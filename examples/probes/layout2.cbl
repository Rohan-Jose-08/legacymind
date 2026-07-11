       IDENTIFICATION DIVISION.
       PROGRAM-ID. LAYOUT2.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  W-RAW      PIC X(6) VALUE "001234".
       01  W-NUM REDEFINES W-RAW PIC 9(4)V99.
       01  W-OUT      PIC 9(6)V99 VALUE 0.
       01  W-SGN      PIC S9(3) VALUE -123.
       01  W-SRAW REDEFINES W-SGN PIC X(3).
       PROCEDURE DIVISION.
       MAIN-PARA.
           DISPLAY "NUM=" W-NUM.
           COMPUTE W-OUT = W-NUM * 2.
           DISPLAY "OUT=" W-OUT.
           MOVE 56.78 TO W-NUM.
           DISPLAY "RAW=[" W-RAW "]".
           DISPLAY "SRAW=[" W-SRAW "]".
           STOP RUN.
