#!/usr/bin/env node
// Mock stand-in for the transpiled Java 21 payroll service (java -jar payroll.jar).
// Same business logic as legacy-payroll.mjs, with one DELIBERATE defect of the
// kind real COBOL -> Java migrations hit constantly:
//
//   tax rounding uses HALF_EVEN (banker's rounding — the reflex of much
//   hand-ported BigDecimal code) instead of COBOL ROUNDED's HALF_UP.
//
// Verifier layer B must catch this on any case where the raw tax lands on an
// exact half cent (e.g. 9.00 hours at 5.00/hr -> gross 45.00 -> tax 10.125).
// Set LEGACYMIND_FIX_ROUNDING=1 to apply the fix and watch the diff go green —
// examples/payroll-diff-fixed.json does exactly that.
// Output formatting is Java-idiomatic (BigDecimal.toString-style, no COBOL
// zero padding); the harness normalizes numerics, so formatting alone must
// never cause a failure.
import { readFileSync } from "node:fs";

const lines = readFileSync(0, "utf8").split(/\r?\n/);
const empId = (lines[0] ?? "").trim();
// Input conversion stores through the target PICTURE (capacity wrap).
const hoursC = toCents(lines[1], 100_000);
const rateC = toCents(lines[2], 1_000_000);

function toCents(s, capacityCents) {
  const v = Number.parseFloat((s ?? "").trim());
  if (!Number.isFinite(v) || v < 0) {
    console.error(`payroll-service: invalid numeric input: ${JSON.stringify(s ?? "")}`);
    process.exit(3);
  }
  return Math.round(v * 100) % capacityCents;
}

// PIC 9(7)V99 capacity: store drops digits beyond 7 integer positions
// (no ON SIZE ERROR in the source) — modulo 10^9 in cents.
const PIC_9_7_V99_CENTS = 1_000_000_000;
const store = (c) => c % PIC_9_7_V99_CENTS;

let grossE5;
if (hoursC > 4000) {
  const otC = hoursC - 4000;
  grossE5 = 4000 * rateC * 10 + otC * rateC * 15;
} else {
  grossE5 = hoursC * rateC * 10;
}
const grossC = store(Math.trunc(grossE5 / 1000));

const taxE5 = grossC * 225;
const q = Math.trunc(taxE5 / 1000);
const r = taxE5 % 1000;
let taxC;
if (process.env.LEGACYMIND_FIX_ROUNDING === "1") {
  taxC = r >= 500 ? q + 1 : q; // HALF_UP — matches COBOL ROUNDED
} else {
  taxC = r > 500 ? q + 1 : r < 500 ? q : q % 2 === 0 ? q : q + 1; // HALF_EVEN — the defect
}
taxC = store(taxC);

const netC = store(grossC - taxC);

const fmt = (c) => (c / 100).toFixed(2);

process.stdout.write(
  `EMP_ID=${empId}\n` + `GROSS_PAY=${fmt(grossC)}\n` + `TAX=${fmt(taxC)}\n` + `NET_PAY=${fmt(netC)}\n`,
);
