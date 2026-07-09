import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * INVOICE - processing fee with input validation. Idiomatic variant. The
 * defect: COBOL's STOP RUN inside the validation IF ends the program, but
 * this translation only prints the EMPTY block and forgets the early return
 * (the classic missing `return` when flattening COBOL paragraph flow into
 * Java). A zero-amount invoice therefore falls through and gets billed: the
 * READY/FEE block prints too. Layer B catches it on any zero-amount case.
 */
public final class Invoice {

    private static final BigDecimal FEE_RATE = new BigDecimal("2.5");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String invId = readLine(in);
        BigDecimal amount = numval(readLine(in), PIC_9_7_V99_MODULUS);

        // BUG: prints the EMPTY block but does not stop - the COBOL STOP RUN
        // inside the IF was dropped, so execution continues below.
        if (amount.compareTo(BigDecimal.ZERO) == 0) {
            String status = "EMPTY";
            StringBuilder empty = new StringBuilder();
            empty.append("INV_ID=").append(invId).append('\n');
            empty.append("STATUS=").append(status).append('\n');
            System.out.print(empty);
        }

        BigDecimal fee = amount.multiply(FEE_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);

        String status = "READY";
        StringBuilder out = new StringBuilder();
        out.append("INV_ID=").append(invId).append('\n');
        out.append("STATUS=").append(status).append('\n');
        out.append("FEE=").append(fee.toPlainString()).append('\n');
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
            System.err.println("INVOICE: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
