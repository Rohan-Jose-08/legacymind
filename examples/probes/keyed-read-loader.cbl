      * PROBE LOADER (stage 90) - infrastructure, NEVER under verification.
      *
      * The existing loaders materialise ONE indexed file. CBTRN01C opens
      * six, so the probe needs to know that several can be built in one
      * run and coexist. Seed format is a multiplexed text stream, one
      * record per line, prefixed by a file tag:
      *
      *     X|4111111111111111<34 bytes>
      *     A|00000000011<39 bytes>
      *
      * EMPTYFILE is created with NO records on purpose (P5): an indexed
      * file that exists and is empty is a different case from one that
      * does not exist, and CBTRN01C opens three files it never reads.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOADER.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SEEDF ASSIGN TO "seed.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-SST.
           SELECT XF ASSIGN TO "XREFFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS FD-X-KEY
               FILE STATUS IS WS-XST.
           SELECT AF ASSIGN TO "ACCTFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS FD-A-KEY
               FILE STATUS IS WS-AST.
           SELECT EF ASSIGN TO "EMPTYFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS FD-E-KEY
               FILE STATUS IS WS-EST.
       DATA DIVISION.
       FILE SECTION.
       FD  SEEDF.
       01  SEED-LINE      PIC X(200).
       FD  XF.
       01  FD-XREF-REC.
           05  FD-X-KEY   PIC X(16).
           05  FD-X-DATA  PIC X(034).
       FD  AF.
       01  FD-ACCT-REC.
           05  FD-A-KEY   PIC X(11).
           05  FD-A-DATA  PIC X(039).
       FD  EF.
       01  FD-EMPTY-REC.
           05  FD-E-KEY   PIC X(08).
           05  FD-E-DATA  PIC X(012).
       WORKING-STORAGE SECTION.
       01  WS-SST         PIC XX.
       01  WS-XST         PIC XX.
       01  WS-AST         PIC XX.
       01  WS-EST         PIC XX.
       01  WS-EOF         PIC X VALUE 'N'.
       01  WS-TAG         PIC X.
       01  WS-BODY        PIC X(198).
       PROCEDURE DIVISION.
       LOAD-PARA.
           OPEN INPUT SEEDF
           IF WS-SST NOT = '00'
               DISPLAY 'LOADER: SEED OPEN ' WS-SST
               STOP RUN
           END-IF
           OPEN OUTPUT XF
           IF WS-XST NOT = '00'
               DISPLAY 'LOADER: XREF OPEN ' WS-XST
               STOP RUN
           END-IF
           OPEN OUTPUT AF
           IF WS-AST NOT = '00'
               DISPLAY 'LOADER: ACCT OPEN ' WS-AST
               STOP RUN
           END-IF
           OPEN OUTPUT EF
           IF WS-EST NOT = '00'
               DISPLAY 'LOADER: EMPTY OPEN ' WS-EST
               STOP RUN
           END-IF
           PERFORM UNTIL WS-EOF = 'Y'
               READ SEEDF
                   AT END
                       MOVE 'Y' TO WS-EOF
                   NOT AT END
                       IF SEED-LINE NOT = SPACES
                           MOVE SEED-LINE(1:1) TO WS-TAG
                           MOVE SEED-LINE(3:198) TO WS-BODY
                           IF WS-TAG = 'X'
                               MOVE WS-BODY TO FD-XREF-REC
                               WRITE FD-XREF-REC
                               IF WS-XST NOT = '00'
                                   DISPLAY 'LOADER: XREF WRITE ' WS-XST
                               END-IF
                           END-IF
                           IF WS-TAG = 'A'
                               MOVE WS-BODY TO FD-ACCT-REC
                               WRITE FD-ACCT-REC
                               IF WS-AST NOT = '00'
                                   DISPLAY 'LOADER: ACCT WRITE ' WS-AST
                               END-IF
                           END-IF
                       END-IF
               END-READ
           END-PERFORM
           CLOSE SEEDF
           CLOSE XF
           CLOSE AF
           CLOSE EF
           GOBACK.
