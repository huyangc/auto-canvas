import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildSvgScene } from "./render.js";
import { wireHopPaths } from "./wire-hops.js";

const p = (x: number, y: number) => ({ x, y });

function hops(
  lines: Record<string, ReturnType<typeof p>[]>,
  hopping = Object.keys(lines),
  contacts: ReturnType<typeof p>[] = [],
) {
  return wireHopPaths(
    new Map(Object.entries(lines)),
    new Set(hopping),
    contacts,
  );
}

describe("wire hops", () => {
  it("arcs a horizontal wire over the vertical one it crosses", () => {
    const paths = hops({
      h: [p(0, 0), p(100, 0)],
      v: [p(50, -50), p(50, 50)],
    });
    expect(paths.get("h")).toBe("M 0 0 L 46 0 A 4 4 0 0 1 54 0 L 100 0");
    // The vertical wire stays straight.
    expect(paths.has("v")).toBe(false);
  });

  it("arcs over the top whichever way the wire was drawn", () => {
    const paths = hops({
      h: [p(100, 0), p(0, 0)],
      v: [p(50, 50), p(50, -50)],
    });
    expect(paths.get("h")).toBe("M 100 0 L 54 0 A 4 4 0 0 0 46 0 L 0 0");
  });

  it("hops every crossing along a bent wire in drawing order", () => {
    const paths = hops({
      h: [p(0, 0), p(100, 0), p(100, 100), p(0, 100)],
      a: [p(30, -20), p(30, 120)],
      b: [p(70, -20), p(70, 120)],
    });
    expect(paths.get("h")).toBe(
      "M 0 0 L 26 0 A 4 4 0 0 1 34 0 L 66 0 A 4 4 0 0 1 74 0 L 100 0 L 100 100 L 74 100 A 4 4 0 0 0 66 100 L 34 100 A 4 4 0 0 0 26 100 L 0 100",
    );
  });

  it.each([
    ["the vertical wire ends on the horizontal one", [p(50, 0), p(50, 50)]],
    ["the vertical wire ends within a radius", [p(50, -3), p(50, 50)]],
    ["the crossing is near the horizontal wire's end", [p(95, -50), p(95, 50)]],
    ["the other wire is diagonal", [p(30, -20), p(70, 20)]],
    ["the other wire is horizontal too", [p(20, 0), p(80, 0)]],
  ])("draws a plain crossing when %s", (_case, other) => {
    expect(hops({ h: [p(0, 0), p(100, 0)], o: other }, ["h"]).size).toBe(0);
  });

  it("never hops at a contact point", () => {
    expect(
      hops(
        { h: [p(0, 0), p(100, 0)], v: [p(50, -50), p(50, 50)] },
        ["h"],
        [p(50, 0)],
      ).size,
    ).toBe(0);
  });

  it("keeps the first of two hops that would overlap", () => {
    const paths = hops(
      {
        h: [p(0, 0), p(100, 0)],
        a: [p(50, -50), p(50, 50)],
        b: [p(56, -50), p(56, 50)],
      },
      ["h"],
    );
    expect(paths.get("h")).toBe("M 0 0 L 46 0 A 4 4 0 0 1 54 0 L 100 0");
  });
});

describe("wire hops in the rendered drawing", () => {
  function crossing(crossingStyle?: "hop") {
    const doc = createEmptyDocument("crossing", "Crossing");
    if (crossingStyle) doc.presentation.crossingStyle = crossingStyle;
    for (const [id, from, to] of [
      ["h", p(0, 0), p(100, 0)],
      ["v", p(50, -50), p(50, 50)],
    ] as const) {
      const net = `net-${id}`;
      doc.nets.push({ id: net, terminals: [] });
      doc.junctions.push(
        { id: `${id}-start`, netId: net, position: from },
        { id: `${id}-end`, netId: net, position: to },
      );
      doc.routes.push(
        createRoutePath({
          id,
          netId: net,
          start: { kind: "junction", junctionId: `${id}-start` },
          end: { kind: "junction", junctionId: `${id}-end` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    return doc;
  }
  const ink = (body: string) =>
    [...body.matchAll(/<path data-role="conductor-ink" d="([^"]*)"/gu)]
      .map(([, d]) => d)
      .join(" ");

  it("draws the hop only when the Document asks for it", () => {
    const resolver = new InMemorySymbolResolver([]);
    expect(ink(buildSvgScene(crossing(), resolver).formalBody)).not.toContain(
      " A ",
    );
    const body = buildSvgScene(crossing("hop"), resolver).formalBody;
    expect(ink(body)).toContain("M 0 0 L 46 0 A 4 4 0 0 1 54 0 L 100 0");
    // Identity and hit geometry stay the Route's own straight centerline.
    expect(body).toContain(
      'data-object-id="h" data-net-id="net-h" points="0,0 100,0"',
    );
  });

  it("hops only over wires the rendered selection includes", () => {
    const resolver = new InMemorySymbolResolver([]);
    const alone = buildSvgScene(crossing("hop"), resolver, {
      objectIds: new Set(["h"]),
    });
    expect(ink(alone.formalBody)).not.toContain(" A ");
  });
});
