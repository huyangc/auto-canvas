import type { AutoLayoutResult } from "./types.js";

interface PlanningTiming {
  milliseconds: number;
  seating: number;
  readability: number;
  seatingCalls: number;
}
let active: PlanningTiming | undefined;
const measurements = new WeakMap<AutoLayoutResult, PlanningTiming>();

/** @internal Evaluation-only timings; never influence deterministic output. */
export function planningTiming(result: AutoLayoutResult) {
  return measurements.get(result);
}

export function timePlanning(plan: () => AutoLayoutResult): AutoLayoutResult {
  const previous = active;
  const timing = {
    milliseconds: 0,
    seating: 0,
    readability: 0,
    seatingCalls: 0,
  };
  active = timing;
  const start = performance.now();
  try {
    const result = plan();
    timing.milliseconds = performance.now() - start;
    measurements.set(result, timing);
    return result;
  } finally {
    active = previous;
  }
}

export function timePhase<T>(
  phase: "seating" | "readability",
  work: () => T,
): T {
  const start = performance.now();
  try {
    return work();
  } finally {
    if (active) {
      active[phase] += performance.now() - start;
      if (phase === "seating") active.seatingCalls++;
    }
  }
}
