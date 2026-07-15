       IDENTIFICATION DIVISION.
       PROGRAM-ID. GOLOOP.
      * Ground-truth probe for backward GO TO (docs/backward-goto.md): a
      * reducible single-back-edge loop (test-at-top, forward exit,
      * backward jump to the head) must be behaviourally identical to the
      * PERFORM UNTIL that structures the same range. Both sum 1..10.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  I   PIC 9(2) VALUE 1.
       01  K   PIC 9(2) VALUE 0.
       01  S   PIC 9(4) VALUE 0.
       01  T   PIC 9(4) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM ADD-PARA VARYING K FROM 1 BY 1 UNTIL K > 10.
       GO-LOOP.
           IF I > 10 GO TO GO-DONE.
           ADD I TO S.
           ADD 1 TO I.
           GO TO GO-LOOP.
       GO-DONE.
           DISPLAY "S=" S.
           DISPLAY "T=" T.
           STOP RUN.
       ADD-PARA.
           ADD K TO T.
