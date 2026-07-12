      * DUES - REDEFINES R1a (docs/redefines.md): the legacy record stores a
      * dues amount as a whole number of CENTS (no decimal point in storage),
      * and a REDEFINES view reinterprets the same six digits as dollars-and-
      * cents for the money math. WS-DOLLARS is read-only; its value is just
      * WS-CENTS at a shifted implied scale (a pure decimal shift). A 5% late
      * fee is charged ROUNDED, and dues over 100.00 are tiered HIGH. Input
      * (SYSIN, one line): the dues amount in cents. Parses only with the
      * proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DUES.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-AMT-TEXT   PIC X(8).
       01  WS-CENTS      PIC 9(6)     VALUE ZERO.
       01  WS-DOLLARS REDEFINES WS-CENTS PIC 9(4)V99.
       01  WS-FEE        PIC 9(4)V99  VALUE ZERO.
       01  WS-TIER       PIC X(4).
       01  WS-DOL-OUT    PIC 9(4).99.
       01  WS-FEE-OUT    PIC 9(4).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-CENTS = FUNCTION NUMVAL(WS-AMT-TEXT)
           COMPUTE WS-FEE ROUNDED = WS-DOLLARS * 5 / 100
           IF WS-DOLLARS > 100
               MOVE "HIGH" TO WS-TIER
           ELSE
               MOVE "LOW " TO WS-TIER
           END-IF
           MOVE WS-DOLLARS TO WS-DOL-OUT
           MOVE WS-FEE TO WS-FEE-OUT
           DISPLAY "DOLLARS=" WS-DOL-OUT
           DISPLAY "FEE=" WS-FEE-OUT
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
