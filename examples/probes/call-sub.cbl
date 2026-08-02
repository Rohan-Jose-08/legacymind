       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALLSUB.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * does WORKING-STORAGE survive between calls?
       01  WS-COUNTER   PIC 9(3) VALUE 0.
       LINKAGE SECTION.
       01  LK-AREA.
           05  LK-IN    PIC 9(3).
           05  LK-OUT   PIC 9(5).
           05  LK-SEEN  PIC 9(3).
       PROCEDURE DIVISION USING LK-AREA.
       SUB-MAIN.
           ADD 1 TO WS-COUNTER
           COMPUTE LK-OUT = LK-IN * 3
           MOVE WS-COUNTER TO LK-SEEN
           GOBACK.
