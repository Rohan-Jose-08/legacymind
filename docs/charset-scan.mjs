// Charset-sensitivity scanner.
//
// Ordering comparisons (< >) on ALPHANUMERIC operands depend on the
// collating sequence, and ASCII and EBCDIC order digits and letters
// differently. Equality is charset-insensitive (byte equality survives any
// bijection), so only ordering matters.
//
// No regex escaping anywhere — token the condition text and compare tokens
// exactly. The previous inline version's \b escapes were mangled by shell
// quoting and produced a FALSE ZERO.

import { readFileSync } from "node:fs";

const TOKEN = /[A-Za-z0-9_$-]+|"[^"]*"|'[^']*'|[<>=]+/g;
const ORDERING = new Set(["<", ">", "<=", ">=", "GREATER", "LESS"]);

function alnumNames(ir) {
  const out = new Set();
  const walk = (items) => {
    for (const it of items ?? []) {
      if (it.name && it.type && it.type.category === "alphanumeric") out.add(it.name.toUpperCase());
      walk(it.children);
    }
  };
  walk(ir.dataDivision?.items);
  return out;
}

/** Conditions containing an ordering operator AND an alphanumeric operand. */
export function scanIr(ir) {
  const alnum = alnumNames(ir);
  const hits = [];
  const visit = (stmts) => {
    for (const s of stmts ?? []) {
      const text = s.condition?.text;
      if (text) {
        const toks = text.match(TOKEN) ?? [];
        const hasOrder = toks.some((t) => ORDERING.has(t.toUpperCase()));
        const named = toks.filter((t) => alnum.has(t.toUpperCase()));
        if (hasOrder && named.length > 0) hits.push({ text, operands: [...new Set(named)] });
      }
      for (const arm of ["then", "else", "atEnd", "notAtEnd"]) visit(s[arm]);
    }
  };
  for (const p of ir.procedureDivision?.paragraphs ?? []) visit(p.statements);
  return { alnumCount: alnum.size, hits };
}

const files = process.argv.slice(2);
let affected = 0;
let totalAlnum = 0;
for (const f of files) {
  const ir = JSON.parse(readFileSync(f, "utf8"));
  const { alnumCount, hits } = scanIr(ir);
  totalAlnum += alnumCount;
  const name = ir.module?.programId ?? f;
  if (hits.length) {
    affected++;
    console.log(`  ${name}: ${hits.length} collation-sensitive condition(s)`);
    for (const h of hits) console.log(`      ${h.text}   [alphanumeric: ${h.operands.join(", ")}]`);
  }
}
console.log(
  `\n  scanned ${files.length} module(s), ${totalAlnum} alphanumeric item(s) declared; ` +
    `${affected} module(s) with a collation-sensitive comparison`,
);
