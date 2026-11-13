/** Small drawings include their ports and rail markers. Retain their complete
 * portfolio through 30 instances; above that size, bound expensive finishing
 * trials separately from the annealer. Above-40 callers keep the old path. */
export function planningBudget(instances: number, small: number) {
  return instances <= 30 ? small : Math.floor(small * (30 / instances) ** 3);
}
