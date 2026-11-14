/** Small drawings include their ports and rail markers. Retain their complete
 * portfolio through 30 instances; above that size, bound expensive finishing
 * trials separately from the annealer. Above-40 callers keep the old path. */
export function planningBudget(instances: number, small: number) {
  return instances <= 30 ? small : Math.floor(small * (30 / instances) ** 3);
}

/** New placement variants receive half the incumbent's trial allowance,
 * rounded down deterministically, with at least one trial per search. */
export function finishingTrialBudget(
  instances: number,
  small: number,
  reduced: boolean,
) {
  const full = planningBudget(instances, small);
  return reduced ? Math.max(1, Math.floor(full / 2)) : full;
}
