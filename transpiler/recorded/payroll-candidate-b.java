import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * PAYROLL — single-record payroll calculation, translated from COBOL 85.
 * Idiomatic variant: standard Java conventions where they appear
 * behaviorally equivalent. Monetary rounding uses banker's rounding
 * (HALF_EVEN), the conventional default for Java financial code.
 */
public final class Payroll {

    /** Overtime threshold from CALCULATE-PAY. */
    private static final BigDecimal STANDARD_HOURS = new BigDecimal("40");

    /** Overtime multiplier from CALCULATE-PAY. */
    private static final BigDecimal OVERTIME_RATE = new BigDecimal("1.5");

    /** WS-TAX-RATE PIC V9(3) VALUE .225 (payroll.cbl:22). */
    private static final BigDecimal TAX_RATE = new BigDecimal("0.225");

    /** PIC 9(7)V99 storage capacity: integer digits beyond 7 positions drop on store. */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    /** Store a scale-2 value into a PIC 9(7)V99 field, COBOL-style. */
    private static BigDecimal storePic97v99(BigDecimal value) {
        return value.remainder(PIC_9_7_V99_MODULUS);
    }

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        // MAIN-PARA (payroll.cbl:29-38): read inputs, NUMVAL conversions.
        String empId = readLine(in);                                          // WS-EMP-ID PIC X(6)
        BigDecimal hoursWorked = numval(readLine(in), 2, new BigDecimal("1000"));   // WS-HOURS-WORKED PIC 9(3)V99
        BigDecimal hourlyRate = numval(readLine(in), 2, new BigDecimal("10000"));   // WS-HOURLY-RATE PIC 9(4)V99

        // CALCULATE-PAY (payroll.cbl:39-52).
        BigDecimal grossPay;
        if (hoursWorked.compareTo(STANDARD_HOURS) > 0) {
            BigDecimal overtimeHours = hoursWorked.subtract(STANDARD_HOURS); // WS-OVERTIME-HOURS
            grossPay = STANDARD_HOURS.multiply(hourlyRate)
                    .add(overtimeHours.multiply(hourlyRate).multiply(OVERTIME_RATE));
        } else {
            grossPay = hoursWorked.multiply(hourlyRate);
        }
        // COMPUTE without ROUNDED: settle into PIC 9(7)V99 by truncation,
        // then apply the PICTURE's storage capacity.
        grossPay = storePic97v99(grossPay.setScale(2, RoundingMode.DOWN));

        // COMPUTE WS-TAX ROUNDED (payroll.cbl:51): round to cents using
        // banker's rounding, the standard for monetary values in Java.
        BigDecimal tax = storePic97v99(
                grossPay.multiply(TAX_RATE).setScale(2, RoundingMode.HALF_EVEN));

        // COMPUTE WS-NET-PAY (payroll.cbl:52).
        BigDecimal netPay = storePic97v99(grossPay.subtract(tax));

        // PRINT-RESULT (payroll.cbl:53-61): KEY=VALUE contract on stdout.
        System.out.print("EMP_ID=" + empId + '\n'
                + "GROSS_PAY=" + grossPay.toPlainString() + '\n'
                + "TAX=" + tax.toPlainString() + '\n'
                + "NET_PAY=" + netPay.toPlainString() + '\n');
    }

    private static String readLine(BufferedReader in) throws IOException {
        String line = in.readLine();
        return line == null ? "" : line.trim();
    }

    /**
     * FUNCTION NUMVAL plus the COMPUTE store into the target PICTURE:
     * decimals truncate toward zero, high-order digits wrap at capacity.
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
