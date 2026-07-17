       IDENTIFICATION DIVISION.
       PROGRAM-ID. P1.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT OUTF ASSIGN TO "/out.dat"
               ORGANIZATION IS SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  OUTF.
       01  REC.
           05 F1 PIC S9(5) COMP-3.
           05 F2 PIC S9(4) COMP-3.
           05 F3 PIC 9(3)  COMP-3.
           05 F4 PIC S9(3)V99 COMP-3.
           05 F5 PIC S9(5) COMP-3.
           05 F6 PIC 9(4)  COMP-3.
       PROCEDURE DIVISION.
       MAIN.
           MOVE 12345 TO F1
           MOVE 987 TO F2
           MOVE 42 TO F3
           MOVE -1.5 TO F4
           MOVE -12345 TO F5
           MOVE -7 TO F6
           OPEN OUTPUT OUTF
           WRITE REC
           CLOSE OUTF
           STOP RUN.
