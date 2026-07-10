import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * RETAIL - discounted order with tax on the settled amount, translated from
 * COBOL 85. Faithful variant: exact COBOL behavior over Java idiom.
 *
 * The chain is DOUBLE rounding, preserved step for step: the 10% discount
 * settles ROUNDED to the nearest whole dollar (PIC 9(7), scale 0), and the
 * 8.25% tax is computed ROUNDED to the cent ON THE SETTLED whole-dollar
 * amount - never on the unrounded discounted value.
 */
public final class Retail {

    /** COMPUTE WS-DISC-DOL ROUNDED = WS-AMOUNT * 90 / 100. */
    private static final BigDecimal DISCOUNT_RATE = new BigDecimal("90");

    /** COMPUTE WS-TAX ROUNDED = WS-DISC-DOL * 825 / 10000. */
    private static final BigDecimal TAX_RATE = new BigDecimal("825");

    /** IF WS-TOTAL > 500: tier threshold. */
    private static final BigDecimal TIER_LIMIT = new BigDecimal("500");

    /** PIC 9(7) capacity (WS-DISC-DOL). */
    private static final BigDecimal PIC_9_7_MODULUS = new BigDecimal("10000000");

    /** PIC 9(7)V99 capacity (WS-AMOUNT / WS-TAX / WS-TOTAL). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String orderId = readLine(in);                                   // WS-ORD-ID PIC X(8)
        BigDecimal amount = numval(readLine(in), PIC_9_7_V99_MODULUS);   // WS-AMOUNT PIC 9(7)V99

        // First rounding: the discount settles to a WHOLE DOLLAR (scale 0).
        BigDecimal discDollars = amount.multiply(DISCOUNT_RATE).movePointLeft(2)
                .setScale(0, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_MODULUS);

        // Second rounding: tax to the cent ON THE SETTLED amount.
        BigDecimal tax = discDollars.multiply(TAX_RATE).movePointLeft(4)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);

        BigDecimal total = discDollars.add(tax).remainder(PIC_9_7_V99_MODULUS);

        String tier;
        if (total.compareTo(TIER_LIMIT) > 0) {
            tier = "HIGH"; // MOVE "HIGH" TO WS-TIER
        } else {
            tier = "NORM"; // MOVE "NORM" TO WS-TIER
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

    /**
     * FUNCTION NUMVAL then the store into PIC 9(7)V99: extra decimals
     * truncate toward zero and integer digits beyond capacity drop silently.
     */
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
