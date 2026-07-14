       IDENTIFICATION DIVISION.
       PROGRAM-ID. WRFROM.
      * Ground-truth probe for stage 47: WRITE ... FROM must equal
      * MOVE ... TO record + WRITE record, byte for byte, including a
      * group source moved over a group record with an edited leaf.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT OUT-FILE ASSIGN TO "probe.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  OUT-FILE.
       01  OUT-REC.
           05  OR-KEY    PIC X(4).
           05  OR-AMT    PIC 9(7).99.
       WORKING-STORAGE SECTION.
       01  WS-LINE.
           05  WS-KEY    PIC X(4).
           05  WS-AMT    PIC 9(7).99.
       01  WS-VAL        PIC 9(7)V99 VALUE 123.45.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN OUTPUT OUT-FILE
      * Variant 1: explicit MOVE + WRITE.
           MOVE "AAA=" TO WS-KEY
           MOVE WS-VAL TO WS-AMT
           MOVE WS-LINE TO OUT-REC
           WRITE OUT-REC
      * Variant 2: WRITE ... FROM (the sugar under test).
           MOVE "BBB=" TO WS-KEY
           MOVE 6789.01 TO WS-AMT
           WRITE OUT-REC FROM WS-LINE
      * Variant 3: FROM leaves the record holding the moved bytes.
           WRITE OUT-REC
           CLOSE OUT-FILE
           STOP RUN.
