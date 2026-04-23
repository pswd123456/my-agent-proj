export const TYPEWRITER_FRAME_MS = 18;

const TYPEWRITER_STEP_DIVISOR = 20;

export function splitTypewriterCharacters(content: string): string[] {
  return Array.from(content);
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
