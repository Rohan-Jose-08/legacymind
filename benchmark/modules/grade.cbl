      * GRADE - pass/fail with a completion bonus for one student.
      * Input  (SYSIN, one value per line): student id, score (0-100).
      * Output (SYSOUT): STUDENT_ID, PASS, BONUS as KEY=VALUE lines.
      * Rules: a score of 60 or more passes (WS-PASS-FLAG := 1); the
      * PASSING 88-level condition name reads that flag. A passing
      * student earns a bonus of score * 2.50% ROUNDED to the cent; a
      * failing student earns nothing.
      * Deliberately uses an 88-level condition name (PASSING) so the
      * module parses only with the proleap engine and exercises the
      * condition-name lowering end-to-end.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. GRADE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN.
           05  WS-STUDENT-ID    PIC X(8).
           05  WS-SCORE-TEXT    PIC X(6).
       01  WS-WORK.
           05  WS-SCORE         PIC 9(3)     VALUE ZERO.
           05  WS-PASS-FLAG     PIC 9        VALUE ZERO.
               88  PASSING      VALUE 1.
           05  WS-BONUS-RATE    PIC 9V99     VALUE 2.50.
           05  WS-BONUS         PIC 9(5)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-BONUS-OUT     PIC 9(5).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-STUDENT-ID
           ACCEPT WS-SCORE-TEXT
           COMPUTE WS-SCORE = FUNCTION NUMVAL(WS-SCORE-TEXT)
           IF WS-SCORE >= 60
               MOVE 1 TO WS-PASS-FLAG
           ELSE
               MOVE 0 TO WS-PASS-FLAG
           END-IF
           IF PASSING
               COMPUTE WS-BONUS ROUNDED = WS-SCORE * WS-BONUS-RATE / 100
           ELSE
               MOVE 0 TO WS-BONUS
           END-IF
           PERFORM PRINT-PARA
           STOP RUN.
       PRINT-PARA.
           MOVE WS-BONUS TO WS-BONUS-OUT
           DISPLAY "STUDENT_ID=" WS-STUDENT-ID
           DISPLAY "PASS=" WS-PASS-FLAG
           DISPLAY "BONUS=" WS-BONUS-OUT.
