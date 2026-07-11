       IDENTIFICATION DIVISION.
       PROGRAM-ID. LAYOUT1.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO "in.dat"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  IN-FILE.
       01  IN-REC.
           05 F-ID     PIC 9(3).
           05 FILLER   PIC X(2).
           05 F-AMT    PIC 9(4)V99.
           05 F-NAME   PIC X(5).
       WORKING-STORAGE SECTION.
       01  EOF-FLAG    PIC 9 VALUE 0.
       01  W-TOT       PIC 9(6)V99 VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT IN-FILE.
           PERFORM UNTIL EOF-FLAG = 1
               READ IN-FILE
                   AT END MOVE 1 TO EOF-FLAG
                   NOT AT END
                       DISPLAY "ID=" F-ID
                       DISPLAY "AMT=" F-AMT
                       DISPLAY "NAME=[" F-NAME "]"
                       DISPLAY "REC=[" IN-REC "]"
                       COMPUTE W-TOT = W-TOT + F-AMT
               END-READ
           END-PERFORM.
           CLOSE IN-FILE.
           DISPLAY "TOT=" W-TOT.
           STOP RUN.
