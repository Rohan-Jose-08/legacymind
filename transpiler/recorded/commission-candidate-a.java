import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * COMMISSION - sales commission with a cap and a completion bonus, translated
 * from COBOL 85. Faithful variant: exact COBOL behavior takes priority over
 * Java idiom. All values are BigDecimal; every store honors the target
 * PICTURE's scale and storage capacity.
 *
 * The COBOL "GO TO CALC-EXIT" is a structured early return from the
 * CALC-COMM THRU CALC-EXIT range: when the base commission is over the cap it
 * is clamped and the paragraph returns, so the completion bonus is NOT paid.
 * Preserved here as the then-branch of the cap test with the bonus only in the
 * else-branch.
 */
public final class Commission {

    /** WS-RATE PIC 99V99 VALUE 7.50: base commission percentage. */
    private static final BigDecimal RATE = new BigDecimal("7.50");

    /** WS-CAP PIC 9(5)V99 VALUE 500.00: commission cap. */
    private static final BigDecimal CAP = new BigDecimal("500.00");

    /** WS-BONUS PIC 9(5)V99 VALUE 50.00: flat completion bonus. */
    private static final BigDecimal BONUS = new BigDecimal("50.00");

    /** PIC 9(7)V99 capacity (WS-SALES / WS-COMMISSION): high-order digits drop on store. */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA (commission.cbl): ACCEPT id + sales text, NUMVAL the sales.
        String repId = readLine(in);                                   // WS-REP-ID PIC X(8)
        BigDecimal sales = numval(readLine(in), PIC_9_7_V99_MODULUS);  // WS-SALES PIC 9(7)V99

        // CALC-COMM THRU CALC-EXIT (commission.cbl:37-45).
        // COMPUTE WS-COMMISSION ROUNDED = WS-SALES * WS-RATE / 100.
        BigDecimal commission = sales.multiply(RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);
        if (commission.compareTo(CAP) > 0) {
            // IF WS-COMMISSION > WS-CAP: clamp and GO TO CALC-EXIT (early return,
            // no completion bonus).
            commission = CAP;
        } else {
            // ADD WS-BONUS TO WS-COMMISSION.
            commission = commission.add(BONUS).remainder(PIC_9_7_V99_MODULUS);
        }

        // PRINT-PARA (commission.cbl:46-48): KEY=VALUE contract on stdout.
        StringBuilder out = new StringBuilder();
        out.append("REP_ID=").append(repId).append('\n');
        out.append("COMMISSION=").append(commission.toPlainString()).append('\n');
        System.out.print(out);
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL followed by the store into PIC 9(7)V99: extra decimals
     * truncate toward zero and integer digits beyond capacity drop silently,
     * as COBOL does with no ON SIZE ERROR declared.
     */
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
