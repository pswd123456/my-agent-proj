export interface LineWindowRequest {
  startLine: number;
  endLine: number | null;
}

export interface LineWindowResult {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export function normalizeLineWindowRequest(input: {
  offset?: number | undefined;
  limit?: number | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
}): LineWindowRequest {
  if (typeof input.offset === "number" || typeof input.limit === "number") {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? null;
    return {
      startLine: offset + 1,
      endLine: limit === null ? null : offset + limit
    };
  }

  return {
    startLine: input.startLine ?? 1,
    endLine: input.endLine ?? null
  };
}

export function splitContentLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

export function readLineWindow(input: {
  content: string;
  startLine: number;
  endLine: number | null;
  maxCharacters: number;
}): LineWindowResult {
  const lines = splitContentLines(input.content);
  const totalLines = lines.length;
  const normalizedEndLine = input.endLine ?? totalLines;
  const selectedLines = lines.slice(input.startLine - 1, normalizedEndLine);
  const selectedContent = selectedLines.join("\n");
  const endLine = Math.min(normalizedEndLine, totalLines);

  if (selectedContent.length <= input.maxCharacters) {
    return {
      content: selectedContent,
      startLine: input.startLine,
      endLine,
      totalLines,
      truncated: false
    };
  }

  return {
    content: selectedContent.slice(0, input.maxCharacters),
    startLine: input.startLine,
    endLine,
    totalLines,
    truncated: true
  };
}
