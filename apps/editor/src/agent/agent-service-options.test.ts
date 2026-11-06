import { describe, expect, it } from "vitest";
import { liveAgentEditor } from "./live-agent-editor.test-support";

describe("live editor capability announcement", () => {
  it("announces model source and artwork structure edits from the canonical contract", async () => {
    const editor = liveAgentEditor();
    const connected = await editor.client.connect("session-1.code");
    expect(connected.capabilities.editKinds).toEqual(
      expect.arrayContaining([
        "apply_model_source",
        "save_model_source_draft",
        "capture_component_definition",
      ]),
    );
  });
  it("omits simulation operations when this editor host does not enable simulation", async () => {
    const editor = liveAgentEditor();
    await editor.client.connect("session-1.code");
    expect(
      (await editor.client.capabilities()).capabilities.resources?.simulation,
    ).toBeUndefined();
  });
});
