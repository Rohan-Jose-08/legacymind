import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * TRANSFER - funds transfer with a fee, translated from COBOL 85. Faithful
 * variant: exact COBOL behavior over Java idiom.
 *
 * The COBOL declares two records whose fields share the leaf name BAL,
 * disambiguated with OF/IN qualification (BAL OF SRC-ACCT vs BAL OF
 * DST-ACCT). Here they are two distinct constants: the source balance
 * funds the transfer plus a 1.25% ROUNDED fee, the destination balance
 * receives the amount. A transfer whose amount + fee exceeds the source
 * balance is DECLINED and both balances print unchanged.
 */
public final class Transfer {

    /** BAL OF SRC-ACCT PIC 9(7)V99 VALUE 1000.00. */
    private static final BigDecimal SRC_BAL = new BigDecimal("1000.00");

    /** BAL OF DST-ACCT PIC 9(7)V99 VALUE 250.00. */
    private static final BigDecimal DST_BAL = new BigDecimal("250.00");

    /** COMPUTE WS-FEE ROUNDED = WS-AMOUNT * 1.25 / 100. */
    private static final BigDecimal FEE_RATE = new BigDecimal("1.25");

    /** PIC 9(7)V99 capacity (WS-AMOUNT / WS-FEE / new balances). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String xferId = readLine(in);                                    // WS-XFER-ID PIC X(8)
        BigDecimal amount = numval(readLine(in), PIC_9_7_V99_MODULUS);   // WS-AMOUNT PIC 9(7)V99

        // COMPUTE WS-FEE ROUNDED = WS-AMOUNT * 1.25 / 100.
        BigDecimal fee = amount.multiply(FEE_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);

        String status;
        BigDecimal srcOut;
        BigDecimal dstOut;
        if (amount.add(fee).compareTo(SRC_BAL) > 0) {
            // Declined: balances unchanged.
            status = "DEC"; // MOVE "DEC" TO WS-STATUS
            srcOut = SRC_BAL;
            dstOut = DST_BAL;
        } else {
            // Approved: source pays amount + fee, destination receives amount.
            status = "APR"; // MOVE "APR" TO WS-STATUS
            srcOut = SRC_BAL.subtract(amount).subtract(fee).remainder(PIC_9_7_V99_MODULUS);
            dstOut = DST_BAL.add(amount).remainder(PIC_9_7_V99_MODULUS);
        }

        StringBuilder out = new StringBuilder();
        out.append("XFER_ID=").append(xferId).append('\n');
        out.append("STATUS=").append(status).append('\n');
        out.append("SRC_BAL=").append(srcOut.toPlainString()).append('\n');
        out.append("DST_BAL=").append(dstOut.toPlainString()).append('\n');
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
            System.err.println("TRANSFER: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
