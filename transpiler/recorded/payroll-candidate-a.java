import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * PAYROLL — single-record payroll calculation, translated from COBOL 85.
 * Faithful variant: exact COBOL arithmetic behavior takes priority over
 * Java idiom. All values are BigDecimal; COMPUTE without ROUNDED settles
 * into the target PICTURE scale by truncation toward zero, and
 * COMPUTE ... ROUNDED rounds half away from zero.
 */
public final class Payroll {

    /** Literal 40 from the overtime threshold in CALCULATE-PAY. */
    private static final BigDecimal FORTY = new BigDecimal("40");

    /** Literal 1.5 overtime factor from CALCULATE-PAY. */
    private static final BigDecimal OVERTIME_FACTOR = new BigDecimal("1.5");

    /** WS-TAX-RATE PIC V9(3) VALUE .225 (payroll.cbl:22). */
    private static final BigDecimal TAX_RATE = new BigDecimal("0.225");

    /**
     * PIC 9(7)V99 capacity. With no ON SIZE ERROR declared, COBOL stores
     * into this PICTURE by truncating to scale 2 and silently dropping
     * integer digits beyond the 7 positions — i.e. modulo 10^7.
     */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    /** Store a scale-2 value into a PIC 9(7)V99 field, COBOL-style. */
    private static BigDecimal storePic97v99(BigDecimal value) {
        return value.remainder(PIC_9_7_V99_MODULUS);
    }

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA (payroll.cbl:29-38): ACCEPT three values, convert the
        // numeric ones via FUNCTION NUMVAL.
        String empId = readLine(in);                                          // WS-EMP-ID PIC X(6)
        BigDecimal hoursWorked = numval(readLine(in), 2, new BigDecimal("1000"));   // WS-HOURS-WORKED PIC 9(3)V99
        BigDecimal hourlyRate = numval(readLine(in), 2, new BigDecimal("10000"));   // WS-HOURLY-RATE PIC 9(4)V99

        // CALCULATE-PAY (payroll.cbl:39-52).
        BigDecimal grossPay;
        if (hoursWorked.compareTo(FORTY) > 0) {
            BigDecimal overtimeHours = hoursWorked.subtract(FORTY); // WS-OVERTIME-HOURS PIC 9(3)V99
            grossPay = FORTY.multiply(hourlyRate)
                    .add(overtimeHours.multiply(hourlyRate).multiply(OVERTIME_FACTOR));
        } else {
            grossPay = hoursWorked.multiply(hourlyRate);
        }
        // COMPUTE without ROUNDED: truncate toward zero into WS-GROSS-PAY
        // PIC 9(7)V99 (scale 2), then apply the PICTURE's storage capacity.
        grossPay = storePic97v99(grossPay.setScale(2, RoundingMode.DOWN));

        // COMPUTE WS-TAX ROUNDED (payroll.cbl:51): COBOL ROUNDED is round
        // half away from zero, i.e. HALF_UP for non-negative amounts.
        BigDecimal tax = storePic97v99(
                grossPay.multiply(TAX_RATE).setScale(2, RoundingMode.HALF_UP));

        // COMPUTE WS-NET-PAY (payroll.cbl:52): exact at scale 2 already.
        BigDecimal netPay = storePic97v99(grossPay.subtract(tax));

        // PRINT-RESULT (payroll.cbl:53-61): KEY=VALUE contract on stdout.
        StringBuilder out = new StringBuilder();
        out.append("EMP_ID=").append(empId).append('\n');
        out.append("GROSS_PAY=").append(grossPay.toPlainString()).append('\n');
        out.append("TAX=").append(tax.toPlainString()).append('\n');
        out.append("NET_PAY=").append(netPay.toPlainString()).append('\n');
        System.out.print(out);
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL (payroll.cbl:33-34) followed by a COMPUTE store into
     * the target PICTURE: extra decimals truncate toward zero and integer
     * digits beyond the PICTURE's capacity drop silently — COBOL's
     * input-conversion behavior when no ON SIZE ERROR is declared. The
     * fields are unsigned; invalid input exits 3, the module's declared
     * error contract.
     */
    private static BigDecimal numval(String s, int scale, BigDecimal capacity) {
        try {
            BigDecimal v = new BigDecimal(s.trim());
            if (v.signum() < 0) {
                throw new NumberFormatException("negative value for unsigned PICTURE");
            }
            return v.setScale(scale, RoundingMode.DOWN).remainder(capacity);
        } catch (NumberFormatException e) {
            System.err.println("PAYROLL: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
