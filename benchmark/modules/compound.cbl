      * COMPOUND - compound interest projection for one deposit.
      * Input  (SYSIN, one value per line): account id, principal,
      *        annual rate percent, term in years (single digit, 0-9).
      * Output (SYSOUT): ACCT_ID, TOTAL_INT, END_BAL as KEY=VALUE lines.
      * Rules: interest accrues yearly at the rate percent, ROUNDED to
      * the cent, and compounds into the balance; TOTAL_INT is the sum
      * of the yearly accruals. PERFORM VARYING has TEST BEFORE
      * semantics: a zero-year term accrues nothing.
      * Deliberately loop-shaped: parses only with the proleap engine
      * and exercises the wave-2 loop lowering end-to-end.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. COMPOUND.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       77  WS-YR                PIC 9(2)     VALUE ZERO.
       01  WS-IN.
           05  WS-ACCT-ID       PIC X(8).
           05  WS-PRIN-TEXT     PIC X(12).
           05  WS-RATE-TEXT     PIC X(8).
           05  WS-TERM-TEXT     PIC X(6).
       01  WS-WORK.
           05  WS-BALANCE       PIC 9(7)V99  VALUE ZERO.
           05  WS-RATE-PCT      PIC 99V99    VALUE ZERO.
           05  WS-TERM          PIC 9        VALUE ZERO.
           05  WS-YR-INT        PIC 9(7)V99  VALUE ZERO.
           05  WS-TOTAL-INT     PIC 9(7)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-INT-OUT       PIC 9(7).99.
           05  WS-BAL-OUT       PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ACCT-ID
           ACCEPT WS-PRIN-TEXT
           ACCEPT WS-RATE-TEXT
           ACCEPT WS-TERM-TEXT
           COMPUTE WS-BALANCE = FUNCTION NUMVAL(WS-PRIN-TEXT)
           COMPUTE WS-RATE-PCT = FUNCTION NUMVAL(WS-RATE-TEXT)
           COMPUTE WS-TERM = FUNCTION NUMVAL(WS-TERM-TEXT)
           PERFORM ACCRUE-PARA
               VARYING WS-YR FROM 1 BY 1 UNTIL WS-YR > WS-TERM
           PERFORM PRINT-PARA
           STOP RUN.
       ACCRUE-PARA.
           COMPUTE WS-YR-INT ROUNDED = WS-BALANCE * WS-RATE-PCT / 100
           ADD WS-YR-INT TO WS-TOTAL-INT
           ADD WS-YR-INT TO WS-BALANCE.
       PRINT-PARA.
           MOVE WS-TOTAL-INT TO WS-INT-OUT
           MOVE WS-BALANCE TO WS-BAL-OUT
           DISPLAY "ACCT_ID=" WS-ACCT-ID
           DISPLAY "TOTAL_INT=" WS-INT-OUT
           DISPLAY "END_BAL=" WS-BAL-OUT.
