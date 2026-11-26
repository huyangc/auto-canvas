import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNTITLED_PROJECT_NAME,
  nextUntitledProjectName,
} from "./project-name";

describe("nextUntitledProjectName", () => {
  it("starts with Untitled when no Untitled project exists", () => {
    expect(nextUntitledProjectName()).toBe(DEFAULT_UNTITLED_PROJECT_NAME);
    expect(nextUntitledProjectName(["Bandgap", "OTA"])).toBe("Untitled");
  });

  it("increments Untitled sequentially across existing names", () => {
    expect(nextUntitledProjectName(["Untitled"])).toBe("Untitled 2");
    expect(nextUntitledProjectName(["Untitled", "Untitled 2"])).toBe(
      "Untitled 3",
    );
  });

  it("reuses the lowest available Untitled number", () => {
    expect(nextUntitledProjectName(["Untitled", "Untitled 3"])).toBe(
      "Untitled 2",
    );
  });

  it("normalizes case and extra whitespace when checking collisions", () => {
    expect(nextUntitledProjectName(["  untitled  ", "UNTITLED   2"])).toBe(
      "Untitled 3",
    );
  });
});
