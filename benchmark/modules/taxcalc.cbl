      * TAXCALC - combined payroll withholding for one employee.
      * Input  (SYSIN, one value per line): employee id, gross pay.
      * Output (SYSOUT): EMP_ID, TAX, NET as KEY=VALUE lines.
      * Rules: three withholding components (state 5%, federal 15%,
      * local 2%) are each computed ROUNDED to the cent on the gross,
      * then summed; NET is gross minus total tax. The three components
      * are computed by a PERFORM <first> THRU <last> paragraph range —
      * a candidate that translates the THRU as a single PERFORM
      * withholds only the state portion and is caught.
      * Deliberately THRU-shaped: parses only with the proleap engine
      * and exercises the wave-3 range lowering end-to-end.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TAXCALC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN.
           05  WS-EMP-ID        PIC X(8).
           05  WS-GROSS-TEXT    PIC X(12).
       01  WS-RATES.
           05  WS-STATE-RATE    PIC 99V99    VALUE 5.00.
           05  WS-FED-RATE      PIC 99V99    VALUE 15.00.
           05  WS-LOCAL-RATE    PIC 99V99    VALUE 2.00.
       01  WS-WORK.
           05  WS-GROSS         PIC 9(7)V99  VALUE ZERO.
           05  WS-STATE-TAX     PIC 9(7)V99  VALUE ZERO.
           05  WS-FED-TAX       PIC 9(7)V99  VALUE ZERO.
           05  WS-LOCAL-TAX     PIC 9(7)V99  VALUE ZERO.
           05  WS-TOTAL-TAX     PIC 9(7)V99  VALUE ZERO.
           05  WS-NET           PIC 9(7)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-TAX-OUT       PIC 9(7).99.
           05  WS-NET-OUT       PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-EMP-ID
           ACCEPT WS-GROSS-TEXT
           COMPUTE WS-GROSS = FUNCTION NUMVAL(WS-GROSS-TEXT)
           PERFORM CALC-STATE THRU CALC-LOCAL
           COMPUTE WS-TOTAL-TAX =
               WS-STATE-TAX + WS-FED-TAX + WS-LOCAL-TAX
           COMPUTE WS-NET = WS-GROSS - WS-TOTAL-TAX
           PERFORM PRINT-PARA
           STOP RUN.
       CALC-STATE.
           COMPUTE WS-STATE-TAX ROUNDED =
               WS-GROSS * WS-STATE-RATE / 100.
       CALC-FEDERAL.
           COMPUTE WS-FED-TAX ROUNDED =
               WS-GROSS * WS-FED-RATE / 100.
       CALC-LOCAL.
           COMPUTE WS-LOCAL-TAX ROUNDED =
               WS-GROSS * WS-LOCAL-RATE / 100.
       PRINT-PARA.
           MOVE WS-TOTAL-TAX TO WS-TAX-OUT
           MOVE WS-NET TO WS-NET-OUT
           DISPLAY "EMP_ID=" WS-EMP-ID
           DISPLAY "TAX=" WS-TAX-OUT
           DISPLAY "NET=" WS-NET-OUT.
