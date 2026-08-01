       IDENTIFICATION DIVISION.
       PROGRAM-ID. IX1.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IXF ASSIGN TO "/tmp/ix.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS SEQUENTIAL
               RECORD KEY IS IX-KEY
               FILE STATUS IS WS-ST.
       DATA DIVISION.
       FILE SECTION.
       FD  IXF.
       01  IX-REC.
           05  IX-KEY  PIC X(5).
           05  IX-VAL  PIC 9(3).
       WORKING-STORAGE SECTION.
       01  WS-ST   PIC XX.
       01  WS-EOF  PIC X VALUE "N".
       PROCEDURE DIVISION.
       MAIN.
           OPEN OUTPUT IXF
           DISPLAY "OPEN-OUT=" WS-ST
           MOVE "AAA01" TO IX-KEY
           MOVE 111 TO IX-VAL
           WRITE IX-REC
           DISPLAY "W1=" WS-ST
           MOVE "CCC03" TO IX-KEY
           MOVE 333 TO IX-VAL
           WRITE IX-REC
           DISPLAY "W2=" WS-ST
           MOVE "BBB02" TO IX-KEY
           MOVE 222 TO IX-VAL
           WRITE IX-REC
           DISPLAY "W3-OUTOFORDER=" WS-ST
           CLOSE IXF
           OPEN INPUT IXF
           DISPLAY "OPEN-IN=" WS-ST
           PERFORM UNTIL WS-EOF = "Y"
               READ IXF
                   AT END MOVE "Y" TO WS-EOF
               END-READ
               IF WS-EOF = "N"
                   DISPLAY "REC=" IX-KEY "/" IX-VAL " ST=" WS-ST
               END-IF
           END-PERFORM
           DISPLAY "FINAL-ST=" WS-ST
           CLOSE IXF
           STOP RUN.
