       IDENTIFICATION DIVISION.
       PROGRAM-ID. CSENS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-TXT  PIC X(10).
       01  W-N    PIC S9(4) COMP.
       01  W-TOT  PIC S9(4) COMP VALUE 0.
       PROCEDURE DIVISION.
       MAIN.
           ACCEPT W-TXT
           COMPUTE W-N = FUNCTION NUMVAL(W-TXT)
           COMPUTE W-TOT = W-N * 4
           DISPLAY "N=" W-N
           DISPLAY "TOT=" W-TOT
           IF W-TOT > 9000
               DISPLAY "BIG=YES"
           ELSE
               DISPLAY "BIG=NO"
           END-IF
           STOP RUN.
