import { withAuth } from "@workos-inc/authkit-nextjs";
import Link from "next/link";
import { listCertifications, DATA_DIR } from "@/lib/data";
import { Badge, Header, Mono } from "./ui";

export default async function Home() {
  const { user } = await withAuth({ ensureSignedIn: true });
  const certs = listCertifications();

  const certified = certs.filter((c) => c.cert.verdict === "CERTIFIED").length;
  const totalCost = certs.reduce((s, c) => s + (c.cert.selection.totalCostUsd ?? 0), 0);

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 grid grid-cols-3 gap-4">
          <Stat label="Certificates" value={String(certs.length)} />
          <Stat label="Certified" value={`${certified} / ${certs.length}`} />
          <Stat label="LLM cost (metered)" value={`$${totalCost.toFixed(4)}`} />
        </div>

        {certs.length === 0 ? (
          <div className="rounded-lg border border-stone-300 bg-white p-8 text-center text-stone-500">
            No certificates found in <Mono>{DATA_DIR}</Mono>. Run the pipeline
            (<Mono>legacymind certify</Mono>) or point <Mono>LEGACYMIND_DATA_DIR</Mono> at its
            output directory.
          </div>
        ) : (
          <ul className="space-y-4">
            {certs.map(({ slug, cert }) => (
              <li key={slug}>
                <Link
                  href={`/certs/${slug}`}
                  className="block rounded-lg border border-stone-300 bg-white p-5 shadow-sm transition hover:border-stone-400 hover:shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold">{cert.module.programId}</span>
                      <Badge value={cert.verdict} />
                    </div>
                    <span className="text-sm text-stone-500">
                      {new Date(cert.generatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-sm text-stone-600">
                    <span className="flex items-center gap-1.5">
                      Layers:
                      {(["A", "B", "C", "D"] as const).map((l) => (
                        <span key={l} className="flex items-center gap-0.5">
                          <span className="text-xs text-stone-400">{l}</span>
                          <Badge value={cert.layers[l]?.status ?? "NOT_RUN"} />
                        </span>
                      ))}
                    </span>
                    <span>·</span>
                    <span>{cert.coverageEnvelope.gaps.length} disclosed gap(s)</span>
                    <span>·</span>
                    <span>${(cert.selection.totalCostUsd ?? 0).toFixed(4)}</span>
                  </div>
                  <div className="mt-2 text-xs text-stone-400">
                    {cert.module.source.file} → candidate {cert.target.candidate} ({cert.target.model})
                    {" · "}certificate <Mono>{slug}.json</Mono>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-300 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
