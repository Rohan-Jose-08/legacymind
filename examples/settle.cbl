      * SETTLE - OCCURS affine subscripts + subscripted MOVE (docs/occurs.md).
      * The ledger table holds four entries in accrual/settlement pairs
      * (positions 1,3 are accruals; 2,4 are settlements). Each cell is filled
      * by a subscripted MOVE from NUMVAL, then the settlements are summed
      * through the strided affine subscript W-ITEM(2 * I), and a 2% fee is
      * charged ROUNDED. Input (SYSIN): four amounts, one per line. Parses only
      * with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SETTLE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-LEDGER.
           05 W-ITEM OCCURS 4 TIMES PIC 9(4)V99.
       01  W-IN1     PIC X(10).
       01  W-IN2     PIC X(10).
       01  W-IN3     PIC X(10).
       01  W-IN4     PIC X(10).
       01  W-PAID    PIC 9(6)V99  VALUE ZERO.
       01  W-FEE     PIC 9(6)V99  VALUE ZERO.
       01  I         PIC 9(2)     VALUE ZERO.
       01  W-PAID-OUT PIC 9(6).99.
       01  W-FEE-OUT  PIC 9(6).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT W-IN1
           MOVE FUNCTION NUMVAL(W-IN1) TO W-ITEM(1)
           ACCEPT W-IN2
           MOVE FUNCTION NUMVAL(W-IN2) TO W-ITEM(2)
           ACCEPT W-IN3
           MOVE FUNCTION NUMVAL(W-IN3) TO W-ITEM(3)
           ACCEPT W-IN4
           MOVE FUNCTION NUMVAL(W-IN4) TO W-ITEM(4)
           PERFORM SUM-PARA VARYING I FROM 1 BY 1 UNTIL I > 2
           COMPUTE W-FEE ROUNDED = W-PAID * 2 / 100
           MOVE W-PAID TO W-PAID-OUT
           MOVE W-FEE TO W-FEE-OUT
           DISPLAY "PAID=" W-PAID-OUT
           DISPLAY "FEE=" W-FEE-OUT
           STOP RUN.
       SUM-PARA.
           ADD W-ITEM(2 * I) TO W-PAID.
