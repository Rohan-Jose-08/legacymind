import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * RETAIL - discounted order with tax on the settled amount. Idiomatic
 * variant. The defect: it "streamlines" the double rounding into one - the
 * tax is computed on the UNROUNDED discounted amount and rounded once at
 * the end, instead of on the whole-dollar settled value. Whenever the
 * dollar settle moves the base (e.g. 10.56 -> 9.504 settles to 10), the tax
 * differs by whole cents (0.78 vs the correct 0.83), and TOTAL follows.
 * Layer B catches it on the curated settle case.
 */
public final class Retail {

    private static final BigDecimal DISCOUNT_RATE = new BigDecimal("90");
    private static final BigDecimal TAX_RATE = new BigDecimal("825");
    private static final BigDecimal TIER_LIMIT = new BigDecimal("500");
    private static final BigDecimal PIC_9_7_MODULUS = new BigDecimal("10000000");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String orderId = readLine(in);
        BigDecimal amount = numval(readLine(in), PIC_9_7_V99_MODULUS);

        BigDecimal discRaw = amount.multiply(DISCOUNT_RATE).movePointLeft(2);
        BigDecimal discDollars = discRaw.setScale(0, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_MODULUS);

        // BUG: taxes the unrounded discounted amount (single rounding at the
        // end) instead of the whole-dollar settled value.
        BigDecimal tax = discRaw.multiply(TAX_RATE).movePointLeft(4)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);

        BigDecimal total = discDollars.add(tax).remainder(PIC_9_7_V99_MODULUS);

        String tier;
        if (total.compareTo(TIER_LIMIT) > 0) {
            tier = "HIGH";
        } else {
            tier = "NORM";
        }

        StringBuilder out = new StringBuilder();
        out.append("ORDER_ID=").append(orderId).append('\n');
        out.append("DISC=").append(discDollars.toPlainString()).append('\n');
        out.append("TAX=").append(tax.toPlainString()).append('\n');
        out.append("TOTAL=").append(total.toPlainString()).append('\n');
        out.append("TIER=").append(tier).append('\n');
        System.out.print(out);
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    private static BigDecimal numval(String s, BigDecimal capacity) {
        try {
            BigDecimal v = new BigDecimal(s.trim());
            if (v.signum() < 0) {
                throw new NumberFormatException("negative value for unsigned PICTURE");
            }
            return v.setScale(2, RoundingMode.DOWN).remainder(capacity);
        } catch (NumberFormatException e) {
            System.err.println("RETAIL: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
