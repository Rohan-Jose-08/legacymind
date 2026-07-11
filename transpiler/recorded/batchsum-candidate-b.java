import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * BATCHSUM - the batch archetype. Idiomatic variant. The defect: a priming
 * read whose value is discarded - the translator treated the first record
 * as a header line, so every non-empty file loses its first record from
 * both COUNT and TOTAL. The empty file agrees by accident; layer B catches
 * it on every case with at least one record.
 */
public final class Batchsum {

    private static final BigDecimal ONE_REC = new BigDecimal("1");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        BigDecimal count = BigDecimal.ZERO;
        BigDecimal total = BigDecimal.ZERO;

        // BUG: the priming read's value is thrown away as if it were a
        // header - the first record never reaches the accumulators.
        String line = in.readLine();
        if (line != null) {
            line = in.readLine();
        }
        while (line != null) {
            BigDecimal amt = numval(line, PIC_9_7_V99_MODULUS);
            total = total.add(amt).remainder(PIC_9_7_V99_MODULUS);
            count = count.add(ONE_REC);
            line = in.readLine();
        }

        StringBuilder out = new StringBuilder();
        out.append("COUNT=").append(count.toPlainString()).append('\n');
        out.append("TOTAL=").append(total.setScale(2, RoundingMode.UNNECESSARY).toPlainString()).append('\n');
        System.out.print(out);
    }

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
