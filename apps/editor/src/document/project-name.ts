export const DEFAULT_UNTITLED_PROJECT_NAME = "Untitled";

/**
 * Returns the first unused Untitled project name ("Untitled", "Untitled 2",
 * "Untitled 3", ...) given a collection of existing project names.
 */
export function nextUntitledProjectName(
  existingNames: Iterable<string> = [],
): string {
  const taken = new Set<string>();
  for (const raw of existingNames) {
    const normalized = raw.trim().replace(/\s+/gu, " ").toLowerCase();
    if (normalized) taken.add(normalized);
  }
  if (!taken.has(DEFAULT_UNTITLED_PROJECT_NAME.toLowerCase())) {
    return DEFAULT_UNTITLED_PROJECT_NAME;
  }
  let index = 2;
  while (taken.has(`${DEFAULT_UNTITLED_PROJECT_NAME} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${DEFAULT_UNTITLED_PROJECT_NAME} ${index}`;
}
