       IDENTIFICATION DIVISION.
       PROGRAM-ID. IX3.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IXF ASSIGN TO "/tmp/ix3.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
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
      * write deliberately OUT of key order under ACCESS DYNAMIC
           MOVE "KEY03" TO IX-KEY
           MOVE 300 TO IX-VAL
           WRITE IX-REC
           DISPLAY "W-KEY03=" WS-ST
           MOVE "KEY01" TO IX-KEY
           MOVE 100 TO IX-VAL
           WRITE IX-REC
           DISPLAY "W-KEY01=" WS-ST
           MOVE "KEY02" TO IX-KEY
           MOVE 200 TO IX-VAL
           WRITE IX-REC
           DISPLAY "W-KEY02=" WS-ST
      * genuine duplicate key
           MOVE "KEY01" TO IX-KEY
           MOVE 999 TO IX-VAL
           WRITE IX-REC
           DISPLAY "W-DUPLICATE=" WS-ST
           CLOSE IXF
      * sequential pass: does it come back in KEY order?
           OPEN INPUT IXF
           PERFORM UNTIL WS-EOF = "Y"
               READ IXF NEXT RECORD
                   AT END MOVE "Y" TO WS-EOF
               END-READ
               IF WS-EOF = "N"
                   DISPLAY "SEQ=" IX-KEY "/" IX-VAL
               END-IF
           END-PERFORM
           CLOSE IXF
      * keyed random read
           OPEN INPUT IXF
           MOVE "KEY02" TO IX-KEY
           READ IXF
               INVALID KEY DISPLAY "KEY02-INVALID"
           END-READ
           DISPLAY "RANDOM-KEY02=" IX-VAL " ST=" WS-ST
           MOVE "ZZZ99" TO IX-KEY
           READ IXF
               INVALID KEY DISPLAY "MISSING-KEY-INVALID-ST=" WS-ST
           END-READ
           CLOSE IXF
           STOP RUN.
