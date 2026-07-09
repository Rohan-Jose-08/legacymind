import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * INVOICE - processing fee with input validation, translated from COBOL 85.
 * Faithful variant: exact COBOL behavior over Java idiom.
 *
 * The COBOL control flow is a top-level fall-through chain: MAIN-PARA
 * validates and, for a zero amount, prints STATUS=EMPTY and executes STOP RUN
 * inside the IF - an early program exit. Otherwise control falls through into
 * CALC-PARA (2.5% fee, ROUNDED) and PRINT-PARA. The early exit is preserved
 * here by printing the EMPTY block and leaving via System.exit(0); the billed
 * path continues sequentially, exactly like the paragraph chain.
 */
public final class Invoice {

    /** CALC-PARA: WS-FEE = WS-AMOUNT * 2.5 / 100, ROUNDED to the cent. */
    private static final BigDecimal FEE_RATE = new BigDecimal("2.5");

    /** PIC 9(7)V99 capacity (WS-AMOUNT / WS-FEE). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA: ACCEPT id + amount text, NUMVAL the amount.
        String invId = readLine(in);                                      // WS-ID-TEXT PIC X(8)
        BigDecimal amount = numval(readLine(in), PIC_9_7_V99_MODULUS);    // WS-AMOUNT PIC 9(7)V99

        // IF WS-AMOUNT = 0: STATUS=EMPTY and STOP RUN (early program exit).
        if (amount.compareTo(BigDecimal.ZERO) == 0) {
            String status = "EMPTY"; // MOVE "EMPTY" TO WS-STATUS
            StringBuilder empty = new StringBuilder();
            empty.append("INV_ID=").append(invId).append('\n');
            empty.append("STATUS=").append(status).append('\n');
            System.out.print(empty);
            System.exit(0); // STOP RUN inside the IF - nothing below runs
        }

        // CALC-PARA (fall-through): COMPUTE WS-FEE ROUNDED = amount * 2.5 / 100.
        BigDecimal fee = amount.multiply(FEE_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);

        // PRINT-PARA (fall-through): STATUS=READY plus the fee.
        String status = "READY"; // MOVE "READY" TO WS-STATUS
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

    /**
     * FUNCTION NUMVAL then the store into PIC 9(7)V99: extra decimals truncate
     * toward zero and integer digits beyond capacity drop silently, as COBOL
     * does with no ON SIZE ERROR declared.
     */
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
