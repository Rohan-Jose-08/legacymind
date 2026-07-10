import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * TRANSFER - funds transfer with a fee. Idiomatic variant. The defect: a
 * wrong-record qualification mix-up - the destination's new balance is
 * computed from BAL OF SRC-ACCT (1000.00) instead of BAL OF DST-ACCT
 * (250.00), the classic bug when duplicated field names lose their
 * qualification during translation. Every approved transfer credits the
 * amount onto the wrong starting balance, off by 750.00. Layer B catches
 * it on any approved case.
 */
public final class Transfer {

    private static final BigDecimal SRC_BAL = new BigDecimal("1000.00");
    private static final BigDecimal DST_BAL = new BigDecimal("250.00");
    private static final BigDecimal FEE_RATE = new BigDecimal("1.25");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String xferId = readLine(in);
        BigDecimal amount = numval(readLine(in), PIC_9_7_V99_MODULUS);

        BigDecimal fee = amount.multiply(FEE_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);

        String status;
        BigDecimal srcOut;
        BigDecimal dstOut;
        if (amount.add(fee).compareTo(SRC_BAL) > 0) {
            status = "DEC";
            srcOut = SRC_BAL;
            dstOut = DST_BAL;
        } else {
            status = "APR";
            srcOut = SRC_BAL.subtract(amount).subtract(fee).remainder(PIC_9_7_V99_MODULUS);
            // BUG: wrong record - credits the transfer onto the SOURCE
            // balance (1000.00) instead of the destination's (250.00).
            dstOut = SRC_BAL.add(amount).remainder(PIC_9_7_V99_MODULUS);
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
