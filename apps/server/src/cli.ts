#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { AgentRelayHost } from "./agent-relay/host.js";
import { createApp } from "./app.js";
import { createDb } from "./db.js";
import { migrate } from "./migrate.js";
import { serveEditor } from "./static-editor.js";

const db = createDb();
await migrate(db);
if (process.argv.includes("--migrate")) {
  await db.end();
} else {
  const agentRelay = new AgentRelayHost(db);
  await agentRelay.start();
  const app = createApp({ db, agentRelay });
  if (process.env.EDITOR_ROOT) await serveEditor(app, process.env.EDITOR_ROOT);
  const server = serve(
    {
      fetch: app.fetch,
      port: Number(process.env.PORT ?? 4310),
      hostname: process.env.HOST ?? "127.0.0.1",
    },
    (info) =>
      console.log(
        `Auto Canvas server listening on ${info.address}:${info.port}`,
      ),
  );
  agentRelay.attach(server);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    const relayClosed = agentRelay.close().catch((error: unknown) => {
      console.error("Agent relay shutdown failed", error);
    });
    const serverClosed = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    void Promise.all([relayClosed, serverClosed]).then(() => db.end());
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
