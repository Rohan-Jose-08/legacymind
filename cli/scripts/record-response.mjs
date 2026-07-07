// Records a model response into the replay cache from a request stub.
//
// When `legacymind migrate` misses the cache offline (or without
// credentials) it writes <key>.request.json next to the cache. This tool
// pairs that stub with a response payload (a Java source file) and writes
// the replayable <key>.json entry. Used to ship pre-recorded caches for
// air-gapped demo/CI runs.
//
// Usage:
//   node scripts/record-response.mjs <cache-dir> <key-or-prefix> <response.java> [note...]
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [cacheDir, keyArg, responsePath, ...noteParts] = process.argv.slice(2);
if (!cacheDir || !keyArg || !responsePath) {
  console.error("usage: node scripts/record-response.mjs <cache-dir> <key-or-prefix> <response.java> [note...]");
  process.exit(1);
}

const keyPrefix = keyArg.replace(/[^a-f0-9]/g, "");
const stubs = readdirSync(cacheDir).filter((f) => f.endsWith(".request.json") && f.startsWith(keyPrefix));
if (stubs.length !== 1) {
  console.error(`expected exactly one request stub matching "${keyPrefix}" in ${cacheDir}, found ${stubs.length}`);
  process.exit(1);
}

const stub = JSON.parse(readFileSync(join(cacheDir, stubs[0]), "utf8"));
const req = stub.request;
const expectedKey = createHash("sha256")
  .update(JSON.stringify([req.model, req.maxTokens, req.system, req.prompt]))
  .digest("hex");
if (expectedKey !== stub.key) {
  console.error(`request stub is corrupt: recomputed key ${expectedKey} != stored key ${stub.key}`);
  process.exit(1);
}

const java = readFileSync(responsePath, "utf8");
const entry = {
  key: stub.key,
  request: req,
  response: {
    text: "```java\n" + java + (java.endsWith("\n") ? "" : "\n") + "```\n",
    model: req.model,
    stopReason: "end_turn",
    usage: null, // recorded out-of-band; no live usage metering for this entry
    costUsd: null,
  },
  recordedAt: new Date().toISOString(),
  recordedFrom: "recorded (scripts/record-response.mjs)",
  note: noteParts.join(" ") || undefined,
};

const outPath = join(cacheDir, `${stub.key}.json`);
writeFileSync(outPath, JSON.stringify(entry, null, 2) + "\n");
console.log(`recorded ${responsePath} -> ${outPath}`);
