/*
 * ProLeap-backed production parser frontend.
 *
 * Runs the ProLeap ANTLR4 COBOL 85 parser (grammar + reference-format
 * preprocessor: fixed/variable/tandem columns, continuation lines,
 * comment/debug indicators, COPY/REPLACE) and lowers the resulting ASG
 * into LegacyMind IR (ir/schema.json).
 *
 * Two-tier honesty contract, reported per file:
 *   frontend  — the grammar + preprocessor accepted the source.
 *   ir        — every construct was lowered into IR. When any construct
 *               falls outside the IR subset the result is ok:false with
 *               EVERY unsupported construct enumerated (not just the
 *               first): the list is the lowering backlog, and nothing
 *               is ever skipped silently.
 *
 * IR parity: for sources inside the stub parser's subset this frontend
 * must produce byte-identical IR (modulo provenance) — same normalized
 * statement text, same refs extraction, same JSON key order. The
 * transpiler replay cache is keyed on IR content, so parity is what
 * keeps committed cache entries valid across parser engines.
 *
 * Output: one JSON document on stdout.
 *   { "ok": true, "format": "FIXED", "ir": { ... } }
 *   { "ok": false, "stage": "frontend"|"asg"|"ir", "format": ...,
 *     "error": "...", "unsupported": ["...", ...] }
 * --batch: read one path per stdin line, emit one NDJSON result per line
 * (single JVM for corpus sweeps).
 */

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.antlr.v4.runtime.ParserRuleContext;

import io.proleap.cobol.asg.metamodel.CompilationUnit;
import io.proleap.cobol.asg.metamodel.Program;
import io.proleap.cobol.asg.metamodel.ProgramUnit;
import io.proleap.cobol.asg.metamodel.data.DataDivision;
import io.proleap.cobol.asg.metamodel.data.datadescription.DataDescriptionEntry;
import io.proleap.cobol.asg.metamodel.data.datadescription.DataDescriptionEntryCondition;
import io.proleap.cobol.asg.metamodel.data.datadescription.DataDescriptionEntryGroup;
import io.proleap.cobol.asg.metamodel.data.datadescription.UsageClause;
import io.proleap.cobol.asg.metamodel.data.datadescription.ValueClause;
import io.proleap.cobol.asg.metamodel.data.datadescription.ValueInterval;
import io.proleap.cobol.asg.metamodel.data.workingstorage.WorkingStorageSection;
import io.proleap.cobol.asg.metamodel.procedure.Paragraph;
import io.proleap.cobol.asg.metamodel.procedure.ProcedureDivision;
import io.proleap.cobol.asg.metamodel.procedure.Statement;
import io.proleap.cobol.asg.metamodel.procedure.StatementTypeEnum;
import io.proleap.cobol.asg.metamodel.procedure.accept.AcceptStatement;
import io.proleap.cobol.asg.metamodel.procedure.compute.ComputeStatement;
import io.proleap.cobol.asg.metamodel.procedure.compute.Store;
import io.proleap.cobol.asg.metamodel.procedure.display.DisplayStatement;
import io.proleap.cobol.asg.metamodel.procedure.ifstmt.IfStatement;
import io.proleap.cobol.asg.metamodel.procedure.move.MoveStatement;
import io.proleap.cobol.asg.metamodel.procedure.move.MoveToStatement;
import io.proleap.cobol.asg.metamodel.procedure.perform.PerformProcedureStatement;
import io.proleap.cobol.asg.metamodel.procedure.perform.PerformStatement;
import io.proleap.cobol.asg.metamodel.procedure.stop.StopStatement;
import io.proleap.cobol.asg.metamodel.procedure.gotostmt.GoToStatement;
import io.proleap.cobol.asg.metamodel.procedure.evaluate.EvaluateStatement;
import io.proleap.cobol.asg.metamodel.procedure.evaluate.WhenPhrase;
import io.proleap.cobol.asg.metamodel.procedure.evaluate.When;
import io.proleap.cobol.asg.metamodel.procedure.evaluate.Condition;
import io.proleap.cobol.asg.metamodel.call.Call;
import io.proleap.cobol.asg.params.CobolParserParams;
import io.proleap.cobol.asg.params.impl.CobolParserParamsImpl;
import io.proleap.cobol.asg.runner.impl.CobolParserRunnerImpl;
import io.proleap.cobol.preprocessor.CobolPreprocessor.CobolSourceFormatEnum;
import io.proleap.cobol.preprocessor.impl.CobolPreprocessorImpl;

public class ProLeapFrontend {

	static final String PARSER_NAME = "legacymind-parse-proleap";
	static final String PARSER_VERSION = "0.1.0+proleap.d1bfe75bdd";

	static final Pattern IDENT = Pattern.compile("[A-Z][A-Z0-9-]*");
	static final Pattern ID_ONLY = Pattern.compile("^[A-Z][A-Z0-9-]*$");
	static final Pattern PROGRAM_ID_RE = Pattern.compile("^[A-Z0-9][A-Z0-9-]*$");
	// Stub-parity tokenizer: quoted strings stay whole, everything else
	// splits on whitespace.
	static final Pattern TOKEN = Pattern.compile("\"[^\"]*\"|'[^']*'|\\S+");

	public static void main(final String[] args) throws Exception {
		String file = null;
		String format = "AUTO";
		boolean batch = false;
		for (int i = 0; i < args.length; i++) {
			switch (args[i]) {
			case "--format":
				format = args[++i].toUpperCase();
				break;
			case "--batch":
				batch = true;
				break;
			default:
				file = args[i];
			}
		}
		if (batch) {
			final BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
			String line;
			while ((line = in.readLine()) != null) {
				if (line.isBlank()) {
					continue;
				}
				final Map<String, Object> result = processQuietly(line.trim(), format);
				result.put("file", line.trim().replace('\\', '/'));
				System.out.println(Json.write(result));
			}
		} else {
			if (file == null) {
				System.err.println("usage: ProLeapFrontend <source.cbl> [--format FIXED|VARIABLE|TANDEM|AUTO] [--batch]");
				System.exit(2);
			}
			final Map<String, Object> result = processQuietly(file, format);
			System.out.println(Json.write(result));
			System.exit(Boolean.TRUE.equals(result.get("ok")) ? 0 : 1);
		}
	}

	static Map<String, Object> processQuietly(final String file, final String format) {
		try {
			return process(file, format);
		} catch (final Throwable t) {
			final Map<String, Object> r = new LinkedHashMap<>();
			r.put("ok", false);
			r.put("stage", "frontend");
			r.put("error", t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage()));
			return r;
		}
	}

	static Map<String, Object> process(final String file, final String format) throws Exception {
		final byte[] raw = Files.readAllBytes(Path.of(file));
		final String text = decode(raw);

		final List<CobolSourceFormatEnum> formats = new ArrayList<>();
		if ("AUTO".equals(format)) {
			formats.add(CobolSourceFormatEnum.FIXED);
			formats.add(CobolSourceFormatEnum.VARIABLE);
			formats.add(CobolSourceFormatEnum.TANDEM);
		} else {
			formats.add(CobolSourceFormatEnum.valueOf(format));
		}

		String firstError = null;
		for (final CobolSourceFormatEnum fmt : formats) {
			final CobolParserParams params = new CobolParserParamsImpl();
			params.setFormat(fmt);
			params.setCopyBookDirectories(Arrays.asList(new File(file).getAbsoluteFile().getParentFile()));

			String preprocessed;
			Program program;
			try {
				preprocessed = new CobolPreprocessorImpl().process(text, params);
				program = new CobolParserRunnerImpl().analyzeCode(text, "MODULE", params);
			} catch (final Throwable t) {
				if (firstError == null) {
					firstError = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
				}
				continue;
			}
			final Map<String, Object> r = new LinkedHashMap<>();
			r.put("ok", true);
			r.put("format", fmt.name());
			try {
				final Lowering lowering = new Lowering(file.replace('\\', '/'), raw, text, preprocessed, fmt, program);
				final Map<String, Object> ir = lowering.lower();
				if (!lowering.unsupported.isEmpty()) {
					r.put("ok", false);
					r.put("stage", "ir");
					r.put("error", lowering.unsupported.size() + " construct(s) outside the IR subset");
					r.put("unsupported", new ArrayList<>(lowering.unsupported));
				} else {
					r.put("ir", ir);
				}
			} catch (final Throwable t) {
				r.put("ok", false);
				r.put("stage", "asg");
				r.put("error", t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage()));
			}
			return r;
		}

		final Map<String, Object> r = new LinkedHashMap<>();
		r.put("ok", false);
		r.put("stage", "frontend");
		r.put("error", firstError == null ? "no source format accepted" : firstError);
		return r;
	}

	/** UTF-8 when valid, ISO-8859-1 otherwise — deterministic, never lossy. */
	static String decode(final byte[] raw) {
		try {
			return StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString();
		} catch (final java.nio.charset.CharacterCodingException e) {
			return new String(raw, StandardCharsets.ISO_8859_1);
		}
	}

	// ------------------------------------------------------------------
	// ASG -> IR lowering
	// ------------------------------------------------------------------

	static final class Lowering {
		final String file;
		final byte[] raw;
		final String preprocessed;
		final CobolSourceFormatEnum format;
		final Program program;

		final List<String> unsupported = new ArrayList<>();
		final List<String> warnings = new ArrayList<>();
		final Set<String> declared = new LinkedHashSet<>();
		final Set<String> paragraphNames = new LinkedHashSet<>();
		/** Paragraph names in source order — the domain for PERFORM THRU ranges. */
		final List<String> paragraphOrder = new ArrayList<>();
		/** 88-level condition name -> {parent item name, value literal}. Pure sugar: expanded into comparisons. */
		final Map<String, String[]> conditionNames = new LinkedHashMap<>();
		/** Non-filler items pending final naming: {itemMap, originalLeafName, ancestors nearest-first}. */
		final List<Object[]> pendingItems = new ArrayList<>();
		/** 88-level captures pending parent finalization: {conditionName, parentItemMap, valueText}. */
		final List<Object[]> pendingConds = new ArrayList<>();
		/** Original leaf name -> entries {finalName, ancestors nearest-first}. Basis for OF/IN resolution. */
		final Map<String, List<Object[]>> leafIndex = new LinkedHashMap<>();
		/** Leaf names declared more than once: bare references to them are ambiguous. */
		final Set<String> duplicatedLeaves = new LinkedHashSet<>();
		/** File I/O stage 1: SELECT name -> assign literal (quotes stripped). */
		final Map<String, String> selectedFiles = new LinkedHashMap<>();
		/** Pending FD links: {fdName, recordItemMap} — record names finalize later. */
		final List<Object[]> pendingFds = new ArrayList<>();
		/** Final record name -> file name (built after finalizeNames). */
		final Map<String, String> recordToFile = new LinkedHashMap<>();
		/** Section name -> its LAST paragraph (or itself when it has none): the THRU endpoint a section PERFORM expands to. */
		final Map<String, String> sectionEnd = new LinkedHashMap<>();

		/** preprocessed line number (1-based) -> original line number; null when inexact. */
		int[] lineMap;

		/** FILLER naming fallback when ProLeap assigns no filler number. */
		int fillerFallback;

		Lowering(final String file, final byte[] raw, final String text, final String preprocessed,
				final CobolSourceFormatEnum format, final Program program) {
			this.file = file;
			this.raw = raw;
			this.preprocessed = preprocessed;
			this.format = format;
			this.program = program;
			buildLineMap(text);
		}

		/**
		 * The ProLeap line writer emits one output line per input line
		 * except continuations (merged into their predecessor). Identify
		 * continuation lines with the same column convention and map
		 * preprocessed lines back to original line numbers. COPY/REPLACE
		 * expansion breaks the correspondence — detected via line-count
		 * mismatch, never guessed.
		 */
		void buildLineMap(final String text) {
			final String[] orig = text.split("\r?\n", -1);
			int origCount = orig.length;
			if (origCount > 0 && orig[origCount - 1].isEmpty()) {
				origCount--; // trailing newline produces one empty split cell
			}
			final List<Integer> nonContinuation = new ArrayList<>();
			for (int i = 0; i < origCount; i++) {
				final String line = orig[i];
				final int indicatorCol = format == CobolSourceFormatEnum.TANDEM ? 0 : 6;
				final boolean continuation = line.length() > indicatorCol && line.charAt(indicatorCol) == '-';
				if (!continuation) {
					nonContinuation.add(i + 1);
				}
			}
			final int preCount = preprocessed.split("\n", -1).length;
			if (preCount == nonContinuation.size()) {
				lineMap = new int[preCount + 1];
				for (int p = 1; p <= preCount; p++) {
					lineMap[p] = nonContinuation.get(p - 1);
				}
			} else {
				lineMap = null;
				unsupported.add("preprocessor changed the line structure (COPY/REPLACE expansion?): "
						+ "span provenance cannot be mapped to original lines yet");
			}
		}

		int mapLine(final int preLine) {
			if (lineMap == null || preLine < 1 || preLine >= lineMap.length) {
				return preLine;
			}
			return lineMap[preLine];
		}

		/**
		 * Stub-parity normalized text of a parse context: substring of the
		 * preprocessed source, tokenized with quoted strings kept whole,
		 * joined with single spaces. Identifier/keyword tokens are
		 * uppercased (COBOL is case-insensitive); quoted literals are not.
		 */
		String textOf(final ParserRuleContext ctx) {
			final String slice = preprocessed.substring(ctx.getStart().getStartIndex(),
					ctx.getStop().getStopIndex() + 1);
			final StringBuilder sb = new StringBuilder();
			final Matcher m = TOKEN.matcher(slice);
			while (m.find()) {
				if (sb.length() > 0) {
					sb.append(' ');
				}
				final String tok = m.group();
				sb.append(tok.startsWith("\"") || tok.startsWith("'") ? tok : tok.toUpperCase());
			}
			return sb.toString();
		}

		/** Stub-parity refs extraction: declared names in order of first appearance. */
		List<String> refsIn(final String text) {
			final List<String> out = new ArrayList<>();
			final Matcher m = IDENT.matcher(text);
			while (m.find()) {
				final String w = m.group();
				if (declared.contains(w) && !out.contains(w)) {
					out.add(w);
				}
			}
			return out;
		}

		Map<String, Object> span(final ParserRuleContext ctx) {
			final Map<String, Object> s = new LinkedHashMap<>();
			s.put("file", file);
			s.put("startLine", mapLine(ctx.getStart().getLine()));
			s.put("endLine", mapLine(ctx.getStop().getLine()));
			return s;
		}

		void reject(final ParserRuleContext ctx, final String what) {
			unsupported.add(what + " (line " + mapLine(ctx.getStart().getLine()) + ")");
		}

		/** Register a procedure name (paragraph or section) — one flat namespace. */
		void registerProcName(final String name, final ParserRuleContext ctx) {
			if (!ID_ONLY.matcher(name).matches()) {
				reject(ctx, "procedure name \"" + name + "\" is not representable in the IR");
				return;
			}
			if (!paragraphNames.add(name)) {
				reject(ctx, "duplicate procedure name " + name + " (section and paragraph names share one namespace)");
				return;
			}
			paragraphOrder.add(name);
		}

		/**
		 * ENVIRONMENT DIVISION, file I/O stage 1: lower FILE-CONTROL SELECT
		 * entries for LINE SEQUENTIAL files assigned to a string literal.
		 * The configuration section is warned (not modeled); other
		 * organizations and non-literal ASSIGNs are rejected.
		 */
		void lowerEnvironment(final io.proleap.cobol.asg.metamodel.environment.EnvironmentDivision ed) {
			if (ed.getConfigurationSection() != null) {
				final ParserRuleContext cctx = ed.getConfigurationSection().getCtx();
				warnings.add("CONFIGURATION SECTION present (line " + mapLine(cctx.getStart().getLine())
						+ ") but not modeled");
			}
			final io.proleap.cobol.asg.metamodel.environment.inputoutput.InputOutputSection ios = ed
					.getInputOutputSection();
			if (ios == null || ios.getFileControlParagraph() == null) {
				return;
			}
			for (final io.proleap.cobol.asg.metamodel.environment.inputoutput.filecontrol.FileControlEntry e : ios
					.getFileControlParagraph().getFileControlEntries()) {
				final ParserRuleContext ctx = e.getCtx();
				final String name = e.getName() != null ? e.getName().toUpperCase() : null;
				if (name == null || !ID_ONLY.matcher(name).matches()) {
					reject(ctx, "SELECT with an unrepresentable file name");
					continue;
				}
				if (e.getAssignClause() == null || e.getAssignClause().getToValueStmt() == null) {
					reject(ctx, "SELECT " + name + " without an ASSIGN TO clause");
					continue;
				}
				final String assignText = textOf(e.getAssignClause().getToValueStmt().getCtx());
				if (!(assignText.startsWith("\"") || assignText.startsWith("'"))) {
					reject(ctx, "SELECT " + name + " ASSIGN TO a non-literal (" + assignText + ")");
					continue;
				}
				final String orgText = e.getOrganizationClause() != null
						? textOf(e.getOrganizationClause().getCtx())
						: "";
				if (!orgText.contains("LINE SEQUENTIAL")) {
					reject(ctx, "SELECT " + name
							+ " with organization other than LINE SEQUENTIAL (file I/O stage 1)");
					continue;
				}
				selectedFiles.put(name, assignText.substring(1, assignText.length() - 1));
			}
		}

		Map<String, Object> lower() {
			final List<CompilationUnit> units = program.getCompilationUnits();
			if (units.isEmpty()) {
				unsupported.add("no compilation unit found");
				return null;
			}
			final CompilationUnit unit = units.get(0);
			if (unit.getProgramUnits().size() != 1) {
				unsupported.add("stacked/nested program units (" + unit.getProgramUnits().size() + ")");
				return null;
			}
			final ProgramUnit pu = unit.getProgramUnit();

			// --- IDENTIFICATION DIVISION ---
			String programId = null;
			if (pu.getIdentificationDivision() == null
					|| pu.getIdentificationDivision().getProgramIdParagraph() == null) {
				unsupported.add("PROGRAM-ID not found in IDENTIFICATION DIVISION");
			} else {
				programId = pu.getIdentificationDivision().getProgramIdParagraph().getName().toUpperCase();
				if (!PROGRAM_ID_RE.matcher(programId).matches()) {
					unsupported.add("program id \"" + programId + "\" is not representable in the IR");
				}
			}

			if (pu.getEnvironmentDivision() != null) {
				lowerEnvironment(pu.getEnvironmentDivision());
			}

			// --- DATA DIVISION ---
			final List<Object> items = new ArrayList<>();
			final DataDivision dd = pu.getDataDivision();
			if (dd != null) {
				if (dd.getFileSection() != null) {
					// File I/O stage 1: each FD must match a lowered SELECT and
					// carry exactly one 01 record, which becomes ordinary storage.
					for (final io.proleap.cobol.asg.metamodel.data.file.FileDescriptionEntry fd : dd.getFileSection()
							.getFileDescriptionEntries()) {
						final ParserRuleContext fctx = ((io.proleap.cobol.asg.metamodel.ASGElement) fd).getCtx();
						final String fdName = fd.getName() != null ? fd.getName().toUpperCase() : null;
						if (fdName == null || !selectedFiles.containsKey(fdName)) {
							reject(fctx, "FD " + fdName + " without a matching LINE SEQUENTIAL SELECT");
							continue;
						}
						final List<io.proleap.cobol.asg.metamodel.data.datadescription.DataDescriptionEntry> recs = fd
								.getRootDataDescriptionEntries();
						if (recs.size() != 1) {
							reject(fctx, "FD " + fdName + " with " + recs.size()
									+ " record layouts (file I/O stage 1 supports exactly one)");
							continue;
						}
						final Object rec = lowerDataItem(recs.get(0), null);
						if (rec != null) {
							items.add(rec);
							pendingFds.add(new Object[] { fdName, rec });
						}
					}
				}
				if (dd.getLinkageSection() != null) {
					reject(dd.getLinkageSection().getCtx(), "LINKAGE SECTION");
				}
				if (dd.getLocalStorageSection() != null) {
					reject(dd.getLocalStorageSection().getCtx(), "LOCAL-STORAGE SECTION");
				}
				if (dd.getCommunicationSection() != null || dd.getScreenSection() != null
						|| dd.getReportSection() != null || dd.getDataBaseSection() != null
						|| dd.getProgramLibrarySection() != null) {
					reject(dd.getCtx(), "DATA DIVISION section outside WORKING-STORAGE");
				}
				final WorkingStorageSection ws = dd.getWorkingStorageSection();
				if (ws != null) {
					for (final DataDescriptionEntry entry : ws.getRootDataDescriptionEntries()) {
						final Object item = lowerDataItem(entry, null);
						if (item != null) {
							items.add(item);
						}
					}
				}
			}
			// Unique final names (duplicated leaves renamed), declared set,
			// leaf index for OF/IN resolution, and 88-level captures.
			finalizeNames();

			// File I/O stage 1: link each FD's (now final) record name to its
			// file and build the files block; every SELECT needs an FD.
			final List<Object> files = new ArrayList<>();
			for (final Object[] pf : pendingFds) {
				@SuppressWarnings("unchecked")
				final Map<String, Object> rec = (Map<String, Object>) pf[1];
				final String fdName = (String) pf[0];
				final String recName = (String) rec.get("name");
				recordToFile.put(recName, fdName);
				final Map<String, Object> f = new LinkedHashMap<>();
				f.put("name", fdName);
				f.put("assign", selectedFiles.get(fdName));
				f.put("organization", "line-sequential");
				f.put("record", recName);
				files.add(f);
			}
			for (final String sel : selectedFiles.keySet()) {
				if (!recordToFile.containsValue(sel)) {
					unsupported.add("SELECT " + sel + " has no FD in the FILE SECTION");
				}
			}

			// --- PROCEDURE DIVISION ---
			final List<Object> paragraphs = new ArrayList<>();
			final List<Object> edges = new ArrayList<>();
			final ProcedureDivision pd = pu.getProcedureDivision();
			if (pd == null || (pd.getParagraphs().isEmpty() && pd.getSections().isEmpty())) {
				unsupported.add("PROCEDURE DIVISION has no paragraphs");
			} else {
				if (pd.getUsingClause() != null || pd.getGivingClause() != null) {
					reject(pd.getCtx(), "PROCEDURE DIVISION USING/GIVING");
				}
				if (pd.getDeclaratives() != null) {
					reject(pd.getDeclaratives().getCtx(), "DECLARATIVES");
				}
				// Statements before the first paragraph header sit in the
				// division's own scope, not in any Paragraph — without this
				// check they would vanish from the IR silently (caught by the
				// corpus sweep: MERGE/PERFORM-UNTIL files ranked IR-complete).
				for (final Statement stray : pd.getStatements()) {
					reject(stray.getCtx(), "statement before the first paragraph header");
				}
				if (pd.getSections().isEmpty()) {
					for (final Paragraph p : pd.getParagraphs()) {
						registerProcName(p.getParagraphName().getName().toUpperCase(), p.getCtx());
					}
					for (final Paragraph p : pd.getParagraphs()) {
						paragraphs.add(lowerParagraph(p));
					}
				} else {
					// Sections flatten onto the paragraph model: each section
					// contributes a synthetic paragraph named after itself
					// (holding the section's own statements, which precede its
					// first paragraph header) followed by its paragraphs, and
					// PERFORM <section> becomes PERFORM <section> THRU <its
					// last paragraph> — the existing THRU machinery does the
					// rest, so no verifier needs section awareness.
					for (final Paragraph p : pd.getParagraphs()) {
						if (p.getSection() == null) {
							reject(p.getCtx(), "paragraph " + p.getParagraphName().getName().toUpperCase()
									+ " outside any section in a sectioned PROCEDURE DIVISION");
						}
					}
					// Pass 1: names + section THRU endpoints (needed before any
					// statement lowering resolves a section PERFORM).
					for (final io.proleap.cobol.asg.metamodel.procedure.Section sec : pd.getSections()) {
						final String sname = sec.getName().toUpperCase();
						registerProcName(sname, sec.getCtx());
						String last = sname;
						for (final Paragraph p : sec.getParagraphs()) {
							final String pname = p.getParagraphName().getName().toUpperCase();
							registerProcName(pname, p.getCtx());
							last = pname;
						}
						sectionEnd.put(sname, last);
					}
					// Pass 2: bodies.
					for (final io.proleap.cobol.asg.metamodel.procedure.Section sec : pd.getSections()) {
						final Map<String, Object> head = new LinkedHashMap<>();
						head.put("name", sec.getName().toUpperCase());
						head.put("span", span(sec.getCtx()));
						head.put("statements", lowerStatements(sec.getStatements()));
						paragraphs.add(head);
						for (final Paragraph p : sec.getParagraphs()) {
							paragraphs.add(lowerParagraph(p));
						}
					}
				}
				// stub-parity CFG: perform edges per paragraph in statement
				// order, then fallthrough edges skipping terminated paragraphs
				for (final Object po : paragraphs) {
					@SuppressWarnings("unchecked")
					final Map<String, Object> pm = (Map<String, Object>) po;
					collectPerformEdges((List<?>) pm.get("statements"), (String) pm.get("name"), edges);
				}
				for (int i = 0; i + 1 < paragraphs.size(); i++) {
					@SuppressWarnings("unchecked")
					final Map<String, Object> pm = (Map<String, Object>) paragraphs.get(i);
					final List<?> stmts = (List<?>) pm.get("statements");
					if (!stmts.isEmpty()) {
						final Object lastKind = ((Map<?, ?>) stmts.get(stmts.size() - 1)).get("kind");
						if ("stop-run".equals(lastKind) || "goback".equals(lastKind)) {
							continue;
						}
					}
					@SuppressWarnings("unchecked")
					final Map<String, Object> next = (Map<String, Object>) paragraphs.get(i + 1);
					final Map<String, Object> e = new LinkedHashMap<>();
					e.put("from", pm.get("name"));
					e.put("to", next.get("name"));
					e.put("kind", "fallthrough");
					edges.add(e);
				}
			}

			// Soundness gate for GO TO: only the structured early-exit of a plain
			// PERFORM THRU range survives; every other shape is enumerated as
			// unsupported here so IR-completeness keeps implying verify-soundness.
			gateGotos(paragraphs);

			if (!unsupported.isEmpty()) {
				return null;
			}

			// --- assemble (key order = stub parser output order) ---
			final Map<String, Object> ir = new LinkedHashMap<>();
			ir.put("irVersion", "0.1.0");
			if (!files.isEmpty()) {
				ir.put("files", files); // omitted entirely for file-less modules (stub parity)
			}
			final Map<String, Object> module = new LinkedHashMap<>();
			module.put("programId", programId);
			module.put("dialect", "cobol85-" + format.name().toLowerCase());
			final Map<String, Object> source = new LinkedHashMap<>();
			source.put("file", file);
			source.put("sha256", sha256(raw));
			module.put("source", source);
			ir.put("module", module);
			final Map<String, Object> dataDivision = new LinkedHashMap<>();
			dataDivision.put("items", items);
			ir.put("dataDivision", dataDivision);
			final Map<String, Object> procedureDivision = new LinkedHashMap<>();
			procedureDivision.put("paragraphs", paragraphs);
			ir.put("procedureDivision", procedureDivision);
			final Map<String, Object> controlFlow = new LinkedHashMap<>();
			controlFlow.put("entry", ((Map<?, ?>) paragraphs.get(0)).get("name"));
			final List<Object> nodes = new ArrayList<>();
			for (final Object po : paragraphs) {
				final Map<String, Object> n = new LinkedHashMap<>();
				n.put("id", ((Map<?, ?>) po).get("name"));
				n.put("kind", "paragraph");
				nodes.add(n);
			}
			controlFlow.put("nodes", nodes);
			controlFlow.put("edges", edges);
			ir.put("controlFlow", controlFlow);
			final Map<String, Object> provenance = new LinkedHashMap<>();
			final Map<String, Object> parser = new LinkedHashMap<>();
			parser.put("name", PARSER_NAME);
			parser.put("version", PARSER_VERSION);
			provenance.put("parser", parser);
			provenance.put("generatedAt", Instant.now().toString());
			provenance.put("warnings", new ArrayList<>(warnings));
			ir.put("provenance", provenance);
			return ir;
		}

		// --- data items ---

		Map<String, Object> lowerDataItem(final DataDescriptionEntry entry, final String parentPath) {
			final ParserRuleContext ctx = ((io.proleap.cobol.asg.metamodel.ASGElement) entry).getCtx();
			final DataDescriptionEntry.DataDescriptionEntryType t = entry.getDataDescriptionEntryType();
			if (t == DataDescriptionEntry.DataDescriptionEntryType.CONDITION) {
				reject(ctx, "88-level condition name");
				return null;
			}
			if (t == DataDescriptionEntry.DataDescriptionEntryType.RENAME) {
				reject(ctx, "66-level RENAMES");
				return null;
			}
			if (t == DataDescriptionEntry.DataDescriptionEntryType.EXEC_SQL) {
				reject(ctx, "EXEC SQL data entry");
				return null;
			}
			final int level = entry.getLevelNumber();
			if (level > 49 && level != 77) {
				reject(ctx, "level-" + level + " data entry");
				return null;
			}
			if (!(entry instanceof DataDescriptionEntryGroup)) {
				reject(ctx, "data entry of unexpected shape");
				return null;
			}
			final DataDescriptionEntryGroup g = (DataDescriptionEntryGroup) entry;
			// FILLER: storage-only, never referable. The synthesized name
			// exists for path uniqueness and MUST NOT enter the declared set.
			final boolean filler = Boolean.TRUE.equals(g.getFiller()) || entry.getName() == null;
			final String name;
			if (filler) {
				final Integer fn = g.getFillerNumber();
				name = "FILLER-" + (fn != null ? fn : ++fillerFallback);
			} else {
				name = entry.getName().toUpperCase();
			}
			if (!ID_ONLY.matcher(name).matches()) {
				reject(ctx, "data name \"" + name + "\" is not representable in the IR");
				return null;
			}
			if (!g.getOccursClauses().isEmpty()) {
				reject(ctx, "OCCURS");
			}
			if (g.getRedefinesClause() != null) {
				reject(ctx, "REDEFINES");
			}
			if (g.getSignClause() != null || g.getJustifiedClause() != null || g.getSynchronizedClause() != null
					|| g.getBlankWhenZeroClause() != null || g.getExternalClause() != null
					|| g.getGlobalClause() != null) {
				reject(ctx, "data clause outside the IR subset (SIGN/JUSTIFIED/SYNC/BLANK/EXTERNAL/GLOBAL)");
			}

			String usage = "DISPLAY";
			if (g.getUsageClause() != null) {
				final UsageClause.UsageClauseType u = g.getUsageClause().getUsageClauseType();
				switch (u) {
				case DISPLAY:
					usage = "DISPLAY";
					break;
				case COMP:
					usage = "COMP";
					break;
				case COMP_3:
					usage = "COMP-3";
					break;
				case BINARY:
					usage = "BINARY";
					break;
				case PACKED_DECIMAL:
					usage = "PACKED-DECIMAL";
					break;
				default:
					reject(ctx, "USAGE " + u);
				}
			}

			String value = null;
			final ValueClause vc = g.getValueClause();
			if (vc != null) {
				final List<ValueInterval> intervals = vc.getValueIntervals();
				if (intervals.size() != 1 || intervals.get(0).getToValueStmt() != null) {
					reject(ctx, "VALUE with multiple literals or THRU");
				} else {
					value = textOf(intervals.get(0).getFromValueStmt().getCtx());
				}
			}

			final String path = parentPath == null ? name : parentPath + "." + name;
			final Map<String, Object> item = new LinkedHashMap<>();
			item.put("level", level);
			item.put("name", name);
			item.put("path", path);
			if (filler) {
				item.put("filler", true);
			}
			if (g.getPictureClause() != null) {
				final String pic = g.getPictureClause().getPictureString();
				item.put("picture", pic);
				try {
					item.put("type", Picture.parse(pic));
				} catch (final IllegalArgumentException e) {
					reject(ctx, e.getMessage());
				}
			}
			item.put("usage", usage);
			if (value != null) {
				item.put("value", value);
			}
			item.put("span", span(ctx));
			final List<Object> children = new ArrayList<>();
			for (final DataDescriptionEntry child : g.getDataDescriptionEntries()) {
				// 88-level condition names are pure sugar: capture the
				// name -> (this item = value) mapping and expand references
				// to comparisons later; never emit them as storage.
				if (child.getDataDescriptionEntryType() == DataDescriptionEntry.DataDescriptionEntryType.CONDITION) {
					captureConditionName(child, item);
					continue;
				}
				final Object c = lowerDataItem(child, path);
				if (c != null) {
					children.add(c);
				}
			}
			item.put("children", children);
			if (!filler) {
				// Final (unique) naming happens in finalizeNames() once every
				// item is known: duplicated leaf names are renamed there.
				final List<String> ancestors = new ArrayList<>();
				if (parentPath != null) {
					final String[] parts = parentPath.split("\\.");
					for (int i = parts.length - 1; i >= 0; i--) {
						ancestors.add(parts[i]); // nearest-first, original names
					}
				}
				pendingItems.add(new Object[] { item, name, ancestors });
			}
			return item;
		}

		/** Record an 88-level condition name against its parent item's single VALUE. */
		void captureConditionName(final DataDescriptionEntry child, final Map<String, Object> parentItem) {
			final ParserRuleContext ctx = ((io.proleap.cobol.asg.metamodel.ASGElement) child).getCtx();
			if (child.getName() == null) {
				reject(ctx, "88-level condition name without a name");
				return;
			}
			final String cn = child.getName().toUpperCase();
			if (!ID_ONLY.matcher(cn).matches()) {
				reject(ctx, "88-level condition name \"" + cn + "\" is not representable in the IR");
				return;
			}
			final ValueClause vc = ((DataDescriptionEntryCondition) child).getValueClause();
			final List<ValueInterval> intervals = vc == null ? List.of() : vc.getValueIntervals();
			// Only a single VALUE lowers soundly to `parent = value`; multiple
			// values or a THRU range would need OR / range predicates the
			// verifier subset does not model, so they are rejected.
			if (intervals.size() != 1 || intervals.get(0).getToValueStmt() != null) {
				reject(ctx, "88-level " + cn + " with multiple values or a THRU range");
				return;
			}
			final String value = textOf(intervals.get(0).getFromValueStmt().getCtx());
			pendingConds.add(new Object[] { cn, parentItem, value });
		}

		/**
		 * Assign final (unique) names once the whole data division is known.
		 * COBOL allows the same leaf name under different groups, referenced
		 * with OF/IN qualification; the IR namespace is flat, so duplicated
		 * leaves are renamed to their hyphen-joined path (SRC-REC.BALANCE ->
		 * SRC-REC-BALANCE) and every qualified reference is resolved to the
		 * final name by resolveQualified(). Bare references to duplicated
		 * leaves are ambiguous and rejected there. Paths keep original names
		 * (source-level provenance).
		 */
		void finalizeNames() {
			final Map<String, List<Object[]>> byLeaf = new LinkedHashMap<>();
			for (final Object[] pi : pendingItems) {
				byLeaf.computeIfAbsent((String) pi[1], k -> new ArrayList<>()).add(pi);
			}
			final Set<String> taken = new LinkedHashSet<>();
			for (final Map.Entry<String, List<Object[]>> e : byLeaf.entrySet()) {
				if (e.getValue().size() == 1) {
					taken.add(e.getKey());
				} else {
					duplicatedLeaves.add(e.getKey());
				}
			}
			for (final String leaf : duplicatedLeaves) {
				for (final Object[] pi : byLeaf.get(leaf)) {
					@SuppressWarnings("unchecked")
					final Map<String, Object> item = (Map<String, Object>) pi[0];
					@SuppressWarnings("unchecked")
					final List<String> ancestors = (List<String>) pi[2];
					final StringBuilder sb = new StringBuilder();
					for (int i = ancestors.size() - 1; i >= 0; i--) {
						sb.append(ancestors.get(i)).append('-'); // root-first
					}
					sb.append(leaf);
					final String finalName = sb.toString();
					if (!ID_ONLY.matcher(finalName).matches() || !taken.add(finalName)) {
						unsupported.add("cannot synthesize a unique name for duplicated data item "
								+ item.get("path") + " (candidate \"" + finalName + "\")");
						continue;
					}
					item.put("name", finalName);
				}
			}
			for (final Object[] pi : pendingItems) {
				@SuppressWarnings("unchecked")
				final Map<String, Object> item = (Map<String, Object>) pi[0];
				declared.add((String) item.get("name"));
				leafIndex.computeIfAbsent((String) pi[1], k -> new ArrayList<>())
						.add(new Object[] { item.get("name"), pi[2] });
			}
			for (final Object[] pc : pendingConds) {
				final String cn = (String) pc[0];
				@SuppressWarnings("unchecked")
				final Map<String, Object> parent = (Map<String, Object>) pc[1];
				if (conditionNames.containsKey(cn)) {
					unsupported.add("88-level condition name " + cn + " is declared more than once");
					continue;
				}
				conditionNames.put(cn, new String[] { (String) parent.get("name"), (String) pc[2] });
			}
		}

		/**
		 * Resolve qualified data references in a normalized operand text:
		 * `LEAF OF G1 [OF G2 ...]` (IN == OF) must match exactly one declared
		 * item whose ancestor chain contains the qualifiers in inner-to-outer
		 * order (COBOL allows skipping levels); the chain is replaced with the
		 * item's final (unique) name. A bare reference to a duplicated leaf is
		 * ambiguous and rejected — never guessed. Returns the rewritten text,
		 * or null after enumerating the problem into `unsupported`.
		 */
		String resolveQualified(final String text, final ParserRuleContext ctx) {
			if (leafIndex.isEmpty() || (!text.contains(" OF ") && !text.contains(" IN ")
					&& duplicatedLeavesAbsent(text))) {
				return text; // fast path: nothing to resolve or validate
			}
			final List<String> toks = new ArrayList<>();
			final Matcher m = TOKEN.matcher(text);
			while (m.find()) {
				toks.add(m.group());
			}
			final List<String> out = new ArrayList<>();
			int i = 0;
			while (i < toks.size()) {
				final String tok = toks.get(i);
				final boolean quoted = tok.startsWith("\"") || tok.startsWith("'");
				if (quoted || !leafIndex.containsKey(tok)) {
					out.add(tok);
					i++;
					continue;
				}
				// gather the OF/IN qualifier chain
				final List<String> quals = new ArrayList<>();
				int j = i + 1;
				while (j + 1 < toks.size() && ("OF".equals(toks.get(j)) || "IN".equals(toks.get(j)))
						&& ID_ONLY.matcher(toks.get(j + 1)).matches()) {
					quals.add(toks.get(j + 1));
					j += 2;
				}
				if (quals.isEmpty()) {
					if (duplicatedLeaves.contains(tok)) {
						reject(ctx, "ambiguous unqualified reference \"" + tok + "\" (declared more than once)");
						return null;
					}
					out.add(tok); // unique leaf keeps its original name
					i++;
					continue;
				}
				final List<Object[]> candidates = new ArrayList<>();
				for (final Object[] entry : leafIndex.get(tok)) {
					@SuppressWarnings("unchecked")
					final List<String> ancestors = (List<String>) entry[1];
					int a = 0;
					boolean matches = true;
					for (final String q : quals) {
						while (a < ancestors.size() && !ancestors.get(a).equals(q)) {
							a++;
						}
						if (a >= ancestors.size()) {
							matches = false;
							break;
						}
						a++;
					}
					if (matches) {
						candidates.add(entry);
					}
				}
				if (candidates.size() != 1) {
					reject(ctx, "qualified reference \"" + tok + " OF " + String.join(" OF ", quals)
							+ "\" resolves to " + candidates.size() + " data item(s)");
					return null;
				}
				out.add((String) candidates.get(0)[0]);
				i = j;
			}
			return String.join(" ", out);
		}

		/** Cheap pre-check: does the text avoid every duplicated leaf name? */
		boolean duplicatedLeavesAbsent(final String text) {
			for (final String d : duplicatedLeaves) {
				if (text.contains(d)) {
					return false;
				}
			}
			return true;
		}

		/**
		 * Expand 88-level condition names in a condition into the equivalent
		 * comparison on the parent item: a bare name becomes `parent = value`,
		 * and `NOT name` becomes `parent <> value`. Non-condition tokens pass
		 * through unchanged, so an ordinary condition is returned verbatim.
		 */
		String expandConditionNames(final String text) {
			if (conditionNames.isEmpty()) {
				return text;
			}
			final List<String> out = new ArrayList<>();
			final Matcher m = TOKEN.matcher(text);
			while (m.find()) {
				final String tok = m.group();
				final String[] cn = conditionNames.get(tok.toUpperCase());
				if (cn == null) {
					out.add(tok);
				} else if (!out.isEmpty() && out.get(out.size() - 1).equals("NOT")) {
					out.remove(out.size() - 1);
					out.add(cn[0]);
					out.add("<>");
					out.add(cn[1]);
				} else {
					out.add(cn[0]);
					out.add("=");
					out.add(cn[1]);
				}
			}
			return String.join(" ", out);
		}

		// --- paragraphs and statements ---

		Map<String, Object> lowerParagraph(final Paragraph p) {
			final Map<String, Object> out = new LinkedHashMap<>();
			out.put("name", p.getParagraphName().getName().toUpperCase());
			out.put("span", span(p.getCtx()));
			out.put("statements", lowerStatements(p.getStatements()));
			return out;
		}

		List<Object> lowerStatements(final List<Statement> statements) {
			final List<Object> out = new ArrayList<>();
			for (final Statement s : statements) {
				lowerStatementInto(s, out);
			}
			return out;
		}

		void lowerStatementInto(final Statement s, final List<Object> out) {
			final ParserRuleContext ctx = s.getCtx();
			final StatementTypeEnum type = (StatementTypeEnum) s.getStatementType();
			switch (type) {
			case MOVE:
				add(out, lowerMove((MoveStatement) s));
				return;
			case COMPUTE:
				add(out, lowerCompute((ComputeStatement) s));
				return;
			case IF:
				add(out, lowerIf((IfStatement) s));
				return;
			case PERFORM:
				add(out, lowerPerform((PerformStatement) s));
				return;
			case DISPLAY:
				add(out, lowerDisplay((DisplayStatement) s));
				return;
			case ACCEPT:
				add(out, lowerAccept((AcceptStatement) s));
				return;
			case ADD:
				lowerAdd((io.proleap.cobol.asg.metamodel.procedure.add.AddStatement) s, out);
				return;
			case SUBTRACT:
				lowerSubtract((io.proleap.cobol.asg.metamodel.procedure.subtract.SubtractStatement) s, out);
				return;
			case MULTIPLY:
				lowerMultiply((io.proleap.cobol.asg.metamodel.procedure.multiply.MultiplyStatement) s, out);
				return;
			case DIVIDE:
				lowerDivide((io.proleap.cobol.asg.metamodel.procedure.divide.DivideStatement) s, out);
				return;
			case EXIT: {
				// EXIT alone is a no-op paragraph terminator; EXIT PROGRAM is a
				// CALL return and stays outside the subset.
				if (!"EXIT".equals(textOf(ctx))) {
					reject(ctx, textOf(ctx) + " statement");
					return;
				}
				final Map<String, Object> m = new LinkedHashMap<>();
				m.put("kind", "exit");
				m.put("text", "EXIT");
				m.put("span", span(ctx));
				out.add(m);
				return;
			}
			case STOP: {
				final StopStatement stop = (StopStatement) s;
				if (stop.getStopType() != StopStatement.StopType.STOP_RUN) {
					reject(ctx, "STOP " + stop.getStopType());
					return;
				}
				final Map<String, Object> m = new LinkedHashMap<>();
				m.put("kind", "stop-run");
				m.put("text", "STOP RUN");
				m.put("span", span(ctx));
				out.add(m);
				return;
			}
			case GO_BACK: {
				final Map<String, Object> m = new LinkedHashMap<>();
				m.put("kind", "goback");
				m.put("text", "GOBACK");
				m.put("span", span(ctx));
				out.add(m);
				return;
			}
			case GO_TO: {
				// A plain GO TO <paragraph> is lowered faithfully to a go-to node;
				// whether it is a SOUND early-exit (the only shape the verifier
				// admits) is decided by gateGotos() once every paragraph and
				// PERFORM range is known. GO TO ... DEPENDING ON is a computed
				// jump outside the subset and is rejected here.
				final GoToStatement gt = (GoToStatement) s;
				if (gt.getGoToType() != GoToStatement.GoToType.SIMPLE || gt.getSimple() == null) {
					reject(ctx, "GO TO ... DEPENDING ON (computed jump)");
					return;
				}
				final Call proc = gt.getSimple().getProcedureCall();
				if (proc == null || proc.getName() == null) {
					reject(ctx, "GO TO with no resolvable procedure target");
					return;
				}
				final String target = proc.getName().toUpperCase();
				if (!ID_ONLY.matcher(target).matches()) {
					reject(ctx, "GO TO target \"" + target + "\" is not representable in the IR");
					return;
				}
				final Map<String, Object> m = new LinkedHashMap<>();
				m.put("kind", "go-to");
				m.put("target", target);
				m.put("text", textOf(ctx));
				m.put("span", span(ctx));
				out.add(m);
				return;
			}
			case SET: {
				// SET condition-name TO TRUE is the write side of 88-levels: pure
				// sugar for MOVE <the 88's VALUE> TO <its parent item> (the read
				// side, IF condition-name, is expanded elsewhere). Only this form
				// is in the subset; SET UP/DOWN BY (index), SET ... TO a
				// value/ON/OFF/FALSE, and SET on a non-condition target are
				// rejected. Multiple condition names in one SET emit one MOVE each.
				final io.proleap.cobol.asg.metamodel.procedure.set.SetStatement set =
						(io.proleap.cobol.asg.metamodel.procedure.set.SetStatement) s;
				if (set.getSetType() != io.proleap.cobol.asg.metamodel.procedure.set.SetStatement.SetType.TO) {
					reject(ctx, "SET ... UP/DOWN BY (index adjustment, outside the subset)");
					return;
				}
				final List<Map<String, Object>> moves = new ArrayList<>();
				for (final io.proleap.cobol.asg.metamodel.procedure.set.SetTo st : set.getSetTos()) {
					final List<io.proleap.cobol.asg.metamodel.procedure.set.Value> vals = st.getValues();
					if (vals.size() != 1 || vals.get(0).getValueStmt() == null
							|| !"TRUE".equals(textOf(vals.get(0).getValueStmt().getCtx()))) {
						reject(ctx, "SET target(s) TO a value other than TRUE (only SET condition-name TO TRUE is supported)");
						return;
					}
					for (final io.proleap.cobol.asg.metamodel.procedure.set.To to : st.getTos()) {
						final Call call = to.getToCall();
						final String cn = call != null && call.getName() != null ? call.getName().toUpperCase() : null;
						final String[] parentValue = cn != null ? conditionNames.get(cn) : null;
						if (parentValue == null) {
							reject(ctx, "SET " + (cn != null ? cn : "target")
									+ " TO TRUE where it is not an 88-level condition name in this program");
							return;
						}
						final Map<String, Object> mv = new LinkedHashMap<>();
						mv.put("kind", "move");
						final Map<String, Object> from = new LinkedHashMap<>();
						from.put("text", parentValue[1]);
						from.put("refs", refsIn(parentValue[1]));
						mv.put("from", from);
						final List<Object> toList = new ArrayList<>();
						toList.add(parentValue[0]);
						mv.put("to", toList);
						mv.put("text", textOf(ctx));
						mv.put("span", span(ctx));
						moves.add(mv);
					}
				}
				for (final Map<String, Object> mv : moves) {
					out.add(mv);
				}
				return;
			}
			case EVALUATE:
				lowerEvaluate((EvaluateStatement) s, out);
				return;
			case OPEN: {
				// File I/O stage 1: OPEN OUTPUT of lowered files only.
				final io.proleap.cobol.asg.metamodel.procedure.open.OpenStatement o =
						(io.proleap.cobol.asg.metamodel.procedure.open.OpenStatement) s;
				if (!o.getInputPhrases().isEmpty() || !o.getInputOutputPhrases().isEmpty()
						|| !o.getExtendPhrases().isEmpty()) {
					reject(ctx, "OPEN INPUT/I-O/EXTEND (file I/O stage 1 supports OPEN OUTPUT only)");
					return;
				}
				for (final io.proleap.cobol.asg.metamodel.procedure.open.OutputPhrase op : o.getOutputPhrases()) {
					for (final io.proleap.cobol.asg.metamodel.procedure.open.Output ou : op.getOutputs()) {
						final String f = ou.getFileCall() != null && ou.getFileCall().getName() != null
								? ou.getFileCall().getName().toUpperCase()
								: null;
						if (f == null || !selectedFiles.containsKey(f)) {
							reject(ctx, "OPEN OUTPUT of \"" + f + "\" which is not a lowered file");
							return;
						}
						final Map<String, Object> m = new LinkedHashMap<>();
						m.put("kind", "open");
						m.put("file", f);
						m.put("text", textOf(ctx));
						m.put("span", span(ctx));
						out.add(m);
					}
				}
				return;
			}
			case WRITE: {
				final io.proleap.cobol.asg.metamodel.procedure.write.WriteStatement w =
						(io.proleap.cobol.asg.metamodel.procedure.write.WriteStatement) s;
				if (w.getFrom() != null || w.getAdvancingPhrase() != null || w.getAtEndOfPagePhrase() != null
						|| w.getNotAtEndOfPagePhrase() != null || w.getInvalidKeyPhrase() != null
						|| w.getNotInvalidKeyPhrase() != null) {
					reject(ctx, "WRITE with FROM/ADVANCING/END-OF-PAGE/INVALID KEY (outside file I/O stage 1)");
					return;
				}
				final String recText = w.getRecordCall() != null
						? resolveQualified(textOf(w.getRecordCall().getCtx()), ctx)
						: null;
				if (recText == null) {
					return;
				}
				final String file = recordToFile.get(recText);
				if (file == null) {
					reject(ctx, "WRITE " + recText + " which is not a file record");
					return;
				}
				final Map<String, Object> m = new LinkedHashMap<>();
				m.put("kind", "write");
				m.put("record", recText);
				m.put("file", file);
				m.put("text", textOf(ctx));
				m.put("span", span(ctx));
				out.add(m);
				return;
			}
			case CLOSE: {
				final io.proleap.cobol.asg.metamodel.procedure.close.CloseStatement c =
						(io.proleap.cobol.asg.metamodel.procedure.close.CloseStatement) s;
				for (final io.proleap.cobol.asg.metamodel.procedure.close.CloseFile cf : c.getCloseFiles()) {
					final String f = cf.getFileCall() != null && cf.getFileCall().getName() != null
							? cf.getFileCall().getName().toUpperCase()
							: null;
					if (f == null || !selectedFiles.containsKey(f)) {
						reject(ctx, "CLOSE of \"" + f + "\" which is not a lowered file");
						return;
					}
					final Map<String, Object> m = new LinkedHashMap<>();
					m.put("kind", "close");
					m.put("file", f);
					m.put("text", textOf(ctx));
					m.put("span", span(ctx));
					out.add(m);
				}
				return;
			}
			default:
				reject(ctx, type + " statement");
			}
		}

		static void add(final List<Object> out, final Map<String, Object> m) {
			if (m != null) {
				out.add(m);
			}
		}

		// --- arithmetic statement family: lowered to compute -------------
		//
		// ADD/SUBTRACT/MULTIPLY/DIVIDE become one compute per receiving
		// field with a synthesized expression; the statement `text` keeps
		// the original source for provenance. COBOL evaluates source
		// operands once before any store, so when a receiving field also
		// appears among the source operands AND there are multiple
		// receivers, sequential computes would read a stale-free value the
		// original never saw — that shape is rejected, not mis-lowered.
		// CORRESPONDING, ON SIZE ERROR, and REMAINDER are rejected.

		/** Receiving field of one lowered compute: name + its ROUNDED flag. */
		static final class ArithTarget {
			final String name;
			final boolean rounded;

			ArithTarget(final String name, final boolean rounded) {
				this.name = name;
				this.rounded = rounded;
			}
		}

		String arithOperand(final ParserRuleContext operandCtx, final ParserRuleContext stmtCtx, final String verb) {
			final String t = resolveQualified(textOf(operandCtx), stmtCtx);
			if (t == null) {
				return null;
			}
			if (t.contains(" ")) {
				reject(stmtCtx, verb + " operand \"" + t + "\" (qualified/subscripted)");
				return null;
			}
			return t;
		}

		ArithTarget arithTarget(final Call call, final boolean rounded, final ParserRuleContext stmtCtx,
				final String verb) {
			final String t = resolveQualified(textOf(call.getCtx()), stmtCtx);
			if (t == null) {
				return null;
			}
			if (!ID_ONLY.matcher(t).matches()) {
				reject(stmtCtx, verb + " receiving field \"" + t + "\" (qualified/subscripted)");
				return null;
			}
			return new ArithTarget(t, rounded);
		}

		/** Emit one compute per target; template's %T is the target name. */
		void emitComputes(final ParserRuleContext ctx, final List<Object> out, final List<ArithTarget> targets,
				final String template, final List<String> sources) {
			if (targets.isEmpty()) {
				reject(ctx, "arithmetic statement without receiving fields");
				return;
			}
			if (targets.size() > 1) {
				final Set<String> names = new LinkedHashSet<>();
				for (final ArithTarget t : targets) {
					if (!names.add(t.name)) {
						reject(ctx, "arithmetic statement with duplicate receiving fields");
						return;
					}
				}
				for (final String src : sources) {
					if (names.contains(src)) {
						reject(ctx, "arithmetic operand \"" + src
								+ "\" is also one of several receiving fields (single-evaluation semantics)");
						return;
					}
				}
			}
			final String text = textOf(ctx);
			for (final ArithTarget t : targets) {
				final String exprText = template.replace("%T", t.name);
				final Map<String, Object> compute = new LinkedHashMap<>();
				compute.put("kind", "compute");
				compute.put("target", t.name);
				compute.put("rounded", t.rounded);
				final Map<String, Object> expr = new LinkedHashMap<>();
				expr.put("text", exprText);
				expr.put("refs", refsIn(exprText));
				compute.put("expression", expr);
				compute.put("text", text);
				compute.put("span", span(ctx));
				out.add(compute);
			}
		}

		void lowerAdd(final io.proleap.cobol.asg.metamodel.procedure.add.AddStatement s, final List<Object> out) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getOnSizeErrorPhrase() != null || s.getNotOnSizeErrorPhrase() != null) {
				reject(ctx, "ADD ... ON SIZE ERROR");
				return;
			}
			final List<String> sources = new ArrayList<>();
			final List<ArithTarget> targets = new ArrayList<>();
			final String template;
			switch (s.getAddType()) {
			case TO: {
				final io.proleap.cobol.asg.metamodel.procedure.add.AddToStatement at = s.getAddToStatement();
				for (final io.proleap.cobol.asg.metamodel.procedure.add.From f : at.getFroms()) {
					final String o = arithOperand(f.getCtx(), ctx, "ADD");
					if (o == null) {
						return;
					}
					sources.add(o);
				}
				for (final io.proleap.cobol.asg.metamodel.procedure.add.To t : at.getTos()) {
					final ArithTarget target = arithTarget(t.getToCall(), t.isRounded(), ctx, "ADD");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = "%T + " + String.join(" + ", sources);
				break;
			}
			case TO_GIVING: {
				final io.proleap.cobol.asg.metamodel.procedure.add.AddToGivingStatement ag = s.getAddToGivingStatement();
				for (final io.proleap.cobol.asg.metamodel.procedure.add.From f : ag.getFroms()) {
					final String o = arithOperand(f.getCtx(), ctx, "ADD");
					if (o == null) {
						return;
					}
					sources.add(o);
				}
				for (final io.proleap.cobol.asg.metamodel.procedure.add.ToGiving t : ag.getTos()) {
					final String o = arithOperand(t.getCtx(), ctx, "ADD");
					if (o == null) {
						return;
					}
					sources.add(o);
				}
				for (final io.proleap.cobol.asg.metamodel.procedure.add.Giving g : ag.getGivings()) {
					final ArithTarget target = arithTarget(g.getGivingCall(), g.isRounded(), ctx, "ADD");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = String.join(" + ", sources);
				break;
			}
			default:
				reject(ctx, "ADD CORRESPONDING");
				return;
			}
			emitComputes(ctx, out, targets, template, sources);
		}

		void lowerSubtract(final io.proleap.cobol.asg.metamodel.procedure.subtract.SubtractStatement s,
				final List<Object> out) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getOnSizeErrorPhrase() != null || s.getNotOnSizeErrorPhrase() != null) {
				reject(ctx, "SUBTRACT ... ON SIZE ERROR");
				return;
			}
			final List<String> sources = new ArrayList<>();
			final List<ArithTarget> targets = new ArrayList<>();
			final String template;
			switch (s.getSubtractType()) {
			case FROM: {
				final io.proleap.cobol.asg.metamodel.procedure.subtract.SubtractFromStatement sf = s
						.getSubtractFromStatement();
				final List<String> subs = new ArrayList<>();
				for (final io.proleap.cobol.asg.metamodel.procedure.subtract.Subtrahend sub : sf.getSubtrahends()) {
					final String o = arithOperand(sub.getCtx(), ctx, "SUBTRACT");
					if (o == null) {
						return;
					}
					subs.add(o);
				}
				sources.addAll(subs);
				for (final io.proleap.cobol.asg.metamodel.procedure.subtract.Minuend m : sf.getMinuends()) {
					final ArithTarget target = arithTarget(m.getMinuendCall(), m.isRounded(), ctx, "SUBTRACT");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = "%T - " + String.join(" - ", subs);
				break;
			}
			case FROM_GIVING: {
				final io.proleap.cobol.asg.metamodel.procedure.subtract.SubtractFromGivingStatement sg = s
						.getSubtractFromGivingStatement();
				final String minuend = arithOperand(sg.getMinuend().getCtx(), ctx, "SUBTRACT");
				if (minuend == null) {
					return;
				}
				sources.add(minuend);
				final List<String> subs = new ArrayList<>();
				for (final io.proleap.cobol.asg.metamodel.procedure.subtract.Subtrahend sub : sg.getSubtrahends()) {
					final String o = arithOperand(sub.getCtx(), ctx, "SUBTRACT");
					if (o == null) {
						return;
					}
					subs.add(o);
				}
				sources.addAll(subs);
				for (final io.proleap.cobol.asg.metamodel.procedure.subtract.Giving g : sg.getGivings()) {
					final ArithTarget target = arithTarget(g.getGivingCall(), g.isRounded(), ctx, "SUBTRACT");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = minuend + " - " + String.join(" - ", subs);
				break;
			}
			default:
				reject(ctx, "SUBTRACT CORRESPONDING");
				return;
			}
			emitComputes(ctx, out, targets, template, sources);
		}

		void lowerMultiply(final io.proleap.cobol.asg.metamodel.procedure.multiply.MultiplyStatement s,
				final List<Object> out) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getOnSizeErrorPhrase() != null || s.getNotOnSizeErrorPhrase() != null) {
				reject(ctx, "MULTIPLY ... ON SIZE ERROR");
				return;
			}
			final String op1 = arithOperand(s.getOperandValueStmt().getCtx(), ctx, "MULTIPLY");
			if (op1 == null) {
				return;
			}
			final List<String> sources = new ArrayList<>(List.of(op1));
			final List<ArithTarget> targets = new ArrayList<>();
			final String template;
			if (s.getMultiplyType() == io.proleap.cobol.asg.metamodel.procedure.multiply.MultiplyStatement.MultiplyType.BY) {
				for (final io.proleap.cobol.asg.metamodel.procedure.multiply.ByOperand b : s.getByPhrase()
						.getByOperands()) {
					final ArithTarget target = arithTarget(b.getOperandCall(), b.isRounded(), ctx, "MULTIPLY");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = "%T * " + op1;
			} else {
				final io.proleap.cobol.asg.metamodel.procedure.multiply.GivingPhrase gp = s.getGivingPhrase();
				final String op2 = arithOperand(gp.getGivingOperand().getCtx(), ctx, "MULTIPLY");
				if (op2 == null) {
					return;
				}
				sources.add(op2);
				for (final io.proleap.cobol.asg.metamodel.procedure.multiply.GivingResult g : gp.getGivingResults()) {
					final ArithTarget target = arithTarget(g.getResultCall(), g.isRounded(), ctx, "MULTIPLY");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = op1 + " * " + op2;
			}
			emitComputes(ctx, out, targets, template, sources);
		}

		void lowerDivide(final io.proleap.cobol.asg.metamodel.procedure.divide.DivideStatement s,
				final List<Object> out) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getOnSizeErrorPhrase() != null || s.getNotOnSizeErrorPhrase() != null) {
				reject(ctx, "DIVIDE ... ON SIZE ERROR");
				return;
			}
			if (s.getRemainder() != null) {
				reject(ctx, "DIVIDE ... REMAINDER");
				return;
			}
			final String op1 = arithOperand(s.getOperandValueStmt().getCtx(), ctx, "DIVIDE");
			if (op1 == null) {
				return;
			}
			final List<String> sources = new ArrayList<>(List.of(op1));
			final List<ArithTarget> targets = new ArrayList<>();
			final String template;
			switch (s.getDivideType()) {
			case INTO: {
				// DIVIDE d INTO t: t = t / d
				for (final io.proleap.cobol.asg.metamodel.procedure.divide.Into into : s.getDivideIntoStatement()
						.getIntos()) {
					final ArithTarget target = arithTarget(into.getGivingCall(), into.isRounded(), ctx, "DIVIDE");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = "%T / " + op1;
				break;
			}
			case INTO_GIVING: {
				// DIVIDE d INTO n GIVING g: g = n / d
				final io.proleap.cobol.asg.metamodel.procedure.divide.DivideIntoGivingStatement dig = s
						.getDivideIntoGivingStatement();
				final String n = arithOperand(dig.getIntoValueStmt().getCtx(), ctx, "DIVIDE");
				if (n == null) {
					return;
				}
				sources.add(n);
				for (final io.proleap.cobol.asg.metamodel.procedure.divide.Giving g : dig.getGivingPhrase()
						.getGivings()) {
					final ArithTarget target = arithTarget(g.getGivingCall(), g.isRounded(), ctx, "DIVIDE");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = n + " / " + op1;
				break;
			}
			default: {
				// DIVIDE n BY d GIVING g: g = n / d
				final io.proleap.cobol.asg.metamodel.procedure.divide.DivideByGivingStatement dbg = s
						.getDivideByGivingStatement();
				final String d = arithOperand(dbg.getByValueStmt().getCtx(), ctx, "DIVIDE");
				if (d == null) {
					return;
				}
				sources.add(d);
				for (final io.proleap.cobol.asg.metamodel.procedure.divide.Giving g : dbg.getGivingPhrase()
						.getGivings()) {
					final ArithTarget target = arithTarget(g.getGivingCall(), g.isRounded(), ctx, "DIVIDE");
					if (target == null) {
						return;
					}
					targets.add(target);
				}
				template = op1 + " / " + d;
				break;
			}
			}
			emitComputes(ctx, out, targets, template, sources);
		}

		Map<String, Object> lowerMove(final MoveStatement s) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getMoveType() != MoveStatement.MoveType.MOVE_TO) {
				reject(ctx, "MOVE CORRESPONDING");
				return null;
			}
			final MoveToStatement mt = s.getMoveToStatement();
			final String fromText = resolveQualified(textOf(mt.getSendingArea().getCtx()), ctx);
			if (fromText == null) {
				return null;
			}
			final List<String> to = new ArrayList<>();
			for (final Call receiving : mt.getReceivingAreaCalls()) {
				final String target = resolveQualified(textOf(receiving.getCtx()), ctx);
				if (target == null) {
					return null;
				}
				if (!ID_ONLY.matcher(target).matches()) {
					reject(ctx, "MOVE target \"" + target + "\" (qualified/subscripted)");
					return null;
				}
				to.add(target);
			}
			final Map<String, Object> out = new LinkedHashMap<>();
			out.put("kind", "move");
			final Map<String, Object> from = new LinkedHashMap<>();
			from.put("text", fromText);
			from.put("refs", refsIn(fromText));
			out.put("from", from);
			out.put("to", to);
			out.put("text", textOf(ctx));
			out.put("span", span(ctx));
			return out;
		}

		Map<String, Object> lowerCompute(final ComputeStatement s) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getOnSizeErrorPhrase() != null || s.getNotOnSizeErrorPhrase() != null) {
				reject(ctx, "COMPUTE ... ON SIZE ERROR");
				return null;
			}
			if (s.getStores().size() != 1) {
				reject(ctx, "COMPUTE with multiple receiving fields");
				return null;
			}
			final Store store = s.getStores().get(0);
			final String target = resolveQualified(textOf(store.getStoreCall().getCtx()), ctx);
			if (target == null) {
				return null;
			}
			if (!ID_ONLY.matcher(target).matches()) {
				reject(ctx, "COMPUTE target \"" + target + "\" (qualified/subscripted)");
				return null;
			}
			final String exprText = resolveQualified(textOf(s.getArithmeticExpression().getCtx()), ctx);
			if (exprText == null) {
				return null;
			}
			final Map<String, Object> out = new LinkedHashMap<>();
			out.put("kind", "compute");
			out.put("target", target);
			out.put("rounded", store.isRounded());
			final Map<String, Object> expr = new LinkedHashMap<>();
			expr.put("text", exprText);
			expr.put("refs", refsIn(exprText));
			out.put("expression", expr);
			out.put("text", textOf(ctx));
			out.put("span", span(ctx));
			return out;
		}

		Map<String, Object> lowerIf(final IfStatement s) {
			final ParserRuleContext ctx = s.getCtx();
			// Period-terminated IFs are accepted: the ANTLR grammar resolves
			// the dangling-ELSE exactly as COBOL 85 does (ELSE binds to the
			// nearest unmatched IF, the sentence period closes everything),
			// so the ASG nesting is already the correct semantics.
			if (s.getThen() == null || s.getThen().isNextSentence()) {
				reject(ctx, "IF ... NEXT SENTENCE");
				return null;
			}
			final String condResolved = resolveQualified(textOf(s.getCondition().getCtx()), ctx);
			if (condResolved == null) {
				return null;
			}
			final String condText = expandConditionNames(condResolved);
			final Map<String, Object> out = new LinkedHashMap<>();
			out.put("kind", "if");
			final Map<String, Object> cond = new LinkedHashMap<>();
			cond.put("text", condText);
			cond.put("refs", refsIn(condText));
			out.put("condition", cond);
			out.put("then", lowerStatements(s.getThen().getStatements()));
			out.put("text", "IF " + condText);
			final Map<String, Object> sp = new LinkedHashMap<>();
			sp.put("file", file);
			sp.put("startLine", mapLine(ctx.getStart().getLine()));
			sp.put("endLine", mapLine(ctx.getStop().getLine()));
			out.put("span", sp);
			if (s.getElse() != null) {
				if (s.getElse().isNextSentence()) {
					reject(ctx, "ELSE NEXT SENTENCE");
					return null;
				}
				// stub parity: "else" is set after the object literal, so it
				// serializes last
				out.put("else", lowerStatements(s.getElse().getStatements()));
			}
			return out;
		}

		/**
		 * EVALUATE is pure structured sugar: it lowers to a nested if/else chain
		 * over the existing `if` IR, so the verifiers need no EVALUATE awareness.
		 * Sound stage-1 subset: a single subject (no ALSO), one WHEN test per
		 * phrase (no OR), and either
		 *   - EVALUATE <subject> WHEN <value>  ->  IF <subject> = <value>, or
		 *   - EVALUATE TRUE     WHEN <cond>     ->  IF <cond>,
		 * with an optional WHEN OTHER as the innermost else. THRU ranges, WHEN
		 * ANY, WHEN NOT, boolean-literal WHENs, EVALUATE FALSE, and mixed
		 * subject/condition forms are rejected — never mis-lowered.
		 */
		void lowerEvaluate(final EvaluateStatement e, final List<Object> out) {
			final ParserRuleContext ctx = e.getCtx();
			if (!e.getAlsoSelects().isEmpty()) {
				reject(ctx, "EVALUATE ... ALSO (multiple subjects)");
				return;
			}
			if (e.getSelect() == null || e.getSelect().getSelectValueStmt() == null) {
				reject(ctx, "EVALUATE without a resolvable subject");
				return;
			}
			final String subject = resolveQualified(textOf(e.getSelect().getSelectValueStmt().getCtx()), ctx);
			if (subject == null) {
				return;
			}
			if ("FALSE".equals(subject)) {
				reject(ctx, "EVALUATE FALSE");
				return;
			}
			final boolean conditionMode = "TRUE".equals(subject);
			if (!conditionMode && subject.contains(" ")) {
				reject(ctx, "EVALUATE subject \"" + subject + "\" (qualified/subscripted or expression)");
				return;
			}
			final List<String> condTexts = new ArrayList<>();
			final List<List<Object>> thenBodies = new ArrayList<>();
			for (final WhenPhrase wp : e.getWhenPhrases()) {
				if (wp.getWhens().size() != 1) {
					reject(ctx, "EVALUATE WHEN with multiple values in one phrase (OR)");
					return;
				}
				final When w = wp.getWhens().get(0);
				if (!w.getAlsoConditions().isEmpty()) {
					reject(ctx, "EVALUATE WHEN ... ALSO");
					return;
				}
				final Condition c = w.getCondition();
				if (c.isNot()) {
					reject(ctx, "EVALUATE WHEN NOT");
					return;
				}
				final Condition.ConditionType ct = c.getConditionType();
				final String cond;
				if (conditionMode) {
					if (ct != Condition.ConditionType.CONDITION || c.getConditionValueStmt() == null) {
						reject(ctx, "EVALUATE TRUE WHEN " + ct + " (only a relational/condition WHEN is supported)");
						return;
					}
					final String resolved = resolveQualified(textOf(c.getConditionValueStmt().getCtx()), ctx);
					if (resolved == null) {
						return;
					}
					cond = resolved;
				} else {
					if (ct != Condition.ConditionType.VALUE || c.getValue() == null
							|| c.getValue().getValueStmt() == null) {
						reject(ctx, "EVALUATE <subject> WHEN " + ct + " (THRU range / ANY / condition outside the subset)");
						return;
					}
					final String resolved = resolveQualified(textOf(c.getValue().getValueStmt().getCtx()), ctx);
					if (resolved == null) {
						return;
					}
					cond = subject + " = " + resolved;
				}
				condTexts.add(expandConditionNames(cond));
				thenBodies.add(lowerStatements(wp.getStatements()));
			}
			final List<Object> otherBody = e.getWhenOther() != null
					? lowerStatements(e.getWhenOther().getStatements())
					: new ArrayList<>();
			if (condTexts.isEmpty()) {
				// EVALUATE with only WHEN OTHER (or empty): just the other body.
				for (final Object m : otherBody) {
					out.add(m);
				}
				return;
			}
			// Fold phrases from last to first into a nested if/else chain; WHEN
			// OTHER (possibly empty) is the innermost else.
			List<Object> elseChain = otherBody;
			for (int i = condTexts.size() - 1; i >= 0; i--) {
				final Map<String, Object> ifNode = new LinkedHashMap<>();
				ifNode.put("kind", "if");
				final Map<String, Object> cond = new LinkedHashMap<>();
				cond.put("text", condTexts.get(i));
				cond.put("refs", refsIn(condTexts.get(i)));
				ifNode.put("condition", cond);
				ifNode.put("then", thenBodies.get(i));
				ifNode.put("text", "IF " + condTexts.get(i));
				ifNode.put("span", span(ctx));
				if (!elseChain.isEmpty()) {
					ifNode.put("else", elseChain); // key order: else serializes last
				}
				final List<Object> wrapped = new ArrayList<>();
				wrapped.add(ifNode);
				elseChain = wrapped;
			}
			for (final Object m : elseChain) {
				out.add(m);
			}
		}

		Map<String, Object> lowerPerform(final PerformStatement s) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getPerformStatementType() != PerformStatement.PerformStatementType.PROCEDURE) {
				reject(ctx, "inline PERFORM");
				return null;
			}
			final PerformProcedureStatement pp = s.getPerformProcedureStatement();
			final List<io.proleap.cobol.asg.metamodel.call.Call> calls = pp.getCalls();
			if (calls.isEmpty()) {
				reject(ctx, "PERFORM with no procedure target");
				return null;
			}
			final String target = calls.get(0).getName().toUpperCase();
			// PERFORM <section>: one SECTION_CALL — expand to the section's own
			// THRU range (its synthetic header paragraph through its last
			// paragraph), which the existing range machinery inlines.
			if (calls.get(0).getCallType() == io.proleap.cobol.asg.metamodel.call.Call.CallType.SECTION_CALL) {
				if (calls.size() > 1) {
					reject(ctx, "PERFORM ... THRU involving a section");
					return null;
				}
				final String end = sectionEnd.get(target);
				if (end == null) {
					reject(ctx, "PERFORM of unknown section " + target);
					return null;
				}
				return finishPerform(s, pp, ctx, target, end.equals(target) ? null : end);
			}
			// PERFORM <a> THRU <b>: ProLeap resolves a valid forward range into
			// the full ordered paragraph list. Accept only when the returned
			// calls are exactly the contiguous source-order slice starting at
			// the target; a backward or non-adjacent range comes back as two
			// non-contiguous endpoints and is rejected, not mis-lowered.
			String thru = null;
			if (calls.size() > 1) {
				final List<String> names = new ArrayList<>();
				for (final io.proleap.cobol.asg.metamodel.call.Call c : calls) {
					names.add(c.getName().toUpperCase());
				}
				final String last = names.get(names.size() - 1);
				if (!last.equals(target)) { // A THRU A resolves to a plain PERFORM of A
					final int fromIdx = paragraphOrder.indexOf(target);
					boolean contiguous = fromIdx >= 0;
					for (int i = 0; i < names.size() && contiguous; i++) {
						final int want = fromIdx + i;
						contiguous = want < paragraphOrder.size() && paragraphOrder.get(want).equals(names.get(i));
					}
					if (!contiguous) {
						reject(ctx, "PERFORM " + target + " THRU " + last + " is a backward or non-contiguous range");
						return null;
					}
					thru = last;
				}
			}
			return finishPerform(s, pp, ctx, target, thru);
		}

		/** Shared tail of PERFORM lowering: plain vs TIMES/UNTIL/VARYING forms. */
		Map<String, Object> finishPerform(final PerformStatement s, final PerformProcedureStatement pp,
				final ParserRuleContext ctx, final String target, final String thru) {
			final io.proleap.cobol.asg.metamodel.procedure.perform.PerformType pt = pp.getPerformType();
			final Map<String, Object> out = new LinkedHashMap<>();
			if (pt == null) {
				out.put("kind", "perform");
				out.put("target", target);
				if (thru != null) {
					out.put("thru", thru);
				}
				out.put("text", textOf(ctx));
				out.put("span", span(ctx));
				return out;
			}
			// Loop forms: TEST BEFORE semantics only (the COBOL 85 default).
			// TEST AFTER changes iteration count by one and is rejected, not
			// mis-lowered; VARYING ... AFTER (nested control variables) too.
			switch (pt.getPerformTypeType()) {
			case TIMES: {
				final String times = arithOperand(pt.getTimes().getTimesValueStmt().getCtx(), ctx, "PERFORM TIMES");
				if (times == null) {
					return null;
				}
				out.put("kind", "perform-times");
				out.put("target", target);
				if (thru != null) {
					out.put("thru", thru);
				}
				out.put("times", operandExpr(times));
				break;
			}
			case UNTIL: {
				final io.proleap.cobol.asg.metamodel.procedure.perform.Until u = pt.getUntil();
				if (u.getTestClause() != null && u.getTestClause()
						.getTestClauseType() == io.proleap.cobol.asg.metamodel.procedure.perform.TestClause.TestClauseType.AFTER) {
					reject(ctx, "PERFORM ... WITH TEST AFTER");
					return null;
				}
				final String untilCond = resolveQualified(textOf(u.getCondition().getCtx()), ctx);
				if (untilCond == null) {
					return null;
				}
				out.put("kind", "perform-until");
				out.put("target", target);
				if (thru != null) {
					out.put("thru", thru);
				}
				out.put("condition", operandExpr(expandConditionNames(untilCond)));
				break;
			}
			default: { // VARYING
				final io.proleap.cobol.asg.metamodel.procedure.perform.Varying v = pt.getVarying();
				if (v.getTestClause() != null && v.getTestClause()
						.getTestClauseType() == io.proleap.cobol.asg.metamodel.procedure.perform.TestClause.TestClauseType.AFTER) {
					reject(ctx, "PERFORM VARYING ... WITH TEST AFTER");
					return null;
				}
				final io.proleap.cobol.asg.metamodel.procedure.perform.VaryingClause vc = v.getVaryingClause();
				if (!vc.getAfters().isEmpty()) {
					reject(ctx, "PERFORM VARYING ... AFTER (nested control variables)");
					return null;
				}
				final io.proleap.cobol.asg.metamodel.procedure.perform.VaryingPhrase ph = vc.getVaryingPhrase();
				final String var = resolveQualified(textOf(ph.getVaryingValueStmt().getCtx()), ctx);
				if (var == null) {
					return null;
				}
				if (!ID_ONLY.matcher(var).matches()) {
					reject(ctx, "PERFORM VARYING control variable \"" + var + "\" (qualified/subscripted)");
					return null;
				}
				final String from = arithOperand(ph.getFrom().getFromValueStmt().getCtx(), ctx, "PERFORM VARYING FROM");
				if (from == null) {
					return null;
				}
				// BY defaults to 1 when absent (COBOL 85).
				final String by = ph.getBy() == null ? "1"
						: arithOperand(ph.getBy().getByValueStmt().getCtx(), ctx, "PERFORM VARYING BY");
				if (by == null) {
					return null;
				}
				out.put("kind", "perform-varying");
				out.put("target", target);
				if (thru != null) {
					out.put("thru", thru);
				}
				final Map<String, Object> varying = new LinkedHashMap<>();
				varying.put("var", var);
				varying.put("from", operandExpr(from));
				varying.put("by", operandExpr(by));
				final String varyCond = resolveQualified(textOf(ph.getUntil().getCondition().getCtx()), ctx);
				if (varyCond == null) {
					return null;
				}
				out.put("varying", varying);
				out.put("condition", operandExpr(expandConditionNames(varyCond)));
				break;
			}
			}
			out.put("text", textOf(ctx));
			out.put("span", span(ctx));
			return out;
		}

		Map<String, Object> operandExpr(final String text) {
			final Map<String, Object> e = new LinkedHashMap<>();
			e.put("text", text);
			e.put("refs", refsIn(text));
			return e;
		}

		Map<String, Object> lowerDisplay(final DisplayStatement s) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getAt() != null || s.getUpon() != null || s.getWith() != null || s.getOnExceptionClause() != null
					|| s.getNotOnExceptionClause() != null) {
				reject(ctx, "DISPLAY ... AT/UPON/WITH/ON EXCEPTION");
				return null;
			}
			final List<Object> operands = new ArrayList<>();
			for (final io.proleap.cobol.asg.metamodel.procedure.display.Operand op : s.getOperands()) {
				final String text = resolveQualified(textOf(op.getCtx()), ctx);
				if (text == null) {
					return null;
				}
				final Map<String, Object> o = new LinkedHashMap<>();
				if (text.startsWith("\"") || text.startsWith("'")) {
					o.put("kind", "literal");
					o.put("value", text.substring(1, text.length() - 1));
				} else if (declared.contains(text)) {
					o.put("kind", "ref");
					o.put("name", text);
				} else if (!text.contains(" ")) {
					o.put("kind", "literal");
					o.put("value", text);
				} else {
					reject(ctx, "DISPLAY operand \"" + text + "\" (qualified/subscripted)");
					return null;
				}
				operands.add(o);
			}
			final Map<String, Object> out = new LinkedHashMap<>();
			out.put("kind", "display");
			out.put("operands", operands);
			out.put("text", textOf(ctx));
			out.put("span", span(ctx));
			return out;
		}

		Map<String, Object> lowerAccept(final AcceptStatement s) {
			final ParserRuleContext ctx = s.getCtx();
			if (s.getAcceptType() != AcceptStatement.AcceptType.NO_FROM) {
				reject(ctx, "ACCEPT ... FROM");
				return null;
			}
			final String target = resolveQualified(textOf(s.getAcceptCall().getCtx()), ctx);
			if (target == null) {
				return null;
			}
			if (!ID_ONLY.matcher(target).matches()) {
				reject(ctx, "ACCEPT target \"" + target + "\" (qualified/subscripted)");
				return null;
			}
			final Map<String, Object> out = new LinkedHashMap<>();
			out.put("kind", "accept");
			out.put("target", target);
			out.put("text", textOf(ctx));
			out.put("span", span(ctx));
			return out;
		}

		static final Set<String> PERFORM_KINDS = new LinkedHashSet<>(
				Arrays.asList("perform", "perform-times", "perform-until", "perform-varying"));

		void collectPerformEdges(final List<?> statements, final String from, final List<Object> edges) {
			for (final Object so : statements) {
				final Map<?, ?> stmt = (Map<?, ?>) so;
				if (PERFORM_KINDS.contains(stmt.get("kind"))) {
					final String target = (String) stmt.get("target");
					if (!paragraphNames.contains(target)) {
						unsupported.add("PERFORM target \"" + target + "\" is not a paragraph in this program (line "
								+ ((Map<?, ?>) stmt.get("span")).get("startLine") + ")");
						continue;
					}
					final Map<String, Object> e = new LinkedHashMap<>();
					e.put("from", from);
					e.put("to", target);
					e.put("kind", "perform");
					e.put("atLine", ((Map<?, ?>) stmt.get("span")).get("startLine"));
					edges.add(e);
				} else if ("if".equals(stmt.get("kind"))) {
					collectPerformEdges((List<?>) stmt.get("then"), from, edges);
					if (stmt.get("else") != null) {
						collectPerformEdges((List<?>) stmt.get("else"), from, edges);
					}
				}
			}
		}

		// ------------------------------------------------------------------
		// GO TO soundness gate
		// ------------------------------------------------------------------
		//
		// Two admitted GO TO shapes; everything else is enumerated as
		// unsupported so IR-completeness keeps implying verify-soundness and
		// the layer-C rewrites stay total.
		//
		// Stage 1 — structured early-exit of a plain PERFORM <s> THRU <exit>
		// range. A GO TO <exit> is sound iff
		//   - <exit> is a real paragraph whose body is a pure EXIT terminator
		//     (empty or a lone EXIT), so "jump to exit then return" == "return";
		//   - <exit> is NOT the THRU endpoint of any looping PERFORM (there a
		//     GO TO would mean continue-this-iteration, not return);
		//   - some plain PERFORM <s> THRU <exit> range lexically encloses the
		//     GO TO's paragraph as a forward jump (index(s) <= index(P) < index(exit)).
		//
		// Stage 2 — forward jump across top-level fall-through paragraphs.
		// Sound iff the GO TO's paragraph is NOT reachable via any PERFORM
		// (otherwise the jump would fire inside a performed context the range
		// inliner does not model) and the target is strictly later in source
		// order (forward-only keeps the chain eliminator's recursion finite).
		//
		// Program-wide placement rules, both stages:
		//   - a GO TO may appear only in tail position (last statement of its
		//     block or of an IF branch) — the structural rewrites need it;
		//   - no ACCEPT may textually follow any GO TO: a jump skipping an
		//     ACCEPT would make stdin positions path-dependent (the same
		//     reason ACCEPT inside a loop body is rejected).

		/** Collect THRU ranges: plain PERFORM into `plainRanges` ({start,exit}); loop PERFORM exits into `loopExits`. */
		void collectRanges(final List<?> stmts, final List<String[]> plainRanges, final Set<String> loopExits) {
			for (final Object so : stmts) {
				final Map<?, ?> s = (Map<?, ?>) so;
				final String kind = (String) s.get("kind");
				final Object thru = s.get("thru");
				if (thru != null) {
					if ("perform".equals(kind)) {
						plainRanges.add(new String[] { (String) s.get("target"), (String) thru });
					} else {
						loopExits.add((String) thru); // perform-times / perform-until / perform-varying
					}
				}
				if ("if".equals(kind)) {
					collectRanges((List<?>) s.get("then"), plainRanges, loopExits);
					if (s.get("else") != null) {
						collectRanges((List<?>) s.get("else"), plainRanges, loopExits);
					}
				}
			}
		}

		/** Collect GO TO sites (target + source line) in a statement list, recursing into IFs. */
		void collectGotos(final List<?> stmts, final List<String[]> out) {
			for (final Object so : stmts) {
				final Map<?, ?> s = (Map<?, ?>) so;
				final String kind = (String) s.get("kind");
				if ("go-to".equals(kind)) {
					out.add(new String[] { (String) s.get("target"),
							String.valueOf(((Map<?, ?>) s.get("span")).get("startLine")) });
				} else if ("if".equals(kind)) {
					collectGotos((List<?>) s.get("then"), out);
					if (s.get("else") != null) {
						collectGotos((List<?>) s.get("else"), out);
					}
				}
			}
		}

		/** A paragraph is a pure EXIT terminator when its body is empty or a single EXIT statement. */
		boolean isPureExit(final String name, final List<Object> paragraphs) {
			for (final Object po : paragraphs) {
				final Map<?, ?> pm = (Map<?, ?>) po;
				if (name.equals(pm.get("name"))) {
					final List<?> st = (List<?>) pm.get("statements");
					return st.isEmpty() || (st.size() == 1 && "exit".equals(((Map<?, ?>) st.get(0)).get("kind")));
				}
			}
			return false;
		}

		/** Every paragraph reachable via any PERFORM (all four kinds, THRU expanded). */
		void collectPerformed(final List<?> stmts, final Set<String> out) {
			for (final Object so : stmts) {
				final Map<?, ?> s = (Map<?, ?>) so;
				final String kind = (String) s.get("kind");
				if (PERFORM_KINDS.contains(kind)) {
					final int i = paragraphOrder.indexOf((String) s.get("target"));
					final Object thru = s.get("thru");
					final int j = thru != null ? paragraphOrder.indexOf((String) thru) : i;
					if (i >= 0 && j >= i) {
						for (int k = i; k <= j; k++) {
							out.add(paragraphOrder.get(k));
						}
					}
				} else if ("if".equals(kind)) {
					collectPerformed((List<?>) s.get("then"), out);
					if (s.get("else") != null) {
						collectPerformed((List<?>) s.get("else"), out);
					}
				}
			}
		}

		/** GO TO may appear only as the last statement of its block or IF branch. */
		void checkGotoPlacement(final List<?> stmts) {
			for (int i = 0; i < stmts.size(); i++) {
				final Map<?, ?> s = (Map<?, ?>) stmts.get(i);
				final String kind = (String) s.get("kind");
				if ("go-to".equals(kind) && i != stmts.size() - 1) {
					unsupported.add("GO TO " + s.get("target")
							+ " is not in tail position (statements follow it in the same block) (line "
							+ ((Map<?, ?>) s.get("span")).get("startLine") + ")");
				} else if ("if".equals(kind)) {
					checkGotoPlacement((List<?>) s.get("then"));
					if (s.get("else") != null) {
						checkGotoPlacement((List<?>) s.get("else"));
					}
				}
			}
		}

		/** Reject any ACCEPT that textually follows a GO TO (path-dependent stdin positions). */
		void checkAcceptAfterGoto(final List<?> stmts, final boolean[] seenGoto) {
			for (final Object so : stmts) {
				final Map<?, ?> s = (Map<?, ?>) so;
				final String kind = (String) s.get("kind");
				if ("go-to".equals(kind)) {
					seenGoto[0] = true;
				} else if ("accept".equals(kind) && seenGoto[0]) {
					unsupported.add("ACCEPT " + s.get("target")
							+ " textually follows a GO TO - stdin positions would become path-dependent (line "
							+ ((Map<?, ?>) s.get("span")).get("startLine") + ")");
				} else if ("if".equals(kind)) {
					checkAcceptAfterGoto((List<?>) s.get("then"), seenGoto);
					if (s.get("else") != null) {
						checkAcceptAfterGoto((List<?>) s.get("else"), seenGoto);
					}
				}
			}
		}

		void gateGotos(final List<Object> paragraphs) {
			final List<String[]> plainRanges = new ArrayList<>();
			final Set<String> loopExits = new LinkedHashSet<>();
			final Set<String> performed = new LinkedHashSet<>();
			for (final Object po : paragraphs) {
				final List<?> stmts = (List<?>) ((Map<?, ?>) po).get("statements");
				collectRanges(stmts, plainRanges, loopExits);
				collectPerformed(stmts, performed);
			}
			// Program-wide placement rules (both stages).
			final boolean[] seenGoto = new boolean[] { false };
			for (final Object po : paragraphs) {
				final List<?> stmts = (List<?>) ((Map<?, ?>) po).get("statements");
				checkGotoPlacement(stmts);
				checkAcceptAfterGoto(stmts, seenGoto);
			}
			// Per-goto acceptance: stage 1 (range early-exit) OR stage 2
			// (forward top-level jump).
			for (final Object po : paragraphs) {
				final Map<?, ?> pm = (Map<?, ?>) po;
				final String pname = (String) pm.get("name");
				final List<String[]> gotos = new ArrayList<>();
				collectGotos((List<?>) pm.get("statements"), gotos);
				for (final String[] g : gotos) {
					final String target = g[0];
					final String line = g[1];
					if (!paragraphNames.contains(target)) {
						unsupported.add("GO TO " + target + " targets a name that is not a paragraph (line " + line + ")");
						continue;
					}
					final int pIdx = paragraphOrder.indexOf(pname);
					final int tIdx = paragraphOrder.indexOf(target);
					// --- stage 1: early-exit of an enclosing plain PERFORM THRU range ---
					boolean stage1 = isPureExit(target, paragraphs) && !loopExits.contains(target);
					if (stage1) {
						boolean governed = false;
						for (final String[] r : plainRanges) {
							if (!target.equals(r[1])) {
								continue;
							}
							final int sIdx = paragraphOrder.indexOf(r[0]);
							if (sIdx >= 0 && tIdx >= 0 && sIdx <= pIdx && pIdx < tIdx) {
								governed = true;
								break;
							}
						}
						stage1 = governed;
					}
					if (stage1) {
						continue;
					}
					// --- stage 2: forward jump across top-level fall-through paragraphs ---
					if (performed.contains(pname)) {
						unsupported.add("GO TO " + target + " inside PERFORM-reachable paragraph " + pname
								+ " is neither a structured range early-exit nor a top-level jump (line " + line + ")");
						continue;
					}
					if (tIdx <= pIdx) {
						unsupported.add("GO TO " + target
								+ " is a backward or self jump; only strictly forward top-level jumps are supported (line "
								+ line + ")");
					}
				}
			}
		}

		static String sha256(final byte[] bytes) {
			try {
				final byte[] d = MessageDigest.getInstance("SHA-256").digest(bytes);
				final StringBuilder sb = new StringBuilder(64);
				for (final byte b : d) {
					sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
				}
				return sb.toString();
			} catch (final Exception e) {
				throw new RuntimeException(e);
			}
		}
	}

	// ------------------------------------------------------------------
	// PICTURE parsing — exact port of cli/src/parse/picture.ts
	// ------------------------------------------------------------------

	static final class Picture {
		static final Pattern REPEAT = Pattern.compile("(.)\\((\\d+)\\)");
		static final Pattern NON_PICTURE = Pattern.compile("[^AX9SVZB0.,*+$-]");
		static final Pattern ALPHA = Pattern.compile("[AX]");
		static final Pattern EDITED = Pattern.compile("[ZB0.,*+$-]");

		static Map<String, Object> parse(final String raw) {
			final StringBuilder sb = new StringBuilder();
			final Matcher m = REPEAT.matcher(raw.toUpperCase());
			int last = 0;
			while (m.find()) {
				sb.append(raw.toUpperCase(), last, m.start());
				sb.append(String.valueOf(m.group(1).charAt(0)).repeat(Integer.parseInt(m.group(2))));
				last = m.end();
			}
			sb.append(raw.toUpperCase().substring(last));
			final String expanded = sb.toString();

			if (expanded.contains("P")) {
				throw new IllegalArgumentException("PICTURE " + raw + ": P scaling is not supported");
			}
			if (NON_PICTURE.matcher(expanded).find()) {
				throw new IllegalArgumentException("PICTURE " + raw + ": unsupported symbol");
			}

			final Map<String, Object> type = new LinkedHashMap<>();
			type.put("raw", raw);
			if (ALPHA.matcher(expanded).find()) {
				type.put("category", "alphanumeric");
				type.put("length", expanded.length());
				return type;
			}
			if (EDITED.matcher(expanded).find()) {
				final int dot = expanded.indexOf('.');
				type.put("category", "numeric-edited");
				type.put("digits", countDigits(expanded));
				type.put("scale", dot >= 0 ? countDigits(expanded.substring(dot + 1)) : 0);
				return type;
			}
			final int v = expanded.indexOf('V');
			type.put("category", "numeric");
			type.put("digits", count(expanded, '9'));
			type.put("scale", v >= 0 ? count(expanded.substring(v + 1), '9') : 0);
			type.put("signed", expanded.startsWith("S"));
			return type;
		}

		static int countDigits(final String s) {
			int n = 0;
			for (final char c : s.toCharArray()) {
				if (c == '9' || c == 'Z') {
					n++;
				}
			}
			return n;
		}

		static int count(final String s, final char ch) {
			int n = 0;
			for (final char c : s.toCharArray()) {
				if (c == ch) {
					n++;
				}
			}
			return n;
		}
	}

	// ------------------------------------------------------------------
	// Minimal JSON writer (JSON.stringify-compatible escaping)
	// ------------------------------------------------------------------

	static final class Json {
		static String write(final Object o) {
			final StringBuilder sb = new StringBuilder();
			value(sb, o);
			return sb.toString();
		}

		static void value(final StringBuilder sb, final Object o) {
			if (o == null) {
				sb.append("null");
			} else if (o instanceof String) {
				string(sb, (String) o);
			} else if (o instanceof Boolean || o instanceof Integer || o instanceof Long) {
				sb.append(o);
			} else if (o instanceof Map) {
				sb.append('{');
				boolean first = true;
				for (final Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
					if (!first) {
						sb.append(',');
					}
					first = false;
					string(sb, String.valueOf(e.getKey()));
					sb.append(':');
					value(sb, e.getValue());
				}
				sb.append('}');
			} else if (o instanceof List) {
				sb.append('[');
				boolean first = true;
				for (final Object e : (List<?>) o) {
					if (!first) {
						sb.append(',');
					}
					first = false;
					value(sb, e);
				}
				sb.append(']');
			} else {
				throw new IllegalArgumentException("unserializable: " + o.getClass());
			}
		}

		static void string(final StringBuilder sb, final String s) {
			sb.append('"');
			for (int i = 0; i < s.length(); i++) {
				final char c = s.charAt(i);
				switch (c) {
				case '"':
					sb.append("\\\"");
					break;
				case '\\':
					sb.append("\\\\");
					break;
				case '\n':
					sb.append("\\n");
					break;
				case '\r':
					sb.append("\\r");
					break;
				case '\t':
					sb.append("\\t");
					break;
				case '\b':
					sb.append("\\b");
					break;
				case '\f':
					sb.append("\\f");
					break;
				default:
					if (c < 0x20) {
						sb.append(String.format("\\u%04x", (int) c));
					} else {
						sb.append(c);
					}
				}
			}
			sb.append('"');
		}
	}
}
