      * COMMISSION - sales commission with a cap and a completion bonus.
      * Input  (SYSIN, one value per line): rep id, sales amount text.
      * Output (SYSOUT): REP_ID, COMMISSION as KEY=VALUE lines.
      * Rule: the base commission is 7.5% of sales, ROUNDED to the cent.
      * If that base is over the cap (500.00) it is clamped to the cap and
      * NO completion bonus is paid - the paragraph returns early with
      * GO TO CALC-EXIT. Otherwise a flat 50.00 completion bonus is added.
      * The early exit is load-bearing: dropping it pays the bonus on top of
      * a capped commission, which a candidate that "simplifies" the GO TO
      * into a plain clamp gets wrong on every capped sale. Structured
      * GO-TO-exit idiom over a PERFORM THRU range; parses only with the
      * proleap engine and exercises the stage-1 GO TO lowering end-to-end.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. COMMISSION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN.
           05  WS-REP-ID        PIC X(8).
           05  WS-SALES-TEXT    PIC X(12).
       01  WS-CONST.
           05  WS-RATE          PIC 99V99    VALUE 7.50.
           05  WS-CAP           PIC 9(5)V99  VALUE 500.00.
           05  WS-BONUS         PIC 9(5)V99  VALUE 50.00.
       01  WS-WORK.
           05  WS-SALES         PIC 9(7)V99  VALUE ZERO.
           05  WS-COMMISSION    PIC 9(7)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-COMM-OUT      PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-REP-ID
           ACCEPT WS-SALES-TEXT
           COMPUTE WS-SALES = FUNCTION NUMVAL(WS-SALES-TEXT)
           PERFORM CALC-COMM THRU CALC-EXIT
           PERFORM PRINT-PARA
           STOP RUN.
       CALC-COMM.
           COMPUTE WS-COMMISSION ROUNDED =
               WS-SALES * WS-RATE / 100.
           IF WS-COMMISSION > WS-CAP
               MOVE WS-CAP TO WS-COMMISSION
               GO TO CALC-EXIT.
           ADD WS-BONUS TO WS-COMMISSION.
       CALC-EXIT.
           EXIT.
       PRINT-PARA.
           MOVE WS-COMMISSION TO WS-COMM-OUT
           DISPLAY "REP_ID=" WS-REP-ID
           DISPLAY "COMMISSION=" WS-COMM-OUT.
