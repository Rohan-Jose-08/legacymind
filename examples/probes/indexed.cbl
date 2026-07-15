       IDENTIFICATION DIVISION.
       PROGRAM-ID. IDXPROBE.
      * Ground-truth probe for OCCURS INDEXED BY (docs/occurs-indexed.md):
      * an index-name is an occurrence-number variable. SET IDX TO n must
      * equal MOVE n; SET IDX UP BY m must equal ADD m; TABLE(IDX) must
      * read occurrence IDX - so a SET-driven PERFORM UNTIL loop equals
      * literal-subscript access. No bytes are ever touched.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-TAB.
           05 W-VAL PIC 9(3) OCCURS 5 INDEXED BY IDX.
       01  W-SUM   PIC 9(5) VALUE 0.
       01  W-PICK  PIC 9(3) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           MOVE 10 TO W-VAL(1)
           MOVE 20 TO W-VAL(2)
           MOVE 30 TO W-VAL(3)
           MOVE 40 TO W-VAL(4)
           MOVE 50 TO W-VAL(5)
      * SET-driven sum over the whole table (SET TO 1, body, SET UP BY 1)
           SET IDX TO 1
           PERFORM SUM-PARA UNTIL IDX > 5
           DISPLAY "SUM=" W-SUM
      * relative pick: SET IDX TO 2 then read occurrence IDX
           SET IDX TO 2
           MOVE W-VAL(IDX) TO W-PICK
           DISPLAY "PICK=" W-PICK
           STOP RUN.
       SUM-PARA.
           ADD W-VAL(IDX) TO W-SUM
           SET IDX UP BY 1.
