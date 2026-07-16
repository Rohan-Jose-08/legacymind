//! validate-ir — the Rust IR core as a pipeline gate.
//!
//! Parses and validates one or more IR documents against the typed
//! contract (`ir_core`). Every problem in every file is enumerated —
//! never just the first — and the exit code is nonzero if any file
//! fails, so a pipeline step can consume this directly. A file that
//! does not even parse (e.g. an unknown statement kind) is reported
//! with serde's error, which names the offending variant and location.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: validate-ir <ir.json> [more.ir.json ...]");
        return ExitCode::from(2);
    }
    let mut failures = 0usize;
    for path in &args {
        let json = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("FAIL  {path}: read error: {e}");
                failures += 1;
                continue;
            }
        };
        let ir = match ir_core::parse(&json) {
            Ok(ir) => ir,
            Err(e) => {
                eprintln!("FAIL  {path}: does not parse as IR v{}: {e}", ir_core::IR_VERSION);
                failures += 1;
                continue;
            }
        };
        match ir_core::validate(&ir) {
            Ok(()) => {
                let module = ir
                    .module
                    .get("programId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                println!(
                    "ok    {path}: {module} ({} paragraphs, {} top-level items)",
                    ir.procedure_division.paragraphs.len(),
                    ir.data_division.items.len()
                );
            }
            Err(errs) => {
                eprintln!("FAIL  {path}: {} invariant violation(s):", errs.len());
                for e in &errs {
                    eprintln!("        {e}");
                }
                failures += 1;
            }
        }
    }
    if failures > 0 {
        eprintln!("validate-ir: {failures} of {} file(s) failed", args.len());
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
