      * HARNESS LOADER for the AWS CardDemo CARDFILE (docs/vsam.md) -
      * infrastructure, NEVER under verification. An INDEXED file is a
      * binary BDB artifact, so it cannot be shipped on the KV stream;
      * the harness receives the logical record set as a text seed on
      * stdin and materialises the file before the module runs.
      *
      * ACCESS DYNAMIC on purpose: it accepts records in ANY order, so a
      * seed can be deliberately unsorted and the module still has to
      * read in KEY order. Under ACCESS SEQUENTIAL an out-of-order WRITE
      * returns status 21 and the record is silently dropped (measured,
      * examples/probes/vsam-basic.cbl).
      *
      * A seed line IS the record image: the 150 fixed-width bytes the
      * stage-2b layout describes for CVACT02Y (CARD-NUM X(16) then the
      * rest), so the record generator and symbolic record binding apply
      * unchanged. Blank lines are ignored.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOADER.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SEEDF ASSIGN TO "seed.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-SST.
           SELECT CARDF ASSIGN TO "CARDFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS FD-CARD-NUM
               FILE STATUS IS WS-AST.
       DATA DIVISION.
       FILE SECTION.
       FD  SEEDF.
       01  SEED-LINE      PIC X(150).
       FD  CARDF.
       01  FD-CARDFILE-REC.
           05  FD-CARD-NUM   PIC X(16).
           05  FD-CARD-DATA  PIC X(134).
       WORKING-STORAGE SECTION.
       01  WS-SST         PIC XX.
       01  WS-AST         PIC XX.
       01  WS-EOF         PIC X VALUE 'N'.
       PROCEDURE DIVISION.
       LOAD-PARA.
           OPEN INPUT SEEDF
           IF WS-SST NOT = '00'
               DISPLAY 'LOADER: SEED OPEN ' WS-SST
               STOP RUN
           END-IF
           OPEN OUTPUT CARDF
           IF WS-AST NOT = '00'
               DISPLAY 'LOADER: CARDFILE OPEN ' WS-AST
               STOP RUN
           END-IF
           PERFORM UNTIL WS-EOF = 'Y'
               READ SEEDF
                   AT END
                       MOVE 'Y' TO WS-EOF
                   NOT AT END
                       IF SEED-LINE NOT = SPACES
                           MOVE SEED-LINE TO FD-CARDFILE-REC
                           WRITE FD-CARDFILE-REC
                           IF WS-AST NOT = '00'
                               DISPLAY 'LOADER: WRITE ' WS-AST
                               STOP RUN
                           END-IF
                       END-IF
               END-READ
           END-PERFORM
           CLOSE SEEDF
           CLOSE CARDF
           STOP RUN.
