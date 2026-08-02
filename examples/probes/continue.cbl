       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONTP.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-N PIC 9(3) VALUE 0.
       PROCEDURE DIVISION.
       MAIN.
           CONTINUE
           ADD 1 TO W-N
           IF W-N = 1
               CONTINUE
           ELSE
               ADD 100 TO W-N
           END-IF
           CONTINUE
           ADD 1 TO W-N
           DISPLAY "N=" W-N
           STOP RUN.
