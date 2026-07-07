      * INTEREST - simple-interest quote for one deposit.
      * Input  (SYSIN, one value per line): account id, principal,
      *        annual rate percent (e.g. 4.25), term in years.
      * Output (SYSOUT): ACCT_ID, INTEREST, TOTAL as KEY=VALUE lines.
      * Rules: terms longer than 5 years earn a 0.25 point loyalty
      * bonus on the rate; interest = principal * rate * years / 100,
      * ROUNDED; total = principal + interest.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTEREST.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN.
           05  WS-ACCT-ID          PIC X(8).
           05  WS-PRIN-TEXT        PIC X(12).
           05  WS-RATE-TEXT        PIC X(8).
           05  WS-TERM-TEXT        PIC X(6).
       01  WS-WORK.
           05  WS-PRINCIPAL        PIC 9(7)V99  VALUE ZERO.
           05  WS-RATE-PCT         PIC 99V99    VALUE ZERO.
           05  WS-TERM-YEARS       PIC 9(2)     VALUE ZERO.
           05  WS-EFF-RATE         PIC 99V99    VALUE ZERO.
           05  WS-INTEREST         PIC 9(7)V99  VALUE ZERO.
           05  WS-TOTAL            PIC 9(8)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-INTEREST-OUT     PIC 9(7).99.
           05  WS-TOTAL-OUT        PIC 9(8).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ACCT-ID
           ACCEPT WS-PRIN-TEXT
           ACCEPT WS-RATE-TEXT
           ACCEPT WS-TERM-TEXT
           COMPUTE WS-PRINCIPAL = FUNCTION NUMVAL(WS-PRIN-TEXT)
           COMPUTE WS-RATE-PCT = FUNCTION NUMVAL(WS-RATE-TEXT)
           COMPUTE WS-TERM-YEARS = FUNCTION NUMVAL(WS-TERM-TEXT)
           PERFORM CALC-INTEREST
           PERFORM PRINT-RESULT
           STOP RUN.
       CALC-INTEREST.
           IF WS-TERM-YEARS > 5
               COMPUTE WS-EFF-RATE = WS-RATE-PCT + 0.25
           ELSE
               MOVE WS-RATE-PCT TO WS-EFF-RATE
           END-IF
           COMPUTE WS-INTEREST ROUNDED =
               WS-PRINCIPAL * WS-EFF-RATE * WS-TERM-YEARS / 100
           COMPUTE WS-TOTAL = WS-PRINCIPAL + WS-INTEREST.
       PRINT-RESULT.
           MOVE WS-INTEREST TO WS-INTEREST-OUT
           MOVE WS-TOTAL TO WS-TOTAL-OUT
           DISPLAY "ACCT_ID=" WS-ACCT-ID
           DISPLAY "INTEREST=" WS-INTEREST-OUT
           DISPLAY "TOTAL=" WS-TOTAL-OUT.
