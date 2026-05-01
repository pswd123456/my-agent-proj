export type ComposerCommandKind = "slash" | "file" | "skill";

export interface ComposerCommandTokenMatch {
  kind: ComposerCommandKind;
  trigger: "/" | "@" | "#";
  query: string;
  tokenStart: number;
  tokenEnd: number;
}

export interface ComposerSlashCommand {
  id: "plan";
  label: "/plan";
  description: string;
}

export const COMPOSER_SLASH_COMMANDS: ComposerSlashCommand[] = [
  {
    id: "plan",
    label: "/plan",
    description: "启用当前会话的 Plan Mode"
  }
];

function isWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function toCommandKind(
  trigger: string
): ComposerCommandTokenMatch["kind"] | null {
  switch (trigger) {
    case "/":
      return "slash";
    case "@":
      return "file";
    case "#":
      return "skill";
    default:
      return null;
  }
}

export function getActiveComposerCommandToken(input: {
  value: string;
  selectionStart: number | null | undefined;
  selectionEnd: number | null | undefined;
}): ComposerCommandTokenMatch | null {
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  if (selectionStart !== selectionEnd) {
    return null;
  }

  let tokenStart = selectionStart;
  while (tokenStart > 0 && !isWhitespace(input.value[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }

  const trigger = input.value[tokenStart] ?? "";
  const kind = toCommandKind(trigger);
  if (!kind) {
    return null;
  }

  if (tokenStart > 0 && !isWhitespace(input.value[tokenStart - 1] ?? "")) {
    return null;
  }

  let tokenEnd = selectionStart;
  while (
    tokenEnd < input.value.length &&
    !isWhitespace(input.value[tokenEnd] ?? "")
  ) {
    tokenEnd += 1;
  }

  return {
    kind,
    trigger: trigger as "/" | "@" | "#",
    query: input.value.slice(tokenStart + 1, selectionStart),
    tokenStart,
    tokenEnd
  };
}

export function replaceComposerCommandToken(input: {
  value: string;
  token: ComposerCommandTokenMatch;
  replacement: string;
}): { value: string; nextSelection: number } {
  const prefix = input.value.slice(0, input.token.tokenStart);
  const suffix = input.value.slice(input.token.tokenEnd);
  const normalizedReplacement = input.replacement.trim();
  const needsTrailingSpace =
    normalizedReplacement.length > 0 &&
    (suffix.length === 0 || !isWhitespace(suffix[0] ?? ""));
  const inserted = `${normalizedReplacement}${needsTrailingSpace ? " " : ""}`;
  const nextValue = `${prefix}${inserted}${suffix}`;

  return {
    value: nextValue,
    nextSelection: prefix.length + inserted.length
  };
}

export function filterComposerSlashCommands(
  query: string
): ComposerSlashCommand[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return COMPOSER_SLASH_COMMANDS;
  }

  return COMPOSER_SLASH_COMMANDS.filter((command) =>
    command.label.slice(1).toLowerCase().includes(normalizedQuery)
  );
}

export function getNextComposerSuggestionIndex(input: {
  currentIndex: number;
  itemCount: number;
  direction: "up" | "down";
}): number {
  if (input.itemCount <= 0) {
    return 0;
  }

  if (input.direction === "down") {
    return (input.currentIndex + 1) % input.itemCount;
  }

  return (input.currentIndex - 1 + input.itemCount) % input.itemCount;
}

export function getComposerSuggestionRefreshIndex(input: {
  currentIndex: number;
  previousItems: ReadonlyArray<{ key: string }>;
  nextItems: ReadonlyArray<{ key: string }>;
}): number {
  if (input.nextItems.length === 0) {
    return 0;
  }

  const previousActiveKey = input.previousItems[input.currentIndex]?.key;
  if (previousActiveKey) {
    const nextActiveIndex = input.nextItems.findIndex(
      (item) => item.key === previousActiveKey
    );
    if (nextActiveIndex >= 0) {
      return nextActiveIndex;
    }
  }

  return Math.min(input.currentIndex, input.nextItems.length - 1);
}
