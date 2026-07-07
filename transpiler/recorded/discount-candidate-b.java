import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * DISCOUNT — tiered volume discount pricing, translated from COBOL 85.
 * Idiomatic variant: compact structure and expressive names, while
 * preserving the module's fixed-point stores (scale and wrap-around
 * capacity of each target PICTURE, matching COBOL's silent high-order
 * truncation when no ON SIZE ERROR is declared).
 */
public final class Discount {

    private static final BigDecimal BULK_MINIMUM_UNITS = new BigDecimal("100");
    private static final BigDecimal BULK_DISCOUNT_RATE = new BigDecimal("0.100");
    private static final BigDecimal STANDARD_DISCOUNT_RATE = new BigDecimal("0.020");

    public static void main(String[] args) throws IOException {
        BufferedReader stdin = new BufferedReader(new InputStreamReader(System.in));
        String orderId = read(stdin);                              // WS-ORDER-ID PIC X(8)
        BigDecimal quantity = parseAmount(read(stdin), 0, 5);      // WS-QTY PIC 9(5)
        BigDecimal unitPrice = parseAmount(read(stdin), 2, 5);     // WS-UNIT-PRICE PIC 9(5)V99

        // CALC-DISCOUNT: gross wraps at the PIC 9(8)V99 capacity.
        BigDecimal gross = storeInto(
                quantity.multiply(unitPrice).setScale(2, RoundingMode.DOWN), 8);

        boolean bulkOrder = quantity.compareTo(BULK_MINIMUM_UNITS) >= 0;
        BigDecimal tierRate = bulkOrder ? BULK_DISCOUNT_RATE : STANDARD_DISCOUNT_RATE;

        // COMPUTE ... ROUNDED settles half away from zero at cents.
        BigDecimal discount = storeInto(
                gross.multiply(tierRate).setScale(2, RoundingMode.HALF_UP), 8);
        BigDecimal net = storeInto(gross.subtract(discount), 8);

        System.out.print("ORDER_ID=" + orderId + '\n'
                + "GROSS=" + gross.toPlainString() + '\n'
                + "DISCOUNT=" + discount.toPlainString() + '\n'
                + "NET=" + net.toPlainString() + '\n');
    }

    /** COBOL store: keep the low-order integer digits the PICTURE can hold. */
    private static BigDecimal storeInto(BigDecimal value, int integerDigits) {
        return value.remainder(BigDecimal.TEN.pow(integerDigits));
    }

    private static String read(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL plus the COMPUTE store into the target PICTURE:
     * decimals truncate toward zero, high-order digits wrap at the
     * PICTURE's integer capacity (COBOL input-conversion behavior).
     */
    private static BigDecimal parseAmount(String text, int scale, int integerDigits) {
        try {
            BigDecimal value = new BigDecimal(text.trim());
            if (value.signum() < 0) {
                throw new NumberFormatException("negative value for unsigned PICTURE");
            }
            return value.setScale(scale, RoundingMode.DOWN)
                    .remainder(BigDecimal.TEN.pow(integerDigits));
        } catch (NumberFormatException e) {
            System.err.println("DISCOUNT: invalid numeric input: " + text);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
