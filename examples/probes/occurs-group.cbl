       IDENTIFICATION DIVISION.
       PROGRAM-ID. OCCGRP.
      * Ground-truth probe for OCCURS O3 (docs/occurs-groups.md): a FLAT
      * group table with elementary leaves must behave exactly like
      * parallel per-leaf tables when every access is leaf-wise - leaf
      * independence, literal and variable subscripts, qualified refs,
      * and arithmetic over numeric leaf cells. Case D documents the
      * excluded shape: a group-as-whole element read is byte
      * concatenation of the leaves.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-TAB.
           05 W-ROW OCCURS 3 TIMES.
              10 W-CODE   PIC X(3).
              10 W-QTY    PIC 9(4).
              10 W-PRICE  PIC 9(3)V99.
       01  I             PIC 9 VALUE ZERO.
       01  W-SUM         PIC 9(6)V99 VALUE ZERO.
       01  W-EXT         PIC 9(8)V99 VALUE ZERO.
       PROCEDURE DIVISION.
       MAIN-PARA.
      * A: leaf-wise fill at literal subscripts; leaf independence.
           MOVE "AAA" TO W-CODE(1)
           MOVE "BBB" TO W-CODE(2)
           MOVE "CCC" TO W-CODE(3)
           MOVE 10 TO W-QTY(1)
           MOVE 20 TO W-QTY(2)
           MOVE 30 TO W-QTY(3)
           MOVE 1.50 TO W-PRICE(1)
           MOVE 2.25 TO W-PRICE(2)
           MOVE 0.75 TO W-PRICE(3)
           DISPLAY "A1=[" W-CODE(1) "|" W-QTY(1) "|" W-PRICE(1) "]"
      * B: qualified leaf ref with subscript.
           DISPLAY "B=[" W-QTY OF W-ROW (2) "]"
      * C: loop-index subscripts + arithmetic over numeric leaf cells.
           PERFORM CALC-PARA VARYING I FROM 1 BY 1 UNTIL I > 3
           DISPLAY "C-SUM=[" W-SUM "]"
      * D: EXCLUDED shape documented - group element read whole.
           DISPLAY "D=[" W-ROW(2) "]"
           STOP RUN.
       CALC-PARA.
           COMPUTE W-EXT = W-QTY(I) * W-PRICE(I)
           COMPUTE W-SUM = W-SUM + W-EXT.
