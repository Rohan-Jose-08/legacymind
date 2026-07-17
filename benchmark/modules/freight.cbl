      * FREIGHT - packed decimal (COMP-3) meets the file boundary: the
      * first module whose data division carries USAGE COMP-3 (value
      * semantics measured identical to DISPLAY - docs/comp3.md) and
      * whose output record stores packed bytes. The harness wrapper
      * serializes the record file as one FILEHEX= hex line, so layers
      * A/B verify the packed encoding BYTE-FOR-BYTE on every case -
      * a strictly stronger contract than the numeric-tolerance KV
      * compare text records get. Input (SYSIN, one value per line):
      * shipment id, weight text (ACCEPT into a packed item is gated;
      * the verified idiom is ACCEPT into PIC X + FUNCTION NUMVAL).
      * charge = weight * 0.245 ROUNDED to the cent, BULK tier above
      * 150.00 - the half-cent tie and the tier boundary are layer C's
      * obligations, identical to the DISPLAY twin's by construction
      * (the IRs differ only in the usage attribute). Candidate B
      * encodes the SIGNED charge with the unsigned F sign nibble -
      * every DISPLAY key identical, one nibble wrong in the file -
      * the packed-sign migration bug that only byte-level
      * verification can catch. Parses only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. FREIGHT.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT FREIGHT-FILE ASSIGN TO "freight.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  FREIGHT-FILE.
       01  FREIGHT-REC.
           05  FR-TAG     PIC X(4).
           05  FR-WEIGHT  PIC 9(4)V9 COMP-3.
           05  FR-CHARGE  PIC S9(5)V99 COMP-3.
       WORKING-STORAGE SECTION.
       01  WS-SHIP-ID    PIC X(8).
       01  WS-WT-TEXT    PIC X(10).
       01  WS-WEIGHT     PIC 9(4)V9    COMP-3.
       01  WS-RATE       PIC 9V999     COMP-3 VALUE 0.245.
       01  WS-CHARGE     PIC S9(5)V99  COMP-3.
       01  WS-TIER       PIC X(4).
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-SHIP-ID
           ACCEPT WS-WT-TEXT
           COMPUTE WS-WEIGHT = FUNCTION NUMVAL(WS-WT-TEXT)
           COMPUTE WS-CHARGE ROUNDED = WS-WEIGHT * WS-RATE
           IF WS-CHARGE > 150.00
               MOVE "BULK" TO WS-TIER
           ELSE
               MOVE "STD " TO WS-TIER
           END-IF
           OPEN OUTPUT FREIGHT-FILE
           MOVE "FRT=" TO FR-TAG
           MOVE WS-WEIGHT TO FR-WEIGHT
           MOVE WS-CHARGE TO FR-CHARGE
           WRITE FREIGHT-REC
           CLOSE FREIGHT-FILE
           DISPLAY "SHIP_ID=" WS-SHIP-ID
           DISPLAY "CHARGE=" WS-CHARGE
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
