import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planPlaceAllUnplacedInstances } from "./placement-tray.js";

describe("Placement Tray bulk layout", () => {
  it("places retained Instances in document order on a snapped viewport grid", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      { id: "R1", symbolId: "resistor", placement: null },
      { id: "C1", symbolId: "capacitor", placement: null },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 700, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      { id: "M1", symbolId: "nmos", placement: null },
    );

    expect(
      planPlaceAllUnplacedInstances(document, {
        x: 0,
        y: 0,
        width: 480,
        height: 320,
      }),
    ).toEqual([
      {
        kind: "place_instance",
        instanceId: "R1",
        placement: {
          position: { x: 80, y: 240 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        kind: "place_instance",
        instanceId: "C1",
        placement: {
          position: { x: 260, y: 240 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        kind: "place_instance",
        instanceId: "M1",
        placement: {
          position: { x: 80, y: 380 },
          rotation: 0,
          mirror: "none",
        },
      },
    ]);
  });

  it("does not emit an edit when the tray is empty", () => {
    const document = createEmptyDocument("document-main", "Main");
    expect(
      planPlaceAllUnplacedInstances(document, {
        x: 0,
        y: 0,
        width: 960,
        height: 640,
      }),
    ).toEqual([]);
  });
});
