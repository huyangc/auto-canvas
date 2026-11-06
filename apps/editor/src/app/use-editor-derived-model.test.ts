import type { Flightline } from "@icm/derived";
import { describe, expect, it } from "vitest";

import { displayedRoutingGuidance } from "./use-editor-derived-model";

function flightline(
  id: string,
  netId: string,
  fromNetId = netId,
  toNetId = netId,
): Flightline {
  return {
    id,
    netId,
    fromNetId,
    toNetId,
    from: { kind: "junction", junctionId: `${id}-from` },
    to: { kind: "junction", junctionId: `${id}-to` },
    fromPoint: { x: 0, y: 0 },
    toPoint: { x: 10, y: 0 },
    distance: 10,
  };
}

describe("editor derived routing guidance", () => {
  const analog = flightline("analog", "net-a");
  const bridge = flightline("bridge", "net-b", "net-b", "net-c");

  it("keeps all guidance when focus has no active Net", () => {
    expect(
      displayedRoutingGuidance([analog, bridge], "focused", new Set(), null),
    ).toEqual([analog, bridge]);
  });

  it("focuses by any participating Base Net and omits the highlighted Net", () => {
    expect(
      displayedRoutingGuidance(
        [analog, bridge],
        "focused",
        new Set(["net-c"]),
        null,
      ),
    ).toEqual([bridge]);
    expect(
      displayedRoutingGuidance([analog, bridge], "all", new Set(), "net-b"),
    ).toEqual([analog]);
  });

  it("honors an explicitly hidden guidance view", () => {
    expect(
      displayedRoutingGuidance(
        [analog, bridge],
        "hidden",
        new Set(["net-a"]),
        null,
      ),
    ).toEqual([]);
  });
});
