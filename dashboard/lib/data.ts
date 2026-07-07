/**
 * Read-only access to pipeline artifacts (certificates and layer reports).
 *
 * The dashboard renders what the CLI produced — it never re-runs
 * verification and never mutates artifacts. Everything served to the
 * browser is confined to LEGACYMIND_DATA_DIR; paths embedded in
 * certificates are mapped into that directory or dropped.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(
  process.cwd(),
  process.env.LEGACYMIND_DATA_DIR ?? "../out",
);

export type LayerName = "A" | "B" | "C" | "D";

export interface LayerEvidence {
  status: "PASS" | "FAIL" | "NOT_RUN";
  summary?: Record<string, unknown>;
  report?: { path: string; sha256: string };
  note?: string;
}

export interface Certification {
  tool: string;
  version: string;
  generatedAt: string;
  verdict: "CERTIFIED" | "NOT_CERTIFIED";
  module: { programId: string; source: { file: string; sha256: string } };
  target: { file: string | null; sha256: string | null; model: string | null; candidate: string };
  layers: Record<LayerName, LayerEvidence>;
  coverageEnvelope: {
    layerB?: { curatedCases: number | null };
    layerA?: { generatedCases: number | null; seed: number | null };
    layerC?: { obligations: Record<string, number> | null; pathsCovered: string | null };
    layerD?: { keys: Record<string, number> | null; capacityWarnings: number };
    gaps: string[];
  };
  selection: {
    path: string;
    sha256: string;
    candidatesEvaluated: number | null;
    totalCostUsd: number | null;
  };
  integrity: { algorithm: string; hash: string; note: string };
}

export interface CertEntry {
  slug: string;
  cert: Certification;
}

const SLUG_RE = /^certification[a-z0-9-]*$/;

export function listCertifications(): CertEntry[] {
  if (!existsSync(DATA_DIR)) return [];
  const entries: CertEntry[] = [];
  for (const f of readdirSync(DATA_DIR)) {
    if (!/^certification[a-z0-9-]*\.json$/.test(f)) continue;
    try {
      const cert = JSON.parse(readFileSync(path.join(DATA_DIR, f), "utf8")) as Certification;
      if (cert.tool === "legacymind certify") entries.push({ slug: f.replace(/\.json$/, ""), cert });
    } catch {
      // unreadable artifact: skip rather than break the dashboard
    }
  }
  return entries.sort((a, b) => (a.cert.generatedAt < b.cert.generatedAt ? 1 : -1));
}

export function loadCertification(slug: string): Certification | null {
  if (!SLUG_RE.test(slug)) return null;
  const p = path.join(DATA_DIR, `${slug}.json`);
  if (!existsSync(p)) return null;
  try {
    const cert = JSON.parse(readFileSync(p, "utf8")) as Certification;
    return cert.tool === "legacymind certify" ? cert : null;
  } catch {
    return null;
  }
}

/** Map an absolute path from a certificate into a DATA_DIR-relative slug, or null if outside. */
export function toDataRelative(absolute: string | null | undefined): string | null {
  if (!absolute) return null;
  const resolved = path.resolve(absolute);
  const rel = path.relative(DATA_DIR, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** Resolve an artifact slug (from toDataRelative / API route) back to a safe absolute path. */
export function resolveArtifact(relSlug: string): string | null {
  const full = path.resolve(DATA_DIR, relSlug);
  if (!full.startsWith(DATA_DIR + path.sep) && full !== DATA_DIR) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return full;
}

export interface LayerCReport {
  summary?: {
    obligations?: Record<string, number>;
    paths?: { total: number; covered: number; unknown: number };
    unrealizedPathObligations?: number;
  };
  obligations?: {
    id: string;
    kind: string;
    description: string;
    status: string;
    notes: string[];
    unrealizedPaths: { path: number; reason: string }[];
  }[];
  paths?: { id: number; conds: string[]; covered: boolean | "unknown" }[];
}

export function loadLayerCReport(cert: Certification): LayerCReport | null {
  const rel = toDataRelative(cert.layers.C?.report?.path);
  if (!rel) return null;
  const full = resolveArtifact(rel);
  if (!full) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as LayerCReport;
  } catch {
    return null;
  }
}
