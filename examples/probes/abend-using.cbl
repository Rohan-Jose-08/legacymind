       IDENTIFICATION DIVISION.
       PROGRAM-ID. AB1.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  ABCODE                  PIC S9(9) BINARY.
       01  TIMING                  PIC S9(9) BINARY.
       PROCEDURE DIVISION.
           DISPLAY 'BEFORE'.
           MOVE 0 TO TIMING.
           MOVE 999 TO ABCODE.
           CALL 'CEE3ABD' USING ABCODE, TIMING.
           DISPLAY 'AFTER'.
           STOP RUN.
