      * SMOKE - the live-API smoke module: a fresh IR (fresh cache keys)
      * so `migrate` without --offline exercises the physical API call.
      * 3% processing fee ROUNDED to the cent (half-cent tie at 0.50),
      * TOTAL = AMT + FEE, HELD tier when TOTAL > 800.00 (crossed at
      * AMT 776.71; AMT 776.70 lands TOTAL exactly 800.00 = FREE).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SMOKE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ACCT-ID    PIC X(8).
       01  WS-AMT-TEXT   PIC X(12).
       01  WS-AMT        PIC 9(5)V99  VALUE ZERO.
       01  WS-FEE        PIC 9(4)V99  VALUE ZERO.
       01  WS-TOTAL      PIC 9(6)V99  VALUE ZERO.
       01  WS-TIER       PIC X(4).
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ACCT-ID
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-AMT = FUNCTION NUMVAL(WS-AMT-TEXT)
           COMPUTE WS-FEE ROUNDED = WS-AMT * 3 / 100
           COMPUTE WS-TOTAL = WS-AMT + WS-FEE
           IF WS-TOTAL > 800.00
               MOVE "HELD" TO WS-TIER
           ELSE
               MOVE "FREE" TO WS-TIER
           END-IF
           DISPLAY "ACCT_ID=" WS-ACCT-ID
           DISPLAY "FEE=" WS-FEE
           DISPLAY "TOTAL=" WS-TOTAL
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
