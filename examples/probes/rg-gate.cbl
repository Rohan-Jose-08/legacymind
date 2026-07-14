       IDENTIFICATION DIVISION.
       PROGRAM-ID. RGNEG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * Case 1: aligned pair but a view leaf is WRITTEN (must reject).
       01  A-REC.
           05 A-ID  PIC 9(4).
           05 A-AMT PIC 9(6).
       01  A-VIEW REDEFINES A-REC.
           05 A-KEY PIC 9(4).
           05 A-DOL PIC 9(4)V99.
      * Case 2: aligned pair but the view GROUP is displayed (must reject).
       01  B-REC.
           05 B-ID  PIC 9(4).
       01  B-VIEW REDEFINES B-REC.
           05 B-KEY PIC 9(4).
       PROCEDURE DIVISION.
       MAIN-PARA.
           MOVE 12 TO A-ID.
           MOVE 3.5 TO A-DOL.
           MOVE 7 TO B-ID.
           DISPLAY "A=" A-KEY.
           DISPLAY "B=" B-VIEW.
           STOP RUN.
