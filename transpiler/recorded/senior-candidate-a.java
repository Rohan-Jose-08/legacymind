import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * SENIOR - senior-citizen discount via a status flag, translated from
 * COBOL 85. Faithful variant: exact COBOL behavior over Java idiom.
 *
 * The COBOL 88-level condition name SENIOR (VALUE 1) on WS-STATUS is a
 * plain numeric flag here: SET SENIOR TO TRUE is MOVE 1 TO WS-STATUS, and
 * IF SENIOR is WS-STATUS = 1. All values are BigDecimal; stores honor the
 * target PICTURE's scale and capacity.
 */
public final class Senior {

    /** 88 SENIOR VALUE 1: the value SET SENIOR TO TRUE writes into WS-STATUS. */
    private static final BigDecimal SENIOR_TRUE = new BigDecimal("1");

    /** IF WS-AGE >= 65: the senior age threshold. */
    private static final BigDecimal SENIOR_AGE = new BigDecimal("65");

    /** COMPUTE WS-DISCOUNT = WS-AMOUNT * 15 / 100: discount rate points. */
    private static final BigDecimal RATE = new BigDecimal("15");

    /** PIC 9(3) capacity (WS-AGE). */
    private static final BigDecimal PIC_9_3_MODULUS = new BigDecimal("1000");

    /** PIC 9(7)V99 capacity (WS-AMOUNT / WS-DISCOUNT). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA: ACCEPT + FUNCTION NUMVAL of age and amount.
        BigDecimal age = numval(readLine(in), 0, PIC_9_3_MODULUS);         // WS-AGE PIC 9(3)
        BigDecimal amount = numval(readLine(in), 2, PIC_9_7_V99_MODULUS);  // WS-AMOUNT PIC 9(7)V99

        // MOVE 0 TO WS-STATUS; IF WS-AGE >= 65 SET SENIOR TO TRUE.
        BigDecimal status = new BigDecimal("0");
        if (age.compareTo(SENIOR_AGE) >= 0) {
            status = SENIOR_TRUE; // SET SENIOR TO TRUE == MOVE 1 TO WS-STATUS
        }

        // IF SENIOR (WS-STATUS = 1): COMPUTE WS-DISCOUNT ROUNDED = amount * 15 / 100.
        BigDecimal discount = BigDecimal.ZERO;
        if (status.compareTo(SENIOR_TRUE) == 0) {
            discount = amount.multiply(RATE).movePointLeft(2)
                    .setScale(2, RoundingMode.HALF_UP)
                    .remainder(PIC_9_7_V99_MODULUS);
        }

        // PRINT: KEY=VALUE contract on stdout.
        StringBuilder out = new StringBuilder();
        out.append("SENIOR=").append(status.toPlainString()).append('\n');
        out.append("DISCOUNT=").append(discount.toPlainString()).append('\n');
        System.out.print(out);
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL then the store into the target PICTURE: extra decimals
     * truncate toward zero and integer digits beyond capacity drop silently,
     * as COBOL does with no ON SIZE ERROR declared.
     */
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
