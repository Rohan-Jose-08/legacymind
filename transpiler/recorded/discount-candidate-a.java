import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * DISCOUNT — tiered volume discount pricing, translated from COBOL 85.
 * Faithful variant: exact COBOL arithmetic behavior takes priority over
 * Java idiom. Every store honors the target PICTURE's scale and storage
 * capacity (high-order digits drop silently, as COBOL does with no
 * ON SIZE ERROR declared).
 */
public final class Discount {

    /** Bulk tier threshold from CALC-DISCOUNT: 100 units or more. */
    private static final BigDecimal BULK_THRESHOLD = new BigDecimal("100");

    /** WS-BULK-RATE PIC V9(3) VALUE .100 (discount.cbl:22). */
    private static final BigDecimal BULK_RATE = new BigDecimal("0.100");

    /** WS-STD-RATE PIC V9(3) VALUE .020 (discount.cbl:23). */
    private static final BigDecimal STD_RATE = new BigDecimal("0.020");

    /** PIC 9(8)V99 capacity (WS-GROSS / WS-DISCOUNT / WS-NET). */
    private static final BigDecimal PIC_9_8_V99_MODULUS = new BigDecimal("100000000");

    /** 5-integer-digit capacity (WS-QTY PIC 9(5), WS-UNIT-PRICE PIC 9(5)V99). */
    private static final BigDecimal PIC_5_MODULUS = new BigDecimal("100000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA (discount.cbl:32-39): ACCEPT + FUNCTION NUMVAL.
        String orderId = readLine(in);                                     // WS-ORDER-ID PIC X(8)
        BigDecimal qty = numval(readLine(in), 0, PIC_5_MODULUS);           // WS-QTY PIC 9(5)
        BigDecimal unitPrice = numval(readLine(in), 2, PIC_5_MODULUS);     // WS-UNIT-PRICE PIC 9(5)V99

        // CALC-DISCOUNT (discount.cbl:40-46).
        // COMPUTE WS-GROSS = WS-QTY * WS-UNIT-PRICE into PIC 9(8)V99:
        // large orders exceed the PICTURE and wrap.
        BigDecimal gross = qty.multiply(unitPrice)
                .setScale(2, RoundingMode.DOWN)
                .remainder(PIC_9_8_V99_MODULUS);

        // Tiered COMPUTE ... ROUNDED: half away from zero at cents.
        BigDecimal rate = qty.compareTo(BULK_THRESHOLD) >= 0 ? BULK_RATE : STD_RATE;
        BigDecimal discount = gross.multiply(rate)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_8_V99_MODULUS);

        // COMPUTE WS-NET = WS-GROSS - WS-DISCOUNT (discount.cbl:46).
        BigDecimal net = gross.subtract(discount).remainder(PIC_9_8_V99_MODULUS);

        // PRINT-RESULT (discount.cbl:47-54): KEY=VALUE contract on stdout.
        StringBuilder out = new StringBuilder();
        out.append("ORDER_ID=").append(orderId).append('\n');
        out.append("GROSS=").append(gross.toPlainString()).append('\n');
        out.append("DISCOUNT=").append(discount.toPlainString()).append('\n');
        out.append("NET=").append(net.toPlainString()).append('\n');
        System.out.print(out);
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL followed by the COMPUTE store into the target
     * PICTURE: decimals truncate toward zero, high-order integer digits
     * wrap at the PICTURE's capacity (COBOL input-conversion behavior
     * with no ON SIZE ERROR declared).
     */
    private static BigDecimal numval(String s, int scale, BigDecimal capacity) {
        try {
            BigDecimal v = new BigDecimal(s.trim());
            if (v.signum() < 0) {
                throw new NumberFormatException("negative value for unsigned PICTURE");
            }
            return v.setScale(scale, RoundingMode.DOWN).remainder(capacity);
        } catch (NumberFormatException e) {
            System.err.println("DISCOUNT: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
