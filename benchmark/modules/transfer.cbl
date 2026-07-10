      * TRANSFER - funds transfer with a fee, between two account records
      * whose fields share the same leaf name (BAL), referenced with the
      * OF/IN qualification this stage lowers. Input (SYSIN, one value per
      * line): transfer id, amount text. Output: XFER_ID, STATUS, SRC_BAL,
      * DST_BAL as KEY=VALUE lines.
      * A 1.25% fee is computed ROUNDED to the cent; when amount + fee
      * exceeds the source balance (1000.00) the transfer is DECLINED and
      * both balances print unchanged, otherwise it is APPROVED and the new
      * balances print. The duplicated BAL leaves force qualification
      * everywhere - a candidate that reads the WRONG record's balance
      * (source instead of destination) credits the transfer onto 1000.00
      * instead of 250.00 and is caught on every approved case. Parses only
      * with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TRANSFER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-XFER-ID    PIC X(8).
       01  WS-AMT-TEXT   PIC X(12).
       01  WS-AMOUNT     PIC 9(7)V99  VALUE ZERO.
       01  WS-FEE        PIC 9(7)V99  VALUE ZERO.
       01  SRC-ACCT.
           05  BAL       PIC 9(7)V99  VALUE 1000.00.
       01  DST-ACCT.
           05  BAL       PIC 9(7)V99  VALUE 250.00.
       01  WS-SRC-NEW    PIC 9(7)V99  VALUE ZERO.
       01  WS-DST-NEW    PIC 9(7)V99  VALUE ZERO.
       01  WS-STATUS     PIC X(3).
       01  WS-SRC-OUT    PIC 9(7).99.
       01  WS-DST-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-XFER-ID
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-AMT-TEXT)
           COMPUTE WS-FEE ROUNDED = WS-AMOUNT * 1.25 / 100
           IF WS-AMOUNT + WS-FEE > BAL OF SRC-ACCT
               MOVE "DEC" TO WS-STATUS
               MOVE BAL OF SRC-ACCT TO WS-SRC-OUT
               MOVE BAL OF DST-ACCT TO WS-DST-OUT
           ELSE
               MOVE "APR" TO WS-STATUS
               COMPUTE WS-SRC-NEW = BAL OF SRC-ACCT - WS-AMOUNT - WS-FEE
               COMPUTE WS-DST-NEW = BAL IN DST-ACCT + WS-AMOUNT
               MOVE WS-SRC-NEW TO WS-SRC-OUT
               MOVE WS-DST-NEW TO WS-DST-OUT
           END-IF
           DISPLAY "XFER_ID=" WS-XFER-ID
           DISPLAY "STATUS=" WS-STATUS
           DISPLAY "SRC_BAL=" WS-SRC-OUT
           DISPLAY "DST_BAL=" WS-DST-OUT
           STOP RUN.
