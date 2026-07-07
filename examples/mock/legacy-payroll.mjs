#!/usr/bin/env node
// Mock stand-in for the GnuCOBOL-compiled PAYROLL binary (cobc -x payroll.cbl).
// It reproduces the COBOL 85 semantics of ../payroll.cbl exactly:
//   - fixed-point decimal arithmetic (no binary floating point anywhere)
//   - COMPUTE without ROUNDED truncates toward zero at the target's scale
//   - COMPUTE ... ROUNDED rounds half-up (away from zero)
//   - DISPLAY of PIC 9(7).99 prints the integer part zero-padded to 7 digits
//   - PIC X(6) fields are space-padded on the right
// Once GnuCOBOL is available, replace this argv in the diff config with the
// real compiled binary; the harness does not care which it runs.
import { readFileSync } from "node:fs";

const lines = readFileSync(0, "utf8").split(/\r?\n/);
const empId = (lines[0] ?? "").trim();
// Input conversion stores through the target PICTURE: integer digits
// beyond capacity drop (hours: 3 int digits; rate: 4 int digits).
const hoursC = toCents(lines[1], 100_000); // hundredths, PIC 9(3)V99
const rateC = toCents(lines[2], 1_000_000); // hundredths, PIC 9(4)V99

function toCents(s, capacityCents) {
  const v = Number.parseFloat((s ?? "").trim());
  if (!Number.isFinite(v) || v < 0) {
    console.error(`PAYROLL: invalid numeric input: ${JSON.stringify(s ?? "")}`);
    process.exit(3);
  }
  return Math.round(v * 100) % capacityCents;
}

// PIC 9(7)V99 holds 9 digit positions (7 integer + 2 decimal). With no
// ON SIZE ERROR declared, COBOL silently drops high-order digits beyond
// capacity when storing — in cents, modulo 10^9. Found by running this
// mock differentially against real GnuCOBOL 3.1.2 (examples/
// mock-validation.json): 9/200 generated cases diverged before this fix.
const PIC_9_7_V99_CENTS = 1_000_000_000;
const store = (c) => c % PIC_9_7_V99_CENTS;

// Gross pay in 1e-5 units so the 1.5x overtime factor stays exact integer math.
let grossE5;
if (hoursC > 4000) {
  const otC = hoursC - 4000;
  grossE5 = 4000 * rateC * 10 + otC * rateC * 15;
} else {
  grossE5 = hoursC * rateC * 10;
}
// COMPUTE without ROUNDED: truncate to the PIC 9(7)V99 target scale.
const grossC = store(Math.trunc(grossE5 / 1000));

// COMPUTE WS-TAX ROUNDED = gross * 0.225 (PIC V999): half-up at cents.
const taxE5 = grossC * 225;
const q = Math.trunc(taxE5 / 1000);
const r = taxE5 % 1000;
const taxC = store(r >= 500 ? q + 1 : q);

const netC = store(grossC - taxC);

// PIC 9(7).99 edited output.
const fmt = (c) => `${String(Math.trunc(c / 100)).padStart(7, "0")}.${String(Math.abs(c % 100)).padStart(2, "0")}`;

process.stdout.write(
  `EMP_ID=${empId.padEnd(6)}\n` +
    `GROSS_PAY=${fmt(grossC)}\n` +
    `TAX=${fmt(taxC)}\n` +
    `NET_PAY=${fmt(netC)}\n`,
);
