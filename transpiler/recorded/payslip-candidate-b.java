import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * PAYSLIP - a pay slip written to a line-sequential output file. Idiomatic
 * variant. The defect: the slip loses its last record - the NET line is
 * never written (the classic lost-final-record / unflushed-buffer migration
 * bug), so the file carries two records instead of three and ROWS reports
 * 2. Layer B catches it on every case: the NET key is missing and ROWS
 * diverges.
 */
public final class Payslip {

    private static final BigDecimal TAX_RATE = new BigDecimal("11");
    private static final BigDecimal ONE_ROW = new BigDecimal("1");
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String empId = readLine(in);
        BigDecimal gross = numval(readLine(in), PIC_9_7_V99_MODULUS);

        BigDecimal tax = gross.multiply(TAX_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);
        BigDecimal net = gross.subtract(tax).remainder(PIC_9_7_V99_MODULUS);

        // BUG: only two records reach the slip - the NET line is dropped.
        Path slip = writeSlip(gross, tax, net);
        BigDecimal rows = BigDecimal.ZERO;
        rows = rows.add(ONE_ROW);
        rows = rows.add(ONE_ROW);

        StringBuilder out = new StringBuilder();
        out.append("EMP_ID=").append(empId).append('\n');
        out.append("ROWS=").append(rows.toPlainString()).append('\n');
        System.out.print(out);

        serializeAndDelete(slip);
    }

    private static Path writeSlip(BigDecimal gross, BigDecimal tax, BigDecimal net) throws IOException {
        Path slip = Files.createTempFile("slip", ".dat");
        try (BufferedWriter w = Files.newBufferedWriter(slip)) {
            w.write("GRS=" + gross.toPlainString());
            w.newLine();
            w.write("TAX=" + tax.toPlainString());
            w.newLine();
            // NET record dropped here.
        }
        return slip;
    }

    private static void serializeAndDelete(Path slip) throws IOException {
        List<String> lines = Files.readAllLines(slip);
        for (int i = 0; i < lines.size(); i = i + 1) {
            System.out.write((lines.get(i) + "\n").getBytes());
        }
        System.out.flush();
        Files.delete(slip);
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
            System.err.println("PAYSLIP: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
