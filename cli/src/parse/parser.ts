/**
 * Stub COBOL 85 fixed-format parser.
 *
 * Scope — a deliberately small, loudly-bounded subset:
 *   IDENTIFICATION DIVISION (PROGRAM-ID), WORKING-STORAGE SECTION
 *   (elementary/group items with PIC / USAGE / VALUE), and a PROCEDURE
 *   DIVISION limited to MOVE, COMPUTE, IF..ELSE..END-IF, PERFORM
 *   <paragraph>, DISPLAY, ACCEPT, STOP RUN, GOBACK.
 *
 * Anything outside the subset throws ParseError with a line number.
 * Nothing is ever skipped silently — "no hidden failures" applies to
 * the parser exactly as it applies to the verifier.
 *
 * This file is a stub in the strict sense: the production parser is the
 * ProLeap ANTLR4 COBOL85 grammar (JVM) feeding a Rust IR layer. Both
 * emit the same IR (../../ir/schema.json); that schema is the contract,
 * this implementation is disposable.
 */

import { createHash } from "node:crypto";
import { parsePicture, PictureError, type PictureType } from "./picture.js";

export const PARSER_NAME = "legacymind-parse-stub";
export const PARSER_VERSION = "0.1.0";

export class ParseError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = "ParseError";
  }
}

export interface Span {
  file: string;
  startLine: number;
  endLine: number;
}

export interface DataItem {
  level: number;
  name: string;
  path: string;
  /** Storage-only FILLER item (proleap engine): synthesized name, never referenced. */
  filler?: true;
  picture?: string;
  type?: PictureType;
  usage: string;
  value?: string;
  span: Span;
  children: DataItem[];
}

export interface OperandExpr {
  text: string;
  refs: string[];
}

export type DisplayOperand =
  | { kind: "literal"; value: string }
  | { kind: "ref"; name: string };

export type Statement =
  | { kind: "move"; from: OperandExpr; to: string[]; text: string; span: Span }
  | { kind: "compute"; target: string; rounded: boolean; expression: OperandExpr; text: string; span: Span }
  | { kind: "if"; condition: OperandExpr; then: Statement[]; else?: Statement[]; text: string; span: Span }
  | { kind: "perform"; target: string; text: string; span: Span }
  | { kind: "display"; operands: DisplayOperand[]; text: string; span: Span }
  | { kind: "accept"; target: string; text: string; span: Span }
  | { kind: "stop-run"; text: string; span: Span }
  | { kind: "goback"; text: string; span: Span }
  /** EXIT: no-op paragraph terminator (proleap engine only; flow-neutral in every layer). */
  | { kind: "exit"; text: string; span: Span };

export interface Paragraph {
  name: string;
  span: Span;
  statements: Statement[];
}

export interface ModuleIR {
  irVersion: "0.1.0";
  module: {
    programId: string;
    dialect: "cobol85-fixed";
    source: { file: string; sha256: string };
  };
  dataDivision: { items: DataItem[] };
  procedureDivision: { paragraphs: Paragraph[] };
  controlFlow: {
    entry: string;
    nodes: { id: string; kind: "paragraph" }[];
    edges: { from: string; to: string; kind: "fallthrough" | "perform"; atLine?: number }[];
  };
  provenance: {
    parser: { name: string; version: string };
    generatedAt: string;
    warnings: string[];
  };
}

export interface ParseSummary {
  programId: string;
  paragraphs: string[];
  dataItems: number;
  statements: number;
  edges: number;
  warnings: string[];
}

const VERBS = new Set(["MOVE", "COMPUTE", "IF", "PERFORM", "DISPLAY", "ACCEPT", "STOP", "GOBACK"]);
const STOP_TOKENS = new Set([...VERBS, ".", "ELSE", "END-IF"]);
const ID_RE = /^[A-Z][A-Z0-9-]*$/;

interface SrcLine {
  no: number;
  indicator: string;
  content: string;
  areaA: boolean;
}

interface Tok {
  text: string;
  line: number;
}

function readLines(text: string): SrcLine[] {
  return text.split(/\r?\n/).map((raw, i) => {
    const indicator = raw.length > 6 ? raw[6]! : " ";
    const content = raw.slice(7, 72).trimEnd();
    const first = content.search(/\S/);
    return { no: i + 1, indicator, content, areaA: first >= 0 && first < 4 };
  });
}

function isComment(l: SrcLine): boolean {
  return l.indicator === "*" || l.indicator === "/";
}

function isBlank(l: SrcLine): boolean {
  return l.content.trim() === "" && l.indicator === " ";
}

export function parseCobol(sourceText: string, sourceFile: string): { ir: ModuleIR; summary: ParseSummary } {
  const warnings: string[] = [];
  const lines = readLines(sourceText);

  for (const l of lines) {
    if (l.indicator === "-") {
      throw new ParseError("continuation lines are not supported by the stub parser", l.no);
    }
    if (l.indicator !== " " && !isComment(l)) {
      throw new ParseError(`unsupported indicator character "${l.indicator}" in column 7`, l.no);
    }
  }

  // --- split into divisions -------------------------------------------------
  const DIVISION_RE = /^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION\s*\.\s*$/;
  const divisions = new Map<string, SrcLine[]>();
  let current: SrcLine[] | null = null;
  for (const l of lines) {
    if (isComment(l) || isBlank(l)) continue;
    const m = DIVISION_RE.exec(l.content);
    if (m) {
      current = [];
      divisions.set(m[1]!, current);
      continue;
    }
    if (!current) {
      throw new ParseError("code before IDENTIFICATION DIVISION", l.no);
    }
    current.push(l);
  }

  // --- IDENTIFICATION DIVISION ---------------------------------------------
  const idLines = divisions.get("IDENTIFICATION");
  if (!idLines) throw new ParseError("missing IDENTIFICATION DIVISION", 1);
  let programId: string | null = null;
  for (const l of idLines) {
    const m = /^\s*PROGRAM-ID\s*\.\s*([A-Z0-9][A-Z0-9-]*)\s*\.?\s*$/.exec(l.content);
    if (m) {
      programId = m[1]!;
      break;
    }
  }
  if (!programId) throw new ParseError("PROGRAM-ID not found in IDENTIFICATION DIVISION", idLines[0]?.no ?? 1);

  const envLines = divisions.get("ENVIRONMENT");
  if (envLines && envLines.length > 0) {
    warnings.push(
      `ENVIRONMENT DIVISION present (lines ${envLines[0]!.no}-${envLines[envLines.length - 1]!.no}) but not modeled by the stub parser`,
    );
  }

  // --- DATA DIVISION / WORKING-STORAGE --------------------------------------
  const declared = new Set<string>();
  const items: DataItem[] = [];
  let dataItemCount = 0;
  const dataLines = divisions.get("DATA") ?? [];
  {
    const SECTION_RE = /^\s*([A-Z-]+)\s+SECTION\s*\.\s*$/;
    let inWorkingStorage = false;
    const stack: DataItem[] = [];
    for (const l of dataLines) {
      const sec = SECTION_RE.exec(l.content);
      if (sec) {
        if (sec[1] !== "WORKING-STORAGE") {
          throw new ParseError(`${sec[1]} SECTION is not supported by the stub parser`, l.no);
        }
        inWorkingStorage = true;
        continue;
      }
      if (!inWorkingStorage) {
        throw new ParseError("data entry outside WORKING-STORAGE SECTION", l.no);
      }
      const t = l.content.trim();
      if (!t.endsWith(".")) {
        throw new ParseError("multi-line data entries are not supported by the stub parser", l.no);
      }
      const body = t.slice(0, -1).trim();
      const m = /^(\d{1,2})\s+([A-Z][A-Z0-9-]*)(?:\s+(.*))?$/.exec(body);
      if (!m) throw new ParseError(`unrecognized data entry: ${t}`, l.no);
      const level = Number(m[1]);
      const name = m[2]!;
      if (level === 88) throw new ParseError("88-level condition names are not supported by the stub parser", l.no);
      if (level === 66) throw new ParseError("66-level RENAMES is not supported by the stub parser", l.no);
      if (name === "FILLER") throw new ParseError("FILLER items are not supported by the stub parser", l.no);

      let picture: string | undefined;
      let usage = "DISPLAY";
      let value: string | undefined;
      const rest = m[3] ? m[3].split(/\s+/) : [];
      for (let i = 0; i < rest.length; i++) {
        const tok = rest[i]!;
        if (tok === "PIC" || tok === "PICTURE") {
          picture = rest[++i];
          if (!picture) throw new ParseError("PIC clause without a picture string", l.no);
        } else if (tok === "USAGE") {
          if (rest[i + 1] === "IS") i++;
          usage = rest[++i] ?? "";
          if (!usage) throw new ParseError("USAGE clause without a value", l.no);
        } else if (tok === "COMP" || tok === "COMP-3" || tok === "BINARY" || tok === "PACKED-DECIMAL") {
          usage = tok;
        } else if (tok === "VALUE") {
          if (rest[i + 1] === "IS") i++;
          value = rest.slice(i + 1).join(" ");
          if (!value) throw new ParseError("VALUE clause without a literal", l.no);
          i = rest.length;
        } else if (tok === "REDEFINES" || tok === "OCCURS") {
          throw new ParseError(`${tok} is not supported by the stub parser`, l.no);
        } else {
          throw new ParseError(`unsupported data clause "${tok}"`, l.no);
        }
      }

      let type: PictureType | undefined;
      if (picture) {
        try {
          type = parsePicture(picture);
        } catch (e) {
          if (e instanceof PictureError) throw new ParseError(e.message, l.no);
          throw e;
        }
      }

      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      const item: DataItem = {
        level,
        name,
        path: parent ? `${parent.path}.${name}` : name,
        picture,
        type,
        usage,
        value,
        span: { file: sourceFile, startLine: l.no, endLine: l.no },
        children: [],
      };
      (parent ? parent.children : items).push(item);
      stack.push(item);
      declared.add(name);
      dataItemCount++;
    }
  }

  // --- PROCEDURE DIVISION ----------------------------------------------------
  const procLines = divisions.get("PROCEDURE") ?? [];
  const PARA_RE = /^([A-Z][A-Z0-9-]*)\s*\.\s*$/;
  interface RawPara {
    name: string;
    headerLine: number;
    body: SrcLine[];
  }
  const rawParas: RawPara[] = [];
  for (const l of procLines) {
    if (/\bSECTION\b/.test(l.content)) {
      throw new ParseError("sections in the PROCEDURE DIVISION are not supported by the stub parser", l.no);
    }
    const m = l.areaA ? PARA_RE.exec(l.content.trim()) : null;
    if (m) {
      rawParas.push({ name: m[1]!, headerLine: l.no, body: [] });
    } else {
      const para = rawParas[rawParas.length - 1];
      if (!para) throw new ParseError("statement before the first paragraph header", l.no);
      para.body.push(l);
    }
  }

  const refsIn = (text: string): string[] => {
    const out: string[] = [];
    for (const m of text.matchAll(/[A-Z][A-Z0-9-]*/g)) {
      const w = m[0];
      if (declared.has(w) && !out.includes(w)) out.push(w);
    }
    return out;
  };

  const paragraphs: Paragraph[] = rawParas.map((rp) => {
    // tokenize the paragraph body: quoted strings stay whole, one trailing
    // period splits off as a sentence terminator token
    const toks: Tok[] = [];
    for (const l of rp.body) {
      for (const m of l.content.matchAll(/"[^"]*"|'[^']*'|\S+/g)) {
        const raw = m[0];
        if (raw.startsWith('"') || raw.startsWith("'")) {
          toks.push({ text: raw, line: l.no });
        } else if (raw === ".") {
          toks.push({ text: ".", line: l.no });
        } else if (raw.endsWith(".")) {
          const base = raw.slice(0, -1);
          if (base) toks.push({ text: base, line: l.no });
          toks.push({ text: ".", line: l.no });
        } else {
          toks.push({ text: raw, line: l.no });
        }
      }
    }

    let cur = 0;
    const peek = (): Tok | undefined => toks[cur];
    const lastLine = (): number => toks[toks.length - 1]?.line ?? rp.headerLine;

    const textOf = (from: number, to: number): string =>
      toks.slice(from, to).map((t) => t.text).join(" ");

    const collectUntil = (stop: Set<string>): Tok[] => {
      const out: Tok[] = [];
      while (cur < toks.length && !stop.has(toks[cur]!.text)) out.push(toks[cur++]!);
      return out;
    };

    const expectIdent = (what: string): Tok => {
      const t = peek();
      if (!t || !ID_RE.test(t.text)) {
        throw new ParseError(`expected ${what}, got "${t?.text ?? "end of paragraph"}"`, t?.line ?? lastLine());
      }
      cur++;
      return t;
    };

    function parseStatement(): Statement {
      const start = cur;
      const t = toks[cur]!;
      const span = (endTokIdx: number): Span => ({
        file: sourceFile,
        startLine: t.line,
        endLine: toks[endTokIdx - 1]?.line ?? t.line,
      });

      switch (t.text) {
        case "MOVE": {
          cur++;
          const from = collectUntil(new Set(["TO", ...STOP_TOKENS]));
          if (peek()?.text !== "TO") throw new ParseError("MOVE without TO", t.line);
          if (from.length === 0) throw new ParseError("MOVE without a source operand", t.line);
          cur++; // TO
          const to: string[] = [];
          while (cur < toks.length && ID_RE.test(toks[cur]!.text) && !STOP_TOKENS.has(toks[cur]!.text)) {
            to.push(toks[cur++]!.text);
          }
          if (to.length === 0) throw new ParseError("MOVE without a receiving field", t.line);
          const fromText = from.map((x) => x.text).join(" ");
          return {
            kind: "move",
            from: { text: fromText, refs: refsIn(fromText) },
            to,
            text: textOf(start, cur),
            span: span(cur),
          };
        }
        case "COMPUTE": {
          cur++;
          const target = expectIdent("a receiving field after COMPUTE").text;
          let rounded = false;
          if (peek()?.text === "ROUNDED") {
            rounded = true;
            cur++;
          }
          if (peek()?.text !== "=") throw new ParseError("COMPUTE without =", t.line);
          cur++;
          const expr = collectUntil(STOP_TOKENS);
          if (expr.length === 0) throw new ParseError("COMPUTE with an empty expression", t.line);
          const exprText = expr.map((x) => x.text).join(" ");
          return {
            kind: "compute",
            target,
            rounded,
            expression: { text: exprText, refs: refsIn(exprText) },
            text: textOf(start, cur),
            span: span(cur),
          };
        }
        case "IF": {
          cur++;
          const cond = collectUntil(new Set([...VERBS, "."]));
          if (cond.length === 0) throw new ParseError("IF with an empty condition", t.line);
          const parseBranch = (stops: string[]): Statement[] => {
            const out: Statement[] = [];
            while (cur < toks.length && !stops.includes(toks[cur]!.text)) out.push(parseStatement());
            if (cur >= toks.length) {
              throw new ParseError("unterminated IF: END-IF is required by the stub parser", t.line);
            }
            if (toks[cur]!.text === ".") {
              throw new ParseError(
                "period-terminated IF is not supported by the stub parser; close with END-IF",
                toks[cur]!.line,
              );
            }
            return out;
          };
          const thenBranch = parseBranch(["ELSE", "END-IF", "."]);
          let elseBranch: Statement[] | undefined;
          if (toks[cur]!.text === "ELSE") {
            cur++;
            elseBranch = parseBranch(["END-IF", "."]);
          }
          const endTok = toks[cur]!; // END-IF, guaranteed by parseBranch
          cur++;
          const condText = cond.map((x) => x.text).join(" ");
          const st: Statement = {
            kind: "if",
            condition: { text: condText, refs: refsIn(condText) },
            then: thenBranch,
            text: `IF ${condText}`,
            span: { file: sourceFile, startLine: t.line, endLine: endTok.line },
          };
          if (elseBranch) st.else = elseBranch;
          return st;
        }
        case "PERFORM": {
          cur++;
          const target = expectIdent("a paragraph name after PERFORM").text;
          const next = peek()?.text;
          if (next && ["TIMES", "UNTIL", "VARYING", "THRU", "THROUGH"].includes(next)) {
            throw new ParseError(`PERFORM ... ${next} is not supported by the stub parser`, t.line);
          }
          return { kind: "perform", target, text: textOf(start, cur), span: span(cur) };
        }
        case "DISPLAY": {
          cur++;
          const raw = collectUntil(STOP_TOKENS);
          if (raw.length === 0) throw new ParseError("DISPLAY without operands", t.line);
          const operands: DisplayOperand[] = raw.map((x) =>
            x.text.startsWith('"') || x.text.startsWith("'")
              ? { kind: "literal", value: x.text.slice(1, -1) }
              : declared.has(x.text)
                ? { kind: "ref", name: x.text }
                : { kind: "literal", value: x.text },
          );
          return { kind: "display", operands, text: textOf(start, cur), span: span(cur) };
        }
        case "ACCEPT": {
          cur++;
          const target = expectIdent("a receiving field after ACCEPT").text;
          if (peek()?.text === "FROM") {
            throw new ParseError("ACCEPT ... FROM is not supported by the stub parser", t.line);
          }
          return { kind: "accept", target, text: textOf(start, cur), span: span(cur) };
        }
        case "STOP": {
          cur++;
          if (peek()?.text !== "RUN") throw new ParseError('expected "RUN" after STOP', t.line);
          cur++;
          return { kind: "stop-run", text: "STOP RUN", span: span(cur) };
        }
        case "GOBACK": {
          cur++;
          return { kind: "goback", text: "GOBACK", span: span(cur) };
        }
        default:
          throw new ParseError(`unsupported statement verb "${t.text}"`, t.line);
      }
    }

    const statements: Statement[] = [];
    while (cur < toks.length) {
      if (toks[cur]!.text === ".") {
        cur++; // sentence boundary
        continue;
      }
      statements.push(parseStatement());
    }

    return {
      name: rp.name,
      span: {
        file: sourceFile,
        startLine: rp.headerLine,
        endLine: rp.body[rp.body.length - 1]?.no ?? rp.headerLine,
      },
      statements,
    };
  });

  if (paragraphs.length === 0) throw new ParseError("PROCEDURE DIVISION has no paragraphs", 1);

  // --- control-flow graph (paragraph level) ---------------------------------
  const paraNames = new Set(paragraphs.map((p) => p.name));
  const edges: ModuleIR["controlFlow"]["edges"] = [];

  const collectPerforms = (stmts: Statement[], from: string): void => {
    for (const s of stmts) {
      if (s.kind === "perform") {
        if (!paraNames.has(s.target)) {
          throw new ParseError(`PERFORM target "${s.target}" is not a paragraph in this program`, s.span.startLine);
        }
        edges.push({ from, to: s.target, kind: "perform", atLine: s.span.startLine });
      } else if (s.kind === "if") {
        collectPerforms(s.then, from);
        if (s.else) collectPerforms(s.else, from);
      }
    }
  };
  for (const p of paragraphs) collectPerforms(p.statements, p.name);

  for (let i = 0; i < paragraphs.length - 1; i++) {
    const last = paragraphs[i]!.statements[paragraphs[i]!.statements.length - 1];
    if (last && (last.kind === "stop-run" || last.kind === "goback")) continue;
    edges.push({ from: paragraphs[i]!.name, to: paragraphs[i + 1]!.name, kind: "fallthrough" });
  }

  const countStatements = (stmts: Statement[]): number =>
    stmts.reduce(
      (n, s) => n + 1 + (s.kind === "if" ? countStatements(s.then) + countStatements(s.else ?? []) : 0),
      0,
    );

  const ir: ModuleIR = {
    irVersion: "0.1.0",
    module: {
      programId,
      dialect: "cobol85-fixed",
      source: {
        file: sourceFile,
        sha256: createHash("sha256").update(sourceText).digest("hex"),
      },
    },
    dataDivision: { items },
    procedureDivision: { paragraphs },
    controlFlow: {
      entry: paragraphs[0]!.name,
      nodes: paragraphs.map((p) => ({ id: p.name, kind: "paragraph" as const })),
      edges,
    },
    provenance: {
      parser: { name: PARSER_NAME, version: PARSER_VERSION },
      generatedAt: new Date().toISOString(),
      warnings,
    },
  };

  return {
    ir,
    summary: {
      programId,
      paragraphs: paragraphs.map((p) => p.name),
      dataItems: dataItemCount,
      statements: paragraphs.reduce((n, p) => n + countStatements(p.statements), 0),
      edges: edges.length,
      warnings,
    },
  };
}
