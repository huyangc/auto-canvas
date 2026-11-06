import { appendFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildTimeline,
  findCommand,
  followRound,
  formatTimeline,
  liveLine,
  parseEvents,
  unwrapShell,
} from "./codex-log.mjs";

const command = (id, text, exitCode, output = "") => ({
  type: "item.completed",
  item: {
    id,
    type: "command_execution",
    command: text,
    exit_code: exitCode,
    aggregated_output: output,
    status: exitCode === 0 ? "completed" : "failed",
  },
});
const message = (text) => ({
  type: "item.completed",
  item: { id: "m", type: "agent_message", text },
});
const jsonl = (...events) =>
  events.map((event) => `${JSON.stringify(event)}\n`).join("");

describe("timeline", () => {
  it("removes the shell wrapper from commands", () => {
    expect(unwrapShell("/bin/zsh -lc 'pnpm build'")).toBe("pnpm build");
    expect(unwrapShell('/bin/bash -c "ls"')).toBe("ls");
    expect(unwrapShell("pnpm build")).toBe("pnpm build");
  });

  it("reports commands, exit codes, messages and the turn result", () => {
    const report = formatTimeline(
      buildTimeline({
        events: [
          { type: "thread.started", thread_id: "t-1" },
          command("a", "/bin/zsh -lc 'pnpm build'", 0),
          command("b", "/bin/zsh -lc 'pnpm test'", 1),
          message("STATUS: partial\nTests fail"),
          { type: "turn.completed" },
        ],
      }),
    );
    expect(report).toContain("thread t-1, turn completed");
    expect(report).toContain("2 commands, 1 nonzero");
    expect(report).toContain("#1 ok pnpm build");
    expect(report).toContain("#2 x1 pnpm test");
    expect(report).toContain("MSG STATUS: partial Tests fail");
  });

  it("keeps what would otherwise disappear visible", () => {
    const parsed = parseEvents(
      `${jsonl(
        {
          type: "item.started",
          item: {
            id: "x",
            type: "command_execution",
            command: "pnpm test",
          },
        },
        { type: "item.completed", item: { id: "f", type: "file_change" } },
        { type: "turn.failed", error: { message: "quota" } },
      )}not json\n`,
    );
    const report = formatTimeline(buildTimeline(parsed));
    expect(report).toContain("turn failed");
    expect(report).toContain("1 malformed lines");
    expect(report).toContain("RUNNING pnpm test");
    expect(report).toContain("OTHER file_change");
    expect(report).toContain("ERROR quota");
  });

  it("counts a command with no exit code as nonzero", () => {
    const report = formatTimeline(
      buildTimeline({ events: [command("a", "killed", null)] }),
    );
    expect(report).toContain("1 nonzero");
    expect(report).toContain("#1 x? killed");
  });

  it("finds a command's output by its timeline number", () => {
    const timeline = buildTimeline({
      events: [
        command("a", "one", 0, "first"),
        command("b", "two", 1, "second"),
      ],
    });
    expect(findCommand(timeline, 2).output).toBe("second");
    expect(findCommand(timeline, 3)).toBeUndefined();
  });
});

describe("live lines", () => {
  it("shows messages and outcomes but not commands", () => {
    expect(liveLine(message("working"))).toBe("MSG working");
    expect(liveLine({ type: "turn.completed" })).toBe("TURN completed");
    expect(liveLine({ type: "error", message: "boom" })).toBe("ERROR boom");
    expect(liveLine({ type: "turn.failed", error: { message: "quota" } })).toBe(
      "TURN failed quota",
    );
    expect(liveLine(command("a", "pnpm test", 1))).toBeNull();
    expect(liveLine({ type: "item.started", item: {} })).toBeNull();
  });
});

describe("followRound", () => {
  let logs;
  afterEach(async () => {
    if (logs) await rm(logs, { recursive: true, force: true });
    logs = undefined;
  });

  const setUp = async () => {
    logs = await mkdtemp(join(tmpdir(), "codex-log-"));
    return {
      log: join(logs, "round-1.jsonl"),
      exit: join(logs, "round-1.exit"),
    };
  };

  it("waits for the log, follows appends and ends on the exit marker", async () => {
    const { log, exit } = await setUp();
    const lines = [];
    const done = followRound({
      logs,
      round: 1,
      emit: (line) => lines.push(line),
      pollMs: 5,
    });
    await delay(20);
    await writeFile(log, jsonl(message("first")));
    await delay(30);
    expect(lines).toEqual(["MSG first"]);
    await appendFile(log, jsonl(message("second"), { type: "turn.completed" }));
    await writeFile(exit, "0\n");
    await expect(done).resolves.toBe("0");
    expect(lines).toEqual([
      "MSG first",
      "MSG second",
      "TURN completed",
      "END exit=0",
    ]);
  });

  it("does not lose events written just before the marker", async () => {
    const { log, exit } = await setUp();
    await writeFile(log, jsonl(message("first")));
    const lines = [];
    await followRound({
      logs,
      round: 1,
      pollMs: 5,
      emit: (line) => {
        lines.push(line);
        // The round finishes while the watcher is partway through a read.
        if (line === "MSG first") {
          appendFileSync(log, jsonl(message("last")));
          writeFileSync(exit, "0\n");
        }
      },
    });
    expect(lines).toEqual(["MSG first", "MSG last", "END exit=0"]);
  });

  it("ends for a round that dies without a final event", async () => {
    const { log, exit } = await setUp();
    await writeFile(log, "");
    await writeFile(exit, "137\n");
    const lines = [];
    await followRound({ logs, round: 1, emit: (line) => lines.push(line) });
    expect(lines).toEqual(["END exit=137"]);
  });

  it("holds a partial line, including a split character, until it completes", async () => {
    const { log, exit } = await setUp();
    const bytes = Buffer.from(jsonl(message("评审")));
    const cut = bytes.indexOf(Buffer.from("评")) + 1;
    await writeFile(log, bytes.subarray(0, cut));
    const lines = [];
    const done = followRound({
      logs,
      round: 1,
      emit: (line) => lines.push(line),
      pollMs: 5,
    });
    await delay(30);
    expect(lines).toEqual([]);
    await appendFile(log, bytes.subarray(cut));
    await writeFile(exit, "0\n");
    await done;
    expect(lines).toEqual(["MSG 评审", "END exit=0"]);
  });

  it("reports silence once, and again only after new activity", async () => {
    const { log, exit } = await setUp();
    await writeFile(log, "");
    const lines = [];
    const done = followRound({
      logs,
      round: 1,
      emit: (line) => lines.push(line),
      pollMs: 5,
      stallMs: 20,
    });
    await delay(80);
    expect(lines.filter((line) => line.startsWith("STALLED"))).toHaveLength(1);
    await appendFile(log, jsonl(message("back")));
    await delay(80);
    expect(lines.filter((line) => line.startsWith("STALLED"))).toHaveLength(2);
    await writeFile(exit, "0\n");
    await done;
  });
});
