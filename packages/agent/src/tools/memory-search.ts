import { z } from "zod";

import { searchMemories, type MemoryMetadata } from "../memory/store.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";
import {
  createToolResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const memorySearchInputSchema = z.object({
  query: z.string().trim().min(1),
  cwd: z.string().trim().optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  paths: z.array(z.string().trim().min(1)).optional(),
  limit: z.number().int().positive().max(10).optional()
});

function formatDisplayText(input: {
  query: string;
  returnedCount: number;
  memoryDirectory: string | null;
}): string {
  return [
    "[memory_search] success",
    `- query: ${input.query}`,
    `- matches returned: ${input.returnedCount}`,
    ...(input.memoryDirectory
      ? [`- memory directory: ${input.memoryDirectory}`]
      : [])
  ].join("\n");
}

export function createMemorySearchTool(
  options: {
    memoryDirectory?: string | null;
  } = {}
): RuntimeTool {
  return {
    name: "memory_search",
    description: buildToolDescription({
      usageScenarios: [
        "Find a small set of reusable engineering memories relevant to the current task.",
        "Use before re-investigating a repo behavior, old trace diagnosis, repeated error text, or prior implementation decision."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "query",
          type: "string",
          required: true,
          description:
            "Current task, question, error text, or decision you want to recall."
        }),
        describeObjectProperty({
          name: "cwd",
          type: "string",
          description:
            "Current working directory. The tool weights memories from the same repo higher."
        }),
        describeObjectProperty({
          name: "keywords",
          type: "string[]",
          description:
            "Concrete signals such as command names, module names, errors, or feature names."
        }),
        describeObjectProperty({
          name: "paths",
          type: "string[]",
          description:
            "Files or directories related to this task, used to match touched_paths."
        }),
        describeObjectProperty({
          name: "limit",
          type: "number",
          description: "Maximum matches to return, capped at 10."
        })
      ],
      constraints: [
        "This scans memory metadata and short reusable conclusions only; it does not load full memory bodies.",
        "Treat results with needs_detail=true as hints that should be verified before influencing implementation.",
        "Do not use this as a substitute for checking current source code when facts may have changed."
      ],
      examples: [
        '{"query":"settings cwd not syncing to current session","cwd":"/repo","keywords":["SettingsConfigStore","workingDirectory"],"limit":3}',
        '{"query":"failed to fetch workbench bootstrap","paths":["apps/web","apps/api"],"keywords":["Next rewrite","3000/api"]}'
      ]
    }),
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Task, question, error, or decision to search for."
        },
        cwd: {
          type: "string",
          description: "Current working directory for cwd-aware ranking."
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Concrete search signals."
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Relevant files or directories."
        },
        limit: {
          type: "number",
          description: "Maximum matches to return."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(memorySearchInputSchema, input);
    },
    async execute(input, context) {
      const parsed = memorySearchInputSchema.parse(input);
      const cwd = parsed.cwd ?? context.workingDirectory;
      const matches = await searchMemories({
        query: parsed.query,
        cwd,
        keywords: parsed.keywords ?? [],
        paths: parsed.paths ?? [],
        ...(typeof parsed.limit === "number" ? { limit: parsed.limit } : {}),
        ...(typeof options.memoryDirectory !== "undefined"
          ? { memoryDirectory: options.memoryDirectory }
          : {})
      });

      return successResult(
        createToolResult({
          ok: true,
          code: "MEMORY_SEARCH_OK",
          message:
            matches.length > 0
              ? "Found relevant memory candidates."
              : "No memory candidates matched the query.",
          data: {
            query: parsed.query,
            cwd,
            returnedCount: matches.length,
            matches: matches.map((match) => ({
              path: match.path,
              metadata: toMetadataJson(match.metadata),
              reusableConclusion: match.reusableConclusion,
              evidenceRefs: match.evidenceRefs,
              score: match.score,
              matchedSignals: match.matchedSignals,
              needsDetail: match.needsDetail
            }))
          }
        }),
        formatDisplayText({
          query: parsed.query,
          returnedCount: matches.length,
          memoryDirectory: options.memoryDirectory ?? null
        })
      );
    }
  };
}

function toMetadataJson(
  metadata: MemoryMetadata
): Record<string, string | number | string[]> {
  return {
    name: metadata.name,
    description: metadata.description,
    cwd: metadata.cwd,
    keywords: metadata.keywords,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
    last_verified_at: metadata.last_verified_at,
    confidence: metadata.confidence,
    touched_paths: metadata.touched_paths,
    evidence_refs: metadata.evidence_refs,
    source_session_id: metadata.source_session_id
  };
}
