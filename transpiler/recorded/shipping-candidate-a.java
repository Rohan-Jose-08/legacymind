import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * SHIPPING - shipping cost with reject and cap dispatch, translated from
 * COBOL 85. Faithful variant: exact COBOL behavior over Java idiom.
 *
 * The COBOL control flow is fall-through plus two forward GO TOs: a
 * zero-weight package jumps to REJECT-PARA (no costing at all), and a cost
 * over the 200.00 cap jumps to CAPPED-PARA (skipping the standard print).
 * Each destination ends with STOP RUN, so the three outcomes are mutually
 * exclusive - preserved here as a three-way if/else dispatch.
 */
public final class Shipping {

    /** CALC-PARA: WS-COST = WS-WEIGHT * 4.75, ROUNDED to the cent. */
    private static final BigDecimal RATE = new BigDecimal("4.75");

    /** IF WS-COST > 200: the cap threshold, and the capped cost itself. */
    private static final BigDecimal CAP = new BigDecimal("200");

    /** PIC 9(5)V99 capacity (WS-WEIGHT). */
    private static final BigDecimal PIC_9_5_V99_MODULUS = new BigDecimal("100000");

    /** PIC 9(7)V99 capacity (WS-COST). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA: ACCEPT id + weight text, NUMVAL the weight.
        String pkgId = readLine(in);                                     // WS-PKG-ID PIC X(8)
        BigDecimal weight = numval(readLine(in), PIC_9_5_V99_MODULUS);   // WS-WEIGHT PIC 9(5)V99

        StringBuilder out = new StringBuilder();
        if (weight.compareTo(BigDecimal.ZERO) == 0) {
            // GO TO REJECT-PARA: zero weight is rejected, no cost printed.
            String status = "REJ"; // MOVE "REJ" TO WS-STATUS
            out.append("PKG_ID=").append(pkgId).append('\n');
            out.append("STATUS=").append(status).append('\n');
        } else {
            // CALC-PARA: COMPUTE WS-COST ROUNDED = WS-WEIGHT * 4.75.
            BigDecimal cost = weight.multiply(RATE)
                    .setScale(2, RoundingMode.HALF_UP)
                    .remainder(PIC_9_7_V99_MODULUS);
            String status;
            if (cost.compareTo(CAP) > 0) {
                // GO TO CAPPED-PARA: clamp to the cap.
                cost = CAP; // MOVE 200 TO WS-COST
                status = "CAP";
            } else {
                status = "STD"; // PRINT-STD-PARA
            }
            out.append("PKG_ID=").append(pkgId).append('\n');
            out.append("STATUS=").append(status).append('\n');
            out.append("COST=").append(cost.toPlainString()).append('\n');
        }
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
    private static BigDecimal numval(String s, BigDecimal capacity) {
        try {
            BigDecimal v = new BigDecimal(s.trim());
            if (v.signum() < 0) {
                throw new NumberFormatException("negative value for unsigned PICTURE");
            }
            return v.setScale(2, RoundingMode.DOWN).remainder(capacity);
        } catch (NumberFormatException e) {
            System.err.println("SHIPPING: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
