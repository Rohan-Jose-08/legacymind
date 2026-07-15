      * TARIFF - freight charges over an ALPHANUMERIC code table (OCCURS
      * O2x, docs/occurs.md): a PIC X(3) zone-code table and a numeric
      * rate table, both filled at literal subscripts - the shape the
      * corpus sweep measured as the real remainder of the subscripted-
      * MOVE head. Layer C carries the X cells as text it never solves
      * over (exactly like X scalars); the three per-zone charges are
      * ROUNDED to the cent, so each carries a half-cent obligation over
      * the weight input, and the BULK tier splits on the affine total.
      * Input (SYSIN, one line): weight text. Output: C1-C3 (zone codes),
      * F1-F3 (charges), TOTAL, TIER as KEY=VALUE. Parses only with the
      * proleap engine.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TARIFF.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-WGT-TEXT   PIC X(10).
       01  WS-WEIGHT     PIC 9(5)V99  VALUE ZERO.
       01  WS-ZONE-CODE  PIC X(3) OCCURS 3.
       01  WS-RATE       PIC 9(3)V99 OCCURS 3.
       01  WS-CHG1       PIC 9(6)V99  VALUE ZERO.
       01  WS-CHG2       PIC 9(6)V99  VALUE ZERO.
       01  WS-CHG3       PIC 9(6)V99  VALUE ZERO.
       01  WS-TOTAL      PIC 9(7)V99  VALUE ZERO.
       01  WS-TIER       PIC X(4).
       01  WS-F1-OUT     PIC 9(6).99.
       01  WS-F2-OUT     PIC 9(6).99.
       01  WS-F3-OUT     PIC 9(6).99.
       01  WS-TOT-OUT    PIC 9(7).99.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-WGT-TEXT
           COMPUTE WS-WEIGHT = FUNCTION NUMVAL(WS-WGT-TEXT)
           MOVE "AIR" TO WS-ZONE-CODE(1)
           MOVE "SEA" TO WS-ZONE-CODE(2)
           MOVE "ROA" TO WS-ZONE-CODE(3)
           MOVE 1.25 TO WS-RATE(1)
           MOVE 0.85 TO WS-RATE(2)
           MOVE 0.45 TO WS-RATE(3)
           COMPUTE WS-CHG1 ROUNDED = WS-WEIGHT * WS-RATE(1)
           COMPUTE WS-CHG2 ROUNDED = WS-WEIGHT * WS-RATE(2)
           COMPUTE WS-CHG3 ROUNDED = WS-WEIGHT * WS-RATE(3)
           COMPUTE WS-TOTAL = WS-CHG1 + WS-CHG2 + WS-CHG3
           IF WS-TOTAL > 50
               MOVE "BULK" TO WS-TIER
           ELSE
               MOVE "STD " TO WS-TIER
           END-IF
           MOVE WS-CHG1 TO WS-F1-OUT
           MOVE WS-CHG2 TO WS-F2-OUT
           MOVE WS-CHG3 TO WS-F3-OUT
           MOVE WS-TOTAL TO WS-TOT-OUT
           DISPLAY "C1=" WS-ZONE-CODE(1)
           DISPLAY "C2=" WS-ZONE-CODE(2)
           DISPLAY "C3=" WS-ZONE-CODE(3)
           DISPLAY "F1=" WS-F1-OUT
           DISPLAY "F2=" WS-F2-OUT
           DISPLAY "F3=" WS-F3-OUT
           DISPLAY "TOTAL=" WS-TOT-OUT
           DISPLAY "TIER=" WS-TIER
           STOP RUN.
