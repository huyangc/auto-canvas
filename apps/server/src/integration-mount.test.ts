import { describe, expect, it } from "vitest";
import { stripIntegrationMount } from "./integration-mount.js";

describe("stripIntegrationMount", () => {
  it.each([
    [
      "http://canvas.test/@notebook/canvas/api/x?y=1",
      "http://canvas.test/canvas/api/x?y=1",
    ],
    ["http://canvas.test/@notebook/", "http://canvas.test/"],
    [
      "http://canvas.test/@notebook/canvas/#frag",
      "http://canvas.test/canvas/#frag",
    ],
  ])("strips the mount from %s", (input, output) =>
    expect(stripIntegrationMount(new URL(input))?.href).toBe(output),
  );
  it.each([
    "http://canvas.test/@notebook",
    "http://canvas.test/@notebookx/a",
    "http://canvas.test/canvas/api/x",
    "http://canvas.test/",
  ])("leaves %s unmounted", (input) =>
    expect(stripIntegrationMount(new URL(input))).toBeNull(),
  );
});
