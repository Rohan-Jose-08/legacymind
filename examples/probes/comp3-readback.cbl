       IDENTIFICATION DIVISION.
       PROGRAM-ID. P4.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT F1 ASSIGN TO "/data.dat"
               ORGANIZATION IS SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  F1.
       01  REC-OUT.
           05 RAWB PIC X(3).
       WORKING-STORAGE SECTION.
       01  REC-IN.
           05 PV PIC S9(5) COMP-3.
       01  HOLD PIC S9(7) COMP-3.
       PROCEDURE DIVISION.
       MAIN.
           OPEN OUTPUT F1
           MOVE X"12345C" TO RAWB
           WRITE REC-OUT
           MOVE X"12345D" TO RAWB
           WRITE REC-OUT
           MOVE X"12345F" TO RAWB
           WRITE REC-OUT
           MOVE X"1A34BC" TO RAWB
           WRITE REC-OUT
           CLOSE F1
           OPEN INPUT F1
           PERFORM 4 TIMES
               READ F1 INTO REC-IN
               DISPLAY "VAL=" PV
               MOVE PV TO HOLD
               DISPLAY "MOVED=" HOLD
           END-PERFORM
           CLOSE F1
           STOP RUN.
