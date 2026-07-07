// Validates IR documents against ir/schema.json using Ajv (draft 2020-12).
// Usage: node scripts/validate-ir.mjs <schema.json> <ir.json> [more.ir.json ...]
// Exit 0 when every document validates, 1 otherwise.
import { readFileSync } from "node:fs";
import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;

const [schemaPath, ...files] = process.argv.slice(2);
if (!schemaPath || files.length === 0) {
  console.error("usage: node scripts/validate-ir.mjs <schema.json> <ir.json> [...]");
  process.exit(1);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));

let ok = true;
for (const f of files) {
  const valid = validate(JSON.parse(readFileSync(f, "utf8")));
  if (valid) {
    console.log(`ok   ${f}`);
  } else {
    ok = false;
    console.error(`FAIL ${f}`);
    for (const e of validate.errors ?? []) {
      console.error(`     ${e.instancePath || "/"} ${e.message}`);
    }
  }
}
process.exit(ok ? 0 : 1);
