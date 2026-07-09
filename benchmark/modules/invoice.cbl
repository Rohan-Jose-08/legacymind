      * INVOICE - processing fee with input validation and an early exit.
      * Input  (SYSIN, one value per line): invoice id, amount text.
      * Output (SYSOUT): INV_ID, STATUS (and FEE when billed) as KEY=VALUE.
      * MAIN-PARA validates: a zero amount prints STATUS=EMPTY and stops the
      * run inside the IF - a conditional early STOP RUN. Otherwise control
      * FALLS THROUGH (no PERFORM anywhere) into CALC-PARA, which computes a
      * 2.5% processing fee ROUNDED to the cent, and on into PRINT-PARA.
      * This is the top-level fall-through + early-exit shape: the verifier
      * layers must model the whole paragraph chain and honor STOP RUN as a
      * path terminator. A candidate that forgets the early return (a missing
      * Java `return`) bills the empty invoice and is caught. Parses only
      * with the proleap engine (period-terminated IF).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVOICE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ID-TEXT    PIC X(8).
       01  WS-AMT-TEXT   PIC X(12).
       01  WS-AMOUNT     PIC 9(7)V99  VALUE ZERO.
       01  WS-FEE        PIC 9(7)V99  VALUE ZERO.
       01  WS-STATUS     PIC X(5).
       01  WS-FEE-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ID-TEXT
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-AMT-TEXT)
           IF WS-AMOUNT = 0
               MOVE "EMPTY" TO WS-STATUS
               DISPLAY "INV_ID=" WS-ID-TEXT
               DISPLAY "STATUS=" WS-STATUS
               STOP RUN.
       CALC-PARA.
           COMPUTE WS-FEE ROUNDED = WS-AMOUNT * 2.5 / 100.
       PRINT-PARA.
           MOVE "READY" TO WS-STATUS
           MOVE WS-FEE TO WS-FEE-OUT
           DISPLAY "INV_ID=" WS-ID-TEXT
           DISPLAY "STATUS=" WS-STATUS
           DISPLAY "FEE=" WS-FEE-OUT
           STOP RUN.
