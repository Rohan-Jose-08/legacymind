/**
 * Anthropic ModelClient. Loaded lazily by model/client.ts — never imported
 * from parse/verify code paths (air-gap requirement).
 *
 * Notes tied to the current API surface (claude-api skill, 2026-06):
 *   - Default model is claude-opus-4-8. Sampling parameters (temperature,
 *     top_p, top_k) are REMOVED on Opus 4.7+ and return a 400 — which is
 *     why LegacyMind's two candidates are prompt-variant-diverse rather
 *     than the originally-specified temperature-diverse.
 *   - Adaptive thinking is the recommended mode: thinking: {type: "adaptive"}.
 *   - The zero-arg client resolves credentials from ANTHROPIC_API_KEY,
 *     ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelCompletion, ModelRequest } from "./client.js";

export function createAnthropicClient(): ModelClient {
  const client = new Anthropic();
  return {
    id: "anthropic-sdk",
    async complete(req: ModelRequest): Promise<ModelCompletion> {
      const response = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: req.prompt }],
      });

      if (response.stop_reason !== "end_turn") {
        throw new Error(
          `model stopped with stop_reason=${response.stop_reason}` +
            (response.stop_reason === "max_tokens" ? " (raise maxTokens)" : ""),
        );
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) throw new Error("model returned no text content");

      return {
        text,
        model: response.model,
        stopReason: response.stop_reason ?? "unknown",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
