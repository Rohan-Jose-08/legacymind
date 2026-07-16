//! LegacyMind IR core — the canonical typed owner of the intermediate
//! representation defined by `ir/schema.json`.
//!
//! The IR is the contract between every component: the ProLeap frontend
//! emits it, the transpiler consumes it, and all four verifier layers read
//! it. Until now that contract was enforced only by a JSON Schema and the
//! TypeScript that happened to read it. This crate makes it a *type*: an IR
//! document either deserializes into these structures or it does not, and an
//! unknown statement kind is a compile-time-closed enum, not a silent
//! passthrough.
//!
//! Design rules for this first increment:
//!
//! * **Lossless.** Deserializing and re-serializing an IR document must
//!   reproduce it exactly (compared as JSON values). Every optional field is
//!   `Option<_>` + `skip_serializing_if`, so "absent" round-trips as absent;
//!   `children` is always present in emitted IR and so is always written.
//! * **Typed where it is load-bearing.** Data items (with their decoded
//!   PICTURE) and statement *kinds* are the inputs the verifier reasons
//!   about, so they are modeled. The envelope (`module`, `controlFlow`,
//!   `provenance`, `files`) round-trips as `Value` and is the next
//!   increment's typing target — named, not silently dropped.
//! * **Statement bodies stay `Value`.** The 16 kinds have widely different
//!   shapes; the kind is validated by the enum and the body round-trips
//!   losslessly. `validate` still walks nested statement lists so a bad kind
//!   inside an IF/READ arm is caught rather than ignored.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The IR version this crate speaks. A bump is a deliberate migration.
pub const IR_VERSION: &str = "0.1.0";

/// One normalized legacy module.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ir {
    #[serde(rename = "irVersion")]
    pub ir_version: String,
    /// Emitted only for modules with a FILE SECTION.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<Value>>,
    pub module: Value,
    #[serde(rename = "dataDivision")]
    pub data_division: DataDivision,
    #[serde(rename = "procedureDivision")]
    pub procedure_division: ProcedureDivision,
    #[serde(rename = "controlFlow")]
    pub control_flow: Value,
    pub provenance: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataDivision {
    pub items: Vec<DataItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcedureDivision {
    pub paragraphs: Vec<Paragraph>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paragraph {
    pub name: String,
    pub statements: Vec<Statement>,
    /// Anything else the paragraph carries (e.g. `span`) round-trips here.
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

/// A WORKING-STORAGE / FILE SECTION data item. Every field the frontend
/// emits is modeled, so the round-trip is lossless without a catch-all.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// FILLER slices are storage-only; they carry no name the program can use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filler: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    /// The decoded PICTURE. `scale` here is load-bearing for layers A/B/C/D.
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub ty: Option<PictureType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// OCCURS n — this item is a table of n occurrences (O1/O2x), or a leaf
    /// of a decomposed flat group table (O3-flat).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurs: Option<i64>,
    /// Provenance only: this group *was* an OCCURS whose leaves were
    /// decomposed into parallel per-leaf tables (docs/occurs-groups.md).
    #[serde(rename = "occursGroup", default, skip_serializing_if = "Option::is_none")]
    pub occurs_group: Option<i64>,
    /// REDEFINES target (R1a elementary, or a per-leaf RG mapping).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redefines: Option<String>,
    /// Synthetic occurrence-number variable for an INDEXED BY index-name.
    #[serde(rename = "indexName", default, skip_serializing_if = "Option::is_none")]
    pub index_name: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span: Option<Value>,
    /// Always emitted (empty for elementary items), so never skipped.
    #[serde(default)]
    pub children: Vec<DataItem>,
}

/// A decoded PICTURE clause.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PictureType {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digits: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<i64>,
}

/// The statement kinds the IR admits. Closed: an unknown kind fails to
/// deserialize rather than passing through unmodeled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StmtKind {
    Accept,
    Close,
    Compute,
    Display,
    Exit,
    GoTo,
    Goback,
    If,
    Move,
    Open,
    Perform,
    PerformUntil,
    PerformVarying,
    Read,
    StopRun,
    Write,
}

/// One statement: a validated kind plus its kind-specific body, which
/// round-trips losslessly while the body's typing is a later increment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Statement {
    pub kind: StmtKind,
    #[serde(flatten)]
    pub body: Map<String, Value>,
}

/// Statement-body keys that hold nested statement lists.
const NESTED: [&str; 4] = ["then", "else", "atEnd", "notAtEnd"];

/// Parse an IR document. A malformed document — including an unknown
/// statement kind — is an error, never a partial parse.
pub fn parse(json: &str) -> Result<Ir, serde_json::Error> {
    serde_json::from_str(json)
}

/// Check the invariants the type system cannot express. Returns every
/// problem found, not just the first — no hidden failures.
pub fn validate(ir: &Ir) -> Result<(), Vec<String>> {
    let mut errs = Vec::new();
    if ir.ir_version != IR_VERSION {
        errs.push(format!(
            "irVersion is {:?}, expected {:?} (a bump is a deliberate migration)",
            ir.ir_version, IR_VERSION
        ));
    }
    if ir.procedure_division.paragraphs.is_empty() {
        errs.push("procedureDivision has no paragraphs".to_string());
    }
    for item in &ir.data_division.items {
        validate_item(item, &mut errs);
    }
    for para in &ir.procedure_division.paragraphs {
        for (i, st) in para.statements.iter().enumerate() {
            validate_stmt(st, &format!("{}[{}]", para.name, i), &mut errs);
        }
    }
    if errs.is_empty() {
        Ok(())
    } else {
        Err(errs)
    }
}

fn validate_item(item: &DataItem, errs: &mut Vec<String>) {
    let named = item.name.is_some();
    if !named && item.filler != Some(true) {
        errs.push("data item has neither a name nor filler=true".to_string());
    }
    // A group has children and no PICTURE; an elementary item is the reverse.
    let group = !item.children.is_empty();
    if group && item.picture.is_some() {
        errs.push(format!(
            "data item {:?} is a group but carries a PICTURE",
            item.name.as_deref().unwrap_or("?")
        ));
    }
    if let Some(t) = &item.ty {
        match t.category.as_str() {
            "numeric" | "numeric-edited" | "alphanumeric" => {}
            other => errs.push(format!(
                "data item {:?} has unknown PICTURE category {:?}",
                item.name.as_deref().unwrap_or("?"),
                other
            )),
        }
    }
    for child in &item.children {
        validate_item(child, errs);
    }
}

/// Walk a statement's nested arms so a bad kind inside an IF/READ body is
/// caught — the flattened body keeps them as `Value`, so the enum alone
/// would not see them.
fn validate_stmt(st: &Statement, where_: &str, errs: &mut Vec<String>) {
    for key in NESTED {
        let Some(arm) = st.body.get(key) else { continue };
        let Some(list) = arm.as_array() else {
            errs.push(format!("{}: {:?} arm is not an array", where_, key));
            continue;
        };
        for (i, nested) in list.iter().enumerate() {
            match serde_json::from_value::<Statement>(nested.clone()) {
                Ok(inner) => validate_stmt(&inner, &format!("{}.{}[{}]", where_, key, i), errs),
                Err(e) => errs.push(format!("{}.{}[{}]: {}", where_, key, i, e)),
            }
        }
    }
}
