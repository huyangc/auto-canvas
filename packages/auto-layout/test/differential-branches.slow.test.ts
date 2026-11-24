import { it } from "vitest";
import { checkSingleStage } from "./differential-branches.test-support.js";

it.each([false, true])(
  "keeps both source-degenerated branches on their own side when all internal names and order change (perturb=$0)",
  (perturb) =>
    checkSingleStage({ rename: perturb, shuffle: perturb, degeneration: true }),
  60_000,
);
