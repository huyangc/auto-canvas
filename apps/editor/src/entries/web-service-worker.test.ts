import { afterEach, describe, expect, it, vi } from "vitest";
import { configureWebServiceWorker } from "./web-service-worker";

afterEach(() => vi.unstubAllGlobals());

function browser(controller: object | null = null) {
  const register = vi.fn().mockResolvedValue({});
  const getRegistrations = vi.fn().mockResolvedValue([]);
  const reload = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: { register, getRegistrations, controller },
  });
  vi.stubGlobal("window", {
    location: { reload, href: "https://editor.test/canvas/" },
  });
  return { register, getRegistrations, reload };
}

describe("Web service worker startup", () => {
  it("registers production workers within the deployment base path", async () => {
    const { register, getRegistrations } = browser();
    await configureWebServiceWorker(true, "/canvas/");
    expect(register).toHaveBeenCalledWith("/canvas/sw.js", {
      scope: "/canvas/",
    });
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  it("waits for every development worker to unregister before reloading a controlled page", async () => {
    const { register, getRegistrations, reload } = browser({});
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const first = vi.fn().mockReturnValue(pending);
    const second = vi.fn().mockResolvedValue(true);
    getRegistrations.mockResolvedValue([
      { scope: "https://editor.test/", unregister: first },
      { scope: "https://editor.test/", unregister: second },
    ]);
    const configured = configureWebServiceWorker(false, "/");
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    finish(true);
    await configured;
    expect(reload).toHaveBeenCalledOnce();
    expect(register).not.toHaveBeenCalled();
  });

  it("does not reload an uncontrolled page after unregistering", async () => {
    const { getRegistrations, reload } = browser();
    getRegistrations.mockResolvedValue([
      {
        scope: "https://editor.test/",
        unregister: vi.fn().mockResolvedValue(true),
      },
    ]);
    await configureWebServiceWorker(false, "/");
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when development has no registrations", async () => {
    const { reload } = browser({});
    await configureWebServiceWorker(false, "/");
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves another application's worker registered in development", async () => {
    const { getRegistrations } = browser();
    const notebook = vi.fn();
    const canvas = vi.fn().mockResolvedValue(true);
    getRegistrations.mockResolvedValue([
      { scope: "https://editor.test/", unregister: notebook },
      { scope: "https://editor.test/canvas/", unregister: canvas },
    ]);
    await configureWebServiceWorker(false, "/canvas/");
    expect(canvas).toHaveBeenCalledOnce();
    expect(notebook).not.toHaveBeenCalled();
  });

  it("supports browsers without service workers", async () => {
    vi.stubGlobal("navigator", {});
    await expect(configureWebServiceWorker(true, "/")).resolves.toBeUndefined();
  });
});
