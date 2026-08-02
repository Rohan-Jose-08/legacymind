      * CAPFEE - transaction fee with a hard cap that ABENDS (COBOL 85,
      * fixed). The point of this module is the abnormal-termination path:
      * it is the benchmark's only exercise of an external service that
      * never returns (docs/external-services.md).
      *
      * Input  (SYSIN, one value per line): account id, amount.
      * Output (SYSOUT): KEY=VALUE lines: ACCT, FEE, TOTAL.
      * Business rules: fee is 1.5% of the amount, ROUNDED (half-up);
      * total = amount + fee. An amount above 5000.00 is refused: the
      * program reports it and abends through CEE3ABD, exactly as the AWS
      * CardDemo batch programs do in their 9999-ABEND-PROGRAM paragraph.
      *
      * Both paths are reachable from ordinary input, so the abend is
      * differentially executed against the real GnuCOBOL binary rather
      * than only reasoned about statically.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CAPFEE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN.
           05  WS-ACCT-ID          PIC X(8).
           05  WS-AMOUNT-TEXT      PIC X(12).
       01  WS-WORK.
           05  WS-AMOUNT           PIC 9(7)V99  VALUE ZERO.
           05  WS-FEE-RATE         PIC V9(3)    VALUE .015.
           05  WS-FEE              PIC 9(7)V99  VALUE ZERO.
           05  WS-TOTAL            PIC 9(7)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-FEE-OUT          PIC 9(7).99.
           05  WS-TOTAL-OUT        PIC 9(7).99.
       01  ABCODE                  PIC S9(9) BINARY.
       01  TIMING                  PIC S9(9) BINARY.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ACCT-ID
           ACCEPT WS-AMOUNT-TEXT
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-AMOUNT-TEXT)
           DISPLAY "ACCT=" WS-ACCT-ID
           IF WS-AMOUNT > 5000.00
               DISPLAY "AMOUNT OVER CAP"
               PERFORM 9999-ABEND-PROGRAM
           END-IF
           PERFORM CALCULATE-FEE
           PERFORM PRINT-RESULT
           STOP RUN.
       CALCULATE-FEE.
           COMPUTE WS-FEE ROUNDED = WS-AMOUNT * WS-FEE-RATE
           COMPUTE WS-TOTAL = WS-AMOUNT + WS-FEE.
       PRINT-RESULT.
           MOVE WS-FEE TO WS-FEE-OUT
           MOVE WS-TOTAL TO WS-TOTAL-OUT
           DISPLAY "FEE=" WS-FEE-OUT
           DISPLAY "TOTAL=" WS-TOTAL-OUT.
       9999-ABEND-PROGRAM.
           DISPLAY "ABENDING PROGRAM"
           MOVE 0 TO TIMING
           MOVE 999 TO ABCODE
           CALL "CEE3ABD" USING ABCODE, TIMING.
