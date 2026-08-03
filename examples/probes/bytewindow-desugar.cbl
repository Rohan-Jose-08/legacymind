       IDENTIFICATION DIVISION.
       PROGRAM-ID. BW3.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  IO-STATUS.
           05  IO-STAT1            PIC X.
           05  IO-STAT2            PIC X.
       01  IO-STATUS-04.
           05  IO-STATUS-0401      PIC 9   VALUE 0.
           05  IO-STATUS-0403      PIC 999 VALUE 0.
       01  WS-ORD                  PIC 9(5) VALUE 0.
       PROCEDURE DIVISION.
           ACCEPT IO-STATUS
      *    DESUGARED: no REDEFINES, no reference modification.
      *    The byte window becomes arithmetic on the character code.
           IF  IO-STATUS NOT NUMERIC
           OR  IO-STAT1 = '9'
               COMPUTE WS-ORD = FUNCTION ORD(IO-STAT1) - 1
               COMPUTE IO-STATUS-0401 = FUNCTION MOD(WS-ORD, 10)
               COMPUTE IO-STATUS-0403 = FUNCTION ORD(IO-STAT2) - 1
               DISPLAY 'STATUS=' IO-STATUS-04
           ELSE
               MOVE ZERO TO IO-STATUS-0401
               COMPUTE IO-STATUS-0403 = FUNCTION NUMVAL(IO-STATUS)
               DISPLAY 'STATUS=' IO-STATUS-04
           END-IF
           STOP RUN.
