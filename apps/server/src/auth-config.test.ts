import { describe, expect, it } from "vitest";
import { readAuthConfig } from "./auth-config.js";

describe("readAuthConfig", () => {
  it.each([{}, { AUTO_CANVAS_AUTH: "accounts" }])(
    "uses standalone accounts for %j",
    (env) => expect(readAuthConfig(env)).toEqual({ mode: "accounts" }),
  );
  it.each([{ AUTO_CANVAS_AUTH: "local" }])("is local for %j", (env) =>
    expect(readAuthConfig(env)).toEqual({ mode: "local" }),
  );
  it.each([
    "http://127.0.0.1:8000",
    "http://localhost:8000/",
    "http://[::1]:8000",
    "https://127.0.0.1",
  ])("accepts the notebook API %s", (api) => {
    const config = readAuthConfig({
      AUTO_CANVAS_AUTH: "notebook",
      AUTO_CANVAS_NOTEBOOK_API: api,
    });
    expect(config.mode).toBe("notebook");
    expect(config.mode === "notebook" && config.notebookApi.href).toBe(
      new URL(api).href,
    );
  });
  it.each(["", "Local", "notebook ", "oidc", "Notebook"])(
    "rejects AUTO_CANVAS_AUTH=%j without echoing it",
    (value) => {
      let message = "";
      try {
        readAuthConfig({
          AUTO_CANVAS_AUTH: value,
          AUTO_CANVAS_NOTEBOOK_API: "http://127.0.0.1:8000",
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("AUTO_CANVAS_AUTH");
      if (value.trim()) expect(message).not.toContain(value);
    },
  );
  it.each([
    undefined,
    "",
    "http://192.168.1.2:8000",
    "http://notebook.example:8000",
    "http://127.0.0.2:8000",
    "http://127.0.0.1:8000/api",
    "http://localhost:8000/api/..",
    "http://127.0.0.1:8000/.",
    "http://127.0.0.1:8000//",
    "http://127.0.0.1:8000/?secret=1",
    "http://127.0.0.1:8000/?",
    "http://127.0.0.1:8000/#secret",
    "http://127.0.0.1:8000/#",
    "http://user:secret@127.0.0.1:8000",
    "http://@127.0.0.1:8000",
    "ftp://127.0.0.1:8000",
    "file:///tmp/notebook",
    "not a url secret",
  ])("rejects AUTO_CANVAS_NOTEBOOK_API=%j without echoing it", (value) => {
    let message = "";
    try {
      readAuthConfig({
        AUTO_CANVAS_AUTH: "notebook",
        ...(value === undefined ? {} : { AUTO_CANVAS_NOTEBOOK_API: value }),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("AUTO_CANVAS_NOTEBOOK_API");
    if (value) expect(message).not.toContain(value);
    expect(message).not.toContain("secret");
  });
});
