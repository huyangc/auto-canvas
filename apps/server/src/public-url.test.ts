import { expect, it } from "vitest";
import { publicUrl } from "./public-url.js";

it("preserves the public HTTPS origin across trusted loopback TLS termination", () => {
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
    expect(
      publicUrl("http://notebook.test/canvas/api/health", "https", peer).href,
    ).toBe("https://notebook.test/canvas/api/health");
});

it("does not trust non-loopback peers or malformed forwarded schemes", () => {
  for (const peer of [undefined, "192.0.2.1", "127.0.0.2"])
    expect(
      publicUrl("http://notebook.test/canvas/", "https", peer).origin,
    ).toBe("http://notebook.test");
  for (const scheme of [
    undefined,
    null,
    "https,http",
    "javascript",
    "https://evil.test",
    "HTTPS",
  ])
    expect(
      publicUrl("http://notebook.test/canvas/", scheme, "127.0.0.1").origin,
    ).toBe("http://notebook.test");
});
