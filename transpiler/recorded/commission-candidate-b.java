import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * COMMISSION - sales commission with a cap and a completion bonus.
 * Idiomatic variant: prefers a clean, flat control flow. In doing so it
 * "simplifies" the COBOL GO TO CALC-EXIT early return into a plain clamp and
 * then adds the completion bonus unconditionally. That is the defect: the
 * COBOL early return skips the bonus for a capped commission, so this variant
 * overpays every capped sale by the 50.00 bonus. Layer B catches it against
 * the real GnuCOBOL binary on any capped case.
 */
public final class Commission {

    private static final BigDecimal RATE = new BigDecimal("7.50");
    private static final BigDecimal CAP = new BigDecimal("500.00");
    private static final BigDecimal BONUS = new BigDecimal("50.00");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String repId = readLine(in);
        BigDecimal sales = numval(readLine(in), PIC_9_7_V99_MODULUS);

        BigDecimal commission = sales.multiply(RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);
        // BUG: the clamp keeps the cap but drops the early return, so the bonus
        // below is paid even when the commission was capped.
        if (commission.compareTo(CAP) > 0) {
            commission = CAP;
        }
        commission = commission.add(BONUS).remainder(PIC_9_7_V99_MODULUS);

        StringBuilder out = new StringBuilder();
        out.append("REP_ID=").append(repId).append('\n');
        out.append("COMMISSION=").append(commission.toPlainString()).append('\n');
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
            System.err.println("COMMISSION: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
