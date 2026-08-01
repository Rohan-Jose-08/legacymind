       IDENTIFICATION DIVISION.
       PROGRAM-ID. IX2.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IXF ASSIGN TO "/tmp/ix2.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS SEQUENTIAL
               RECORD KEY IS IX-KEY
               FILE STATUS IS WS-ST.
           SELECT MISSF ASSIGN TO "/tmp/nosuch.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS SEQUENTIAL
               RECORD KEY IS MS-KEY
               FILE STATUS IS WS-ST2.
       DATA DIVISION.
       FILE SECTION.
       FD  IXF.
       01  IX-REC.
           05  IX-KEY  PIC X(5).
           05  IX-VAL  PIC 9(3).
       FD  MISSF.
       01  MS-REC.
           05  MS-KEY  PIC X(5).
           05  MS-VAL  PIC 9(3).
       WORKING-STORAGE SECTION.
       01  WS-ST   PIC XX.
       01  WS-ST2  PIC XX.
       01  WS-EOF  PIC X VALUE "N".
       01  HOLD.
           05  H-KEY  PIC X(5).
           05  H-VAL  PIC 9(3).
       01  WS-N    PIC 9 VALUE 0.
       PROCEDURE DIVISION.
       MAIN.
      * missing-file OPEN INPUT: expect status 35
           OPEN INPUT MISSF
           DISPLAY "MISSING-OPEN-ST=" WS-ST2
      * build the file
           OPEN OUTPUT IXF
           MOVE "KEY03" TO IX-KEY
           MOVE 300 TO IX-VAL
           WRITE IX-REC
           MOVE "KEY01" TO IX-KEY
           MOVE 100 TO IX-VAL
           WRITE IX-REC
           MOVE "KEY02" TO IX-KEY
           MOVE 200 TO IX-VAL
           WRITE IX-REC
      * duplicate key: expect status 22
           MOVE "KEY01" TO IX-KEY
           MOVE 999 TO IX-VAL
           WRITE IX-REC
           DISPLAY "DUP-WRITE-ST=" WS-ST
           CLOSE IXF
      * READ INTO over the whole file
           OPEN INPUT IXF
           PERFORM UNTIL WS-EOF = "Y"
               READ IXF INTO HOLD
                   AT END MOVE "Y" TO WS-EOF
               END-READ
               IF WS-EOF = "N"
                   ADD 1 TO WS-N
                   DISPLAY "INTO=" H-KEY "/" H-VAL " ST=" WS-ST
                   DISPLAY "  RECAREA=" IX-KEY "/" IX-VAL
               END-IF
           END-PERFORM
           DISPLAY "ATEND-ST=" WS-ST
           DISPLAY "COUNT=" WS-N
           CLOSE IXF
           STOP RUN.
