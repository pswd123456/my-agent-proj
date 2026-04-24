export const TYPEWRITER_FRAME_MS = 18;

const TYPEWRITER_STEP_DIVISOR = 20;

interface TypewriterResetInput {
  animate: boolean;
  itemChanged: boolean;
  animationStarted: boolean;
  totalLength: number;
  previousTotalLength: number;
  currentVisibleLength: number;
}

interface AssistantTextRenderModeInput {
  animate: boolean;
  streaming: boolean;
  totalLength: number;
  visibleLength: number;
}

export function splitTypewriterCharacters(content: string): string[] {
  return Array.from(content);
}

export function getTypewriterVisibleLengthOnChange(
  input: TypewriterResetInput
): number {
  const {
    animate,
    itemChanged,
    animationStarted,
    totalLength,
    previousTotalLength,
    currentVisibleLength
  } = input;

  if (!animate) {
    return totalLength;
  }

  if (itemChanged || animationStarted || totalLength < previousTotalLength) {
    return 0;
  }

  return Math.max(0, Math.min(currentVisibleLength, totalLength));
}

export function getAssistantTextRenderMode(
  input: AssistantTextRenderModeInput
): "plaintext" | "markdown" {
  const { animate, streaming, totalLength, visibleLength } = input;

  if (streaming) {
    return "plaintext";
  }

  if (!animate) {
    return "markdown";
  }

  const boundedVisibleLength = Math.max(
    0,
    Math.min(visibleLength, totalLength)
  );
  return boundedVisibleLength < totalLength ? "plaintext" : "markdown";
}

export function getNextTypewriterLength(
  currentLength: number,
  totalLength: number
): number {
  if (totalLength <= 0) {
    return 0;
  }

  const boundedCurrent = Math.max(0, Math.min(currentLength, totalLength));
  if (boundedCurrent >= totalLength) {
    return totalLength;
  }

  const remaining = totalLength - boundedCurrent;
  const step = Math.max(1, Math.ceil(remaining / TYPEWRITER_STEP_DIVISOR));

  return Math.min(totalLength, boundedCurrent + step);
}
