const TOOL_RESULT_CONTEXT_LIMIT = 4_000;
const TOOL_RESULT_CONTEXT_HEAD = 2_600;
const TOOL_RESULT_CONTEXT_TAIL = 900;

export function compactToolResultForContext(content: string): string {
  if (content.length <= TOOL_RESULT_CONTEXT_LIMIT) {
    return content;
  }

  const omittedCharacters = Math.max(
    0,
    content.length - TOOL_RESULT_CONTEXT_HEAD - TOOL_RESULT_CONTEXT_TAIL
  );

  return [
    content.slice(0, TOOL_RESULT_CONTEXT_HEAD),
    `[Tool result compacted for model context; omitted ${omittedCharacters} chars. Full output remains available in trace.]`,
    content.slice(-TOOL_RESULT_CONTEXT_TAIL)
  ].join("\n");
}
