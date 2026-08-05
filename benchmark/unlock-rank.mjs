// Definitive unlock ranking for AWS CardDemo. Themes are derived from the
// measured blocker text, not guessed. Anything unmatched is reported as
// UNCLASSIFIED and still blocks its module — a theme list that quietly
// drops a blocker would understate the work.
import { readFileSync } from "node:fs";

const S = "C:/Users/Ender/AppData/Local/Temp/claude/C--Users-Ender-startup/218d28ce-10f6-4c2f-95c2-9476bd5c1b39/scratchpad";
const raw = JSON.parse(readFileSync(`${S}/assess-baseline/assessment.json`, "utf8"));
const arr = raw.modules ?? raw.files ?? raw.results ?? raw;
const blocked = arr.filter((r) => r.verdict === "BLOCKED");

const THEMES = [
  ["VSAM keyed + multi-file", /ACCESS MODE RANDOM|KEY\/INVALID KEY|REWRITE|OPEN I-O|not a lowered file|without a matching lowered SELECT|organization other than|which is not a file record|START statement|more than one input file|OPEN OUTPUT of indexed|is never opened|READ site\(s\)/i],
  ["record layout (signed, re-carve)", /is signed \(S overpunches|must have the same total width|decomposes a group record|INTO "[^"]*" which is not a declared/i],
  ["control-flow normalisation", /GO TO|ALTER statement|EXIT PROGRAM|is a backward or non-contiguous range|before the first paragraph header|PROCEDURE DIVISION has no paragraphs/i],
  ["ordinary-verb tail", /INITIALIZE|STRING statement|UNSTRING|INSPECT|intrinsic|CONTINUE|ELSE NEXT SENTENCE|EVALUATE TRUE WHEN VALUE|MOVE target .*\(qualified|SET .* TO TRUE|ACCEPT .* FROM/i],
  ["REDEFINES / byte-window V2", /REDEFINES|byte-window|renames/i],
  ["inter-program CALL boundary", /CALL statement|LINKAGE SECTION|PROCEDURE DIVISION USING|CANCEL/i],
  ["tables / OCCURS residue", /subscripted but not a lowered table|OCCURS DEPENDING|OCCURS group|INDEXED BY|SEARCH/i],
  ["COPY span provenance", /span provenance|COPY\/REPLACE|preprocessor changed/i],
  ["USAGE POINTER", /USAGE POINTER/i],
];
const NAMES = [...THEMES.map(([n]) => n), "UNCLASSIFIED"];
const themeOf = (b) => THEMES.find(([, re]) => re.test(b))?.[0] ?? "UNCLASSIFIED";

const mods = blocked.map((r) => ({
  name: r.file.split(/[\\/]/).pop(),
  themes: new Set([...new Set(r.blockers ?? [])].map(themeOf)),
}));

const unclassified = new Set();
for (const r of blocked) for (const b of new Set(r.blockers ?? [])) if (themeOf(b) === "UNCLASSIFIED") unclassified.add(b);
console.log(`blocked modules: ${mods.length} | UNCLASSIFIED blocker kinds remaining: ${unclassified.size}`);
for (const u of unclassified) console.log(`   ! ${u.slice(0, 100)}`);

console.log("\n=== greedy: which themes, in which order, unlock the most ===");
const state = mods.map((m) => ({ name: m.name, t: new Set(m.themes), done: false }));
const solved = new Set();
for (let step = 1; step <= NAMES.length; step++) {
  let best = null;
  for (const n of NAMES) {
    if (solved.has(n)) continue;
    const gain = state.filter((s) => !s.done && [...s.t].every((x) => x === n || solved.has(x))).length;
    if (!best || gain > best.gain) best = { n, gain };
  }
  if (!best) break;
  solved.add(best.n);
  const newly = state.filter((s) => !s.done && [...s.t].every((x) => solved.has(x)));
  for (const s of newly) s.done = true;
  const total = state.filter((s) => s.done).length;
  const mark = best.gain > 0 ? "" : "   (unlocks nothing alone — prerequisite only)";
  console.log(
    `${String(step).padStart(2)}. ${best.n.padEnd(34)} +${best.gain}  ->  ${3 + total}/31 verifiable` +
      (newly.length ? `   [${newly.map((s) => s.name).join(", ")}]` : mark),
  );
}
