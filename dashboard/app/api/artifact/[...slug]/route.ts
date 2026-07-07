import { withAuth } from "@workos-inc/authkit-nextjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { resolveArtifact } from "@/lib/data";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".java": "text/x-java-source; charset=utf-8",
  ".cbl": "text/plain; charset=utf-8",
};

// Serves pipeline artifacts (reports, certificates, generated sources) to
// signed-in users. Confined to LEGACYMIND_DATA_DIR; anything outside — or
// any traversal attempt — is a 404. The SSO middleware already gates this
// route; the withAuth check is defense in depth.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> },
) {
  const { user } = await withAuth();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { slug } = await ctx.params;
  const rel = slug.join("/");
  const full = resolveArtifact(rel);
  if (!full) return new NextResponse("not found", { status: 404 });

  const ext = path.extname(full).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return new NextResponse("unsupported artifact type", { status: 404 });

  return new NextResponse(readFileSync(full), {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${path.basename(full)}"`,
      "cache-control": "no-store",
    },
  });
}
