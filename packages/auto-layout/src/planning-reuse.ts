import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

type Cache = WeakMap<
  SchematicDocument,
  WeakMap<SymbolResolver, Map<string, unknown>>
>;
let active: Cache | undefined;

/** Planner previews are immutable snapshots. Never retain cached observations
 * across public calls: the caller may edit its document or symbol library. */
export function reusePlanning<T>(work: () => T): T {
  const previous = active;
  active = new WeakMap();
  try {
    return work();
  } finally {
    active = previous;
  }
}

export function planningMemo<T>(
  document: SchematicDocument,
  resolver: SymbolResolver,
  key: string,
  work: () => T,
): T {
  if (!active) return work();
  let resolvers = active.get(document);
  if (!resolvers) active.set(document, (resolvers = new WeakMap()));
  let values = resolvers.get(resolver);
  if (!values) resolvers.set(resolver, (values = new Map()));
  if (values.has(key)) return values.get(key) as T;
  const value = work();
  values.set(key, value);
  return value;
}
