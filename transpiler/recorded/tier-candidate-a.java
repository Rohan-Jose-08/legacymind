import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * TIER - tiered order discount, translated from COBOL 85. Faithful variant:
 * exact COBOL behavior over Java idiom.
 *
 * The COBOL EVALUATE TRUE band selector is a nested if/else here: the first
 * matching band wins (COBOL EVALUATE does not fall through), its rate is
 * applied ROUNDED to the cent, and WHEN OTHER means no discount. All values
 * are BigDecimal and stores honor the target PICTURE's scale and capacity.
 */
public final class Tier {

    /** WHEN WS-AMOUNT >= 1000 / 500 / 100: band thresholds. */
    private static final BigDecimal BAND_3 = new BigDecimal("1000");
    private static final BigDecimal BAND_2 = new BigDecimal("500");
    private static final BigDecimal BAND_1 = new BigDecimal("100");

    /** Discount rate points per band: WS-AMOUNT * 15 / 100, etc. */
    private static final BigDecimal RATE_3 = new BigDecimal("15");
    private static final BigDecimal RATE_2 = new BigDecimal("10");
    private static final BigDecimal RATE_1 = new BigDecimal("5");

    /** PIC 9(7)V99 capacity (WS-AMOUNT / WS-DISCOUNT). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String orderId = readLine(in);                                    // WS-ID-TEXT PIC X(8)
        BigDecimal amount = numval(readLine(in), 2, PIC_9_7_V99_MODULUS);  // WS-AMOUNT PIC 9(7)V99

        // EVALUATE TRUE: the first band whose threshold amount reaches wins.
        BigDecimal discount;
        if (amount.compareTo(BAND_3) >= 0) {
            discount = amount.multiply(RATE_3).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP).remainder(PIC_9_7_V99_MODULUS);
        } else if (amount.compareTo(BAND_2) >= 0) {
            discount = amount.multiply(RATE_2).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP).remainder(PIC_9_7_V99_MODULUS);
        } else if (amount.compareTo(BAND_1) >= 0) {
            discount = amount.multiply(RATE_1).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP).remainder(PIC_9_7_V99_MODULUS);
        } else {
            discount = new BigDecimal("0"); // WHEN OTHER: MOVE 0 TO WS-DISCOUNT
        }

        StringBuilder out = new StringBuilder();
        out.append("ORDER_ID=").append(orderId).append('\n');
        out.append("DISCOUNT=").append(discount.toPlainString()).append('\n');
        System.out.print(out);
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL then the store into the target PICTURE: extra decimals
     * truncate toward zero and integer digits beyond capacity drop silently.
     */
    private static BigDecimal numval(String s, int scale, BigDecimal capacity) {
        try {
            BigDecimal v = new BigDecimal(s.trim());
            if (v.signum() < 0) {
                throw new NumberFormatException("negative value for unsigned PICTURE");
            }
            return v.setScale(scale, RoundingMode.DOWN).remainder(capacity);
        } catch (NumberFormatException e) {
            System.err.println("TIER: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
