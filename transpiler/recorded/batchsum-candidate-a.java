import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * BATCHSUM - the batch archetype, translated from COBOL 85. Faithful
 * variant: exact COBOL behavior over Java idiom.
 *
 * The COBOL reads a LINE SEQUENTIAL input file to end-of-file,
 * accumulating a count and a total. Under the record protocol the input
 * file's records arrive as stdin lines, so the translation is the
 * canonical read loop: each line is one record, end of stream is AT END.
 * An empty input produces COUNT=0 TOTAL=0.00 - the AT END branch fires on
 * the very first read.
 */
public final class Batchsum {

    /** ADD 1 TO WS-COUNT: one increment per record. */
    private static final BigDecimal ONE_REC = new BigDecimal("1");

    /** PIC 9(7)V99 capacity (WS-AMT / WS-TOTAL). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        BigDecimal count = BigDecimal.ZERO; // WS-COUNT PIC 9(4) VALUE ZERO
        BigDecimal total = BigDecimal.ZERO; // WS-TOTAL PIC 9(7)V99 VALUE ZERO

        // PERFORM READ-PARA UNTIL WS-EOF = 1: one record per line, AT END on
        // end of stream. The single read site mirrors the single COBOL READ.
        String line;
        while ((line = in.readLine()) != null) {
            BigDecimal amt = numval(line, PIC_9_7_V99_MODULUS); // NUMVAL(IN-REC)
            total = total.add(amt).remainder(PIC_9_7_V99_MODULUS);
            count = count.add(ONE_REC);
        }

        StringBuilder out = new StringBuilder();
        out.append("COUNT=").append(count.toPlainString()).append('\n');
        out.append("TOTAL=").append(total.setScale(2, RoundingMode.UNNECESSARY).toPlainString()).append('\n');
        System.out.print(out);
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
            System.err.println("BATCHSUM: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
