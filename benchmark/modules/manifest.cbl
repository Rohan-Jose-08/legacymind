      * MANIFEST - an order manifest over a GROUP OCCURS table (O3-flat,
      * docs/occurs-groups.md): one table whose rows mix X and numeric
      * leaves (sku, unit price, quantity, extension). The frontend
      * decomposes the flat group into PARALLEL PER-LEAF TABLES -
      * validated byte-for-byte on GnuCOBOL, sound because every access
      * is leaf-wise (whole-element reads/writes reject loudly). Skus and
      * prices fill at literal subscripts; quantities (tenths) arrive by
      * NUMVAL into subscripted COMPUTE targets; the loop writes each
      * row's ROUNDED extension into its table cell (read back at literal
      * subscripts for output), so each row carries a half-cent
      * obligation and the BIG tier splits on the affine total of three
      * rounded cells. Input (SYSIN, three lines): qty1, qty2, qty3.
      * Output: S1-S3, E1-E3, TOTAL, TIER. Parses only with proleap.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. MANIFEST.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-Q1-TEXT    PIC X(8).
       01  WS-Q2-TEXT    PIC X(8).
       01  WS-Q3-TEXT    PIC X(8).
       01  W-ITEM-TAB.
           05 W-ITEM OCCURS 3 TIMES.
              10 W-SKU    PIC X(4).
              10 W-PRICE  PIC 9(3)V99.
              10 W-QTY    PIC 9(3)V9.
              10 W-EXT    PIC 9(6)V99.
       01  I             PIC 9 VALUE ZERO.
       01  W-TOTAL       PIC 9(7)V99 VALUE ZERO.
       01  W-TIER        PIC X(4).
       01  W-E1-OUT      PIC 9(6).99.
       01  W-E2-OUT      PIC 9(6).99.
       01  W-E3-OUT      PIC 9(6).99.
       01  W-TOT-OUT     PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-Q1-TEXT
           ACCEPT WS-Q2-TEXT
           ACCEPT WS-Q3-TEXT
           MOVE "PLNK" TO W-SKU(1)
           MOVE "BOLT" TO W-SKU(2)
           MOVE "GEAR" TO W-SKU(3)
           MOVE 2.35 TO W-PRICE(1)
           MOVE 1.15 TO W-PRICE(2)
           MOVE 0.55 TO W-PRICE(3)
           COMPUTE W-QTY(1) = FUNCTION NUMVAL(WS-Q1-TEXT)
           COMPUTE W-QTY(2) = FUNCTION NUMVAL(WS-Q2-TEXT)
           COMPUTE W-QTY(3) = FUNCTION NUMVAL(WS-Q3-TEXT)
           PERFORM CALC-PARA VARYING I FROM 1 BY 1 UNTIL I > 3
           COMPUTE W-TOTAL = W-EXT(1) + W-EXT(2) + W-EXT(3)
           IF W-TOTAL > 100
               MOVE "BIG " TO W-TIER
           ELSE
               MOVE "STD " TO W-TIER
           END-IF
           MOVE W-EXT(1) TO W-E1-OUT
           MOVE W-EXT(2) TO W-E2-OUT
           MOVE W-EXT(3) TO W-E3-OUT
           MOVE W-TOTAL TO W-TOT-OUT
           DISPLAY "S1=" W-SKU(1)
           DISPLAY "S2=" W-SKU(2)
           DISPLAY "S3=" W-SKU(3)
           DISPLAY "E1=" W-E1-OUT
           DISPLAY "E2=" W-E2-OUT
           DISPLAY "E3=" W-E3-OUT
           DISPLAY "TOTAL=" W-TOT-OUT
           DISPLAY "TIER=" W-TIER
           STOP RUN.
       CALC-PARA.
           COMPUTE W-EXT(I) ROUNDED = W-QTY(I) * W-PRICE(I).
