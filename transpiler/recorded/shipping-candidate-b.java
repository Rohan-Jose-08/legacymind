import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * SHIPPING - shipping cost with reject and cap dispatch. Idiomatic variant.
 * The defect: it drops the zero-weight GO TO REJECT-PARA guard entirely (the
 * classic "simplification" when flattening COBOL jump dispatch), so an empty
 * package is priced like any other: STATUS=STD COST=0.00 instead of
 * STATUS=REJ with no cost line. Layer B catches it on any zero-weight case.
 */
public final class Shipping {

    private static final BigDecimal RATE = new BigDecimal("4.75");
    private static final BigDecimal CAP = new BigDecimal("200");
    private static final BigDecimal PIC_9_5_V99_MODULUS = new BigDecimal("100000");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String pkgId = readLine(in);
        BigDecimal weight = numval(readLine(in), PIC_9_5_V99_MODULUS);

        // BUG: the zero-weight reject guard was dropped - every package,
        // including an empty one, is priced and printed with a cost.
        BigDecimal cost = weight.multiply(RATE)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);
        String status;
        if (cost.compareTo(CAP) > 0) {
            cost = CAP;
            status = "CAP";
        } else {
            status = "STD";
        }
        StringBuilder out = new StringBuilder();
        out.append("PKG_ID=").append(pkgId).append('\n');
        out.append("STATUS=").append(status).append('\n');
        out.append("COST=").append(cost.toPlainString()).append('\n');
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
            System.err.println("SHIPPING: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
