       IDENTIFICATION DIVISION.
       PROGRAM-ID. LSQ.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT OUTF ASSIGN TO "/out.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  OUTF.
       01  REC.
           05 R-TAG    PIC X(4).
           05 R-WEIGHT PIC 9(4)V9 COMP-3.
           05 R-CHARGE PIC S9(5)V99 COMP-3.
       PROCEDURE DIVISION.
       MAIN.
           OPEN OUTPUT OUTF
           MOVE "R1= " TO R-TAG
           MOVE 200.0 TO R-WEIGHT
           MOVE 204.80 TO R-CHARGE
           WRITE REC
           MOVE "R2= " TO R-TAG
           MOVE 819.2 TO R-WEIGHT
           MOVE -1.30 TO R-CHARGE
           WRITE REC
           MOVE "R3= " TO R-TAG
           MOVE 0.5 TO R-WEIGHT
           MOVE 0.02 TO R-CHARGE
           WRITE REC
           CLOSE OUTF
           STOP RUN.
