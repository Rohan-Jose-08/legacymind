      * BONUS - sales bonus computed by a multi-paragraph SECTION. Input
      * (SYSIN, one value per line): employee id, sales text. Output:
      * EMP_ID, BONUS, TOTAL as KEY=VALUE lines.
      * PERFORM CALC performs the WHOLE section: its own statement (3%
      * base, ROUNDED) plus STEP-UPLIFT (150% uplift over 50000.00, also
      * ROUNDED - a nested rounding over the settled base) and STEP-TOTAL.
      * The classic migration bug is treating PERFORM <section> as its
      * first block only, which computes the base and skips the uplift and
      * total - caught on every case. Sections lower onto the PERFORM THRU
      * machinery (header = a synthetic paragraph); parses only with the
      * proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. BONUS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-EMP-ID      PIC X(8).
       01  WS-SALES-TEXT  PIC X(12).
       01  WS-SALES       PIC 9(7)V99  VALUE ZERO.
       01  WS-BASE        PIC 9(7)V99  VALUE ZERO.
       01  WS-BONUS       PIC 9(7)V99  VALUE ZERO.
       01  WS-TOTAL       PIC 9(7)V99  VALUE ZERO.
       01  WS-BON-OUT     PIC 9(7).99.
       01  WS-TOT-OUT     PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN SECTION.
       MAIN-PARA.
           ACCEPT WS-EMP-ID
           ACCEPT WS-SALES-TEXT
           COMPUTE WS-SALES = FUNCTION NUMVAL(WS-SALES-TEXT)
           PERFORM CALC
           MOVE WS-BONUS TO WS-BON-OUT
           MOVE WS-TOTAL TO WS-TOT-OUT
           DISPLAY "EMP_ID=" WS-EMP-ID
           DISPLAY "BONUS=" WS-BON-OUT
           DISPLAY "TOTAL=" WS-TOT-OUT
           STOP RUN.
       CALC SECTION.
           COMPUTE WS-BASE ROUNDED = WS-SALES * 3 / 100.
       STEP-UPLIFT.
           IF WS-SALES > 50000
               COMPUTE WS-BONUS ROUNDED = WS-BASE * 150 / 100
           ELSE
               MOVE WS-BASE TO WS-BONUS
           END-IF.
       STEP-TOTAL.
           COMPUTE WS-TOTAL = WS-SALES + WS-BONUS.
