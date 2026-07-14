      * LOCKER - club locker billing over a GROUP REDEFINES view (RG,
      * docs/redefines-edited.md). The member record stores raw digits:
      * a 4-digit member id and the balance as a WHOLE NUMBER OF CENTS.
      * A money view redefines the record group leaf-for-leaf: the same
      * id digits, and the same six balance digits read as dollars with
      * an implied decimal (a per-leaf decimal shift - REDEFINES R1a
      * applied to each aligned leaf of the group). The 2.5% late fee is
      * computed ROUNDED on the dollars view, so the half-cent obligation
      * and the GOLD tier branch sit directly over the shifted view read.
      * Input (SYSIN): member id text, cents text. Output: KEY=, FEE=,
      * TOTAL=, TIER= as KEY=VALUE lines. Parses only with proleap.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOCKER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ID-TEXT    PIC X(4).
       01  WS-CENTS-TEXT PIC X(12).
       01  WS-REC.
           05 WS-MEM-ID    PIC 9(4).
           05 WS-BAL-CENTS PIC 9(6).
       01  WS-MONEY REDEFINES WS-REC.
           05 WS-MEM-KEY   PIC 9(4).
           05 WS-BAL-DOL   PIC 9(4)V99.
       01  WS-FEE        PIC 9(4)V99 VALUE ZERO.
       01  WS-TOTAL      PIC 9(5)V99 VALUE ZERO.
       01  WS-TIER       PIC X(4).
       01  WS-FEE-OUT    PIC 9(4).99.
       01  WS-TOT-OUT    PIC 9(5).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ID-TEXT
           ACCEPT WS-CENTS-TEXT
           COMPUTE WS-MEM-ID = FUNCTION NUMVAL(WS-ID-TEXT)
           COMPUTE WS-BAL-CENTS = FUNCTION NUMVAL(WS-CENTS-TEXT)
           COMPUTE WS-FEE ROUNDED = WS-BAL-DOL * 25 / 1000
           COMPUTE WS-TOTAL = WS-BAL-DOL + WS-FEE
           IF WS-BAL-DOL > 200
               MOVE "GOLD" TO WS-TIER
           ELSE
               MOVE "STD " TO WS-TIER
           END-IF
           MOVE WS-FEE TO WS-FEE-OUT
           MOVE WS-TOTAL TO WS-TOT-OUT
           DISPLAY "KEY=" WS-MEM-KEY
           DISPLAY "FEE=" WS-FEE-OUT
           DISPLAY "TOTAL=" WS-TOT-OUT
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
