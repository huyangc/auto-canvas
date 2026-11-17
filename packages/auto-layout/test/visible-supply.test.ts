import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { placement } from "../src/geometry.js";
import { floatingPins, missingConnections } from "../src/routing-audit.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it("audits the selected amplifier artwork's visible supplies without losing hidden electrical membership", () => {
  const document = circuit(
    { amp: "opamp", supply: "vdd-port" },
    { vdd: ["amp.VDD", "supply.P"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(0, -80);
  const originalNets = structuredClone(document.nets);
  expect(missingConnections(document, resolver)).toBe(0);
  expect(floatingPins(document, resolver)).toEqual([]);
  document.instances[0]!.symbolVariantId = "supply-pins";
  expect(missingConnections(document, resolver)).toBe(1);
  expect(floatingPins(document, resolver)).toEqual([
    { instanceId: "amp", pinName: "VDD", netId: "vdd" },
    { instanceId: "supply", pinName: "P", netId: "vdd" },
  ]);
  expect(document.nets).toEqual(originalNets);
});
