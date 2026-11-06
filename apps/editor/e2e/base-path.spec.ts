import { AgentHttpClient } from "@icm/agent-client";
import { expect, test } from "@playwright/test";
import {
  clickCommand,
  renameProject,
  readAgentClaim,
} from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";

test("a prefixed editor saves and reopens a Cloud circuit beside notebook", async ({
  page,
  browser,
}) => {
  const name = `Prefix circuit ${Date.now()}`;
  const escaped: string[] = [];
  const sockets: string[] = [];
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const watch = (target: typeof page) => {
    target.context().on("request", (request) => {
      if (
        /^https?:/u.test(request.url()) &&
        !request.url().startsWith(`${origin}/canvas/`)
      )
        escaped.push(request.url());
    });
    target.on("websocket", (socket) => {
      sockets.push(socket.url());
      if (!new URL(socket.url()).pathname.startsWith("/canvas/api/"))
        escaped.push(socket.url());
    });
  };
  let projectId: string | undefined;
  try {
    // These requests intentionally address the neighbouring application.
    expect(await (await page.request.get("/api/health")).json()).toEqual({
      app: "notebook",
      path: "/api/health",
    });
    watch(page);
    await page.goto("/canvas/?new=1");
    await placeComponent(page, "resistor", { x: 320, y: 200 });
    await page.getByTestId("open-agent").click();
    const panel = page.getByTestId("connect-agent-panel");
    const { claimCode } = await readAgentClaim(panel);
    await expect(panel.getByTestId("agent-copy-text")).toHaveValue(
      new RegExp(`${origin}/canvas/api/agent/kit`),
    );
    const client = new AgentHttpClient({ baseUrl: `${origin}/canvas` });
    const session = await client.claim(claimCode);
    await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    expect(
      await client.circuit(session.sessionId, session.agentToken, {
        apiVersion: "3.0",
        requestId: "prefix-capabilities",
        operation: "capabilities",
      }),
    ).toMatchObject({
      capabilities: {
        resources: {
          file: { path: "/canvas/api/agent/sessions/{sessionId}/files" },
          project: { path: "/canvas/api/agent/sessions/{sessionId}/projects" },
        },
      },
    });
    await panel
      .getByRole("button", { name: "Close Agent dialog", exact: true })
      .click();
    await expect(panel).toBeHidden();
    await renameProject(page, name);
    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith("/canvas/api/projects") &&
        response.request().method() === "POST",
    );
    await page.keyboard.press("ControlOrMeta+s");
    const saved = await saving;
    expect(saved.status()).toBe(201);
    projectId = (await saved.json()).project.id;
    await expect(page.getByTestId("status")).toHaveText(
      `Saved ${name} to Cloud`,
    );
    await page.reload();
    await expect(page.getByTestId("hit-R1")).toBeVisible();
    const fresh = await browser.newPage();
    watch(fresh);
    try {
      await fresh.goto(`${origin}/canvas/?new=1`);
      await fresh
        .getByLabel("Open Shelf project in tab", { exact: true })
        .click();
      await fresh
        .locator(".project-tabs-shelf")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(fresh.getByTestId("hit-R1")).toBeVisible();
      await expect(fresh.getByTestId("active-instance-count")).toHaveText("1");
      await clickCommand(fresh, "Edit", "User Components…");
      await expect(
        fresh.getByRole("dialog", { name: "User Components", exact: true }),
      ).toBeVisible();
      await fresh.getByRole("tab", { name: "Library", exact: true }).click();
      await expect
        .poll(async () =>
          (await fresh.request.get(`${origin}/canvas/api/components`)).status(),
        )
        .toBe(200);
      await expect
        .poll(() =>
          fresh.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            return new URL(registration.scope).pathname;
          }),
        )
        .toBe("/canvas/");
    } finally {
      await fresh.close();
    }
    expect(escaped).toEqual([]);
  } finally {
    if (projectId)
      await page.request.delete(`/canvas/api/projects/${projectId}`);
  }
});
