// Parser coverage sweep over an external COBOL corpus, both engines.
//
// stub    — the bounded TypeScript subset parser (baseline).
// proleap — the production engine, measured on two honest tiers:
//             frontend    the ANTLR4 grammar + reference-format
//                         preprocessor accepted the source
//             irComplete  every construct was lowered into IR; anything
//                         less lists each unsupported construct, and the
//                         histogram of those is the lowering backlog.
//
// Usage:
//   git clone --depth 1 https://github.com/uwol/proleap-cobol-parser <dir>
//   node benchmark/parse-sweep.mjs <dir>
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, relative } from "node:path";
import { parseCobol } from "../cli/dist/parse/parser.js";
import { ensureProleapFrontend, proleapClasspath } from "../cli/dist/parse/proleap.js";

const corpusDir = process.argv[2];
if (!corpusDir) {
  console.error("usage: node benchmark/parse-sweep.mjs <corpus-dir>");
  process.exit(2);
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.cbl$/i.test(name)) files.push(p);
  }
};
walk(corpusDir);

let commit = null;
try {
  commit = execFileSync("git", ["-C", corpusDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* corpus may not be a git checkout */
}

// Identify the corpus by its remote URL, not the session-local checkout
// path — so the published snapshot names the source stably across machines
// and re-clones (the path is scratch and changes every session).
let corpusLabel = corpusDir.split("\\").join("/");
try {
  const url = execFileSync("git", ["-C", corpusDir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  if (url) corpusLabel = url.replace(/\.git$/, "");
} catch {
  /* no remote — keep the path */
}

// Normalize a rejection message into a histogram bucket: drop line
// numbers and collapse specific identifiers so equivalent reasons group.
const bucket = (message) =>
  message
    .replace(/^line \d+: /, "")
    .replace(/ ?\(line \d+\)/g, "")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/PICTURE \S+:/, "PICTURE …:")
    .replace(/line \d+:\d+ /, "")
    .slice(0, 100);

const tally = (map, reason) => map.set(reason, (map.get(reason) ?? 0) + 1);
const sorted = (map) =>
  [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

// --- stub engine (in-process) -------------------------------------------------
const stubReasons = new Map();
let stubParsed = 0;
for (const f of files) {
  try {
    parseCobol(readFileSync(f, "utf8"), relative(corpusDir, f).split("\\").join("/"));
    stubParsed++;
  } catch (e) {
    tally(stubReasons, bucket(e.message ?? String(e)));
  }
}

// --- proleap engine (one batched JVM) -----------------------------------------
ensureProleapFrontend();
const batch = spawnSync("java", ["-cp", proleapClasspath(), "ProLeapFrontend", "--batch"], {
  input: files.join("\n") + "\n",
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 1024,
});
if (batch.error || batch.status !== 0) {
  console.error(`proleap batch failed: ${batch.error?.message ?? batch.stderr}`);
  process.exit(1);
}
const results = batch.stdout
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
if (results.length !== files.length) {
  console.error(`proleap batch returned ${results.length} results for ${files.length} files`);
  process.exit(1);
}

let frontendAccepted = 0;
let irComplete = 0;
const formats = new Map();
const frontendReasons = new Map();
const unsupportedConstructs = new Map();
const irCompleteFiles = [];
for (const r of results) {
  if (r.stage === "frontend") {
    tally(frontendReasons, bucket(r.error ?? "unknown"));
    continue;
  }
  frontendAccepted++;
  tally(formats, r.format ?? "unknown");
  if (r.ok) {
    irComplete++;
    irCompleteFiles.push(relative(corpusDir, r.file).split("\\").join("/"));
  } else if (r.stage === "asg") {
    tally(unsupportedConstructs, "asg: " + bucket(r.error ?? "unknown"));
  } else {
    for (const u of r.unsupported ?? []) tally(unsupportedConstructs, bucket(u));
  }
}

const result = {
  tool: "legacymind parse-sweep",
  generatedAt: new Date().toISOString(),
  corpus: corpusLabel,
  commit,
  total: files.length,
  stub: {
    parsed: stubParsed,
    rate: files.length === 0 ? 0 : stubParsed / files.length,
    topReasons: sorted(stubReasons),
  },
  proleap: {
    frontendAccepted,
    frontendRate: files.length === 0 ? 0 : frontendAccepted / files.length,
    irComplete,
    irRate: files.length === 0 ? 0 : irComplete / files.length,
    formats: Object.fromEntries(sorted(formats).map((f) => [f.reason, f.count])),
    topFrontendReasons: sorted(frontendReasons),
    topUnsupportedConstructs: sorted(unsupportedConstructs),
    irCompleteFiles,
  },
};
writeFileSync("benchmark/parse-coverage.json", JSON.stringify(result, null, 2) + "\n");

const pct = (n) => ((100 * n) / files.length).toFixed(1);
console.log(`parse sweep over ${files.length} files (${corpusDir}):`);
console.log(`  stub     parsed       ${stubParsed}/${files.length} (${pct(stubParsed)}%)`);
console.log(`  proleap  frontend     ${frontendAccepted}/${files.length} (${pct(frontendAccepted)}%)`);
console.log(`  proleap  IR-complete  ${irComplete}/${files.length} (${pct(irComplete)}%)`);
console.log("top frontend rejections:");
for (const r of result.proleap.topFrontendReasons.slice(0, 8)) {
  console.log(`  ${String(r.count).padStart(5)}  ${r.reason}`);
}
console.log("top constructs outside the IR subset (lowering backlog):");
for (const r of result.proleap.topUnsupportedConstructs.slice(0, 15)) {
  console.log(`  ${String(r.count).padStart(5)}  ${r.reason}`);
}
console.log("wrote benchmark/parse-coverage.json");
