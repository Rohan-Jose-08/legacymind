/**
 * `legacymind plan` — module inventory and rough migration cost estimate.
 *
 * Reads one IR file (or every *.ir.json in a directory) and reports size
 * plus an ESTIMATED LLM cost for a two-candidate migrate pass. The token
 * estimate is chars/4 — a deliberate rough cut, clearly labeled; the
 * authoritative numbers come from the metered usage `migrate` records
 * per call. This stage exists so a customer sees scope and cost before
 * any model is invoked.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { costUsd } from "./model/client.js";

interface PlanRow {
  file: string;
  programId: string;
  paragraphs: number;
  dataItems: number;
  estInputTokens: number;
  estCostUsd: number | null;
}

function countItems(items: { children?: unknown[] }[]): number {
  return items.reduce((n, i) => n + 1 + countItems((i.children ?? []) as { children?: unknown[] }[]), 0);
}

export function runPlan(target: string, model: string): number {
  const files = statSync(target).isDirectory()
    ? readdirSync(target)
        .filter((f) => f.endsWith(".ir.json"))
        .map((f) => join(target, f))
    : [target];
  if (files.length === 0) {
    console.error(`legacymind: plan: no *.ir.json files in ${target}`);
    return 2;
  }

  const rows: PlanRow[] = files.map((file) => {
    const ir = JSON.parse(readFileSync(file, "utf8"));
    const estInputTokens = Math.ceil(JSON.stringify(ir).length / 4); // rough: ~4 chars/token
    // two candidates; assume output comparable to input for small modules
    const est = costUsd(model, { inputTokens: estInputTokens * 2, outputTokens: estInputTokens * 2 });
    return {
      file: file.replace(/\\/g, "/"),
      programId: ir.module?.programId ?? "?",
      paragraphs: ir.procedureDivision?.paragraphs?.length ?? 0,
      dataItems: countItems(ir.dataDivision?.items ?? []),
      estInputTokens,
      estCostUsd: est,
    };
  });

  console.log(`legacymind plan (model: ${model})`);
  console.log("");
  for (const r of rows) {
    console.log(`  ${r.programId.padEnd(10)} ${r.file}`);
    console.log(
      `    paragraphs: ${r.paragraphs}  data items: ${r.dataItems}  ` +
        `~${r.estInputTokens} input tokens/candidate`,
    );
    console.log(
      `    est. migrate cost (2 candidates): ${r.estCostUsd === null ? "unknown model pricing" : `~$${r.estCostUsd.toFixed(4)}`}`,
    );
  }
  console.log("");
  console.log("  NOTE: token counts are a chars/4 estimate for scoping only.");
  console.log("  Actual usage and cost are metered per call by `migrate` and");
  console.log("  recorded in the replay cache and selection.json.");
  return 0;
}
