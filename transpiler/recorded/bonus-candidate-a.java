import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * BONUS - sales bonus computed by a multi-paragraph COBOL section,
 * translated from COBOL 85. Faithful variant: exact COBOL behavior over
 * Java idiom.
 *
 * PERFORM CALC performs the WHOLE section - its own base computation plus
 * the STEP-UPLIFT and STEP-TOTAL paragraphs - preserved here as the full
 * three-phase sequence: 3% base ROUNDED, a 150% uplift ROUNDED over
 * 50000.00 (a nested rounding over the settled base), then the total.
 */
public final class Bonus {

    /** CALC SECTION: WS-BASE = WS-SALES * 3 / 100, ROUNDED. */
    private static final BigDecimal BASE_RATE = new BigDecimal("3");

    /** STEP-UPLIFT: WS-BONUS = WS-BASE * 150 / 100, ROUNDED, over 50000. */
    private static final BigDecimal UPLIFT_RATE = new BigDecimal("150");
    private static final BigDecimal UPLIFT_LIMIT = new BigDecimal("50000");

    /** PIC 9(7)V99 capacity (WS-SALES / WS-BASE / WS-BONUS / WS-TOTAL). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String empId = readLine(in);                                     // WS-EMP-ID PIC X(8)
        BigDecimal sales = numval(readLine(in), PIC_9_7_V99_MODULUS);    // WS-SALES PIC 9(7)V99

        // CALC SECTION, all three phases (the section's own statement plus
        // STEP-UPLIFT and STEP-TOTAL).
        BigDecimal base = sales.multiply(BASE_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);
        BigDecimal bonus;
        if (sales.compareTo(UPLIFT_LIMIT) > 0) {
            bonus = base.multiply(UPLIFT_RATE).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP)
                    .remainder(PIC_9_7_V99_MODULUS);
        } else {
            bonus = base; // MOVE WS-BASE TO WS-BONUS
        }
        BigDecimal total = sales.add(bonus).remainder(PIC_9_7_V99_MODULUS);

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
            System.err.println("BONUS: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
