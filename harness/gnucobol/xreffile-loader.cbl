      * HARNESS LOADER for the AWS CardDemo XREFFILE (docs/vsam.md) —
      * infrastructure, NEVER under verification. Same contract as
      * cardfile-loader.cbl: the logical record set arrives as a text seed
      * on stdin and this materialises the INDEXED file before the module
      * under test runs. ACCESS DYNAMIC so the seed may be unsorted.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOADER.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SEEDF ASSIGN TO "seed.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-SST.
           SELECT XREFF ASSIGN TO "XREFFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS FD-XREF-CARD-NUM
               FILE STATUS IS WS-AST.
       DATA DIVISION.
       FILE SECTION.
       FD  SEEDF.
       01  SEED-LINE      PIC X(50).
       FD  XREFF.
       01  FD-XREFFILE-REC.
           05  FD-XREF-CARD-NUM  PIC X(16).
           05  FD-XREF-DATA      PIC X(34).
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
           OPEN OUTPUT XREFF
           IF WS-AST NOT = '00'
               DISPLAY 'LOADER: XREFFILE OPEN ' WS-AST
               STOP RUN
           END-IF
           PERFORM UNTIL WS-EOF = 'Y'
               READ SEEDF
                   AT END
                       MOVE 'Y' TO WS-EOF
                   NOT AT END
                       IF SEED-LINE NOT = SPACES
                           MOVE SEED-LINE TO FD-XREFFILE-REC
                           WRITE FD-XREFFILE-REC
                           IF WS-AST NOT = '00'
                               DISPLAY 'LOADER: WRITE ' WS-AST
                               STOP RUN
                           END-IF
                       END-IF
               END-READ
           END-PERFORM
           CLOSE SEEDF
           CLOSE XREFF
           STOP RUN.
