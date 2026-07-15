       IDENTIFICATION DIVISION.
       PROGRAM-ID. SCANT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-CODE-TEXT PIC X(4).
       01  W-WANT      PIC 9(2)   VALUE 0.
       01  W-TAB.
           05 W-ENTRY OCCURS 5 INDEXED BY IX.
              10 W-CODE  PIC 9(2).
              10 W-PRICE PIC 9(3)V99.
       01  W-FOUND     PIC 9(3)V99 VALUE 0.
       01  W-FEE       PIC 9(5)V99 VALUE 0.
       01  W-FEE-OUT   PIC 9(5).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT W-CODE-TEXT
           COMPUTE W-WANT = FUNCTION NUMVAL(W-CODE-TEXT)
           MOVE 11 TO W-CODE(1)
           MOVE 22 TO W-CODE(2)
           MOVE 33 TO W-CODE(3)
           MOVE 44 TO W-CODE(4)
           MOVE 55 TO W-CODE(5)
           MOVE 1.00 TO W-PRICE(1)
           MOVE 2.50 TO W-PRICE(2)
           MOVE 3.75 TO W-PRICE(3)
           MOVE 4.00 TO W-PRICE(4)
           MOVE 5.20 TO W-PRICE(5)
           SET IX TO 1
           PERFORM SCAN-STEP VARYING IX FROM 1 BY 1
               UNTIL IX > 5 OR W-CODE(IX) = W-WANT
           IF IX > 5
               MOVE 0 TO W-FOUND
           ELSE
               MOVE W-PRICE(IX) TO W-FOUND
           END-IF
           COMPUTE W-FEE ROUNDED = W-FOUND * 5 / 100
           MOVE W-FEE TO W-FEE-OUT
           DISPLAY "FOUND=" W-FOUND
           DISPLAY "FEE=" W-FEE-OUT
           STOP RUN.
       SCAN-STEP.
           EXIT.
