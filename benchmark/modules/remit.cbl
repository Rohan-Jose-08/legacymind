      * REMIT - a remittance advice written with WRITE ... FROM: file
      * I/O stage 1 plus the FROM sugar (ISO 14.9.47), which desugars to
      * MOVE source TO record + WRITE record - validated byte-for-byte
      * against GnuCOBOL (examples/probes/writefrom.cbl). Input (SYSIN,
      * one value per line): account id, amount text. A 1.5% handling
      * charge is taken ROUNDED to the cent; the advice lists AMT=, CHG=
      * and NET= records built in a WORKING-STORAGE line and written FROM
      * it to "remit.dat"; the harness wrapper serializes the file to
      * stdout after the DISPLAY lines (ACCT_ID=, ROWS=). A candidate
      * that drops the desugared MOVE writes a stale record buffer - the
      * classic WRITE FROM migration bug - and is caught on every case.
      * Parses only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. REMIT.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT REMIT-FILE ASSIGN TO "remit.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  REMIT-FILE.
       01  REMIT-REC.
           05  RR-KEY     PIC X(4).
           05  RR-AMT     PIC 9(7).99.
       WORKING-STORAGE SECTION.
       01  WS-ACCT-ID    PIC X(8).
       01  WS-AMT-TEXT   PIC X(12).
       01  WS-LINE.
           05  WS-KEY     PIC X(4).
           05  WS-AMT     PIC 9(7).99.
       01  WS-GROSS      PIC 9(7)V99  VALUE ZERO.
       01  WS-CHARGE     PIC 9(7)V99  VALUE ZERO.
       01  WS-NET        PIC 9(7)V99  VALUE ZERO.
       01  WS-ROWS       PIC 9        VALUE ZERO.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ACCT-ID
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-GROSS = FUNCTION NUMVAL(WS-AMT-TEXT)
           COMPUTE WS-CHARGE ROUNDED = WS-GROSS * 15 / 1000
           COMPUTE WS-NET = WS-GROSS - WS-CHARGE
           OPEN OUTPUT REMIT-FILE
           MOVE "AMT=" TO WS-KEY
           MOVE WS-GROSS TO WS-AMT
           WRITE REMIT-REC FROM WS-LINE
           ADD 1 TO WS-ROWS
           MOVE "CHG=" TO WS-KEY
           MOVE WS-CHARGE TO WS-AMT
           WRITE REMIT-REC FROM WS-LINE
           ADD 1 TO WS-ROWS
           MOVE "NET=" TO WS-KEY
           MOVE WS-NET TO WS-AMT
           WRITE REMIT-REC FROM WS-LINE
           ADD 1 TO WS-ROWS
           CLOSE REMIT-FILE
           DISPLAY "ACCT_ID=" WS-ACCT-ID
           DISPLAY "ROWS=" WS-ROWS
           STOP RUN.
