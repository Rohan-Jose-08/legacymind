       IDENTIFICATION DIVISION.
       PROGRAM-ID. P2.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  AD PIC S9(5)V99.
       01  AP PIC S9(5)V99 COMP-3.
       01  BD PIC S9(5)V99 VALUE 3.
       01  BP PIC S9(5)V99 COMP-3 VALUE 3.
       01  RD-X PIC S9(5)V99.
       01  RP-X PIC S9(5)V99 COMP-3.
       01  TD PIC 9(3)V99.
       01  TP PIC 9(3)V99 COMP-3.
       PROCEDURE DIVISION.
       MAIN.
           MOVE 12345.67 TO AD AP
           COMPUTE RD-X ROUNDED = AD / BD
           COMPUTE RP-X ROUNDED = AP / BP
           DISPLAY "RD=" RD-X
           DISPLAY "RP=" RP-X
           IF RD-X = RP-X DISPLAY "DIV-EQ" ELSE DISPLAY "DIV-NE"
           END-IF
           MOVE 123456.789 TO TD
           MOVE 123456.789 TO TP
           DISPLAY "TD=" TD
           DISPLAY "TP=" TP
           IF TD = TP DISPLAY "TRUNC-EQ" ELSE DISPLAY "TRUNC-NE"
           END-IF
           COMPUTE TD = 999 * 999
               ON SIZE ERROR DISPLAY "SIZE-D"
           END-COMPUTE
           COMPUTE TP = 999 * 999
               ON SIZE ERROR DISPLAY "SIZE-P"
           END-COMPUTE
           MOVE -123 TO AD AP
           DISPLAY "ND=" AD
           DISPLAY "NP=" AP
           MOVE -42.5 TO TD TP
           DISPLAY "UD=" TD
           DISPLAY "UP=" TP
           STOP RUN.
