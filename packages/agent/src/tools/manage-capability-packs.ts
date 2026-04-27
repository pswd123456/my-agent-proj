import { z } from "zod";

import {
  CAPABILITY_PACK_OPTIONS,
  normalizeCapabilityPacks,
  type DomainJsonValue
} from "@ai-app-template/domain";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const capabilityPackNameSchema = z.enum(CAPABILITY_PACK_OPTIONS);

const listSchema = z
  .object({
    action: z.literal("list")
  })
  .strict();

const enableSchema = z
  .object({
    action: z.literal("enable"),
    pack_name: capabilityPackNameSchema
  })
  .strict();

const disableSchema = z
  .object({
    action: z.literal("disable"),
    pack_name: capabilityPackNameSchema
  })
  .strict();

const schema = z.discriminatedUnion("action", [
  listSchema,
  enableSchema,
  disableSchema
]);

type CapabilityPackAction = z.infer<typeof schema>["action"];

interface CapabilityPackStatus {
  readonly [key: string]: DomainJsonValue;
  packName: (typeof CAPABILITY_PACK_OPTIONS)[number];
  enabled: boolean;
}

function buildPackStatuses(enabledCapabilityPacks: readonly string[]): CapabilityPackStatus[] {
  const enabled = new Set(enabledCapabilityPacks);
  return [...CAPABILITY_PACK_OPTIONS].map((packName) => ({
    packName,
    enabled: enabled.has(packName)
  }));
}

function formatEnabledPackList(enabledCapabilityPacks: readonly string[]): string {
  return enabledCapabilityPacks.length > 0
    ? enabledCapabilityPacks.join(", ")
    : "none";
}

function formatPackStatuses(statuses: CapabilityPackStatus[]): string[] {
  return statuses.map(
    (status) => `- ${status.packName}: ${status.enabled ? "enabled" : "disabled"}`
  );
}

function buildResultData(input: {
  action: CapabilityPackAction;
  enabledCapabilityPacks: readonly string[];
  changedPackName?: string | null;
  changed?: boolean;
}): DomainJsonValue {
  const enabledCapabilityPacks = normalizeCapabilityPacks(
    input.enabledCapabilityPacks
  );
  const packStatuses = buildPackStatuses(enabledCapabilityPacks);
  return {
    action: input.action,
    availableCapabilityPacks: [...CAPABILITY_PACK_OPTIONS],
    enabledCapabilityPacks,
    packStatuses,
    effectiveFromNextRun: input.action !== "list",
    ...(typeof input.changedPackName === "string"
      ? { changedPackName: input.changedPackName }
      : {}),
    ...(typeof input.changed === "boolean" ? { changed: input.changed } : {})
  };
}

function formatDisplayText(input: {
  action: CapabilityPackAction;
  enabledCapabilityPacks: readonly string[];
  changedPackName?: string | null;
  changed?: boolean;
}): string {
  const enabledCapabilityPacks = normalizeCapabilityPacks(
    input.enabledCapabilityPacks
  );
  const packStatuses = buildPackStatuses(enabledCapabilityPacks);
  const lines = [
    `[manage_capability_packs] success`,
    `- action: ${input.action}`
  ];

  if (input.action === "list") {
    lines.push(
      `- available: ${[...CAPABILITY_PACK_OPTIONS].join(", ") || "none"}`
    );
  } else {
    lines.push(
      `- pack: ${input.changedPackName ?? "unknown"}${
        input.changed === false ? " (unchanged)" : ""
      }`
    );
    lines.push(`- effective: next run`);
  }

  lines.push(`- enabled: ${formatEnabledPackList(enabledCapabilityPacks)}`);
  lines.push(...formatPackStatuses(packStatuses));

  return lines.join("\n");
}

export function createManageCapabilityPacksTool(): RuntimeTool {
  return {
    name: "manage_capability_packs",
    description:
      "List, enable, or disable the session capability packs. Enable and disable update the current session state and take effect on the next run.",
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "list" }
          },
          required: ["action"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "enable" },
            pack_name: { enum: [...CAPABILITY_PACK_OPTIONS] }
          },
          required: ["action", "pack_name"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "disable" },
            pack_name: { enum: [...CAPABILITY_PACK_OPTIONS] }
          },
          required: ["action", "pack_name"],
          additionalProperties: false
        }
      ]
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "input",
          issue: issue.message
        }));
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Tool input validation failed.",
            validationErrors: issues
          }),
          `[manage_capability_packs] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const session = await context.sessionManager.getSession(context.sessionId);
      if (!session) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "SESSION_NOT_FOUND",
            message: "Session not found."
          }),
          "[manage_capability_packs] failed\n- session not found"
        );
      }

      const currentEnabledCapabilityPacks = normalizeCapabilityPacks(
        session.context.enabledCapabilityPacks
      );

      if (parsed.data.action === "list") {
        const data = buildResultData({
          action: parsed.data.action,
          enabledCapabilityPacks: currentEnabledCapabilityPacks
        });

        return successResult(
          createToolResult({
            ok: true,
            code: "CAPABILITY_PACKS_LISTED",
            message: "Read the current session capability pack state.",
            data
          }),
          formatDisplayText({
            action: parsed.data.action,
            enabledCapabilityPacks: currentEnabledCapabilityPacks
          })
        );
      }

      const packName = parsed.data.pack_name;
      const nextEnabledCapabilityPacks =
        parsed.data.action === "enable"
          ? [...new Set([...currentEnabledCapabilityPacks, packName])]
          : currentEnabledCapabilityPacks.filter((value) => value !== packName);
      const changed =
        nextEnabledCapabilityPacks.length !== currentEnabledCapabilityPacks.length ||
        nextEnabledCapabilityPacks.some(
          (value, index) => value !== currentEnabledCapabilityPacks[index]
        );

      if (changed) {
        await context.sessionManager.updateContext(context.sessionId, {
          enabledCapabilityPacks: nextEnabledCapabilityPacks
        });
      }

      const data = buildResultData({
        action: parsed.data.action,
        enabledCapabilityPacks: nextEnabledCapabilityPacks,
        changedPackName: packName,
        changed
      });

      return successResult(
        createToolResult({
          ok: true,
          code: changed
            ? parsed.data.action === "enable"
              ? "CAPABILITY_PACK_ENABLED"
              : "CAPABILITY_PACK_DISABLED"
            : parsed.data.action === "enable"
              ? "CAPABILITY_PACK_ALREADY_ENABLED"
              : "CAPABILITY_PACK_ALREADY_DISABLED",
          message: changed
            ? `Updated session capability pack "${packName}". The change takes effect on the next run.`
            : `Session capability pack "${packName}" is already ${
                parsed.data.action === "enable" ? "enabled" : "disabled"
              }. The current session state is unchanged.`,
          data
        }),
        formatDisplayText({
          action: parsed.data.action,
          enabledCapabilityPacks: nextEnabledCapabilityPacks,
          changedPackName: packName,
          changed
        })
      );
    }
  };
}
