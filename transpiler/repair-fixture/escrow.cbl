      * ESCROW - the deterministic repair-loop fixture (NOT a benchmark
      * module). A deposit pays a 3% escrow fee ROUNDED to the cent;
      * deposits over 1000.00 are tiered HELD. The committed cache
      * entries for this module are deliberately broken candidates (a:
      * wrong rate, caught by layer B; b: does not compile), so
      * `migrate --offline --max-repairs 1` exercises the whole
      * generate -> verify -> repair loop from the replay cache: evidence
      * prompt built, repair candidate a-r1 compiled, verified, and
      * selected. See transpiler/repair-fixture/README.md.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ESCROW.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-DEP-TEXT   PIC X(10).
       01  WS-DEPOSIT    PIC 9(6)V99  VALUE ZERO.
       01  WS-FEE        PIC 9(5)V99  VALUE ZERO.
       01  WS-TIER       PIC X(4).
       01  WS-FEE-OUT    PIC 9(5).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-DEP-TEXT
           COMPUTE WS-DEPOSIT = FUNCTION NUMVAL(WS-DEP-TEXT)
           COMPUTE WS-FEE ROUNDED = WS-DEPOSIT * 3 / 100
           IF WS-DEPOSIT > 1000
               MOVE "HELD" TO WS-TIER
           ELSE
               MOVE "FREE" TO WS-TIER
           END-IF
           MOVE WS-FEE TO WS-FEE-OUT
           DISPLAY "FEE=" WS-FEE-OUT
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
