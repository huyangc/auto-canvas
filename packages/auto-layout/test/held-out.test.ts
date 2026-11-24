import { it } from "vitest";
import { checkQuickHeldOut, heldOutCases } from "./held-out.test-support.js";

// The slowest fixtures run in held-out-ltc3452.test.ts and
// held-out-deadtime.test.ts; this file runs the rest.
it.each(heldOutCases("rest"))(
  "$id: quick planning commits safely and preserves Nets",
  checkQuickHeldOut,
  60000,
);
