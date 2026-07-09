      * SHIPPING - shipping cost with reject and cap dispatch via GO TO.
      * Input  (SYSIN, one value per line): package id, weight text (kg).
      * Output (SYSOUT): PKG_ID, STATUS (and COST unless rejected).
      * The guard-and-dispatch idiom, stage-2 GO TO: two FORWARD top-level
      * jumps to two DIFFERENT paragraphs. MAIN-PARA rejects a zero weight
      * with GO TO REJECT-PARA (skipping all costing); CALC-PARA prices at
      * 4.75/kg ROUNDED to the cent and jumps with GO TO CAPPED-PARA when
      * the cost exceeds the 200.00 cap (skipping the standard print).
      * Each print paragraph ends with STOP RUN, so fall-through never
      * bleeds between them. No PERFORM anywhere: control is pure
      * fall-through plus forward jumps, the shape the verifier eliminates
      * into branch-embedded continuations. A candidate that drops the
      * zero-weight guard prices the empty package and is caught. Parses
      * only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SHIPPING.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-PKG-ID     PIC X(8).
       01  WS-WGT-TEXT   PIC X(12).
       01  WS-WEIGHT     PIC 9(5)V99  VALUE ZERO.
       01  WS-COST       PIC 9(7)V99  VALUE ZERO.
       01  WS-STATUS     PIC X(3).
       01  WS-COST-OUT   PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-PKG-ID
           ACCEPT WS-WGT-TEXT
           COMPUTE WS-WEIGHT = FUNCTION NUMVAL(WS-WGT-TEXT)
           IF WS-WEIGHT = 0
               GO TO REJECT-PARA.
       CALC-PARA.
           COMPUTE WS-COST ROUNDED = WS-WEIGHT * 4.75
           IF WS-COST > 200
               GO TO CAPPED-PARA.
       PRINT-STD-PARA.
           MOVE "STD" TO WS-STATUS
           MOVE WS-COST TO WS-COST-OUT
           DISPLAY "PKG_ID=" WS-PKG-ID
           DISPLAY "STATUS=" WS-STATUS
           DISPLAY "COST=" WS-COST-OUT
           STOP RUN.
       CAPPED-PARA.
           MOVE 200 TO WS-COST
           MOVE "CAP" TO WS-STATUS
           MOVE WS-COST TO WS-COST-OUT
           DISPLAY "PKG_ID=" WS-PKG-ID
           DISPLAY "STATUS=" WS-STATUS
           DISPLAY "COST=" WS-COST-OUT
           STOP RUN.
       REJECT-PARA.
           MOVE "REJ" TO WS-STATUS
           DISPLAY "PKG_ID=" WS-PKG-ID
           DISPLAY "STATUS=" WS-STATUS
           STOP RUN.
