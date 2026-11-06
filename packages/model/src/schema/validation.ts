import type { z } from "zod";

/** Shared strict-schema validation primitive for ID-addressable collections. */
export function reportDuplicateIds(
  entries: ReadonlyArray<{ id: string }>,
  path: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ID: ${entry.id}`,
        path: [path, index, "id"],
      });
    }
    seen.add(entry.id);
  }
}
