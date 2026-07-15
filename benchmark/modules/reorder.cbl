      * REORDER - a reorder cost over an INDEXED BY price table (OCCURS
      * index-names, docs/occurs-indexed.md): an index-name is an
      * occurrence-number variable, so SET PX TO n desugars to MOVE n and
      * SET PX UP BY n to COMPUTE PX = PX + n over a synthetic numeric
      * item - the verifier is untouched. The price table is filled at
      * literal subscripts and summed by PERFORM VARYING the index; a SET
      * TO / SET UP BY pair selects the tier-3 price by relative indexing;
      * the reorder fee is 5% ROUNDED on the input quantity times that
      * price, so the half-cent obligation is affine over the input and
      * the BULK tier splits the total. Input (SYSIN, one line): demand
      * quantity text. Output: SUMP, PICK, BASE, FEE, TOTAL, TIER as
      * KEY=VALUE. Parses only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. REORDER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-QTY-TEXT   PIC X(8).
       01  WS-QTY        PIC 9(5)V99  VALUE ZERO.
       01  WS-PRICE      PIC 9(3)V99 OCCURS 5 INDEXED BY PX.
       01  WS-SUMP       PIC 9(5)V99  VALUE ZERO.
       01  WS-BASE       PIC 9(7)V99  VALUE ZERO.
       01  WS-FEE        PIC 9(7)V99  VALUE ZERO.
       01  WS-TOTAL      PIC 9(7)V99  VALUE ZERO.
       01  WS-TIER       PIC X(4).
       01  WS-SUMP-OUT   PIC 9(5).99.
       01  WS-PICK-OUT   PIC 9(3).99.
       01  WS-BASE-OUT   PIC 9(7).99.
       01  WS-FEE-OUT    PIC 9(7).99.
       01  WS-TOT-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-QTY-TEXT
           COMPUTE WS-QTY = FUNCTION NUMVAL(WS-QTY-TEXT)
           MOVE 1.20 TO WS-PRICE(1)
           MOVE 1.55 TO WS-PRICE(2)
           MOVE 1.75 TO WS-PRICE(3)
           MOVE 2.00 TO WS-PRICE(4)
           MOVE 0.90 TO WS-PRICE(5)
           PERFORM SUMP-PARA VARYING PX FROM 1 BY 1 UNTIL PX > 5
           SET PX TO 1
           SET PX UP BY 2
           COMPUTE WS-BASE ROUNDED = WS-QTY * WS-PRICE(PX)
           COMPUTE WS-FEE ROUNDED = WS-BASE * 5 / 100
           COMPUTE WS-TOTAL = WS-BASE + WS-FEE
           IF WS-TOTAL > 500
               MOVE "BULK" TO WS-TIER
           ELSE
               MOVE "STD " TO WS-TIER
           END-IF
           MOVE WS-SUMP TO WS-SUMP-OUT
           MOVE WS-PRICE(PX) TO WS-PICK-OUT
           MOVE WS-BASE TO WS-BASE-OUT
           MOVE WS-FEE TO WS-FEE-OUT
           MOVE WS-TOTAL TO WS-TOT-OUT
           DISPLAY "SUMP=" WS-SUMP-OUT
           DISPLAY "PICK=" WS-PICK-OUT
           DISPLAY "BASE=" WS-BASE-OUT
           DISPLAY "FEE=" WS-FEE-OUT
           DISPLAY "TOTAL=" WS-TOT-OUT
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
       SUMP-PARA.
           ADD WS-PRICE(PX) TO WS-SUMP.
