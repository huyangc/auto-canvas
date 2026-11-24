import { it } from "vitest";
import {
  checkRealTransactions,
  checkRouteRemoval,
  corpusCases,
} from "./corpus.test-support.js";
import { createCorpusPlans } from "./corpus-plans.js";

// The nine-case corpus. Its slowest fixtures run in corpus-two-inverters.test.ts
// and corpus-common-source.test.ts; this file runs the rest.
const defaultPlan = createCorpusPlans();
const cases = corpusCases("rest");

it.each(cases)(
  "$id: real transactions preserve electricity and satisfy placement",
  (fixture) => checkRealTransactions(fixture, defaultPlan),
  // T074's readability selection adds ~1.5x on two-inverters (CI passed 30 s).
  60000,
);

// Commit the planner's first phases independently to isolate route removal
// and annotation re-anchoring from instance transforms.
it.each(cases)(
  "$id: R2 re-anchoring and Route removal preserve terminal membership",
  (fixture) => checkRouteRemoval(fixture, defaultPlan),
  30000,
);
