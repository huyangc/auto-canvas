#!/usr/bin/env node
import { startServer } from "./server-main.js";

const server = await startServer();
if (server) {
  const close = () => void server.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
