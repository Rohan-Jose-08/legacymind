      * DISCOUNT - order pricing with a tiered volume discount.
      * Input  (SYSIN, one value per line): order id, quantity,
      *        unit price.
      * Output (SYSOUT): ORDER_ID, GROSS, DISCOUNT, NET as KEY=VALUE.
      * Rules: gross = quantity * unit price; orders of 100 units or
      * more get the bulk discount rate (10%), smaller orders the
      * standard rate (2%); discounts are ROUNDED; net = gross minus
      * discount.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DISCOUNT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN.
           05  WS-ORDER-ID         PIC X(8).
           05  WS-QTY-TEXT         PIC X(8).
           05  WS-PRICE-TEXT       PIC X(10).
       01  WS-WORK.
           05  WS-QTY              PIC 9(5)     VALUE ZERO.
           05  WS-UNIT-PRICE       PIC 9(5)V99  VALUE ZERO.
           05  WS-GROSS            PIC 9(8)V99  VALUE ZERO.
           05  WS-BULK-RATE        PIC V9(3)    VALUE .100.
           05  WS-STD-RATE         PIC V9(3)    VALUE .020.
           05  WS-DISCOUNT         PIC 9(8)V99  VALUE ZERO.
           05  WS-NET              PIC 9(8)V99  VALUE ZERO.
       01  WS-OUT.
           05  WS-GROSS-OUT        PIC 9(8).99.
           05  WS-DISCOUNT-OUT     PIC 9(8).99.
           05  WS-NET-OUT          PIC 9(8).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ORDER-ID
           ACCEPT WS-QTY-TEXT
           ACCEPT WS-PRICE-TEXT
           COMPUTE WS-QTY = FUNCTION NUMVAL(WS-QTY-TEXT)
           COMPUTE WS-UNIT-PRICE = FUNCTION NUMVAL(WS-PRICE-TEXT)
           PERFORM CALC-DISCOUNT
           PERFORM PRINT-RESULT
           STOP RUN.
       CALC-DISCOUNT.
           COMPUTE WS-GROSS = WS-QTY * WS-UNIT-PRICE
           IF WS-QTY >= 100
               COMPUTE WS-DISCOUNT ROUNDED = WS-GROSS * WS-BULK-RATE
           ELSE
               COMPUTE WS-DISCOUNT ROUNDED = WS-GROSS * WS-STD-RATE
           END-IF
           COMPUTE WS-NET = WS-GROSS - WS-DISCOUNT.
       PRINT-RESULT.
           MOVE WS-GROSS TO WS-GROSS-OUT
           MOVE WS-DISCOUNT TO WS-DISCOUNT-OUT
           MOVE WS-NET TO WS-NET-OUT
           DISPLAY "ORDER_ID=" WS-ORDER-ID
           DISPLAY "GROSS=" WS-GROSS-OUT
           DISPLAY "DISCOUNT=" WS-DISCOUNT-OUT
           DISPLAY "NET=" WS-NET-OUT.
