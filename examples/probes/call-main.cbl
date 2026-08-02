       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALLMAIN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  ARG-AREA.
           05  A-IN     PIC 9(3).
           05  A-OUT    PIC 9(5) VALUE 0.
           05  A-SEEN   PIC 9(3) VALUE 0.
       PROCEDURE DIVISION.
       MAIN.
           MOVE 5 TO A-IN
           CALL "CALLSUB" USING ARG-AREA
           DISPLAY "CALL1-OUT=" A-OUT " SEEN=" A-SEEN
           MOVE 7 TO A-IN
           CALL "CALLSUB" USING ARG-AREA
           DISPLAY "CALL2-OUT=" A-OUT " SEEN=" A-SEEN
           MOVE 9 TO A-IN
           CALL "CALLSUB" USING ARG-AREA
           DISPLAY "CALL3-OUT=" A-OUT " SEEN=" A-SEEN
           STOP RUN.
