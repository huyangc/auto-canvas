import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { digestSha256Hex } from "./sha256.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["native", "http"])(
  "hashes exact bytes and UTF-8 text using %s",
  async (mode) => {
    if (mode === "http") vi.stubGlobal("crypto", {});
    const buffer = Uint8Array.from({ length: 132 }, (_, index) => 255 - index);
    for (const input of [
      "",
      "模拟电路",
      ...[1, 55, 56, 63, 64, 65, 129].map((length) =>
        buffer.subarray(2, 2 + length),
      ),
    ]) {
      expect(await digestSha256Hex(input)).toBe(
        createHash("sha256").update(input).digest("hex"),
      );
    }
  },
);
