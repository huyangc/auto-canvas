import { describe, expect, it } from "vitest";

import { requestFailureOf } from "./request-failure";

describe("requestFailureOf", () => {
  it("classifies an HTTP rate limit with its retry delay", async () => {
    const refusal = Response.json(
      { error: "too-many-requests" },
      { status: 429, headers: { "retry-after": "60" } },
    );
    expect(await requestFailureOf(refusal!)).toEqual({
      failure: "rate-limited",
      message: "Too many requests. Wait 60 seconds and try again.",
    });
  });

  it("keeps not found and server errors apart", async () => {
    const kind = async (status: number) =>
      (await requestFailureOf(new Response("", { status }))).failure;
    expect(await kind(404)).toBe("not-found");
    expect(await kind(403)).toBe("server-error");
    expect(await kind(503)).toBe("server-error");
    expect(
      (await requestFailureOf(new Response("", { status: 503 }))).message,
    ).toBe("The server could not answer (503). Try again later.");
  });
});
