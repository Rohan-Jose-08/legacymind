import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * TIER - tiered order discount. Idiomatic variant. The defect: it reads the
 * top band boundary as a strict `amount > 1000` instead of the COBOL
 * `WS-AMOUNT >= 1000`, so an order of exactly 1000 falls to the 10% band
 * (100.00) instead of the 15% band (150.00). Layer B catches it against the
 * real GnuCOBOL binary on the 1000 boundary.
 */
public final class Tier {

    private static final BigDecimal BAND_3 = new BigDecimal("1000");
    private static final BigDecimal BAND_2 = new BigDecimal("500");
    private static final BigDecimal BAND_1 = new BigDecimal("100");
    private static final BigDecimal RATE_3 = new BigDecimal("15");
    private static final BigDecimal RATE_2 = new BigDecimal("10");
    private static final BigDecimal RATE_1 = new BigDecimal("5");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String orderId = readLine(in);
        BigDecimal amount = numval(readLine(in), 2, PIC_9_7_V99_MODULUS);

        BigDecimal discount;
        // BUG: strict > misses the order sitting exactly on the 1000 boundary.
        if (amount.compareTo(BAND_3) > 0) {
            discount = amount.multiply(RATE_3).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP).remainder(PIC_9_7_V99_MODULUS);
        } else if (amount.compareTo(BAND_2) >= 0) {
            discount = amount.multiply(RATE_2).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP).remainder(PIC_9_7_V99_MODULUS);
        } else if (amount.compareTo(BAND_1) >= 0) {
            discount = amount.multiply(RATE_1).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP).remainder(PIC_9_7_V99_MODULUS);
        } else {
            discount = new BigDecimal("0");
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
