/**
 * Driver-agnostic model access with a mandatory replay cache.
 *
 * Non-negotiables implemented here:
 *   - Every LLM call is cached, hashed, and replayable. The cache key is
 *     the SHA-256 of the canonical request (model, maxTokens, system,
 *     prompt), so identical requests never hit the network twice and an
 *     air-gapped machine can run entirely from a shipped cache.
 *   - Cost is a first-class metric: token usage and USD cost are recorded
 *     per call and surfaced per module.
 *   - No hidden failures: a cache miss in offline mode (or with no working
 *     credentials) writes a `<key>.request.json` stub and reports exactly
 *     what is missing, instead of guessing.
 *
 * Providers plug in behind the ModelClient interface. The Anthropic client
 * (./anthropic.ts) is loaded lazily so `parse` and `verify` never touch
 * the SDK — the verifier stays runnable with zero network-facing code.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class ModelError extends Error {}

export interface ModelRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCompletion {
  text: string;
  model: string;
  stopReason: string;
  usage: ModelUsage | null;
}

export interface ModelClient {
  readonly id: string;
  complete(req: ModelRequest): Promise<ModelCompletion>;
}

export interface CachedCompletion extends ModelCompletion {
  fromCache: boolean;
  cacheKey: string;
  costUsd: number | null;
}

/** USD per million tokens. Source: claude-api skill, cached 2026-06-24. */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-fable-5": { input: 10, output: 50 },
  // Sonnet 5 sticker price; intro $2/$10 per MTok through 2026-08-31.
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function costUsd(model: string, usage: ModelUsage | null): number | null {
  const price = PRICE_PER_MTOK[model];
  if (!price || !usage) return null;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

export function cacheKeyFor(req: ModelRequest): string {
  // Array form fixes field order; any byte change is a different key.
  const canonical = JSON.stringify([req.model, req.maxTokens, req.system, req.prompt]);
  return createHash("sha256").update(canonical).digest("hex");
}

interface CacheEntry {
  key: string;
  request: ModelRequest;
  response: {
    text: string;
    model: string;
    stopReason: string;
    usage: ModelUsage | null;
    costUsd: number | null;
  };
  recordedAt: string;
  recordedFrom: string;
  note?: string;
}

export class MissingCacheEntryError extends ModelError {
  constructor(
    public readonly cacheKey: string,
    public readonly requestStubPath: string,
    reason: string,
  ) {
    super(
      `no cached response for ${cacheKey.slice(0, 16)}… and ${reason}.\n` +
        `  The full request was written to:\n    ${requestStubPath}\n` +
        `  Record a response with:\n` +
        `    node scripts/record-response.mjs <cache-dir> ${cacheKey.slice(0, 16)}… <response.java>\n` +
        `  or re-run with credentials available (ANTHROPIC_API_KEY or an 'ant auth login' profile).`,
    );
  }
}

/**
 * Resolve a completion: replay cache first, then (unless offline) the live
 * model. A miss that cannot be served writes a request stub and throws
 * MissingCacheEntryError — loudly, with the exact key.
 */
export async function completeWithCache(
  cacheDir: string,
  req: ModelRequest,
  opts: { offline: boolean },
): Promise<CachedCompletion> {
  mkdirSync(cacheDir, { recursive: true });
  const key = cacheKeyFor(req);
  const entryPath = join(cacheDir, `${key}.json`);

  if (existsSync(entryPath)) {
    const entry = JSON.parse(readFileSync(entryPath, "utf8")) as CacheEntry;
    return {
      text: entry.response.text,
      model: entry.response.model,
      stopReason: entry.response.stopReason,
      usage: entry.response.usage,
      costUsd: 0, // replayed calls cost nothing; recorded cost lives in the entry
      fromCache: true,
      cacheKey: key,
    };
  }

  const stubPath = join(cacheDir, `${key}.request.json`);
  const writeStub = () =>
    writeFileSync(stubPath, JSON.stringify({ key, request: req }, null, 2) + "\n");

  if (opts.offline) {
    writeStub();
    throw new MissingCacheEntryError(key, stubPath, "--offline was requested");
  }

  let client: ModelClient;
  try {
    // Lazy import: parse/verify code paths never load the SDK.
    const mod = await import("./anthropic.js");
    client = mod.createAnthropicClient();
  } catch (e) {
    writeStub();
    throw new MissingCacheEntryError(key, stubPath, `the Anthropic SDK failed to load (${(e as Error).message})`);
  }

  let completion: ModelCompletion;
  try {
    completion = await client.complete(req);
  } catch (e) {
    writeStub();
    throw new MissingCacheEntryError(key, stubPath, `the live call failed (${(e as Error).message})`);
  }

  const cost = costUsd(completion.model, completion.usage);
  const entry: CacheEntry = {
    key,
    request: req,
    response: {
      text: completion.text,
      model: completion.model,
      stopReason: completion.stopReason,
      usage: completion.usage,
      costUsd: cost,
    },
    recordedAt: new Date().toISOString(),
    recordedFrom: `live api (${client.id})`,
  };
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + "\n");

  return { ...completion, costUsd: cost, fromCache: false, cacheKey: key };
}
