      * HARNESS LOADER - not under verification. Reads seed records from a
      * LINE SEQUENTIAL text file and builds the INDEXED file the module
      * under test reads. ACCESS DYNAMIC so seed order is arbitrary (the
      * index imposes key order on the reader side - that asymmetry is the
      * point of the test).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOADER.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SEEDF ASSIGN TO "/tmp/seed.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-SST.
           SELECT ACCTF ASSIGN TO "/tmp/acct.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS AC-ID
               FILE STATUS IS WS-AST.
       DATA DIVISION.
       FILE SECTION.
       FD  SEEDF.
       01  SEED-LINE      PIC X(20).
       FD  ACCTF.
       01  ACCT-REC.
           05  AC-ID      PIC X(5).
           05  AC-BAL     PIC 9(5)V99.
       WORKING-STORAGE SECTION.
       01  WS-SST         PIC XX.
       01  WS-AST         PIC XX.
       01  WS-EOF         PIC X VALUE "N".
       01  WS-N           PIC 9(3) VALUE 0.
       PROCEDURE DIVISION.
       MAIN.
           OPEN INPUT SEEDF
           OPEN OUTPUT ACCTF
           PERFORM UNTIL WS-EOF = "Y"
               READ SEEDF
                   AT END MOVE "Y" TO WS-EOF
               END-READ
               IF WS-EOF = "N" AND SEED-LINE NOT = SPACES
                   MOVE SEED-LINE(1:5) TO AC-ID
                   COMPUTE AC-BAL = FUNCTION NUMVAL(SEED-LINE(6:12))
                   WRITE ACCT-REC
                   ADD 1 TO WS-N
               END-IF
           END-PERFORM
           CLOSE SEEDF
           CLOSE ACCTF
           DISPLAY "LOADED=" WS-N
           STOP RUN.
