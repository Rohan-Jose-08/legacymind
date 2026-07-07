      * PAYROLL - single-record payroll calculation (COBOL 85, fixed).
      * Input  (SYSIN, one value per line): employee id, hours worked,
      *        hourly rate.
      * Output (SYSOUT): KEY=VALUE lines: EMP_ID, GROSS_PAY, TAX,
      *        NET_PAY.
      * Business rules: overtime above 40 hours is paid at 1.5x; tax is
      * a flat 22.5% of gross, ROUNDED (half-up); net = gross - tax.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYROLL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN.
           05  WS-EMP-ID           PIC X(6).
           05  WS-HOURS-TEXT       PIC X(10).
           05  WS-RATE-TEXT        PIC X(10).
       01  WS-WORK.
           05  WS-HOURS-WORKED     PIC 9(3)V99  VALUE ZERO.
           05  WS-HOURLY-RATE      PIC 9(4)V99  VALUE ZERO.
           05  WS-OVERTIME-HOURS   PIC 9(3)V99  VALUE ZERO.
           05  WS-GROSS-PAY        PIC 9(7)V99  VALUE ZERO.
           05  WS-TAX-RATE         PIC V9(3)    VALUE .225.
           05  WS-TAX              PIC 9(7)V99  VALUE ZERO.
           05  WS-NET-PAY          PIC 9(7)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-GROSS-PAY-OUT    PIC 9(7).99.
           05  WS-TAX-OUT          PIC 9(7).99.
           05  WS-NET-PAY-OUT      PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-EMP-ID
           ACCEPT WS-HOURS-TEXT
           ACCEPT WS-RATE-TEXT
           COMPUTE WS-HOURS-WORKED = FUNCTION NUMVAL(WS-HOURS-TEXT)
           COMPUTE WS-HOURLY-RATE = FUNCTION NUMVAL(WS-RATE-TEXT)
           PERFORM CALCULATE-PAY
           PERFORM PRINT-RESULT
           STOP RUN.
       CALCULATE-PAY.
           MOVE ZERO TO WS-GROSS-PAY
           IF WS-HOURS-WORKED > 40
               COMPUTE WS-OVERTIME-HOURS = WS-HOURS-WORKED - 40
               COMPUTE WS-GROSS-PAY =
                   (40 * WS-HOURLY-RATE)
                   + (WS-OVERTIME-HOURS * WS-HOURLY-RATE * 1.5)
           ELSE
               MOVE ZERO TO WS-OVERTIME-HOURS
               COMPUTE WS-GROSS-PAY =
                   WS-HOURS-WORKED * WS-HOURLY-RATE
           END-IF
           COMPUTE WS-TAX ROUNDED = WS-GROSS-PAY * WS-TAX-RATE
           COMPUTE WS-NET-PAY = WS-GROSS-PAY - WS-TAX.
       PRINT-RESULT.
           MOVE WS-GROSS-PAY TO WS-GROSS-PAY-OUT
           MOVE WS-TAX TO WS-TAX-OUT
           MOVE WS-NET-PAY TO WS-NET-PAY-OUT
           DISPLAY "EMP_ID=" WS-EMP-ID
           DISPLAY "GROSS_PAY=" WS-GROSS-PAY-OUT
           DISPLAY "TAX=" WS-TAX-OUT
           DISPLAY "NET_PAY=" WS-NET-PAY-OUT.
