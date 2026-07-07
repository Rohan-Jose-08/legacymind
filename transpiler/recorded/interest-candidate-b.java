import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * INTEREST — simple-interest quote, translated from COBOL 85.
 * Idiomatic variant: compact structure and expressive names, while
 * preserving the module's fixed-point stores (each target PICTURE's
 * scale and wrap-around capacity, matching COBOL's silent high-order
 * truncation when no ON SIZE ERROR is declared).
 */
public final class Interest {

    private static final BigDecimal LOYALTY_THRESHOLD_YEARS = new BigDecimal("5");
    private static final BigDecimal LOYALTY_BONUS_POINTS = new BigDecimal("0.25");

    public static void main(String[] args) throws IOException {
        BufferedReader stdin = new BufferedReader(new InputStreamReader(System.in));
        String accountId = read(stdin);                                 // WS-ACCT-ID PIC X(8)
        BigDecimal principal = parseAmount(read(stdin), 2, 7);          // WS-PRINCIPAL PIC 9(7)V99
        BigDecimal annualRatePct = parseAmount(read(stdin), 2, 2);      // WS-RATE-PCT PIC 99V99
        BigDecimal termYears = parseAmount(read(stdin), 0, 2);          // WS-TERM-YEARS PIC 9(2)

        // CALC-INTEREST: loyalty bonus for terms beyond five years; the
        // effective rate lives in PIC 99V99 and wraps at 100.
        BigDecimal effectiveRate = termYears.compareTo(LOYALTY_THRESHOLD_YEARS) > 0
                ? storeInto(annualRatePct.add(LOYALTY_BONUS_POINTS), 2)
                : annualRatePct;

        // interest = principal * rate * years / 100, ROUNDED into PIC 9(7)V99.
        BigDecimal interest = storeInto(
                principal.multiply(effectiveRate).multiply(termYears)
                        .movePointLeft(2)
                        .setScale(2, RoundingMode.HALF_UP),
                7);

        // total = principal + interest into PIC 9(8)V99.
        BigDecimal total = storeInto(principal.add(interest), 8);

        System.out.print("ACCT_ID=" + accountId + '\n'
                + "INTEREST=" + interest.toPlainString() + '\n'
                + "TOTAL=" + total.toPlainString() + '\n');
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
            System.err.println("INTEREST: invalid numeric input: " + text);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
