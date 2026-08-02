       IDENTIFICATION DIVISION.
       PROGRAM-ID. CMP1.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * binary vs its DISPLAY twin, same PICTURE
       01  B4   PIC S9(4) COMP.
       01  D4   PIC S9(4).
       01  B9   PIC S9(9) COMP.
       01  D9   PIC S9(9).
       01  BU4  PIC 9(4) COMP.
       01  B92  PIC S9(9)V99 COMP.
       01  D92  PIC S9(9)V99.
      * byte widths
       01  W-GRP.
           05  G4   PIC S9(4) COMP.
           05  G8   PIC S9(8) COMP.
           05  G9   PIC S9(9) COMP.
           05  G11  PIC S9(11) COMP.
           05  G18  PIC S9(18) COMP.
       01  W-RED REDEFINES W-GRP PIC X(30).
       PROCEDURE DIVISION.
       MAIN.
      * ---- the soundness question: overflow past the PICTURE
           MOVE 9999 TO B4 D4
           ADD 1 TO B4
           ADD 1 TO D4
           DISPLAY "OVF-COMP=" B4
           DISPLAY "OVF-DISP=" D4
           IF B4 = D4 DISPLAY "OVF-SAME" ELSE DISPLAY "OVF-DIFFERENT"
           END-IF
      * ---- can a COMP field hold beyond its decimal capacity?
           MOVE 30000 TO B4
           DISPLAY "BIG-INTO-S9(4)COMP=" B4
      * ---- unsigned binary overflow
           MOVE 9999 TO BU4
           ADD 1 TO BU4
           DISPLAY "OVF-UNSIGNED=" BU4
      * ---- negative values
           MOVE -1234 TO B4 D4
           DISPLAY "NEG-COMP=" B4
           DISPLAY "NEG-DISP=" D4
      * ---- scaled binary
           MOVE 12345.67 TO B92 D92
           COMPUTE B92 = B92 * 3
           COMPUTE D92 = D92 * 3
           DISPLAY "SCALED-COMP=" B92
           DISPLAY "SCALED-DISP=" D92
      * ---- division rounding parity
           MOVE 100 TO B9 D9
           COMPUTE B9 ROUNDED = B9 / 3
           COMPUTE D9 ROUNDED = D9 / 3
           DISPLAY "DIV-COMP=" B9 " DIV-DISP=" D9
      * ---- byte widths (offsets tell the story)
           MOVE ALL "0" TO W-RED
           MOVE 1 TO G4
           MOVE 1 TO G8
           MOVE 1 TO G9
           MOVE 1 TO G11
           MOVE 1 TO G18
           DISPLAY "GROUP-LEN=" LENGTH OF W-GRP
           STOP RUN.
