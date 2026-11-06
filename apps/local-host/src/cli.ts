#!/usr/bin/env node
import { resolve } from "node:path";

import { startLocalHost } from "./index.js";

const rootArgument = process.argv.indexOf("--root");
const editorRoot = resolve(
  rootArgument >= 0 && process.argv[rootArgument + 1]
    ? process.argv[rootArgument + 1]!
    : "apps/editor/dist",
);
const running = await startLocalHost({
  editorRoot,
  port: 4173,
});
process.stdout.write(`Analog Canvas v0.9.2: ${running.origin}\n`);
