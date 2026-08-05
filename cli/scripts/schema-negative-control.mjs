#!/usr/bin/env node
/**
 * Negative control for ir/schema.json.
 *
 * "Every IR validates" is only meaningful if the schema can still REJECT
 * things. A schema loosened until everything passes reports exactly the
 * same green as a correct one — this project has already been burned once
 * by a detector that could not fire (the charset sweep's mangled regex),
 * so every sweep gets a control that must fire in the same run.
 *
 * Each mutation below corrupts a valid IR in a way the schema is supposed
 * to catch. Any mutation that still validates is a hole, and the run fails.
 *
 *   node scripts/schema-negative-control.mjs <schema.json> <valid.ir.json>
 */
import { readFileSync } from "node:fs";
import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const [schemaPath, irPath] = process.argv.slice(2);
if (!schemaPath || !irPath) {
  console.error("usage: node scripts/schema-negative-control.mjs <schema.json> <valid.ir.json>");
  process.exit(1);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
const base = JSON.parse(readFileSync(irPath, "utf8"));
const clone = () => JSON.parse(JSON.stringify(base));

const firstItem = (ir) => ir.dataDivision.items[0];
const firstStmt = (ir) => ir.procedureDivision.paragraphs[0].statements[0];

const MUTATIONS = [
  ["unknown statement kind", (ir) => { firstStmt(ir).kind = "teleport"; }],
  ["extra property on a statement", (ir) => { firstStmt(ir).surprise = 1; }],
  ["extra property on a data item", (ir) => { firstItem(ir).surprise = 1; }],
  ["data item missing span", (ir) => { delete firstItem(ir).span; }],
  ["data item missing name", (ir) => { delete firstItem(ir).name; }],
  ["bad source sha256", (ir) => { ir.module.source.sha256 = "nothex"; }],
  ["unknown dialect", (ir) => { ir.module.dialect = "cobol74"; }],
  ["paragraph name with a stray space", (ir) => { ir.procedureDivision.paragraphs[0].name = "NOT A PARAGRAPH"; }],
  ["negative occurs", (ir) => { firstItem(ir).occurs = -1; }],
  ["indexName used as a string", (ir) => { firstItem(ir).indexName = "PX"; }],
  ["byte window with 0 offset", (ir) => { firstItem(ir).window = { of: "REC", offset: 0, length: 2 }; }],
  // Written out in full rather than patching ir.files[0], so it fails on the
  // organization and not on some other missing field of a stub object — a
  // control that passes for the wrong reason is not a control.
  ["unknown file organization", (ir) => {
    ir.files = [{ name: "F", assign: "F", organization: "sequential", record: "R", mode: "input" }];
  }],
];

// The control's own control: the base document must VALIDATE, and the
// same file entry that fails above must PASS with a legal organization.
// Without this, a schema that rejected everything would score 12/12.
if (!validate(base)) {
  console.error(`  HOLE  the base document ${irPath} does not validate; every rejection below is meaningless`);
  process.exit(1);
}
{
  const ok = clone();
  ok.files = [{ name: "F", assign: "F", organization: "line-sequential", record: "R", mode: "input" }];
  if (!validate(ok)) {
    console.error("  HOLE  a LEGAL file entry was rejected; the organization mutation below proves nothing");
    console.error(JSON.stringify(validate.errors, null, 1));
    process.exit(1);
  }
  console.log("  ok    baseline: valid document accepted, legal file entry accepted");
}

let holes = 0;
for (const [name, mutate] of MUTATIONS) {
  const bad = clone();
  try {
    mutate(bad);
  } catch (e) {
    console.log(`  SKIP  ${name} — not applicable to this IR (${e.message})`);
    continue;
  }
  if (validate(bad)) {
    console.error(`  HOLE  ${name} — schema ACCEPTED a document it should reject`);
    holes++;
  } else {
    console.log(`  ok    rejected: ${name}`);
  }
}

if (holes > 0) {
  console.error(`\nschema-negative-control: ${holes} hole(s) — the schema is not constraining what it claims to`);
  process.exit(1);
}
console.log(`\nschema-negative-control: all ${MUTATIONS.length} mutations rejected`);
