      * BATCHSUM restructured into AWS CardDemo's batch-read idiom:
      * an INLINE PERFORM UNTIL whose body PERFORMs the read paragraph
      * behind a redundant guard. Same semantics, different shape.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CDLOOP.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO "in.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  IN-FILE.
       01  IN-REC        PIC X(12).
       WORKING-STORAGE SECTION.
       01  END-OF-FILE   PIC X(01)    VALUE 'N'.
       01  WS-AMT        PIC 9(7)V99  VALUE ZERO.
       01  WS-COUNT      PIC 9(4)     VALUE ZERO.
       01  WS-TOTAL      PIC 9(7)V99  VALUE ZERO.
       01  WS-TOT-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT IN-FILE
           PERFORM UNTIL END-OF-FILE = 'Y'
               IF  END-OF-FILE = 'N'
                   PERFORM 1000-GET-NEXT
                   IF  END-OF-FILE = 'N'
                       ADD WS-AMT TO WS-TOTAL
                       ADD 1 TO WS-COUNT
                   END-IF
               END-IF
           END-PERFORM
           CLOSE IN-FILE
           MOVE WS-TOTAL TO WS-TOT-OUT
           DISPLAY "COUNT=" WS-COUNT
           DISPLAY "TOTAL=" WS-TOT-OUT
           STOP RUN.
       1000-GET-NEXT.
           READ IN-FILE
               AT END
                   MOVE 'Y' TO END-OF-FILE
               NOT AT END
                   COMPUTE WS-AMT = FUNCTION NUMVAL(IN-REC)
           END-READ.
