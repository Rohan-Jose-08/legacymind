import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * SENIOR - senior-citizen discount via a status flag.
 * Idiomatic variant. The defect: it reads the age threshold as a strict
 * `age > 65` instead of the COBOL `WS-AGE >= 65`, so a customer who is
 * exactly 65 is not marked senior and receives no discount. Layer B catches
 * it against the real GnuCOBOL binary on the age-65 boundary.
 */
public final class Senior {

    private static final BigDecimal SENIOR_TRUE = new BigDecimal("1");
    private static final BigDecimal SENIOR_AGE = new BigDecimal("65");
    private static final BigDecimal RATE = new BigDecimal("15");
    private static final BigDecimal PIC_9_3_MODULUS = new BigDecimal("1000");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        BigDecimal age = numval(readLine(in), 0, PIC_9_3_MODULUS);
        BigDecimal amount = numval(readLine(in), 2, PIC_9_7_V99_MODULUS);

        BigDecimal status = new BigDecimal("0");
        // BUG: strict > misses the exactly-65 senior that COBOL's >= includes.
        if (age.compareTo(SENIOR_AGE) > 0) {
            status = SENIOR_TRUE;
        }

        BigDecimal discount = BigDecimal.ZERO;
        if (status.compareTo(SENIOR_TRUE) == 0) {
            discount = amount.multiply(RATE).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP)
                    .remainder(PIC_9_7_V99_MODULUS);
        }

        StringBuilder out = new StringBuilder();
        out.append("SENIOR=").append(status.toPlainString()).append('\n');
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
            System.err.println("SENIOR: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
