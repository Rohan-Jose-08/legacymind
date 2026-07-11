      * BATCHSUM - the batch archetype, used as the record-protocol
      * design's ground-truth probe (docs/record-protocol.md) and as the
      * first file-READING benchmark module: READ a LINE SEQUENTIAL input
      * file to end-of-file, accumulate, report. Run through
      * harness/gnucobol/Dockerfile.infile, whose wrapper turns the
      * case's stdin into the input file's records. Outputs COUNT and
      * TOTAL as KV lines. The canonical stage-2a shape: one input file,
      * a single elementary-field record, one READ site heading the body
      * of one top-level PERFORM UNTIL loop, no ACCEPT.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. BATCHSUM.
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
       01  WS-EOF        PIC 9        VALUE ZERO.
       01  WS-AMT        PIC 9(7)V99  VALUE ZERO.
       01  WS-COUNT      PIC 9(4)     VALUE ZERO.
       01  WS-TOTAL      PIC 9(7)V99  VALUE ZERO.
       01  WS-TOT-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT IN-FILE
           PERFORM READ-PARA UNTIL WS-EOF = 1
           CLOSE IN-FILE
           MOVE WS-TOTAL TO WS-TOT-OUT
           DISPLAY "COUNT=" WS-COUNT
           DISPLAY "TOTAL=" WS-TOT-OUT
           STOP RUN.
       READ-PARA.
           READ IN-FILE
               AT END
                   MOVE 1 TO WS-EOF
               NOT AT END
                   COMPUTE WS-AMT = FUNCTION NUMVAL(IN-REC)
                   ADD WS-AMT TO WS-TOTAL
                   ADD 1 TO WS-COUNT
           END-READ.
