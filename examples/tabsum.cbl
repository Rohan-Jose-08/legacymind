      * TABSUM - OCCURS O1/O2 (docs/occurs.md): a fixed table of four line
      * amounts, each parsed from input with NUMVAL into a table cell, summed
      * through a PERFORM VARYING loop index, with a 2% fee ROUNDED on the
      * total. The table W-VAL OCCURS 4 TIMES is four contiguous cells;
      * W-VAL(I) selects the I-th. Input (SYSIN): four amounts, one per line.
      * Parses only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TABSUM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-TABLE.
           05 W-VAL OCCURS 4 TIMES PIC 9(4)V99.
       01  W-IN1     PIC X(10).
       01  W-IN2     PIC X(10).
       01  W-IN3     PIC X(10).
       01  W-IN4     PIC X(10).
       01  W-TOTAL   PIC 9(6)V99  VALUE ZERO.
       01  W-FEE     PIC 9(6)V99  VALUE ZERO.
       01  I         PIC 9(2)     VALUE ZERO.
       01  W-TOT-OUT PIC 9(6).99.
       01  W-FEE-OUT PIC 9(6).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT W-IN1
           COMPUTE W-VAL(1) = FUNCTION NUMVAL(W-IN1)
           ACCEPT W-IN2
           COMPUTE W-VAL(2) = FUNCTION NUMVAL(W-IN2)
           ACCEPT W-IN3
           COMPUTE W-VAL(3) = FUNCTION NUMVAL(W-IN3)
           ACCEPT W-IN4
           COMPUTE W-VAL(4) = FUNCTION NUMVAL(W-IN4)
           PERFORM ADD-PARA VARYING I FROM 1 BY 1 UNTIL I > 4
           COMPUTE W-FEE ROUNDED = W-TOTAL * 2 / 100
           MOVE W-TOTAL TO W-TOT-OUT
           MOVE W-FEE TO W-FEE-OUT
           DISPLAY "TOTAL=" W-TOT-OUT
           DISPLAY "FEE=" W-FEE-OUT
           STOP RUN.
       ADD-PARA.
           ADD W-VAL(I) TO W-TOTAL.
