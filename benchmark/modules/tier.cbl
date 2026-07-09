      * TIER - tiered order discount selected by EVALUATE.
      * Input  (SYSIN, one value per line): order id, order amount text.
      * Output (SYSOUT): ORDER_ID, DISCOUNT as KEY=VALUE lines.
      * EVALUATE TRUE picks the discount rate by amount band, applied
      * ROUNDED to the cent: >= 1000 -> 15%, >= 500 -> 10%, >= 100 -> 5%,
      * otherwise no discount. The EVALUATE lowers to a nested IF/ELSE
      * chain, so a candidate that reads a band boundary as a strict > (not
      * >=) misses the order that sits exactly on the boundary, and is
      * caught. Parses only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TIER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ID-TEXT    PIC X(8).
       01  WS-AMT-TEXT   PIC X(12).
       01  WS-AMOUNT     PIC 9(7)V99  VALUE ZERO.
       01  WS-DISCOUNT   PIC 9(7)V99  VALUE ZERO.
       01  WS-DISC-OUT   PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ID-TEXT
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-AMT-TEXT)
           EVALUATE TRUE
               WHEN WS-AMOUNT >= 1000
                   COMPUTE WS-DISCOUNT ROUNDED = WS-AMOUNT * 15 / 100
               WHEN WS-AMOUNT >= 500
                   COMPUTE WS-DISCOUNT ROUNDED = WS-AMOUNT * 10 / 100
               WHEN WS-AMOUNT >= 100
                   COMPUTE WS-DISCOUNT ROUNDED = WS-AMOUNT * 5 / 100
               WHEN OTHER
                   MOVE 0 TO WS-DISCOUNT
           END-EVALUATE
           MOVE WS-DISCOUNT TO WS-DISC-OUT
           DISPLAY "ORDER_ID=" WS-ID-TEXT
           DISPLAY "DISCOUNT=" WS-DISC-OUT
           STOP RUN.
