       IDENTIFICATION DIVISION.
       PROGRAM-ID. REDEFINES.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * Case 1: read-only reinterpretation - populate the X view, read numeric.
       01  W-RAW1     PIC X(6) VALUE "015025".
       01  W-NUM1 REDEFINES W-RAW1 PIC 9(4)V99.
      * Case 2: write-through - write numeric view, read the X view.
       01  W-NUM2     PIC 9(4)V99 VALUE ZERO.
       01  W-RAW2 REDEFINES W-NUM2 PIC X(6).
      * Case 3: group over group (two field layouts over the same bytes).
       01  W-REC.
           05 W-A     PIC 9(3).
           05 W-B     PIC 9(4)V99.
       01  W-ALT REDEFINES W-REC.
           05 W-WHOLE PIC 9(9).
       01  W-BIG      PIC 9(9)V99 VALUE ZERO.
       PROCEDURE DIVISION.
       MAIN-PARA.
      * Case 1
           DISPLAY "C1-NUM=" W-NUM1.
           COMPUTE W-BIG = W-NUM1 * 2.
           DISPLAY "C1-BIG=" W-BIG.
      * Case 2
           MOVE 42.75 TO W-NUM2.
           DISPLAY "C2-RAW=[" W-RAW2 "]".
           MOVE 100.00 TO W-NUM2.
           DISPLAY "C2-RAW2=[" W-RAW2 "]".
      * Case 3
           MOVE 123 TO W-A.
           MOVE 4567.89 TO W-B.
           DISPLAY "C3-REC=[" W-REC "]".
           DISPLAY "C3-WHOLE=" W-WHOLE.
           STOP RUN.
