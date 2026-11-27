// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountAccountGate } from "./account-gate";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let originalFetch: typeof fetch;
let container: HTMLDivElement;

beforeEach(() => {
  originalFetch = window.fetch;
  container = document.createElement("div");
  container.id = "root";
  document.body.replaceChildren(container);
  window.history.replaceState(null, "", "/editor");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.fetch = originalFetch;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function flush() {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await Promise.resolve();
    });
}

it("requires a password change before mounting the editor and unlocks after updating", async () => {
  let mustChangePassword = true;
  const calls: {
    url: string;
    method: string;
    account: string | null;
    body: unknown;
  }[] = [];
  const mockFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      );
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const headers = new Headers(
        input instanceof Request ? input.headers : init?.headers,
      );
      const bodyText =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request && method === "POST"
            ? await input.clone().text()
            : "";
      const body = bodyText ? JSON.parse(bodyText) : null;
      calls.push({
        url: url.pathname,
        method,
        account: headers.get("X-Canvas-Account"),
        body,
      });
      if (url.pathname === "/api/session")
        return Response.json({
          mode: "accounts",
          user: {
            id: "account:user-1",
            displayName: "a12345678",
            role: "user",
            isAdmin: false,
            mustChangePassword,
          },
        });
      if (url.pathname === "/api/auth/password") {
        mustChangePassword = false;
        return Response.json({ ok: true });
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    },
  ) as typeof fetch;
  vi.stubGlobal("fetch", mockFetch);
  window.fetch = mockFetch;

  const editor = vi.fn(() => <div data-testid="mounted-editor">Editor</div>);
  mountAccountGate(container, editor);
  await flush();

  expect(editor).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Change your password");

  const inputs = container.querySelectorAll<HTMLInputElement>("input");
  await act(async () => {
    inputs[0]!.value = "TempPassword1234";
    inputs[1]!.value = "NewPassword12345";
    inputs[2]!.value = "DifferentPassword";
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "do not match",
  );
  expect(calls.some((c) => c.url === "/api/auth/password")).toBe(false);

  await act(async () => {
    inputs[2]!.value = "NewPassword12345";
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();

  expect(calls.find((c) => c.url === "/api/auth/password")).toEqual({
    url: "/api/auth/password",
    method: "POST",
    account: "account:user-1",
    body: {
      currentPassword: "TempPassword1234",
      newPassword: "NewPassword12345",
    },
  });
  expect(
    container.querySelector('[data-testid="mounted-editor"]'),
  ).not.toBeNull();
});
