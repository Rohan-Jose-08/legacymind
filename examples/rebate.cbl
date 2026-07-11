      * REBATE - the first multi-field fixed-width batch module (file I/O
      * stage 2b, docs/memory-layout.md). Each input record packs a numeric
      * customer id, the purchase amount, and trailing padding into a fixed
      * 13-byte line; the program decodes AMOUNT by its byte offset, pays a
      * 2% rebate (ROUNDED) on purchases of 100.00 or more, and reports the
      * accumulated rebate plus the qualifying and total record counts. Run
      * through harness/gnucobol/Dockerfile.infile. The stage-2b shape: one
      * input file, a multi-field group record, one READ heading the body of
      * one top-level PERFORM UNTIL loop, field references only, no ACCEPT.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. REBATE.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO "in.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  IN-FILE.
       01  IN-REC.
           05 R-ID       PIC 9(4).
           05 R-AMOUNT   PIC 9(5)V99.
           05 FILLER     PIC X(2).
       WORKING-STORAGE SECTION.
       01  WS-EOF        PIC 9        VALUE ZERO.
       01  WS-REBATE     PIC 9(6)V99  VALUE ZERO.
       01  WS-QUAL       PIC 9(4)     VALUE ZERO.
       01  WS-RECS       PIC 9(4)     VALUE ZERO.
       01  WS-ONE-REB    PIC 9(4)V99  VALUE ZERO.
       01  WS-REB-OUT    PIC 9(6).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT IN-FILE
           PERFORM PROC-REC UNTIL WS-EOF = 1
           CLOSE IN-FILE
           MOVE WS-REBATE TO WS-REB-OUT
           DISPLAY "REBATE=" WS-REB-OUT
           DISPLAY "QUAL=" WS-QUAL
           DISPLAY "RECS=" WS-RECS
           STOP RUN.
       PROC-REC.
           READ IN-FILE
               AT END
                   MOVE 1 TO WS-EOF
               NOT AT END
                   ADD 1 TO WS-RECS
                   IF R-AMOUNT >= 100.00
                       COMPUTE WS-ONE-REB ROUNDED = R-AMOUNT * 0.02
                       ADD WS-ONE-REB TO WS-REBATE
                       ADD 1 TO WS-QUAL
                   END-IF
           END-READ.
