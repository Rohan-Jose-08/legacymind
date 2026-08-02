       IDENTIFICATION DIVISION.
       PROGRAM-ID. RDINTO.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT INF ASSIGN TO "in.dat"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-ST.
       DATA DIVISION.
       FILE SECTION.
       FD  INF.
       01  FD-REC.
           05  FD-KEY   PIC X(4).
           05  FD-DATA  PIC X(16).
       WORKING-STORAGE SECTION.
       01  WS-ST   PIC XX.
       01  WS-EOF  PIC 9 VALUE 0.
       01  WS-DET.
           05  D-KEY    PIC X(4).
           05  D-QTY    PIC 9(3).
           05  D-AMT    PIC 9(5)V99.
           05  D-FLAG   PIC X(1).
           05  FILLER   PIC X(5).
       PROCEDURE DIVISION.
       MAIN.
           OPEN INPUT INF
           PERFORM READ-ONE UNTIL WS-EOF = 1
           CLOSE INF
           STOP RUN.

       READ-ONE.
           READ INF INTO WS-DET
               AT END
                   MOVE 1 TO WS-EOF
               NOT AT END
                   DISPLAY "KEY=" D-KEY
                   DISPLAY "QTY=" D-QTY
                   DISPLAY "AMT=" D-AMT
                   DISPLAY "FLAG=" D-FLAG
           END-READ.
