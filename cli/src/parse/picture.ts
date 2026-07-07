/**
 * COBOL PICTURE clause parsing.
 *
 * Supported symbols: 9 A X S V plus repeat factors like 9(4), and the
 * editing symbols . , Z B 0 * + - $ (any of which mark the field
 * numeric-edited). P (decimal scaling) is rejected outright: silently
 * mis-typing a money field is worse than failing loudly.
 *
 * The scale of numeric fields (digits right of V) is the single most
 * important output here — it drives COMP-3 vs BigDecimal equivalence
 * checks in every verifier layer.
 */

export interface PictureType {
  /** The PICTURE string exactly as written in the source. */
  raw: string;
  category: "alphanumeric" | "numeric" | "numeric-edited";
  /** Total digit positions (numeric / numeric-edited). */
  digits?: number;
  /** Digit positions right of the implied (V) or editing (.) decimal point. */
  scale?: number;
  /** True when the picture carries an S sign symbol. */
  signed?: boolean;
  /** Character length (alphanumeric only). */
  length?: number;
}

export class PictureError extends Error {}

const REPEAT = /(.)\((\d+)\)/g;

export function parsePicture(raw: string): PictureType {
  const expanded = raw
    .toUpperCase()
    .replace(REPEAT, (_m, ch: string, n: string) => ch.repeat(Number(n)));

  if (expanded.includes("P")) {
    throw new PictureError(`PICTURE ${raw}: P scaling is not supported by the stub parser`);
  }
  if (/[^AX9SVZB0.,*+$-]/.test(expanded)) {
    throw new PictureError(`PICTURE ${raw}: unsupported symbol`);
  }

  if (/[AX]/.test(expanded)) {
    return { raw, category: "alphanumeric", length: expanded.length };
  }

  const isEdited = /[ZB0.,*+$-]/.test(expanded);
  if (isEdited) {
    const dot = expanded.indexOf(".");
    const digitsOf = (s: string) => (s.match(/[9Z]/g) ?? []).length;
    return {
      raw,
      category: "numeric-edited",
      digits: digitsOf(expanded),
      scale: dot >= 0 ? digitsOf(expanded.slice(dot + 1)) : 0,
    };
  }

  const signed = expanded.startsWith("S");
  const v = expanded.indexOf("V");
  return {
    raw,
    category: "numeric",
    digits: (expanded.match(/9/g) ?? []).length,
    scale: v >= 0 ? (expanded.slice(v + 1).match(/9/g) ?? []).length : 0,
    signed,
  };
}
