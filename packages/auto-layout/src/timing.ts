import type { AutoLayoutResult } from "./types.js";

type PlanningPhase =
  | "annealer"
  | "relocation"
  | "ports"
  | "rails"
  | "gaps"
  | "drafting"
  | "finishing";

interface PlanningTiming {
  phases: Record<PlanningPhase, number>;
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
    phases: {
      annealer: 0,
      relocation: 0,
      ports: 0,
      rails: 0,
      gaps: 0,
      drafting: 0,
      finishing: 0,
    },
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
    // A nested planning pass (R150 plans twice) reports its phases to the
    // enclosing measurement too, so the outer result is not left at zero.
    if (previous) {
      for (const phase of Object.keys(timing.phases) as PlanningPhase[])
        previous.phases[phase] += timing.phases[phase];
      previous.seating += timing.seating;
      previous.readability += timing.readability;
      previous.seatingCalls += timing.seatingCalls;
    }
  }
}

export function timePhase<T>(
  phase: "seating" | "readability" | PlanningPhase,
  work: () => T,
): T {
  const start = performance.now();
  try {
    return work();
  } finally {
    if (active) {
      if (phase === "seating" || phase === "readability")
        active[phase] += performance.now() - start;
      else active.phases[phase] += performance.now() - start;
      if (phase === "seating") active.seatingCalls++;
    }
  }
}
