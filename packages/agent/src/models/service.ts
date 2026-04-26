import Anthropic from "@anthropic-ai/sdk";

import { DEFAULT_SESSION_MODEL } from "@ai-app-template/domain";

import type { AnthropicCompatibleClient } from "../model.js";

export const DEFAULT_MINIMAX_MODEL = DEFAULT_SESSION_MODEL;
export const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

export const SUPPORTED_MODEL_IDS = [
  DEFAULT_MINIMAX_MODEL,
  DEFAULT_DEEPSEEK_MODEL
] as const;

export type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number];
export type ModelProviderId = "minimax" | "deepseek";

export interface ModelCatalogEntry {
  id: SupportedModelId;
  label: string;
  provider: ModelProviderId;
  description: string;
  configured: boolean;
  baseURL: string;
  supportsThinking: boolean;
  unavailableReason: string | null;
}

interface ModelDefinition {
  id: SupportedModelId;
  label: string;
  provider: ModelProviderId;
  description: string;
  supportsThinking: boolean;
}

interface ProviderRuntime {
  id: ModelProviderId;
  label: string;
  apiKeyEnv: string;
  baseURL: string;
  configured: boolean;
  client: AnthropicCompatibleClient | null;
}

const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: DEFAULT_MINIMAX_MODEL,
    label: "MiniMax 2.7",
    provider: "minimax",
    description: "当前默认模型，走 MiniMax 的 Anthropic-compatible endpoint。",
    supportsThinking: true
  },
  {
    id: DEFAULT_DEEPSEEK_MODEL,
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    description: "通过 DeepSeek 官方 Anthropic-compatible endpoint 接入。",
    supportsThinking: true
  }
];

const MODEL_DEFINITION_MAP = new Map(
  MODEL_DEFINITIONS.map((definition) => [definition.id, definition])
);

export class UnsupportedModelError extends Error {
  constructor(model: string) {
    super(
      `Unsupported model "${model}". Supported models: ${SUPPORTED_MODEL_IDS.join(", ")}.`
    );
    this.name = "UnsupportedModelError";
  }
}

export class ModelUnavailableError extends Error {
  constructor(
    readonly model: string,
    reason: string
  ) {
    super(reason);
    this.name = "ModelUnavailableError";
  }
}

function createAnthropicCompatibleClient(input: {
  apiKey: string;
  baseURL: string;
}): AnthropicCompatibleClient {
  const client = new Anthropic({
    apiKey: input.apiKey,
    baseURL: input.baseURL
  });

  return client as unknown as AnthropicCompatibleClient;
}

function resolveMiniMaxProvider(
  env: NodeJS.ProcessEnv
): ProviderRuntime {
  const apiKey =
    env.MINIMAX_API_KEY ?? env.ANTHROPIC_API_KEY ?? env.API_KEY ?? "";
  const baseURL =
    env.MINIMAX_BASE_URL ??
    env.ANTHROPIC_BASE_URL ??
    DEFAULT_MINIMAX_BASE_URL;
  const configured = apiKey.trim().length > 0;

  return {
    id: "minimax",
    label: "MiniMax",
    apiKeyEnv: "MINIMAX_API_KEY",
    baseURL,
    configured,
    client: configured
      ? createAnthropicCompatibleClient({
          apiKey,
          baseURL
        })
      : null
  };
}

function resolveDeepSeekProvider(
  env: NodeJS.ProcessEnv
): ProviderRuntime {
  const apiKey = env.DEEPSEEK_API_KEY ?? "";
  const baseURL = env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL;
  const configured = apiKey.trim().length > 0;

  return {
    id: "deepseek",
    label: "DeepSeek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseURL,
    configured,
    client: configured
      ? createAnthropicCompatibleClient({
          apiKey,
          baseURL
        })
      : null
  };
}

function resolvePreferredDefaultModel(
  env: NodeJS.ProcessEnv
): string | null {
  const value = env.DEFAULT_AGENT_MODEL ?? env.AGENT_MODEL ?? null;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export interface ModelService {
  listModels(): ModelCatalogEntry[];
  getDefaultModel(): SupportedModelId | null;
  isModelSupported(model: string): model is SupportedModelId;
  isModelAvailable(model: string): boolean;
  supportsThinking(model: string): boolean;
  assertModelAvailable(model: string): SupportedModelId;
  getClient(model: string): AnthropicCompatibleClient;
}

export class AnthropicCompatibleModelService implements ModelService {
  private readonly providers: Record<ModelProviderId, ProviderRuntime>;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    this.providers = {
      minimax: resolveMiniMaxProvider(env),
      deepseek: resolveDeepSeekProvider(env)
    };
  }

  listModels(): ModelCatalogEntry[] {
    return MODEL_DEFINITIONS.map((definition) => {
      const provider = this.providers[definition.provider];
      return {
        id: definition.id,
        label: definition.label,
        provider: definition.provider,
        description: definition.description,
        configured: provider.configured,
        baseURL: provider.baseURL,
        supportsThinking: definition.supportsThinking,
        unavailableReason: provider.configured
          ? null
          : `${definition.label} is not configured. Set ${provider.apiKeyEnv}.`
      };
    });
  }

  getDefaultModel(): SupportedModelId | null {
    const preferredModel = resolvePreferredDefaultModel(this.env);
    if (preferredModel && this.isModelAvailable(preferredModel)) {
      return preferredModel as SupportedModelId;
    }

    for (const modelId of SUPPORTED_MODEL_IDS) {
      if (this.isModelAvailable(modelId)) {
        return modelId;
      }
    }

    return null;
  }

  isModelSupported(model: string): model is SupportedModelId {
    return MODEL_DEFINITION_MAP.has(model as SupportedModelId);
  }

  isModelAvailable(model: string): boolean {
    if (!this.isModelSupported(model)) {
      return false;
    }

    const definition = MODEL_DEFINITION_MAP.get(model);
    if (!definition) {
      return false;
    }

    return this.providers[definition.provider].configured;
  }

  supportsThinking(model: string): boolean {
    if (!this.isModelSupported(model)) {
      return false;
    }

    return MODEL_DEFINITION_MAP.get(model)?.supportsThinking ?? false;
  }

  assertModelAvailable(model: string): SupportedModelId {
    const normalized = model.trim();
    if (!this.isModelSupported(normalized)) {
      throw new UnsupportedModelError(normalized);
    }

    const definition = MODEL_DEFINITION_MAP.get(normalized);
    if (!definition) {
      throw new UnsupportedModelError(normalized);
    }

    const provider = this.providers[definition.provider];
    if (!provider.configured || !provider.client) {
      throw new ModelUnavailableError(
        normalized,
        `${definition.label} is not configured. Set ${provider.apiKeyEnv}.`
      );
    }

    return normalized;
  }

  getClient(model: string): AnthropicCompatibleClient {
    const resolvedModel = this.assertModelAvailable(model);
    const definition = MODEL_DEFINITION_MAP.get(resolvedModel);
    if (!definition) {
      throw new UnsupportedModelError(resolvedModel);
    }

    const provider = this.providers[definition.provider];
    if (!provider.client) {
      throw new ModelUnavailableError(
        resolvedModel,
        `${definition.label} is not configured. Set ${provider.apiKeyEnv}.`
      );
    }

    return provider.client;
  }
}

export function createModelService(
  env: NodeJS.ProcessEnv = process.env
): AnthropicCompatibleModelService {
  return new AnthropicCompatibleModelService(env);
}
