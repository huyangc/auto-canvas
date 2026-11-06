import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planElectricalMarkerName } from "./electrical-marker-name";

function documentWithSupplyMarker() {
  const document = createEmptyDocument("main", "Main");
  document.instances.push({
    id: "P1",
    symbolId: "vdd-port",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
  });
  document.nets.push({
    id: "net-p1",

    terminals: [{ instanceId: "P1", pinName: "P" }],
  });
  document.connectivityEvidence.push({
    id: "claim-p1",
    kind: "name-claim",
    netId: "net-p1",
    name: "VDD",
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: "P1" },
  });
  return document;
}

describe("electrical marker name planning", () => {
  it("keeps supply markers on the specialized detach-and-rejoin planner", () => {
    const plan = planElectricalMarkerName(
      documentWithSupplyMarker(),
      "P1",
      "  AVDD  ",
    );

    expect(plan).toMatchObject({
      status: "ready",
      message: "Supply named AVDD",
    });
    expect(
      plan.status === "ready" &&
        plan.edits.some((edit) => edit.kind === "disconnect_endpoint"),
    ).toBe(true);
  });

  it("does not send Cell Pins through supply-marker naming", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({ id: "P1", symbolId: "port", placement: null });
    document.nets.push({
      id: "net-p1",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist = {
      name: "Main",
      terminals: [
        {
          id: "formal-in",
          name: "IN",
          netId: "net-p1",
          interfaceInstanceIds: ["P1"],
          direction: "input",
        },
      ],
      formalParameters: [],
    };

    expect(planElectricalMarkerName(document, "P1", "VIN")).toEqual({
      status: "rejected",
      message: "Formal Cell Pins use Cell naming",
    });
  });
});
