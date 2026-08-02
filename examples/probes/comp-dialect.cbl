       IDENTIFICATION DIVISION.
       PROGRAM-ID. CMP2.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  B4   PIC S9(4) COMP.
       01  D4   PIC S9(4).
       01  RES  PIC X(12).
       PROCEDURE DIVISION.
       MAIN.
      * Does the DISPLAYED value agree with the COMPARED value?
           MOVE 9999 TO B4
           ADD 1 TO B4
           DISPLAY "DISPLAYED=" B4
           IF B4 = 0
               MOVE "EQ-ZERO" TO RES
           ELSE
               MOVE "NOT-ZERO" TO RES
           END-IF
           DISPLAY "COMPARES-AS=" RES
           IF B4 > 9999
               DISPLAY "GT-9999=YES"
           ELSE
               DISPLAY "GT-9999=NO"
           END-IF
      * and does it survive a MOVE to a DISPLAY field?
           MOVE B4 TO D4
           DISPLAY "MOVED-TO-DISPLAY=" D4
           STOP RUN.
