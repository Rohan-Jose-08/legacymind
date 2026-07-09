import { withAuth } from "@workos-inc/authkit-nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadCertification,
  loadLayerCReport,
  resolveArtifact,
  toDataRelative,
  verifyCertSignature,
  type LayerName,
} from "@/lib/data";
import { Badge, Header, Mono, shortHash, SignatureBadge } from "../../ui";

const LAYER_TECH: Record<LayerName, string> = {
  A: "Property-based testing (seeded generation + shrinking)",
  B: "Differential execution (curated traces)",
  C: "Symbolic execution (path + boundary obligations)",
  D: "Static data-flow equivalence",
};

export default async function CertPage({ params }: { params: Promise<{ slug: string }> }) {
  const { user } = await withAuth({ ensureSignedIn: true });
  const { slug } = await params;
  const cert = loadCertification(slug);
  if (!cert) notFound();
  const signature = verifyCertSignature(cert);
  const layerC = loadLayerCReport(cert);

  const downloads: { label: string; rel: string | null }[] = [
    { label: "Certificate (JSON)", rel: `${slug}.json` },
    { label: "Certificate report (Markdown)", rel: relIfExists(`${slug}.md`) },
    { label: "Layer A report", rel: toDataRelative(cert.layers.A?.report?.path) },
    { label: "Layer B report", rel: toDataRelative(cert.layers.B?.report?.path) },
    { label: "Layer C report", rel: toDataRelative(cert.layers.C?.report?.path) },
    { label: "Layer D report", rel: toDataRelative(cert.layers.D?.report?.path) },
    { label: "Selection report (migrate)", rel: toDataRelative(cert.selection.path) },
    { label: "Certified Java source", rel: toDataRelative(cert.target.file) },
  ];

  const unrealized = (layerC?.obligations ?? []).filter(
    (o) => o.status === "UNREALIZED" || o.unrealizedPaths.length > 0,
  );
  const uncoveredPaths = (layerC?.paths ?? []).filter((p) => p.covered !== true);

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">
          ← All certificates
        </Link>

        <div className="mt-3 flex items-center gap-4">
          <h1 className="text-2xl font-bold">{cert.module.programId}</h1>
          <Badge value={cert.verdict} />
          <SignatureBadge sig={signature} withKey />
        </div>

        <section className="mt-6 rounded-lg border border-stone-300 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Provenance</h2>
          <dl className="mt-3 grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
            <dt className="text-stone-500">Generated</dt>
            <dd>{new Date(cert.generatedAt).toLocaleString()}</dd>
            <dt className="text-stone-500">Source</dt>
            <dd><Mono>{cert.module.source.file}</Mono> sha256 <Mono>{shortHash(cert.module.source.sha256)}</Mono></dd>
            <dt className="text-stone-500">Target</dt>
            <dd><Mono>{cert.target.file ?? "n/a"}</Mono> sha256 <Mono>{shortHash(cert.target.sha256)}</Mono></dd>
            <dt className="text-stone-500">Transpiler</dt>
            <dd>{cert.target.model} — candidate {cert.target.candidate} of {cert.selection.candidatesEvaluated}</dd>
            <dt className="text-stone-500">LLM cost</dt>
            <dd>${(cert.selection.totalCostUsd ?? 0).toFixed(4)} (cached replays are free)</dd>
          </dl>
        </section>

        <section className="mt-6 rounded-lg border border-stone-300 bg-white p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Authenticity</h2>
            <SignatureBadge sig={signature} />
          </div>
          <dl className="mt-3 grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
            <dt className="text-stone-500">Signature</dt>
            <dd>{signature.reason}</dd>
            <dt className="text-stone-500">Algorithm</dt>
            <dd>{cert.integrity.algorithm ?? "unsigned"}{cert.integrity.canonicalization ? ` over ${cert.integrity.canonicalization}` : ""}</dd>
            <dt className="text-stone-500">Signer key</dt>
            <dd>
              <Mono>{signature.keyId}</Mono>
              {signature.trustedKeyId
                ? signature.keyTrusted
                  ? " — matches the trusted key"
                  : ` — does NOT match the trusted key ${signature.trustedKeyId}`
                : " — no trusted key configured"}
            </dd>
            <dt className="text-stone-500">Content digest</dt>
            <dd><Mono>{shortHash(cert.integrity.contentSha256 ?? cert.integrity.hash)}</Mono></dd>
          </dl>
          <p className="mt-3 text-xs text-stone-400">
            Verified server-side, the same check as <Mono>legacymind verify-cert</Mono>: the
            Ed25519 signature covers the certificate body, and the signer&apos;s public key is
            pinned against the trusted key. Any edit to the certificate breaks the signature.
          </p>
        </section>

        <section className="mt-6 rounded-lg border border-stone-300 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Verification layers
          </h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4">Layer</th>
                <th className="py-2 pr-4">Technique</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {(["A", "B", "C", "D"] as const).map((l) => (
                <tr key={l} className="border-b border-stone-100 align-top">
                  <td className="py-2 pr-4 font-bold">{l}</td>
                  <td className="py-2 pr-4 text-stone-600">{LAYER_TECH[l]}</td>
                  <td className="py-2 pr-4"><Badge value={cert.layers[l]?.status ?? "NOT_RUN"} /></td>
                  <td className="py-2 text-stone-600">{coverageFor(l, cert)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
            Known gaps — read before relying on this certificate
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {cert.coverageEnvelope.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </section>

        {(unrealized.length > 0 || uncoveredPaths.length > 0) && (
          <section className="mt-6 rounded-lg border border-stone-300 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Remaining unverified branches (layer C)
            </h2>
            {unrealized.map((o) => (
              <div key={o.id} className="mt-3 rounded border border-stone-200 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge value={o.status} />
                  <Mono>{o.description}</Mono>
                </div>
                <ul className="mt-2 list-disc pl-5 text-stone-600">
                  {o.unrealizedPaths.map((up) => (
                    <li key={up.path}>
                      path #{up.path}: {up.reason}
                    </li>
                  ))}
                  {o.notes.map((n, i) => (
                    <li key={`n${i}`}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
            {uncoveredPaths.length > 0 && (
              <p className="mt-3 text-sm text-stone-600">
                Paths without a covering case:{" "}
                {uncoveredPaths.map((p) => `#${p.id} [${p.conds.join(" ∧ ")}]`).join(", ")}
              </p>
            )}
          </section>
        )}

        <section className="mt-6 rounded-lg border border-stone-300 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Evidence downloads
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {downloads
              .filter((d): d is { label: string; rel: string } => d.rel !== null)
              .map((d) => (
                <li key={d.rel}>
                  <a
                    href={`/api/artifact/${d.rel}`}
                    className="text-blue-700 underline decoration-blue-300 hover:decoration-blue-700"
                  >
                    {d.label}
                  </a>{" "}
                  <span className="text-xs text-stone-400">{d.rel}</span>
                </li>
              ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function coverageFor(layer: LayerName, cert: NonNullable<ReturnType<typeof loadCertification>>): string {
  const env = cert.coverageEnvelope;
  if (layer === "A" && env.layerA) {
    return `${env.layerA.generatedCases} generated cases, seed ${env.layerA.seed} (reproducible)`;
  }
  if (layer === "B" && env.layerB) return `${env.layerB.curatedCases} curated trace cases`;
  if (layer === "C" && env.layerC) {
    const o = env.layerC.obligations ?? {};
    return `${o.total ?? "?"} obligations (${o.verified ?? 0} verified, ${o.divergent ?? 0} divergent, ${o.unrealized ?? 0} unrealized); paths ${env.layerC.pathsCovered ?? "?"}`;
  }
  if (layer === "D" && env.layerD) {
    const k = env.layerD.keys ?? {};
    return `${k.verified ?? 0}/${k.total ?? "?"} output keys statically verified (${env.layerD.capacityWarnings ?? 0} capacity warnings)`;
  }
  return "—";
}

// The markdown report is optional; only offer it when it exists.
function relIfExists(rel: string): string | null {
  return resolveArtifact(rel) ? rel : null;
}
