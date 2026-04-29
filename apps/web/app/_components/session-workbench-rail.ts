export const SESSION_RAIL_COLLAPSE_MEDIA_QUERY = "(max-width: 1023px)";

export function resolveSessionRailCollapsedState(
  storedValue: string | null,
  mediaMatches: boolean
): boolean {
  if (mediaMatches) {
    return true;
  }

  if (storedValue === "true") {
    return true;
  }

  if (storedValue === "false") {
    return false;
  }

  return mediaMatches;
}
