      * PROBE (stage 90): what does GnuCOBOL actually do on a KEYED RANDOM
      * read? Everything CBTRN01C needs that the pipeline has never seen:
      * more than one file open at once, ACCESS MODE RANDOM, and
      * READ ... RECORD INTO ... KEY IS ... INVALID KEY / NOT INVALID KEY.
      *
      * HAND PREDICTIONS, written before the first run (docs/keyed-read.md):
      *   P1  keyed READ, key present   -> FILE STATUS '00', NOT INVALID KEY
      *   P2  keyed READ, key absent    -> FILE STATUS '23', INVALID KEY
      *   P3  on a MISS the INTO target is LEFT UNCHANGED (no partial copy)
      *   P4  two INDEXED files can be open simultaneously alongside a
      *       LINE SEQUENTIAL one
      *   P5  OPEN INPUT of an indexed file that exists but is EMPTY -> '00'
      *   P6  a short key is SPACE-padded to the key width before lookup,
      *       so 'A' and 'A               ' find the same record
       IDENTIFICATION DIVISION.
       PROGRAM-ID. KEYEDREAD.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT XF ASSIGN TO "XREFFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS RANDOM
               RECORD KEY IS FD-X-KEY
               FILE STATUS IS WS-XST.
           SELECT AF ASSIGN TO "ACCTFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS RANDOM
               RECORD KEY IS FD-A-KEY
               FILE STATUS IS WS-AST.
           SELECT EF ASSIGN TO "EMPTYFILE"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS RANDOM
               RECORD KEY IS FD-E-KEY
               FILE STATUS IS WS-EST.
       DATA DIVISION.
       FILE SECTION.
       FD  XF.
       01  FD-XREF-REC.
           05  FD-X-KEY       PIC X(16).
           05  FD-X-DATA      PIC X(034).
       FD  AF.
       01  FD-ACCT-REC.
           05  FD-A-KEY       PIC X(11).
           05  FD-A-DATA      PIC X(039).
       FD  EF.
       01  FD-EMPTY-REC.
           05  FD-E-KEY       PIC X(08).
           05  FD-E-DATA      PIC X(012).
       WORKING-STORAGE SECTION.
       01  WS-XST             PIC XX.
       01  WS-AST             PIC XX.
       01  WS-EST             PIC XX.
       01  W-XREF             PIC X(050) VALUE ALL 'x'.
       01  W-ACCT             PIC X(050) VALUE ALL 'a'.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT XF
           DISPLAY 'OPEN-XREF=' WS-XST
           OPEN INPUT AF
           DISPLAY 'OPEN-ACCT=' WS-AST
      *    P5: an existing but EMPTY indexed file
           OPEN INPUT EF
           DISPLAY 'OPEN-EMPTY=' WS-EST

      *    P1: key that IS present
           MOVE '4111111111111111' TO FD-X-KEY
           READ XF RECORD INTO W-XREF
               KEY IS FD-X-KEY
               INVALID KEY
                   DISPLAY 'HIT-BRANCH=INVALID'
               NOT INVALID KEY
                   DISPLAY 'HIT-BRANCH=VALID'
           END-READ
           DISPLAY 'HIT-STATUS=' WS-XST
           DISPLAY 'HIT-INTO=[' W-XREF ']'

      *    P2 + P3: key that is ABSENT. W-XREF still holds the hit record,
      *    so a partial copy on the miss path is visible.
           MOVE '9999999999999999' TO FD-X-KEY
           READ XF RECORD INTO W-XREF
               KEY IS FD-X-KEY
               INVALID KEY
                   DISPLAY 'MISS-BRANCH=INVALID'
               NOT INVALID KEY
                   DISPLAY 'MISS-BRANCH=VALID'
           END-READ
           DISPLAY 'MISS-STATUS=' WS-XST
           DISPLAY 'MISS-INTO=[' W-XREF ']'

      *    P4: the second indexed file still works after the first missed
           MOVE '00000000011' TO FD-A-KEY
           READ AF RECORD INTO W-ACCT
               KEY IS FD-A-KEY
               INVALID KEY
                   DISPLAY 'ACCT-BRANCH=INVALID'
               NOT INVALID KEY
                   DISPLAY 'ACCT-BRANCH=VALID'
           END-READ
           DISPLAY 'ACCT-STATUS=' WS-AST
           DISPLAY 'ACCT-INTO=[' W-ACCT ']'

      *    P6: short key, space-padded by the MOVE
           MOVE '4111' TO FD-X-KEY
           READ XF RECORD INTO W-XREF
               KEY IS FD-X-KEY
               INVALID KEY
                   DISPLAY 'SHORT-BRANCH=INVALID'
               NOT INVALID KEY
                   DISPLAY 'SHORT-BRANCH=VALID'
           END-READ
           DISPLAY 'SHORT-STATUS=' WS-XST

      *    P5 continued: read the empty file
           MOVE 'AAAAAAAA' TO FD-E-KEY
           READ EF RECORD INTO W-ACCT
               KEY IS FD-E-KEY
               INVALID KEY
                   DISPLAY 'EMPTY-BRANCH=INVALID'
               NOT INVALID KEY
                   DISPLAY 'EMPTY-BRANCH=VALID'
           END-READ
           DISPLAY 'EMPTY-STATUS=' WS-EST

           CLOSE XF
           CLOSE AF
           CLOSE EF
           DISPLAY 'DONE'
           GOBACK.
