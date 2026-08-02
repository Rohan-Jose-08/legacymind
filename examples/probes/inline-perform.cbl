       IDENTIFICATION DIVISION.
       PROGRAM-ID. INLP.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-N PIC 9(3) VALUE 0.
       01  W-I PIC 9(3) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM UNTIL W-N > 10
               ADD 3 TO W-N
           END-PERFORM
           PERFORM VARYING W-I FROM 1 BY 1 UNTIL W-I > 3
               ADD 1 TO W-N
           END-PERFORM
           DISPLAY "N=" W-N
           STOP RUN.
