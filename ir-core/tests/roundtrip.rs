//! The IR core is only worth anything if it is faithful to the IR the
//! frontend actually emits — so these tests run against real committed IR
//! documents (tests/fixtures/), not hand-written toys. The fixtures are
//! chosen to span the whole IR surface: REDEFINES R1a (DUES), group
//! REDEFINES RG (LOCKER), a decomposed flat group table (MANIFEST), an
//! INDEXED BY index-name (REORDER), a LINE SEQUENTIAL output file
//! (PAYSLIP), and a multi-field input record with a byte layout (REBATE).

use std::fs;
use std::path::PathBuf;

use serde_json::Value;

fn fixtures() -> Vec<(String, String)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).expect("fixtures dir") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            out.push((name, fs::read_to_string(&path).expect("read fixture")));
        }
    }
    out.sort();
    assert!(!out.is_empty(), "no fixtures found");
    out
}

/// Every real IR document parses into the typed model.
#[test]
fn parses_every_fixture() {
    for (name, json) in fixtures() {
        let ir = ir_core::parse(&json).unwrap_or_else(|e| panic!("{name}: parse failed: {e}"));
        assert_eq!(ir.ir_version, ir_core::IR_VERSION, "{name}: irVersion");
    }
}

/// Deserialize -> serialize reproduces the document exactly. This is the
/// property that lets the Rust core own the contract without becoming a
/// lossy filter in the middle of the pipeline.
#[test]
fn round_trips_losslessly() {
    for (name, json) in fixtures() {
        let ir = ir_core::parse(&json).unwrap_or_else(|e| panic!("{name}: parse failed: {e}"));
        let reserialized = serde_json::to_string(&ir).expect("serialize");

        let before: Value = serde_json::from_str(&json).expect("original as value");
        let after: Value = serde_json::from_str(&reserialized).expect("round-tripped as value");
        assert_eq!(before, after, "{name}: round-trip changed the document");
    }
}

/// Every real IR document satisfies the invariants the types cannot state.
#[test]
fn validates_every_fixture() {
    for (name, json) in fixtures() {
        let ir = ir_core::parse(&json).unwrap_or_else(|e| panic!("{name}: parse failed: {e}"));
        if let Err(errs) = ir_core::validate(&ir) {
            panic!("{name}: validation failed:\n  {}", errs.join("\n  "));
        }
    }
}

/// The fixtures really do span the constructs claimed above — a guard so
/// this suite cannot quietly become a test of one trivial shape.
#[test]
fn fixtures_span_the_ir_surface() {
    let mut saw_redefines = false;
    let mut saw_occurs = false;
    let mut saw_occurs_group = false;
    let mut saw_index_name = false;
    let mut saw_files = false;

    fn walk(items: &[ir_core::DataItem], f: &mut impl FnMut(&ir_core::DataItem)) {
        for it in items {
            f(it);
            walk(&it.children, f);
        }
    }

    for (_, json) in fixtures() {
        let ir = ir_core::parse(&json).expect("parse");
        saw_files |= ir.files.is_some();
        walk(&ir.data_division.items, &mut |it| {
            saw_redefines |= it.redefines.is_some();
            saw_occurs |= it.occurs.is_some();
            saw_occurs_group |= it.occurs_group.is_some();
            saw_index_name |= it.index_name.is_some();
        });
    }
    assert!(saw_redefines, "no fixture exercises REDEFINES");
    assert!(saw_occurs, "no fixture exercises OCCURS");
    assert!(saw_occurs_group, "no fixture exercises a decomposed group table");
    assert!(saw_index_name, "no fixture exercises an INDEXED BY index-name");
    assert!(saw_files, "no fixture exercises a FILE SECTION");
}

/// An unknown statement kind must fail to parse, not pass through. This is
/// the property that makes the IR contract enforceable in Rust.
#[test]
fn rejects_unknown_statement_kind() {
    let (_, json) = fixtures().into_iter().next().expect("a fixture");
    let mut doc: Value = serde_json::from_str(&json).expect("as value");
    doc["procedureDivision"]["paragraphs"][0]["statements"][0]["kind"] =
        Value::String("teleport".into());
    let err = ir_core::parse(&doc.to_string()).expect_err("unknown kind must be rejected");
    assert!(
        err.to_string().contains("teleport") || err.to_string().contains("unknown variant"),
        "unexpected error: {err}"
    );
}
