# The mainline — statements before the first paragraph

Most real COBOL programs write their whole top level *before* any
paragraph header, with the paragraphs below acting as subroutines:

```cobol
PROCEDURE DIVISION.
    DISPLAY 'START OF EXECUTION OF PROGRAM CBACT02C'.
    PERFORM 0000-CARDFILE-OPEN.
    PERFORM UNTIL END-OF-FILE = 'Y'
        ...
    END-PERFORM.
    PERFORM 9000-CARDFILE-CLOSE.
    GOBACK.

0000-CARDFILE-OPEN.
    ...
```

Those statements sit in the division's own scope rather than in any
`Paragraph`. Finding 4 established that a paragraphs-only walk drops them
**silently**, so they have been rejected outright ever since — correct,
but it blocked 9 of the analysable AWS CardDemo modules.

## The model

The mainline becomes a **synthetic entry paragraph**, placed first, which
the control-flow entry then names. Its name is synthesised as
`MAINLINE PARAGRAPH` — containing a space, which a COBOL word cannot, so
it can never collide with a real procedure name and no source text can
`PERFORM` it. Everything else (the paragraphs, the CFG, PERFORM
resolution) is unchanged.

## The soundness guard

In COBOL the mainline **falls through** into the first paragraph unless
it terminates. Modelling it as its own paragraph is faithful only when it
ends in `STOP RUN` or `GOBACK`; anything else is rejected rather than
approximated:

> statements before the first paragraph header do not end in STOP RUN or
> GOBACK (they would fall through into the first paragraph)

That is not hypothetical — of the 9 CardDemo modules, **7 terminate and 2
do not**, and the 2 are refused.

## Result

- `statement before the first paragraph header` blocker: **gone for 9
  modules**; 2 replaced by the honest fall-through rejection.
- Nearest realistic module `CBACT02C`: 6 blockers → **5**.
- Median across blocked modules unchanged at 17.5; VERIFIABLE still 0/31.
- Every benchmark module's IR is unchanged (none has a mainline), and the
  Rust `ir-core` gate validates the synthetic paragraph.

`CBACT02C` now needs five: `CALL`, reference modification, `REDEFINES`
group-over-elementary, inline `PERFORM`, and signed numeric record
fields.
