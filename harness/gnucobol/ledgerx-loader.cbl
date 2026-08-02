      * HARNESS LOADER for LEDGERX - infrastructure, NEVER under
      * verification (docs/vsam.md). An INDEXED file is a binary BDB
      * artifact, so it cannot be shipped on the KV stream; instead the
      * harness receives the logical record set as a text seed on stdin
      * and materialises the file before the module runs.
      *
      * ACCESS DYNAMIC on purpose: it accepts records in ANY order, so a
      * seed can be deliberately unsorted. Under ACCESS SEQUENTIAL an
      * out-of-order WRITE returns status 21 and the record is silently
      * dropped (measured - examples/probes/vsam-basic.cbl), which would
      * quietly shrink the seeded file.
      *
      * A seed line IS the record image - the same fixed-width bytes the
      * stage-2b layout describes (AC-ID X(5) then AC-BAL 9(5)V99, 12
      * bytes), so the existing record generator and symbolic record
      * binding apply unchanged. Blank lines are ignored.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOADER.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SEEDF ASSIGN TO "seed.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-SST.
           SELECT ACCTF ASSIGN TO "acct.dat"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS AC-ID
               FILE STATUS IS WS-AST.
       DATA DIVISION.
       FILE SECTION.
       FD  SEEDF.
       01  SEED-LINE      PIC X(12).
       FD  ACCTF.
       01  ACCT-REC.
           05  AC-ID      PIC X(5).
           05  AC-BAL     PIC 9(5)V99.
       WORKING-STORAGE SECTION.
       01  WS-SST         PIC XX.
       01  WS-AST         PIC XX.
       01  WS-EOF         PIC X       VALUE "N".
       01  WS-N           PIC 9(3)    VALUE ZERO.
       PROCEDURE DIVISION.
       MAIN.
           OPEN INPUT SEEDF
           OPEN OUTPUT ACCTF
           PERFORM UNTIL WS-EOF = "Y"
               READ SEEDF
                   AT END MOVE "Y" TO WS-EOF
               END-READ
               IF WS-EOF = "N" AND SEED-LINE NOT = SPACES
      *            the seed line is the record image: one group move
                   MOVE SEED-LINE TO ACCT-REC
                   WRITE ACCT-REC
      *            Diagnostics go to SYSERR, never stdout: stdout is the
      *            KV stream both sides are compared on. A duplicate key
      *            (status 22) is dropped by the file system and the
      *            FIRST occurrence survives - measured, and the modern
      *            side must model exactly that.
                   IF WS-AST NOT = "00"
                       DISPLAY "LOADER ST=" WS-AST " KEY=" AC-ID
                           UPON SYSERR
                   END-IF
                   ADD 1 TO WS-N
               END-IF
           END-PERFORM
           CLOSE SEEDF
           CLOSE ACCTF
           STOP RUN.
