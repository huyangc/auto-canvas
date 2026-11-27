import { describe, expect, it } from "vitest";

import { createId, deriveStableId } from "./ids.js";

describe("stable identity", () => {
  it("derives the same ID from the same framed source identity", () => {
    expect(deriveStableId("instance", "source.spi", "M1")).toBe(
      deriveStableId("instance", "source.spi", "M1"),
    );
    expect(deriveStableId("instance", "source.spi", "M1")).not.toBe(
      deriveStableId("instance", "source.spiM", "1"),
    );
  });

  it.each(["", "ascii", "A|:\0".repeat(8192), "Ω电🙂", "before\ud800after"])(
    "matches the reference hash of framed UTF-8 input %#",
    (part) => {
      let hash = 0xcbf29ce484222325n;
      for (const byte of new TextEncoder().encode(`${part.length}:${part}`)) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
      }
      expect(deriveStableId("test", part)).toBe(
        `test-${hash.toString(16).padStart(16, "0")}`,
      );
    },
  );

  it("creates prefixed IDs from an injected UUID source", () => {
    expect(
      createId("route", () => "00000000-0000-4000-8000-000000000000"),
    ).toBe("route-00000000-0000-4000-8000-000000000000");
  });

  /**
   * These values are written into Project files — Route, Junction, Evidence
   * and Cell IDs all come from `deriveStableId` — so the hash is part of the
   * persisted format, not an implementation detail. Pinning them makes any
   * change to the digest fail here instead of silently re-identifying objects
   * in a saved circuit.
   */
  it("pins the digest of a framed source identity", () => {
    expect(deriveStableId("route", "J001", "terminal:U1:out")).toBe(
      "route-106c9631702aa540",
    );
    expect(deriveStableId("component", "net-001", "terminal:R1:1")).toBe(
      "component-1f03472ef1dbfaef",
    );
    expect(
      deriveStableId(
        "contact",
        "document-main",
        "net-042",
        "terminal:U17:out",
        "0",
      ),
    ).toBe("contact-4bcb40b01a445e60");
    expect(deriveStableId("cell", "source.spi")).toBe("cell-718a32b82c4af0b3");
    expect(deriveStableId("instance", "source.spi", "M1")).toBe(
      "instance-3c85d8bb05bb5fcb",
    );
    // Non-ASCII must digest its UTF-8 bytes, not its code units.
    expect(deriveStableId("non-ascii", "ünïcödé-Ω-日本語")).toBe(
      "non-ascii-0f718aa933c1b3f1",
    );
  });
});
