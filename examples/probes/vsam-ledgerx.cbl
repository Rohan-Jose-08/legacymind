      * LEDGERX - the VSAM target shape: a batch report over an INDEXED
      * account file. The read loop is the CBACT01C idiom measured in
      * CardDemo: OPEN INPUT, sequential READ INTO with AT END, FILE
      * STATUS checked, CLOSE. Records arrive in KEY order regardless of
      * the order they were loaded - a Java candidate that iterates in
      * insertion order diverges on every unsorted case.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEDGERX.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ACCTF ASSIGN TO "/tmp/acct.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS SEQUENTIAL
               RECORD KEY IS AC-ID
               FILE STATUS IS WS-AST.
       DATA DIVISION.
       FILE SECTION.
       FD  ACCTF.
       01  ACCT-REC.
           05  AC-ID      PIC X(5).
           05  AC-BAL     PIC 9(5)V99.
       WORKING-STORAGE SECTION.
       01  WS-AST         PIC XX.
       01  WS-EOF         PIC X VALUE "N".
       01  HOLD-REC.
           05  H-ID       PIC X(5).
           05  H-BAL      PIC 9(5)V99.
       01  WS-COUNT       PIC 9(3)   VALUE 0.
       01  WS-TOTAL       PIC 9(7)V99 VALUE 0.
       01  WS-FEE         PIC 9(5)V99 VALUE 0.
       01  WS-FIRST       PIC X(5)   VALUE SPACES.
       01  WS-LAST        PIC X(5)   VALUE SPACES.
       01  WS-TIER        PIC X(4).
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT ACCTF
           PERFORM UNTIL WS-EOF = "Y"
               READ ACCTF INTO HOLD-REC
                   AT END MOVE "Y" TO WS-EOF
               END-READ
               IF WS-EOF = "N"
                   ADD 1 TO WS-COUNT
                   ADD H-BAL TO WS-TOTAL
                   IF WS-FIRST = SPACES
                       MOVE H-ID TO WS-FIRST
                   END-IF
                   MOVE H-ID TO WS-LAST
               END-IF
           END-PERFORM
           CLOSE ACCTF
           COMPUTE WS-FEE ROUNDED = WS-TOTAL * 15 / 1000
           IF WS-TOTAL > 5000.00
               MOVE "GOLD" TO WS-TIER
           ELSE
               MOVE "STD " TO WS-TIER
           END-IF
           DISPLAY "COUNT=" WS-COUNT
           DISPLAY "TOTAL=" WS-TOTAL
           DISPLAY "FEE=" WS-FEE
           DISPLAY "FIRST=" WS-FIRST
           DISPLAY "LAST=" WS-LAST
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
