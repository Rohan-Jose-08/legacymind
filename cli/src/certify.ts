/**
 * `legacymind certify` — aggregate the verification evidence for one
 * migrated module into certification.json, the artifact LegacyMind sells.
 *
 * A certificate is issued (verdict CERTIFIED) only when:
 *   - migrate selected a winning candidate,
 *   - layer B passed on that candidate, and
 *   - every additional layer report provided (A, C) passed, with at least
 *     one of them present — one evidence class is never enough.
 *
 * Everything the certificate does NOT cover is listed in
 * coverageEnvelope.gaps — unrealized symbolic obligations, layers not run,
 * a mock standing in for the legacy binary. No hidden failures: the gaps
 * section is the contract, not a disclaimer.
 *
 * The certificate is signed (Ed25519) over the canonical form of its own
 * body: any later edit breaks the signature, and `legacymind verify-cert`
 * both checks the signature (integrity) and pins the signer's public key
 * (provenance). The demo key ships in keys/; production signs with a
 * KMS-held key via --signing-key. See cli/src/sign.ts.
 *
 * `legacymind report` renders the certificate as human-readable Markdown.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { signBody } from "./sign.js";

export class CertifyError extends Error {}

interface LayerEvidence {
  status: "PASS" | "FAIL" | "NOT_RUN";
  summary?: Record<string, unknown>;
  report?: { path: string; sha256: string };
  note?: string;
}

const sha256File = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
const readJson = (p: string, what: string): any => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new CertifyError(`cannot read ${what} at ${p}: ${(e as Error).message}`);
  }
};

function evidence(reportPath: string, verdict: string, summary: Record<string, unknown>): LayerEvidence {
  return {
    status: verdict === "PASS" ? "PASS" : "FAIL",
    summary,
    report: { path: resolve(reportPath).replace(/\\/g, "/"), sha256: sha256File(reportPath) },
  };
}

export function runCertify(opts: {
  selectionPath: string;
  layerAPath?: string;
  layerCPath?: string;
  layerDPath?: string;
  outPath: string;
  /** PEM private key for production signing; omitted uses the committed demo key. */
  signingKeyPath?: string;
  /**
   * JSON record of the toolchain the evidence was produced with (compiler,
   * version, options). Rides inside the signed body; when omitted the
   * certificate says so and gains a gap (docs/binary-comp.md).
   */
  toolchainPath?: string;
  /**
   * The module's IR. Read only to disclose EXTERNAL SERVICES — calls to a
   * vendor implementation we never see, admissible only when they never
   * return (docs/external-services.md). Such a call terminates the program,
   * so the equivalence claim covers reaching it and stopping there, and NOT
   * the service's own behaviour or its arguments. Omitted, the certificate
   * says the check could not be made rather than implying it passed.
   */
  irPath?: string;
}): number {
  const selection = readJson(opts.selectionPath, "selection.json");
  if (!selection.winner) {
    throw new CertifyError(
      "selection.json has no winning candidate — an unmigrated module cannot be certified",
    );
  }
  const winnerId: string = selection.winner.id;
  const gaps: string[] = [];
  const mockLegacyLabels = new Set<string>();

  // --- layer B: the winner's diff report written by migrate --------------------
  const layerBPath = join(dirname(resolve(opts.selectionPath)), `candidate-${winnerId}.diff-report.json`);
  if (!existsSync(layerBPath)) {
    throw new CertifyError(`winner's layer B report not found at ${layerBPath}`);
  }
  const layerB = readJson(layerBPath, "layer B report");
  const layers: { A: LayerEvidence; B: LayerEvidence; C: LayerEvidence; D: LayerEvidence } = {
    A: { status: "NOT_RUN", note: "property-based report not provided" },
    B: evidence(layerBPath, layerB.verdict, layerB.summary),
    C: { status: "NOT_RUN", note: "symbolic-execution report not provided" },
    D: { status: "NOT_RUN", note: "static data-flow report not provided" },
  };

  // Layer B report from migrate has no artifact labels; the selection gate ran
  // against the diff config's legacy side. Mock detection happens on A/C below,
  // which embed artifact labels.

  const coverage: Record<string, unknown> = {
    layerB: { curatedCases: layerB.summary?.total ?? null },
  };

  // --- layer A -------------------------------------------------------------------
  if (opts.layerAPath) {
    const a = readJson(opts.layerAPath, "layer A report");
    layers.A = evidence(opts.layerAPath, a.verdict, a.summary);
    coverage.layerA = { generatedCases: a.summary?.generated ?? null, seed: a.generator?.seed ?? null };
    checkTargetsWinner(a, winnerId, "A", gaps);
    noteMock(a, mockLegacyLabels);
  } else {
    gaps.push("layer A (property-based) was not run");
  }

  // --- layer C -------------------------------------------------------------------
  if (opts.layerCPath) {
    const c = readJson(opts.layerCPath, "layer C report");
    layers.C = evidence(opts.layerCPath, c.verdict, c.summary);
    const infeasible = c.summary?.paths?.infeasible ?? 0;
    coverage.layerC = {
      obligations: c.summary?.obligations ?? null,
      pathsCovered: c.summary?.paths
        ? `${c.summary.paths.covered}/${c.summary.paths.total - infeasible}` +
          (infeasible > 0 ? ` (+${infeasible} proven infeasible)` : "")
        : null,
    };
    const unrealized = c.summary?.obligations?.unrealized ?? 0;
    const unrealizedPaths = c.summary?.unrealizedPathObligations ?? 0;
    if (unrealized > 0) gaps.push(`layer C: ${unrealized} obligation(s) could not be realized as inputs (see report)`);
    if (unrealizedPaths > 0) {
      gaps.push(`layer C: ${unrealizedPaths} obligation-path combination(s) unrealized (see report)`);
    }
    checkTargetsWinner(c, winnerId, "C", gaps);
    noteMock(c, mockLegacyLabels);
  } else {
    gaps.push("layer C (symbolic execution) was not run");
  }

  // --- layer D -------------------------------------------------------------------
  if (opts.layerDPath) {
    const d = readJson(opts.layerDPath, "layer D report");
    layers.D = evidence(opts.layerDPath, d.verdict, d.summary);
    coverage.layerD = { keys: d.summary?.keys ?? null, capacityWarnings: d.summary?.capacityWarnings ?? 0 };
    const unresolvedKeys = d.summary?.keys?.unresolved ?? 0;
    if (unresolvedKeys > 0) {
      gaps.push(`layer D: ${unresolvedKeys} output key(s) statically unresolved (see report)`);
    }
    if ((d.summary?.capacityWarnings ?? 0) > 0) {
      gaps.push(
        `layer D: ${d.summary.capacityWarnings} storage-capacity difference(s) flagged as warnings — ` +
          `statically inconclusive, covered dynamically by layers A/B/C`,
      );
    }
    checkTargetsWinner(d, winnerId, "D", gaps);
  } else {
    gaps.push("layer D (static data-flow equivalence) was not run");
  }
  for (const label of mockLegacyLabels) {
    gaps.push(
      `legacy side is "${label}" — a mock of GnuCOBOL semantics; this certificate is conditional on ` +
        `mock fidelity and must be re-issued against the real legacy binary`,
    );
  }

  // --- target hash ------------------------------------------------------------------
  const targetFile: string | null = selection.winner.javaFile ?? null;
  const target = {
    file: targetFile,
    sha256: targetFile && existsSync(targetFile) ? sha256File(targetFile) : null,
    model: selection.model ?? null,
    candidate: winnerId,
  };
  if (!target.sha256) gaps.push("target source file could not be hashed (moved or deleted since migrate)");

  // --- verdict ------------------------------------------------------------------------
  const provided = [layers.A, layers.C, layers.D].filter((l) => l.status !== "NOT_RUN");
  const allRunPassed = [layers.B, ...provided].every((l) => l.status === "PASS");
  const verdict = layers.B.status === "PASS" && provided.length >= 1 && allRunPassed ? "CERTIFIED" : "NOT_CERTIFIED";

  // --- toolchain -----------------------------------------------------------------------
  // Equivalence is established against a SPECIFIC compiler with SPECIFIC
  // options, and some COBOL semantics belong to the options rather than to
  // the source: a PIC S9(4) COMP field computing 9999+1 yields 0 under
  // GnuCOBOL's default and 10000 under -std=ibm (docs/binary-comp.md). A
  // certificate that does not say which one it used overstates what it
  // proves, so the toolchain rides INSIDE the signed body - and when it was
  // not supplied we say so loudly rather than leaving the reader to assume.
  let toolchain: Record<string, unknown>;
  if (opts.toolchainPath) {
    toolchain = { recorded: true, ...readJson(opts.toolchainPath, "toolchain record") };
  } else {
    toolchain = {
      recorded: false,
      note:
        "No toolchain record was supplied to certify, so the compiler, its version and its " +
        "options are NOT part of this certificate. Semantics that depend on compile options " +
        "(notably binary COMP truncation) are therefore unpinned: see docs/binary-comp.md.",
    };
    gaps.push(
      "toolchain not recorded — the compiler and its options are not pinned by this certificate",
    );
  }

  // --- external services -----------------------------------------------------------
  // A modelled service is an ENVIRONMENT divergence, the same class of
  // disclosure as the toolchain block: under the certified toolchain
  // CEE3ABD is an absent module and the call simply ends the run, while on
  // z/OS it raises user abend `abcode`. Naming it here — inside the signed
  // body — is what keeps "certified" from over-reading.
  let externalServices: Record<string, unknown>;
  if (opts.irPath) {
    const services = collectExternalServices(readJson(opts.irPath, "module IR"));
    externalServices = {
      checked: true,
      services,
      ...(services.length > 0
        ? {
            note:
              "Each service below NEVER RETURNS, which is the only reason it can be modelled: " +
              "the program terminates at the call, so there is no post-call state to get wrong. " +
              "COVERED: the program reaches the call under the same conditions in both " +
              "implementations, has produced identical output beforehand, and runs nothing " +
              "afterwards. NOT COVERED: the service's own behaviour, and the USING argument " +
              "values — under the certified toolchain they have no observable effect, whereas " +
              "on z/OS they are visible as the abend code. See docs/external-services.md.",
          }
        : {}),
    };
    for (const s of services) {
      gaps.push(
        `external service ${(s as { service: string }).service} is modelled as non-returning: its own ` +
          `behaviour and its argument values are outside this certificate (docs/external-services.md)`,
      );
    }
  } else {
    externalServices = {
      checked: false,
      note:
        "No IR was supplied to certify, so this certificate does NOT state whether the module " +
        "calls an external service modelled as non-returning. See docs/external-services.md.",
    };
    gaps.push("module IR not supplied — external-service disclosure could not be checked");
  }

  const body = {
    tool: "legacymind certify",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    verdict,
    module: selection.module,
    target,
    toolchain,
    externalServices,
    layers,
    coverageEnvelope: { ...coverage, gaps },
    selection: {
      path: resolve(opts.selectionPath).replace(/\\/g, "/"),
      sha256: sha256File(opts.selectionPath),
      candidatesEvaluated: selection.candidates?.length ?? null,
      totalCostUsd: selection.totalCostUsd ?? null,
    },
  };

  const signingKeyPath = opts.signingKeyPath ?? process.env.LEGACYMIND_SIGNING_KEY;
  const { integrity, source: keySource } = signBody(body, signingKeyPath);
  const certificate = { ...body, integrity };

  mkdirSync(dirname(resolve(opts.outPath)), { recursive: true });
  writeFileSync(opts.outPath, JSON.stringify(certificate, null, 2) + "\n");

  console.log(`legacymind certify — ${selection.module?.programId ?? "?"}`);
  console.log("");
  for (const [name, l] of Object.entries(layers)) {
    console.log(`  layer ${name}: ${l.status}${l.note ? ` (${l.note})` : ""}`);
  }
  console.log("");
  console.log(`  gaps (${gaps.length}):`);
  for (const g of gaps) console.log(`    - ${g}`);
  console.log("");
  console.log(`  verdict: ${verdict}`);
  console.log(`  signed: ed25519, key ${integrity.keyId} (${keySource})`);
  console.log(`  certificate: ${opts.outPath}`);
  return verdict === "CERTIFIED" ? 0 : 1;
}

/**
 * Every `terminate-abnormal` in the IR, deduplicated by service, with the
 * source spans that reached it — so an auditor can find the call sites.
 */
function collectExternalServices(ir: any): Record<string, unknown>[] {
  interface ServiceRec {
    service: string;
    callSites: string[];
    args: string[];
  }
  const byService = new Map<string, ServiceRec>();
  const scan = (stmts: any): void => {
    if (!Array.isArray(stmts)) return;
    for (const s of stmts) {
      if (!s || typeof s !== "object") continue;
      if (s.kind === "terminate-abnormal") {
        const rec: ServiceRec = byService.get(s.service) ?? { service: s.service, callSites: [], args: [] };
        const span = s.span ? `${s.span.file}:${s.span.startLine}` : "unknown";
        if (!rec.callSites.includes(span)) rec.callSites.push(span);
        for (const a of s.args ?? []) if (!rec.args.includes(a)) rec.args.push(a);
        byService.set(s.service, rec);
      }
      for (const arm of ["then", "else", "atEnd", "notAtEnd"]) scan(s[arm]);
    }
  };
  for (const p of ir?.procedureDivision?.paragraphs ?? []) scan(p?.statements);
  return [...byService.values()].map((r) => ({
    service: r.service,
    model: "non-returning: terminates the run; nothing after the call executes",
    callSites: r.callSites,
    unverifiedArguments: r.args,
  }));
}

function checkTargetsWinner(report: any, winnerId: string, layer: string, gaps: string[]): void {
  const argv: string[] = report.artifacts?.modern?.argv ?? [];
  const label: string = report.artifacts?.modern?.label ?? "";
  const hay = argv.join(" ") + " " + label;
  if (!hay.includes(`candidate-${winnerId}`) && !hay.includes(`candidate ${winnerId}`)) {
    gaps.push(
      `layer ${layer} report's modern side ("${label || argv.join(" ")}") does not clearly reference the ` +
        `certified candidate-${winnerId} artifact — verify it tested the same binary`,
    );
  }
}

function noteMock(report: any, mockLabels: Set<string>): void {
  const label: string = report.artifacts?.legacy?.label ?? "";
  if (/mock/i.test(label)) mockLabels.add(label);
}

// ---------------------------------------------------------------------------------
// `legacymind report` — Markdown rendering of a certificate
// ---------------------------------------------------------------------------------

export function runReport(certPath: string, outPath?: string): number {
  const cert = readJson(certPath, "certification.json");
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push(`# LegacyMind certification report — ${cert.module?.programId ?? "?"}`);
  push();
  push(`**Verdict: ${cert.verdict}**`);
  push();
  push(`| | |`);
  push(`|---|---|`);
  push(`| Generated | ${cert.generatedAt} |`);
  push(`| Source | \`${cert.module?.source?.file}\` (sha256 \`${short(cert.module?.source?.sha256)}\`) |`);
  push(`| Target | \`${cert.target?.file}\` (sha256 \`${short(cert.target?.sha256)}\`) |`);
  push(`| Transpiler model | ${cert.target?.model} (candidate ${cert.target?.candidate}) |`);
  const tc = cert.toolchain ?? {};
  push(
    `| Reference compiler | ${tc.recorded
      ? `${tc.legacy?.compiler ?? "?"}, options: ${tc.legacy?.options ?? "?"}`
      : "**not recorded** — compiler and options are not pinned by this certificate"} |`,
  );
  push(`| Candidates evaluated | ${cert.selection?.candidatesEvaluated} |`);
  push(`| LLM cost (this migration) | $${Number(cert.selection?.totalCostUsd ?? 0).toFixed(4)} |`);
  const integ = cert.integrity ?? {};
  const sig =
    integ.algorithm === "ed25519"
      ? `Ed25519, key \`${integ.keyId}\` — check with \`legacymind verify-cert\``
      : `${integ.algorithm ?? "unsigned"}`;
  push(`| Signature | ${sig} |`);
  push();
  push(`## Verification layers`);
  push();
  push(`| Layer | Technique | Status | Evidence |`);
  push(`|---|---|---|---|`);
  const tech: Record<string, string> = {
    A: "Property-based testing (seeded generation + shrinking)",
    B: "Differential execution (curated traces)",
    C: "Symbolic execution (path + boundary obligations)",
    D: "Static data-flow equivalence",
  };
  for (const name of ["A", "B", "C", "D"]) {
    const l = cert.layers?.[name] ?? {};
    const ev = l.report ? `\`${l.report.path}\` (\`${short(l.report.sha256)}\`)` : (l.note ?? "—");
    push(`| ${name} | ${tech[name]} | **${l.status}** | ${ev} |`);
  }
  push();
  push(`## Coverage envelope`);
  push();
  const env = cert.coverageEnvelope ?? {};
  if (env.layerB) push(`- Layer B: ${env.layerB.curatedCases} curated trace case(s)`);
  if (env.layerA) push(`- Layer A: ${env.layerA.generatedCases} generated case(s), seed ${env.layerA.seed} (reproducible)`);
  if (env.layerC) {
    const o = env.layerC.obligations ?? {};
    push(
      `- Layer C: ${o.total ?? "?"} obligation(s) — ${o.verified ?? 0} verified, ${o.divergent ?? 0} divergent, ` +
        `${o.unrealized ?? 0} unrealized; paths covered ${env.layerC.pathsCovered ?? "?"}`,
    );
  }
  if (env.layerD) {
    const k = env.layerD.keys ?? {};
    push(
      `- Layer D: ${k.total ?? "?"} output key(s) statically compared — ${k.verified ?? 0} verified, ` +
        `${k.divergent ?? 0} divergent, ${k.unresolved ?? 0} unresolved; ` +
        `${env.layerD.capacityWarnings ?? 0} capacity warning(s)`,
    );
  }
  push();
  push(`## External services`);
  push();
  const ext = cert.externalServices ?? {};
  if (!ext.checked) {
    push(`- **Not checked.** ${ext.note ?? "No IR was supplied to certify."}`);
  } else if ((ext.services ?? []).length === 0) {
    push(`- None. This module calls no external service; no environment divergence is claimed away.`);
  } else {
    for (const s of ext.services) {
      push(`- **\`${s.service}\`** — modelled as ${s.model}.`);
      push(`  - call site(s): ${(s.callSites ?? []).map((c: string) => `\`${c}\``).join(", ")}`);
      push(
        `  - **not verified**: the service's own behaviour, and the argument value(s) ` +
          `${(s.unverifiedArguments ?? []).map((a: string) => `\`${a}\``).join(", ") || "(none)"} — ` +
          `unobservable under the certified toolchain, visible as the abend code on z/OS.`,
      );
    }
    push();
    push(`> ${ext.note}`);
  }
  push();
  push(`## Known gaps — read before relying on this certificate`);
  push();
  for (const g of env.gaps ?? []) push(`- ${g}`);
  push();
  push(`---`);
  push(`*Generated by legacymind certify/report v${cert.version}. A certificate documents evidence`);
  push(`gathered on a defined coverage envelope; it is not a proof over the full input space.*`);
  push();

  const md = lines.join("\n");
  if (outPath) {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, md);
    console.log(`wrote ${outPath}`);
  } else {
    console.log(md);
  }
  return 0;
}

const short = (h?: string | null): string => (h ? `${h.slice(0, 16)}…` : "n/a");
