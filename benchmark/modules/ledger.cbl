      * LEDGER - monthly settlement for one account.
      * Input  (SYSIN, one value per line): account id, opening balance,
      *        deposits total, withdrawals total.
      * Output (SYSOUT): ACCT_ID, FEE, NET, WEEKLY as KEY=VALUE lines.
      * Rules: withdrawals cap at available funds; maintenance fee is
      * 0.25% of the settled balance ROUNDED, waived below 500.00 and
      * capped at 15.00; WEEKLY is the net balance over 4 weeks ROUNDED.
      * Deliberately outside the stub parser's subset: level-77 items,
      * FILLER, ADD/SUBTRACT/MULTIPLY/DIVIDE, period-terminated IFs
      * (including a dangling ELSE), and an EXIT paragraph. Parses only
      * with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEDGER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       77  WS-FEE-RATE          PIC 9V9999   VALUE 0.0025.
       77  WS-FEE-CAP           PIC 9(2)V99  VALUE 15.00.
       01  WS-IN.
           05  WS-ACCT-ID       PIC X(8).
           05  WS-OPEN-TEXT     PIC X(12).
           05  WS-DEP-TEXT      PIC X(12).
           05  WS-WDL-TEXT     PIC X(12).
       01  WS-BANNER.
           05  FILLER           PIC X(4)     VALUE "*** ".
           05  WS-BANNER-TAG    PIC X(6)     VALUE "LEDGER".
           05  FILLER           PIC X(4)     VALUE " ***".
       01  WS-WORK.
           05  WS-BALANCE       PIC 9(7)V99  VALUE ZERO.
           05  WS-DEPOSITS      PIC 9(7)V99  VALUE ZERO.
           05  WS-WITHDRAWALS   PIC 9(7)V99  VALUE ZERO.
           05  WS-FEE           PIC 9(5)V99  VALUE ZERO.
           05  WS-WEEKLY        PIC 9(7)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-FEE-OUT       PIC 9(5).99.
           05  WS-NET-OUT       PIC 9(7).99.
           05  WS-WEEKLY-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ACCT-ID
           ACCEPT WS-OPEN-TEXT
           ACCEPT WS-DEP-TEXT
           ACCEPT WS-WDL-TEXT
           COMPUTE WS-BALANCE = FUNCTION NUMVAL(WS-OPEN-TEXT)
           COMPUTE WS-DEPOSITS = FUNCTION NUMVAL(WS-DEP-TEXT)
           COMPUTE WS-WITHDRAWALS = FUNCTION NUMVAL(WS-WDL-TEXT)
           PERFORM SETTLE-PARA
           PERFORM PRINT-PARA
           PERFORM DONE-PARA
           STOP RUN.
       SETTLE-PARA.
           ADD WS-DEPOSITS TO WS-BALANCE
           IF WS-WITHDRAWALS > WS-BALANCE
               MOVE WS-BALANCE TO WS-WITHDRAWALS.
           SUBTRACT WS-WITHDRAWALS FROM WS-BALANCE
           MULTIPLY WS-BALANCE BY WS-FEE-RATE GIVING WS-FEE ROUNDED
           IF WS-BALANCE < 500
               MOVE 0 TO WS-FEE
           ELSE
               IF WS-FEE > WS-FEE-CAP
                   MOVE WS-FEE-CAP TO WS-FEE.
           SUBTRACT WS-FEE FROM WS-BALANCE
           DIVIDE WS-BALANCE BY 4 GIVING WS-WEEKLY ROUNDED.
       PRINT-PARA.
           MOVE WS-FEE TO WS-FEE-OUT
           MOVE WS-BALANCE TO WS-NET-OUT
           MOVE WS-WEEKLY TO WS-WEEKLY-OUT
           DISPLAY "ACCT_ID=" WS-ACCT-ID
           DISPLAY "FEE=" WS-FEE-OUT
           DISPLAY "NET=" WS-NET-OUT
           DISPLAY "WEEKLY=" WS-WEEKLY-OUT.
       DONE-PARA.
           EXIT.
