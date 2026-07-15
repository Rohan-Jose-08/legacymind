       IDENTIFICATION DIVISION.
       PROGRAM-ID. SRCHP.
      * Ground-truth probe for serial SEARCH (docs/search.md): SEARCH walks
      * the index from its CURRENT value up, testing WHEN at each position
      * (test-then-increment); a match runs the WHEN body with the index at
      * the matching occurrence; running off the end runs AT END with the
      * index one past the table. So a SET-before + SEARCH is a bounded
      * loop over the index - what determines whether it desugars to the
      * PERFORM-UNTIL machinery the engine already unrolls.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-TAB.
           05 W-ENT OCCURS 4 INDEXED BY IX.
              10 W-CODE PIC X(2).
              10 W-VAL  PIC 9(3).
       01  W-KEY   PIC X(2).
       01  W-FOUND PIC 9(3) VALUE 0.
       01  W-POS   PIC 9(2) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           MOVE "AA" TO W-CODE(1)
           MOVE "BB" TO W-CODE(2)
           MOVE "CC" TO W-CODE(3)
           MOVE "DD" TO W-CODE(4)
           MOVE 10 TO W-VAL(1)
           MOVE 20 TO W-VAL(2)
           MOVE 30 TO W-VAL(3)
           MOVE 40 TO W-VAL(4)
      * Case 1: find "CC" from the top - matches occurrence 3.
           MOVE "CC" TO W-KEY
           SET IX TO 1
           SEARCH W-ENT
             AT END MOVE 999 TO W-FOUND
             WHEN W-CODE(IX) = W-KEY
                MOVE W-VAL(IX) TO W-FOUND
                SET W-POS TO IX
           END-SEARCH
           DISPLAY "C1-FOUND=" W-FOUND " POS=" W-POS
      * Case 2: missing key - AT END fires; where is the index?
           MOVE "ZZ" TO W-KEY
           MOVE 0 TO W-POS
           SET IX TO 1
           SEARCH W-ENT
             AT END MOVE 999 TO W-FOUND
                SET W-POS TO IX
             WHEN W-CODE(IX) = W-KEY
                MOVE W-VAL(IX) TO W-FOUND
           END-SEARCH
           DISPLAY "C2-FOUND=" W-FOUND " POS=" W-POS
      * Case 3: start mid-table (IX=3) - "AA" at occ 1 is BEFORE the start,
      * so it is NOT found.
           MOVE "AA" TO W-KEY
           MOVE 0 TO W-POS
           SET IX TO 3
           SEARCH W-ENT
             AT END MOVE 888 TO W-FOUND
             WHEN W-CODE(IX) = W-KEY
                MOVE W-VAL(IX) TO W-FOUND
                SET W-POS TO IX
           END-SEARCH
           DISPLAY "C3-FOUND=" W-FOUND " POS=" W-POS
           STOP RUN.
