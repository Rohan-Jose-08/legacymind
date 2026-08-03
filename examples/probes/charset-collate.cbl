       IDENTIFICATION DIVISION.
       PROGRAM-ID. CS5.
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       OBJECT-COMPUTER. XXX
           PROGRAM COLLATING SEQUENCE IS EB.
       SPECIAL-NAMES.
           ALPHABET EB IS EBCDIC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-A    PIC X VALUE "A".
       01  WS-0    PIC X VALUE "0".
       01  TWO-BYTES-BINARY   PIC 9(4) BINARY.
       01  TWO-BYTES-ALPHA    REDEFINES TWO-BYTES-BINARY.
           05  TWO-BYTES-LEFT   PIC X.
           05  TWO-BYTES-RIGHT  PIC X.
       PROCEDURE DIVISION.
      *    does the declared collation change STORAGE, or only compares?
           MOVE 0 TO TWO-BYTES-BINARY
           MOVE WS-A TO TWO-BYTES-RIGHT
           DISPLAY "BYTE_OF_A=" TWO-BYTES-BINARY
           MOVE 0 TO TWO-BYTES-BINARY
           MOVE WS-0 TO TWO-BYTES-RIGHT
           DISPLAY "BYTE_OF_0=" TWO-BYTES-BINARY
      *    and the literal-vs-variable inconsistency, side by side
           IF WS-A < WS-0
               DISPLAY "VAR_A_LT_0=TRUE"
           ELSE
               DISPLAY "VAR_A_LT_0=FALSE"
           END-IF
           IF WS-A < "0"
               DISPLAY "MIX_A_LT_0=TRUE"
           ELSE
               DISPLAY "MIX_A_LT_0=FALSE"
           END-IF
           STOP RUN.
