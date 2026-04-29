import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_FLASH_MODEL,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_MODEL,
  createModelService
} from "../src/models/service.js";

describe("AnthropicCompatibleModelService", () => {
  test("prefers configured MiniMax as the default model and reports DeepSeek availability", () => {
    const service = createModelService({
      MINIMAX_API_KEY: "minimax-key"
    });

    expect(service.getDefaultModel()).toBe(DEFAULT_MINIMAX_MODEL);
    expect(service.isModelAvailable(DEFAULT_MINIMAX_MODEL)).toBe(true);
    expect(service.isModelAvailable(DEFAULT_DEEPSEEK_MODEL)).toBe(false);
    expect(service.listModels()).toEqual([
      expect.objectContaining({
        id: DEFAULT_MINIMAX_MODEL,
        configured: true,
        baseURL: DEFAULT_MINIMAX_BASE_URL,
        thinkingEfforts: []
      }),
      expect.objectContaining({
        id: DEFAULT_DEEPSEEK_MODEL,
        configured: false,
        thinkingEfforts: ["high", "max"]
      }),
      expect.objectContaining({
        id: DEFAULT_DEEPSEEK_FLASH_MODEL,
        configured: false,
        thinkingEfforts: ["high", "max"]
      })
    ]);
  });

  test("uses the requested global default when the provider is configured", () => {
    const service = createModelService({
      MINIMAX_API_KEY: "minimax-key",
      DEEPSEEK_API_KEY: "deepseek-key",
      DEFAULT_AGENT_MODEL: DEFAULT_DEEPSEEK_MODEL
    });

    expect(service.getDefaultModel()).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(service.assertModelAvailable(DEFAULT_DEEPSEEK_MODEL)).toBe(
      DEFAULT_DEEPSEEK_MODEL
    );
    expect(service.supportsThinking(DEFAULT_DEEPSEEK_MODEL)).toBe(true);
    expect(service.getThinkingEfforts(DEFAULT_DEEPSEEK_MODEL)).toEqual([
      "high",
      "max"
    ]);
  });

  test("throws a provider-specific error for unavailable models", () => {
    const service = createModelService({
      MINIMAX_API_KEY: "minimax-key"
    });

    expect(() => service.assertModelAvailable(DEFAULT_DEEPSEEK_MODEL)).toThrow(
      "DeepSeek V4 Pro is not configured. Set DEEPSEEK_API_KEY."
    );
    expect(() => service.assertModelAvailable("unknown-model")).toThrow(
      'Unsupported model "unknown-model"'
    );
  });
});
