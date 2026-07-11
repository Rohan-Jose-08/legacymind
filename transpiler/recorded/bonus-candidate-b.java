import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * BONUS - sales bonus computed by a multi-paragraph COBOL section.
 * Idiomatic variant. The defect: PERFORM CALC was translated as performing
 * only the section's FIRST block (the base computation), so STEP-UPLIFT
 * and STEP-TOTAL never run - the bonus and total print as their VALUE ZERO
 * initials. The classic section-vs-paragraph migration bug; layer B
 * catches it on every case with non-zero sales.
 */
public final class Bonus {

    private static final BigDecimal BASE_RATE = new BigDecimal("3");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String empId = readLine(in);
        BigDecimal sales = numval(readLine(in), PIC_9_7_V99_MODULUS);

        // BUG: only the section's own statement runs - the uplift and total
        // paragraphs of the CALC section were never reached.
        BigDecimal base = sales.multiply(BASE_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);
        BigDecimal bonus = new BigDecimal("0.00"); // WS-BONUS VALUE ZERO, never assigned
        BigDecimal total = new BigDecimal("0.00"); // WS-TOTAL VALUE ZERO, never assigned

        StringBuilder out = new StringBuilder();
        out.append("EMP_ID=").append(empId).append('\n');
        out.append("BONUS=").append(bonus.toPlainString()).append('\n');
        out.append("TOTAL=").append(total.toPlainString()).append('\n');
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
            System.err.println("BONUS: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
