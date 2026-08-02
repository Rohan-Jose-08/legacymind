      * LEDGERX - the first VSAM module: a batch report over an INDEXED
      * account file (docs/vsam.md). This is the CBACT01C shape measured
      * in AWS CardDemo - the dominant real batch idiom: OPEN INPUT, a
      * PERFORM-driven READ INTO loop with AT END / NOT AT END, CLOSE.
      * The SELECT declares FILE STATUS, so the lowering's status
      * assignments (00 on a read, 10 at end - measured) are exercised;
      * this module drives its loop from AT END rather than branching on
      * the status, which is the shape the symbolic engine supports.
      *
      * The point of the module is ORDER. Records come back in RECORD KEY
      * order, never the order they were loaded - measured against
      * GnuCOBOL (examples/probes/vsam-dynamic.cbl: written 03/01/02,
      * read back 01/02/03). FIRST= and LAST= put that ordering on the
      * KV stream as an observable, so a candidate that iterates its
      * input in seed order is caught on every unsorted case, while
      * COUNT/TOTAL/FEE stay identical - order-independent sums cannot
      * catch it.
      *
      * The harness supplies the record set as a seed on stdin; a loader
      * (harness infrastructure, never under verification) materialises
      * the indexed file before the module runs. Parses only with the
      * proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEDGERX.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ACCT-FILE ASSIGN TO "acct.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS SEQUENTIAL
               RECORD KEY IS AC-ID
               FILE STATUS IS WS-AST.
       DATA DIVISION.
       FILE SECTION.
       FD  ACCT-FILE.
       01  ACCT-REC.
           05  AC-ID      PIC X(5).
           05  AC-BAL     PIC 9(5)V99.
       WORKING-STORAGE SECTION.
       01  WS-AST         PIC XX.
       01  WS-EOF         PIC 9       VALUE 0.
       01  HOLD-REC.
           05  H-ID       PIC X(5).
           05  H-BAL      PIC 9(5)V99.
       01  WS-COUNT       PIC 9(3)    VALUE ZERO.
       01  WS-TOTAL       PIC 9(7)V99 VALUE ZERO.
       01  WS-FEE         PIC 9(5)V99 VALUE ZERO.
       01  WS-FIRST       PIC X(5)    VALUE SPACES.
       01  WS-LAST        PIC X(5)    VALUE SPACES.
       01  WS-TIER        PIC X(4).
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT ACCT-FILE
           PERFORM READ-LOOP UNTIL WS-EOF = 1
           CLOSE ACCT-FILE
           COMPUTE WS-FEE ROUNDED = WS-TOTAL * 15 / 1000
           IF WS-TOTAL > 5000.00
               MOVE "GOLD" TO WS-TIER
           ELSE
               MOVE "STD " TO WS-TIER
           END-IF
           DISPLAY "COUNT=" WS-COUNT
           DISPLAY "TOTAL=" WS-TOTAL
           DISPLAY "FEE=" WS-FEE
           DISPLAY "FIRST=" WS-FIRST
           DISPLAY "LAST=" WS-LAST
           DISPLAY "TIER=" WS-TIER
           STOP RUN.

       READ-LOOP.
           READ ACCT-FILE INTO HOLD-REC
               AT END
                   MOVE 1 TO WS-EOF
               NOT AT END
                   ADD 1 TO WS-COUNT
                   ADD H-BAL TO WS-TOTAL
                   IF WS-COUNT = 1
                       MOVE H-ID TO WS-FIRST
                   END-IF
                   MOVE H-ID TO WS-LAST
           END-READ.
