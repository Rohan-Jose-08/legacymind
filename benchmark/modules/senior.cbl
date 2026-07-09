      * SENIOR - senior-citizen discount via a SET flag (88-level write side).
      * Input  (SYSIN, one value per line): age, purchase amount text.
      * Output (SYSOUT): SENIOR (0/1 flag), DISCOUNT as KEY=VALUE lines.
      * WS-STATUS PIC 9 carries the 88-level condition name SENIOR (VALUE 1).
      * SET SENIOR TO TRUE - the write side of 88-levels - sets the flag when
      * age >= 65; it lowers to MOVE 1 TO WS-STATUS. IF SENIOR (the read side,
      * expanded to WS-STATUS = 1) then gates a 15% ROUNDED discount. A
      * candidate that reads the age boundary as > 65 misses the exactly-65
      * senior and is caught. Parses only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SENIOR.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-AGE-TEXT      PIC X(4).
       01  WS-AMT-TEXT      PIC X(12).
       01  WS-AGE           PIC 9(3)     VALUE ZERO.
       01  WS-AMOUNT        PIC 9(7)V99  VALUE ZERO.
       01  WS-STATUS        PIC 9        VALUE ZERO.
           88  SENIOR       VALUE 1.
       01  WS-DISCOUNT      PIC 9(7)V99  VALUE ZERO.
       01  WS-DISC-OUT      PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-AGE-TEXT
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-AGE = FUNCTION NUMVAL(WS-AGE-TEXT)
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-AMT-TEXT)
           MOVE 0 TO WS-STATUS
           IF WS-AGE >= 65
               SET SENIOR TO TRUE
           END-IF
           IF SENIOR
               COMPUTE WS-DISCOUNT ROUNDED = WS-AMOUNT * 15 / 100
           END-IF
           MOVE WS-DISCOUNT TO WS-DISC-OUT
           DISPLAY "SENIOR=" WS-STATUS
           DISPLAY "DISCOUNT=" WS-DISC-OUT
           STOP RUN.
