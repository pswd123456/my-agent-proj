import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ConversationBlock } from "../types.js";

const FRONTMATTER_DELIMITER = "---";
const MEMORY_FILE_LIMIT = 2_000;
const CONCLUSION_LIMIT = 1_200;
const BODY_SECTION_LIMIT = 2_000;

export interface MemoryMetadata {
  name: string;
  description: string;
  cwd: string;
  keywords: string[];
  created_at: string;
  updated_at: string;
  last_verified_at: string;
  confidence: number;
  touched_paths: string[];
  evidence_refs: string[];
  source_session_id: string;
}

export interface MemoryDocument {
  path: string;
  metadata: MemoryMetadata;
  body: string;
  reusableConclusion: string;
}

export interface MemorySearchInput {
  query: string;
  cwd?: string | null;
  keywords?: string[];
  paths?: string[];
  limit?: number;
  memoryDirectory?: string | null;
}

export interface MemorySearchMatch {
  path: string;
  metadata: MemoryMetadata;
  reusableConclusion: string;
  evidenceRefs: string[];
  score: number;
  matchedSignals: string[];
  needsDetail: boolean;
}

export interface MemoryWriteInput {
  metadata: MemoryMetadata;
  body: string;
  memoryDirectory?: string | null;
}

export function resolveMemoryDirectory(
  memoryDirectory?: string | null
): string {
  const configured = memoryDirectory?.trim() || process.env.AGENTS_MEMORY_DIR;
  if (configured && configured.trim().length > 0) {
    return path.resolve(configured);
  }

  return path.join(os.homedir(), ".agents", "memories");
}

export function formatMemoryDocument(input: {
  metadata: MemoryMetadata;
  body: string;
}): string {
  return [
    FRONTMATTER_DELIMITER,
    JSON.stringify(input.metadata, null, 2),
    FRONTMATTER_DELIMITER,
    "",
    input.body.trim(),
    ""
  ].join("\n");
}

export function parseMemoryDocument(
  filePath: string,
  content: string
): MemoryDocument | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return null;
  }

  const endIndex = normalized.indexOf(
    `\n${FRONTMATTER_DELIMITER}\n`,
    FRONTMATTER_DELIMITER.length + 1
  );
  if (endIndex < 0) {
    return null;
  }

  const metadataText = normalized.slice(
    FRONTMATTER_DELIMITER.length + 1,
    endIndex
  );
  const body = normalized
    .slice(endIndex + FRONTMATTER_DELIMITER.length + 2)
    .trim();

  try {
    const metadata = normalizeMemoryMetadata(JSON.parse(metadataText));
    if (!metadata) {
      return null;
    }

    return {
      path: filePath,
      metadata,
      body,
      reusableConclusion: extractReusableConclusion(body)
    };
  } catch {
    return null;
  }
}

export async function readMemoryDocuments(
  memoryDirectory?: string | null
): Promise<MemoryDocument[]> {
  const directory = resolveMemoryDirectory(memoryDirectory);
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const documents: MemoryDocument[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".md")).sort()) {
    if (documents.length >= MEMORY_FILE_LIMIT) {
      break;
    }
    const filePath = path.join(directory, entry);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseMemoryDocument(filePath, content);
    if (parsed) {
      documents.push(parsed);
    }
  }

  return documents;
}

export async function searchMemories(
  input: MemorySearchInput
): Promise<MemorySearchMatch[]> {
  const queryTerms = tokenize(input.query);
  const keywordTerms = [
    ...new Set((input.keywords ?? []).flatMap((item) => tokenize(item)))
  ];
  const pathTerms = [
    ...new Set((input.paths ?? []).flatMap((item) => tokenize(item)))
  ];
  const cwd = input.cwd?.trim() || null;
  const limit = normalizeLimit(input.limit);
  const documents = await readMemoryDocuments(input.memoryDirectory);

  return documents
    .map((document) =>
      scoreMemoryDocument(document, {
        queryTerms,
        keywordTerms,
        pathTerms,
        cwd
      })
    )
    .filter((match): match is MemorySearchMatch => match !== null)
    .sort((left, right) =>
      right.score === left.score
        ? right.metadata.updated_at.localeCompare(left.metadata.updated_at)
        : right.score - left.score
    )
    .slice(0, limit);
}

export async function writeMemoryDocument(
  input: MemoryWriteInput
): Promise<string> {
  const directory = resolveMemoryDirectory(input.memoryDirectory);
  await fs.mkdir(directory, { recursive: true });
  const baseName = `${input.metadata.created_at.slice(0, 10)}-${slugify(
    input.metadata.name
  )}`;
  const content = formatMemoryDocument({
    metadata: input.metadata,
    body: input.body
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${randomBytes(2).toString("hex")}`;
    const filePath = path.join(directory, `${baseName}${suffix}.md`);
    try {
      await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  const fallbackPath = path.join(
    directory,
    `${baseName}-${randomBytes(4).toString("hex")}.md`
  );
  await fs.writeFile(fallbackPath, content, { encoding: "utf8", flag: "wx" });
  return fallbackPath;
}

export function buildMemoryBody(input: {
  background: string;
  reusableConclusion: string;
  evidence: string;
  steps: string;
  outdatedNotes?: string | null;
}): string {
  return [
    "## 背景",
    truncateSection(input.background),
    "",
    "## 可复用结论",
    truncateSection(input.reusableConclusion),
    "",
    "## 关键证据",
    truncateSection(input.evidence),
    "",
    "## 执行步骤或排查路径",
    truncateSection(input.steps),
    "",
    "## 过时标注",
    truncateSection(input.outdatedNotes?.trim() || "暂无")
  ].join("\n");
}

export function collectSessionKeywords(
  messages: ConversationBlock[],
  extra: string[] = []
): string[] {
  const sourceText = [
    ...messages
      .filter((block) => block.kind === "user" || block.kind === "tool call")
      .map((block) =>
        block.kind === "tool call" ? block.toolName : block.content
      ),
    ...extra
  ].join(" ");
  const ignored = new Set([
    "this",
    "that",
    "with",
    "from",
    "have",
    "需要",
    "这个",
    "那个",
    "实现",
    "一下"
  ]);

  return [...new Set(tokenize(sourceText))]
    .filter((term) => term.length >= 3 && !ignored.has(term))
    .slice(0, 16);
}

function normalizeMemoryMetadata(value: unknown): MemoryMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = normalizeString(record.name);
  const description = normalizeString(record.description);
  const cwd = normalizeString(record.cwd);
  const createdAt = normalizeString(record.created_at);
  const updatedAt = normalizeString(record.updated_at);
  const lastVerifiedAt = normalizeString(record.last_verified_at);
  const sourceSessionId = normalizeString(record.source_session_id);
  if (
    !name ||
    !description ||
    !cwd ||
    !createdAt ||
    !updatedAt ||
    !lastVerifiedAt ||
    !sourceSessionId
  ) {
    return null;
  }

  return {
    name,
    description,
    cwd,
    keywords: normalizeStringArray(record.keywords),
    created_at: createdAt,
    updated_at: updatedAt,
    last_verified_at: lastVerifiedAt,
    confidence: normalizeConfidence(record.confidence),
    touched_paths: normalizeStringArray(record.touched_paths),
    evidence_refs: normalizeStringArray(record.evidence_refs),
    source_session_id: sourceSessionId
  };
}

function scoreMemoryDocument(
  document: MemoryDocument,
  input: {
    queryTerms: string[];
    keywordTerms: string[];
    pathTerms: string[];
    cwd: string | null;
  }
): MemorySearchMatch | null {
  const matchedSignals = new Set<string>();
  let score = 0;
  const metadataText = [
    document.metadata.name,
    document.metadata.description,
    ...document.metadata.keywords
  ]
    .join(" ")
    .toLowerCase();
  const touchedPathText = document.metadata.touched_paths
    .join(" ")
    .toLowerCase();

  for (const term of input.queryTerms) {
    if (metadataText.includes(term)) {
      score += 8;
      matchedSignals.add(`query:${term}`);
    }
  }
  for (const term of input.keywordTerms) {
    if (metadataText.includes(term)) {
      score += 10;
      matchedSignals.add(`keyword:${term}`);
    }
  }
  for (const term of input.pathTerms) {
    if (touchedPathText.includes(term)) {
      score += 12;
      matchedSignals.add(`path:${term}`);
    }
  }
  if (input.cwd) {
    const normalizedCwd = path.resolve(input.cwd);
    const memoryCwd = path.resolve(document.metadata.cwd);
    if (normalizedCwd === memoryCwd) {
      score += 16;
      matchedSignals.add("cwd:exact");
    } else if (
      normalizedCwd.startsWith(`${memoryCwd}${path.sep}`) ||
      memoryCwd.startsWith(`${normalizedCwd}${path.sep}`)
    ) {
      score += 8;
      matchedSignals.add("cwd:related");
    }
  }

  score += Math.max(0, Math.min(1, document.metadata.confidence)) * 4;
  score += freshnessBoost(document.metadata.last_verified_at);

  if (matchedSignals.size === 0 && score < 10) {
    return null;
  }

  return {
    path: document.path,
    metadata: document.metadata,
    reusableConclusion: truncateText(
      document.reusableConclusion || document.body,
      CONCLUSION_LIMIT
    ),
    evidenceRefs: document.metadata.evidence_refs,
    score: Number(score.toFixed(3)),
    matchedSignals: [...matchedSignals],
    needsDetail:
      document.metadata.confidence < 0.6 ||
      daysSince(document.metadata.last_verified_at) > 60
  };
}

function extractReusableConclusion(body: string): string {
  const match = body.match(/##\s*可复用结论\s*\n([\s\S]*?)(?=\n##\s+|$)/);
  return (match?.[1] ?? "").trim();
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function normalizeConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5;
}

function normalizeLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(10, Math.floor(value)))
    : 5;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_\-\u4e00-\u9fff/.]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "memory";
}

function freshnessBoost(lastVerifiedAt: string): number {
  const days = daysSince(lastVerifiedAt);
  if (days <= 7) {
    return 3;
  }
  if (days <= 30) {
    return 2;
  }
  if (days <= 90) {
    return 1;
  }
  return 0;
}

function daysSince(value: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (Date.now() - time) / 86_400_000);
}

function truncateSection(value: string): string {
  return truncateText(value.trim() || "暂无", BODY_SECTION_LIMIT);
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}
