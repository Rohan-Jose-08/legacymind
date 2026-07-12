       IDENTIFICATION DIVISION.
       PROGRAM-ID. OCCURS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-TABLE.
           05 W-VAL OCCURS 5 TIMES PIC 9(4)V99.
       01  W-OVERLAY REDEFINES W-TABLE PIC X(30).
       01  W-TOTAL   PIC 9(6)V99 VALUE ZERO.
       01  I         PIC 9(2)    VALUE ZERO.
       01  W-OUT     PIC 9(6).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
      * initialize the table by constant subscript
           MOVE 10.00 TO W-VAL(1).
           MOVE 20.50 TO W-VAL(2).
           MOVE 5.25  TO W-VAL(3).
           MOVE 100.00 TO W-VAL(4).
           MOVE 3.75  TO W-VAL(5).
      * sum via a PERFORM VARYING loop index (canonical table idiom)
           PERFORM VARYING I FROM 1 BY 1 UNTIL I > 5
               ADD W-VAL(I) TO W-TOTAL
           END-PERFORM.
           MOVE W-TOTAL TO W-OUT.
           DISPLAY "TOTAL=" W-OUT.
      * show the contiguous storage layout via the X overlay
           DISPLAY "RAW=[" W-OVERLAY "]".
      * constant-subscript read
           DISPLAY "V4=" W-VAL(4).
           STOP RUN.
