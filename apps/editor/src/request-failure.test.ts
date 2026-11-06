import { describe, expect, it } from "vitest";

import { requestFailureOf } from "./request-failure";
import { SITE_USAGE_CONTACT } from "./usage-policy-note";

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

  it("names a blocked account and where to appeal", async () => {
    const failure = await requestFailureOf(
      Response.json({ error: "account-blocked" }, { status: 403 }),
    );
    expect(failure.failure).toBe("blocked");
    expect(failure.message).toContain(SITE_USAGE_CONTACT);
  });

  it("gives a daily allowance its reset time", async () => {
    const opens = await requestFailureOf(
      Response.json(
        {
          error: "daily-open-limit",
          limit: 100,
          resetAt: "2026-10-25T00:00:00.000Z",
        },
        { status: 429 },
      ),
    );
    expect(opens.failure).toBe("daily-limit");
    expect(opens.message).toMatch(
      /^Today's limit is reached\. Try again after/,
    );
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
