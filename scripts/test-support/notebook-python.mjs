import { spawnSync } from "node:child_process";

export function findPython() {
  const configured = process.env.AUTO_CANVAS_TEST_PYTHON;
  const candidates = configured
    ? [configured]
    : ["python3.13", "python3.12", "python3"];
  for (const candidate of candidates) {
    const probe = spawnSync(
      candidate,
      ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) return candidate;
  }
  throw new Error(
    "The notebook tests need Python 3.12 or newer: set AUTO_CANVAS_TEST_PYTHON to its path or put python3.13, python3.12 or python3 on PATH",
  );
}
