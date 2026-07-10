      * RETAIL - discounted order with tax on the settled amount: a
      * DOUBLE-ROUNDING chain. Input (SYSIN, one value per line): order id,
      * amount text. Output: ORDER_ID, DISC, TAX, TOTAL, TIER as KEY=VALUE.
      * The 10% discount settles ROUNDED to the nearest WHOLE DOLLAR
      * (PIC 9(7)), then 8.25% tax is computed ROUNDED to the cent ON THE
      * SETTLED amount - round2(0.0825 * round0(0.9 * amount)). Taxing the
      * unrounded discounted amount instead (a single rounding at the end)
      * differs by whole cents whenever the dollar settle moves the base,
      * and is caught. TOTAL adds the two rounded values; the TIER split at
      * 500.00 puts a branch boundary directly over the nested form.
      * Parses only with the proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. RETAIL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ORD-ID     PIC X(8).
       01  WS-AMT-TEXT   PIC X(12).
       01  WS-AMOUNT     PIC 9(7)V99  VALUE ZERO.
       01  WS-DISC-DOL   PIC 9(7)     VALUE ZERO.
       01  WS-TAX        PIC 9(7)V99  VALUE ZERO.
       01  WS-TOTAL      PIC 9(7)V99  VALUE ZERO.
       01  WS-TIER       PIC X(4).
       01  WS-TAX-OUT    PIC 9(7).99.
       01  WS-TOT-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-ORD-ID
           ACCEPT WS-AMT-TEXT
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-AMT-TEXT)
           COMPUTE WS-DISC-DOL ROUNDED = WS-AMOUNT * 90 / 100
           COMPUTE WS-TAX ROUNDED = WS-DISC-DOL * 825 / 10000
           COMPUTE WS-TOTAL = WS-DISC-DOL + WS-TAX
           IF WS-TOTAL > 500
               MOVE "HIGH" TO WS-TIER
           ELSE
               MOVE "NORM" TO WS-TIER
           END-IF
           MOVE WS-TAX TO WS-TAX-OUT
           MOVE WS-TOTAL TO WS-TOT-OUT
           DISPLAY "ORDER_ID=" WS-ORD-ID
           DISPLAY "DISC=" WS-DISC-DOL
           DISPLAY "TAX=" WS-TAX-OUT
           DISPLAY "TOTAL=" WS-TOT-OUT
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
