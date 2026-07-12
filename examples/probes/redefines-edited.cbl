       IDENTIFICATION DIVISION.
       PROGRAM-ID. REDEDIT.
      * Ground-truth probe for stage 43 (docs/redefines-edited.md):
      * numeric-edited REDEFINES views and group-over-group redefines.
      * Every DISPLAY brackets its field so the exact bytes and width show.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * --- A: edited byte width and formatting rules (no redefine) ---
       01  E1         PIC -9(9).9(9).
       01  E2         PIC ZZ,ZZ9.99.
       01  E3         PIC $$$,$$9.99.
       01  E4         PIC 9(5).99CR.
       01  E5         PIC +9(5).99.
      * --- B: edited TARGET, X view reads the formatted bytes ---
       01  T          PIC -9(9).9(9).
       01  TX REDEFINES T PIC X(20).
      * --- C: edited VIEW read-only over a numeric base (no MOVE in) ---
       01  B1         PIC 9(4)V99 VALUE 0150.25.
       01  BV REDEFINES B1 PIC ZZ9.99.
      * --- D: group over group (two partitions of one byte range) ---
       01  G1.
           05 G1A     PIC 9(3).
           05 G1B     PIC 9(4)V99.
       01  G2 REDEFINES G1.
           05 G2A     PIC 9(4).
           05 G2B     PIC 9(5).
      * --- E: de-edit (edited field as a sending field into numeric) ---
       01  N1         PIC S9(9)V9(9).
       PROCEDURE DIVISION.
       MAIN-PARA.
      * A: widths and rules
           MOVE 123.45 TO E1.
           DISPLAY "A-E1-POS=[" E1 "]".
           MOVE -7.5 TO E1.
           DISPLAY "A-E1-NEG=[" E1 "]".
           MOVE 12345.67 TO E2.
           DISPLAY "A-E2=[" E2 "]".
           MOVE 42.5 TO E3.
           DISPLAY "A-E3=[" E3 "]".
           MOVE 0 TO E3.
           DISPLAY "A-E3-ZERO=[" E3 "]".
           MOVE -88.25 TO E4.
           DISPLAY "A-E4-NEG=[" E4 "]".
           MOVE 88.25 TO E4.
           DISPLAY "A-E4-POS=[" E4 "]".
           MOVE -1.5 TO E5.
           DISPLAY "A-E5-NEG=[" E5 "]".
      * B: edited target read through X redefine == direct display
           MOVE 123.45 TO T.
           DISPLAY "B-T =[" T "]".
           DISPLAY "B-TX=[" TX "]".
           MOVE -7.5 TO T.
           DISPLAY "B-T-NEG =[" T "]".
           DISPLAY "B-TX-NEG=[" TX "]".
           MOVE ZERO TO T.
           DISPLAY "B-T-ZERO=[" T "]".
      * C: edited view over numeric base, no MOVE into the view
           DISPLAY "C-BV=[" BV "]".
      * D: group over group
           MOVE 123 TO G1A.
           MOVE 4567.89 TO G1B.
           DISPLAY "D-G1=[" G1 "] G2A=[" G2A "] G2B=[" G2B "]".
      * E: de-edit edited -> numeric
           MOVE -123.45 TO E1.
           MOVE E1 TO N1.
           DISPLAY "E-N1=[" N1 "]".
           STOP RUN.
