import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * INTEREST — simple-interest quote, translated from COBOL 85.
 * Faithful variant: exact COBOL arithmetic behavior takes priority over
 * Java idiom. All values are BigDecimal; every store honors the target
 * PICTURE's scale and storage capacity (high-order digits drop silently,
 * as COBOL does with no ON SIZE ERROR declared).
 */
public final class Interest {

    /** Loyalty threshold from CALC-INTEREST: terms longer than 5 years. */
    private static final BigDecimal FIVE_YEARS = new BigDecimal("5");

    /** Loyalty bonus rate points from CALC-INTEREST. */
    private static final BigDecimal LOYALTY_BONUS = new BigDecimal("0.25");

    /** PIC 99V99 capacity (WS-EFF-RATE): integer digits beyond 2 drop on store. */
    private static final BigDecimal PIC_99_V99_MODULUS = new BigDecimal("100");

    /** PIC 9(7)V99 capacity (WS-INTEREST). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    /** PIC 9(8)V99 capacity (WS-TOTAL). */
    private static final BigDecimal PIC_9_8_V99_MODULUS = new BigDecimal("100000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA (interest.cbl:29-39): ACCEPT + FUNCTION NUMVAL.
        String acctId = readLine(in);                                            // WS-ACCT-ID PIC X(8)
        BigDecimal principal = numval(readLine(in), 2, PIC_9_7_V99_MODULUS);     // WS-PRINCIPAL PIC 9(7)V99
        BigDecimal ratePct = numval(readLine(in), 2, PIC_99_V99_MODULUS);        // WS-RATE-PCT PIC 99V99
        BigDecimal termYears = numval(readLine(in), 0, PIC_99_V99_MODULUS);      // WS-TERM-YEARS PIC 9(2)

        // CALC-INTEREST (interest.cbl:40-48).
        BigDecimal effRate;
        if (termYears.compareTo(FIVE_YEARS) > 0) {
            // COMPUTE WS-EFF-RATE = WS-RATE-PCT + 0.25 into PIC 99V99:
            // a 99.99 rate plus the bonus overflows and wraps to 0.24.
            effRate = ratePct.add(LOYALTY_BONUS).remainder(PIC_99_V99_MODULUS);
        } else {
            effRate = ratePct; // MOVE WS-RATE-PCT TO WS-EFF-RATE
        }

        // COMPUTE WS-INTEREST ROUNDED = P * ER * Y / 100 (interest.cbl:46-47):
        // the /100 is an exact decimal shift; ROUNDED settles half away from
        // zero into PIC 9(7)V99, then capacity applies.
        BigDecimal interest = principal.multiply(effRate).multiply(termYears)
                .movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);

        // COMPUTE WS-TOTAL = P + interest (interest.cbl:48) into PIC 9(8)V99.
        BigDecimal total = principal.add(interest).remainder(PIC_9_8_V99_MODULUS);

        // PRINT-RESULT (interest.cbl:49-54): KEY=VALUE contract on stdout.
        StringBuilder out = new StringBuilder();
        out.append("ACCT_ID=").append(acctId).append('\n');
        out.append("INTEREST=").append(interest.toPlainString()).append('\n');
        out.append("TOTAL=").append(total.toPlainString()).append('\n');
        System.out.print(out);
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL followed by the COMPUTE store into the target
     * PICTURE: extra decimals truncate toward zero and integer digits
     * beyond the PICTURE's capacity drop silently — e.g. a term of "444"
     * stored into PIC 9(2) becomes 44. COBOL input-conversion behavior
     * with no ON SIZE ERROR declared.
     */
    private static BigDecimal numval(String s, int scale, BigDecimal capacity) {
        try {
            BigDecimal v = new BigDecimal(s.trim());
            if (v.signum() < 0) {
                throw new NumberFormatException("negative value for unsigned PICTURE");
            }
            return v.setScale(scale, RoundingMode.DOWN).remainder(capacity);
        } catch (NumberFormatException e) {
            System.err.println("INTEREST: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
