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
 * PAYSLIP - a pay slip written to a line-sequential output file, translated
 * from COBOL 85. Faithful variant: exact COBOL behavior over Java idiom.
 *
 * The COBOL WRITEs three KEY=VALUE records (GRS=, TAX=, NET=) to slip.dat
 * and DISPLAYs EMP_ID and ROWS. This translation writes a real file (a
 * temp path standing in for slip.dat), then serializes its contents to
 * stdout after the display lines - mirroring the harness contract for
 * file modules, where the output file is part of the observable stream.
 */
public final class Payslip {

    /** COMPUTE WS-TAX ROUNDED = WS-GROSS * 11 / 100. */
    private static final BigDecimal TAX_RATE = new BigDecimal("11");

    /** ADD 1 TO WS-ROWS: one increment per record written. */
    private static final BigDecimal ONE_ROW = new BigDecimal("1");

    /** PIC 9(7)V99 capacity (WS-GROSS / WS-TAX / WS-NET). */
    private static final BigDecimal PIC_9_7_V99_MODULUS = new BigDecimal("10000000");

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

        String empId = readLine(in);                                     // WS-EMP-ID PIC X(8)
        BigDecimal gross = numval(readLine(in), PIC_9_7_V99_MODULUS);    // WS-GROSS PIC 9(7)V99

        BigDecimal tax = gross.multiply(TAX_RATE).movePointLeft(2)
                .setScale(2, RoundingMode.HALF_UP)
                .remainder(PIC_9_7_V99_MODULUS);
        BigDecimal net = gross.subtract(tax).remainder(PIC_9_7_V99_MODULUS);

        // OPEN OUTPUT / WRITE x3 / CLOSE: a real file, written by the helper;
        // WS-ROWS counts one ADD 1 per record written.
        Path slip = writeSlip(gross, tax, net);
        BigDecimal rows = BigDecimal.ZERO; // WS-ROWS PIC 9 VALUE ZERO
        rows = rows.add(ONE_ROW);
        rows = rows.add(ONE_ROW);
        rows = rows.add(ONE_ROW);

        StringBuilder out = new StringBuilder();
        out.append("EMP_ID=").append(empId).append('\n');
        out.append("ROWS=").append(rows.toPlainString()).append('\n');
        System.out.print(out);

        // Serialize the file's actual contents (read back, not echoed),
        // mirroring the harness wrapper's `cat` of the legacy slip.dat.
        serializeAndDelete(slip);
    }

    /** The slip file itself: GRS=, TAX=, NET= records, one per line. */
    private static Path writeSlip(BigDecimal gross, BigDecimal tax, BigDecimal net) throws IOException {
        Path slip = Files.createTempFile("slip", ".dat");
        try (BufferedWriter w = Files.newBufferedWriter(slip)) {
            w.write("GRS=" + gross.toPlainString());
            w.newLine();
            w.write("TAX=" + tax.toPlainString());
            w.newLine();
            w.write("NET=" + net.toPlainString());
            w.newLine();
        }
        return slip;
    }

    /** Emit the file's contents to stdout, then remove the temp file. */
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
            System.err.println("PAYSLIP: invalid numeric input: " + s);
            System.exit(3);
            return BigDecimal.ZERO; // unreachable
        }
    }
}
