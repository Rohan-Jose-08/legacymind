       IDENTIFICATION DIVISION.
       PROGRAM-ID. P3.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WD PIC 9(4).
       01  WP PIC 9(4) COMP-3.
       01  ZD PIC S9(3).
       01  ZP PIC S9(3) COMP-3.
       01  RAW-VIEW.
           05 ZP2 PIC S9(3) COMP-3.
       01  RAW-R REDEFINES RAW-VIEW.
           05 RB PIC X(2).
       01  I PIC 9(4).
       PROCEDURE DIVISION.
       MAIN.
           MOVE 9999 TO WD WP
           ADD 1 TO WD
           ADD 1 TO WP
           DISPLAY "WRAP-D=" WD
           DISPLAY "WRAP-P=" WP
           MOVE -5 TO ZD ZP
           ADD 5 TO ZD
           ADD 5 TO ZP
           DISPLAY "ZERO-D=" ZD
           DISPLAY "ZERO-P=" ZP
           IF ZP = 0 DISPLAY "ZP-IS-ZERO" END-IF
           MOVE -5 TO ZP2
           ADD 5 TO ZP2
           MOVE 0 TO I
           INSPECT RB TALLYING I FOR ALL X"0C"
           DISPLAY "ZEROSIGN-C-COUNT=" I
           MOVE 0 TO I
           INSPECT RB TALLYING I FOR ALL X"0D"
           DISPLAY "ZEROSIGN-D-COUNT=" I
           STOP RUN.
