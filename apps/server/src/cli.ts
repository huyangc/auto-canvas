#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db.js";
import { migrate } from "./migrate.js";
import { serveEditor } from "./static-editor.js";

const db = createDb();
await migrate(db);
if (process.argv.includes("--migrate")) {
  await db.end();
} else {
  const app = createApp({ db });
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
  const close = () =>
    server.close(() => {
      void db.end();
    });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
