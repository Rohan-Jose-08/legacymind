      * PAYSLIP - a pay slip written to a LINE SEQUENTIAL output file:
      * file I/O stage 1 (SELECT/FD + OPEN OUTPUT/WRITE/CLOSE). Input
      * (SYSIN, one value per line): employee id, gross text. The program
      * DISPLAYs EMP_ID and a ROWS count to SYSOUT and WRITEs three
      * KEY=VALUE records (GRS=, TAX=, NET=) to "slip.dat"; the harness
      * wrapper serializes the file to stdout after the DISPLAY lines, so
      * the observable stream stays KV lines end to end. Tax is 11%
      * ROUNDED to the cent. A candidate that loses the last record (the
      * classic unflushed-buffer migration bug) ships a slip without the
      * NET line and is caught on every case. Parses only with the
      * proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYSLIP.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SLIP-FILE ASSIGN TO "slip.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  SLIP-FILE.
       01  SLIP-REC.
           05  REC-KEY    PIC X(4).
           05  REC-AMT    PIC 9(7).99.
       WORKING-STORAGE SECTION.
       01  WS-EMP-ID     PIC X(8).
       01  WS-GROSS-TEXT PIC X(12).
       01  WS-GROSS      PIC 9(7)V99  VALUE ZERO.
       01  WS-TAX        PIC 9(7)V99  VALUE ZERO.
       01  WS-NET        PIC 9(7)V99  VALUE ZERO.
       01  WS-ROWS       PIC 9        VALUE ZERO.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-EMP-ID
           ACCEPT WS-GROSS-TEXT
           COMPUTE WS-GROSS = FUNCTION NUMVAL(WS-GROSS-TEXT)
           COMPUTE WS-TAX ROUNDED = WS-GROSS * 11 / 100
           COMPUTE WS-NET = WS-GROSS - WS-TAX
           OPEN OUTPUT SLIP-FILE
           MOVE "GRS=" TO REC-KEY
           MOVE WS-GROSS TO REC-AMT
           WRITE SLIP-REC
           ADD 1 TO WS-ROWS
           MOVE "TAX=" TO REC-KEY
           MOVE WS-TAX TO REC-AMT
           WRITE SLIP-REC
           ADD 1 TO WS-ROWS
           MOVE "NET=" TO REC-KEY
           MOVE WS-NET TO REC-AMT
           WRITE SLIP-REC
           ADD 1 TO WS-ROWS
           CLOSE SLIP-FILE
           DISPLAY "EMP_ID=" WS-EMP-ID
           DISPLAY "ROWS=" WS-ROWS
           STOP RUN.
