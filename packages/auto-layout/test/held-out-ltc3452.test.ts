import { it } from "vitest";
import { checkQuickHeldOut, heldOutCases } from "./held-out.test-support.js";

// Split from held-out.test.ts so this fixture plans on a worker of its own.
it.each(heldOutCases("ltc3452"))(
  "$id: quick planning commits safely and preserves Nets",
  checkQuickHeldOut,
  60000,
);
