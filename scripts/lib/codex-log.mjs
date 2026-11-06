import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const COMMAND_WIDTH = 160;
const MESSAGE_WIDTH = 500;

/** Collapse text onto one line and cap its length. */
function oneLine(text, width) {
  const flat = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return flat.length > width ? `${flat.slice(0, width)}…` : flat;
}

/** Remove the login-shell wrapper Codex puts around every command. */
export function unwrapShell(command) {
  const match = /^\S*\/(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/u.exec(
    command ?? "",
  );
  return match ? match[2] : (command ?? "");
}

/** Parse JSONL text; lines that are not JSON are counted, not dropped silently. */
export function parseEvents(text) {
  const events = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed };
}

/**
 * Reduce a round's events to what a reviewer reads. A command that started and
 * never completed stays visible as running, and an item type this code does not
 * know stays visible as "other".
 */
export function buildTimeline({ events, malformed = 0 }) {
  const entries = [];
  const started = new Map();
  let threadId = null;
  let turn = "not finished";
  let commandNumber = 0;

  for (const event of events) {
    const item = event.item ?? {};
    if (event.type === "thread.started") {
      threadId = event.thread_id ?? null;
    } else if (event.type === "turn.completed") {
      turn = "completed";
    } else if (event.type === "turn.failed") {
      turn = "failed";
      entries.push({ kind: "error", text: event.error?.message ?? "" });
    } else if (event.type === "error") {
      entries.push({ kind: "error", text: event.message ?? "" });
    } else if (event.type === "item.started") {
      if (item.type === "command_execution") started.set(item.id, item);
    } else if (event.type === "item.completed") {
      if (item.type === "command_execution") {
        started.delete(item.id);
        commandNumber += 1;
        entries.push({
          kind: "command",
          number: commandNumber,
          command: unwrapShell(item.command),
          exitCode: item.exit_code ?? null,
          output: item.aggregated_output ?? "",
        });
      } else if (item.type === "agent_message") {
        entries.push({ kind: "message", text: item.text ?? "" });
      } else {
        entries.push({ kind: "other", text: item.type ?? "unknown" });
      }
    }
  }
  for (const item of started.values()) {
    entries.push({ kind: "running", command: unwrapShell(item.command) });
  }
  return { threadId, turn, malformed, entries };
}

/** Render a timeline as a compact, reviewable text report. */
export function formatTimeline({ threadId, turn, malformed, entries }) {
  const count = (kind) => entries.filter((entry) => entry.kind === kind).length;
  const commands = entries.filter((entry) => entry.kind === "command");
  const nonzero = commands.filter((entry) => entry.exitCode !== 0).length;
  const lines = [
    `thread ${threadId ?? "unknown"}, turn ${turn}`,
    `${commands.length} commands, ${nonzero} nonzero, ${count("running")} running, ` +
      `${count("message")} messages, ${count("error")} errors, ` +
      `${count("other")} other, ${malformed} malformed lines`,
  ];
  for (const entry of entries) {
    if (entry.kind === "command") {
      const status = entry.exitCode === 0 ? "ok" : `x${entry.exitCode ?? "?"}`;
      lines.push(
        `#${entry.number} ${status} ${oneLine(entry.command, COMMAND_WIDTH)}`,
      );
    } else if (entry.kind === "message") {
      lines.push(`MSG ${oneLine(entry.text, MESSAGE_WIDTH)}`);
    } else if (entry.kind === "error") {
      lines.push(`ERROR ${oneLine(entry.text, MESSAGE_WIDTH)}`);
    } else if (entry.kind === "running") {
      lines.push(`RUNNING ${oneLine(entry.command, COMMAND_WIDTH)}`);
    } else {
      lines.push(`OTHER ${entry.text}`);
    }
  }
  return lines.join("\n");
}

/** Find a numbered command, for reading its output after seeing the timeline. */
export function findCommand({ entries }, number) {
  return entries.find(
    (entry) => entry.kind === "command" && entry.number === number,
  );
}

/** The line a live watcher shows for an event, or null to stay quiet. */
export function liveLine(event) {
  if (event.type === "item.completed") {
    return event.item?.type === "agent_message"
      ? `MSG ${oneLine(event.item.text, MESSAGE_WIDTH)}`
      : null;
  }
  if (event.type === "turn.completed") return "TURN completed";
  if (event.type === "turn.failed") {
    return `TURN failed ${oneLine(event.error?.message, MESSAGE_WIDTH)}`;
  }
  if (event.type === "error") {
    return `ERROR ${oneLine(event.message, MESSAGE_WIDTH)}`;
  }
  return null;
}

/**
 * Emit live lines for a round until codex-task.sh writes its exit marker. A
 * round can die without a final event, so silence is reported as STALLED rather
 * than left looking like progress.
 */
export async function followRound({
  logs,
  round,
  emit,
  pollMs = 1000,
  stallMs = 15 * 60 * 1000,
  now = Date.now,
}) {
  const logPath = join(logs, `round-${round}.jsonl`);
  const exitPath = join(logs, `round-${round}.exit`);
  let offset = 0;
  let pending = Buffer.alloc(0);
  let lastActivity = now();
  let stalled = false;

  const drain = async () => {
    if (!existsSync(logPath)) return;
    const file = await open(logPath, "r");
    try {
      const { size } = await file.stat();
      if (size <= offset) return;
      const chunk = Buffer.alloc(size - offset);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
      offset += bytesRead;
      // Split on bytes: a read can end inside a multibyte character.
      pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      lastActivity = now();
      stalled = false;
      let newline = pending.indexOf(10);
      while (newline >= 0) {
        const text = pending.subarray(0, newline).toString("utf8");
        pending = pending.subarray(newline + 1);
        newline = pending.indexOf(10);
        if (text.trim() === "") continue;
        try {
          const line = liveLine(JSON.parse(text));
          if (line) emit(line);
        } catch {
          emit(`MALFORMED ${oneLine(text, 120)}`);
        }
      }
    } finally {
      await file.close();
    }
  };

  for (;;) {
    // Check the marker first: anything written before it is drained below.
    const finished = existsSync(exitPath);
    await drain();
    if (finished) {
      const status = (await readFile(exitPath, "utf8")).trim();
      emit(`END exit=${status}`);
      return status;
    }
    if (!stalled && now() - lastActivity >= stallMs) {
      stalled = true;
      emit(
        `STALLED no events for ${Math.round(stallMs / 60000)} min; ` +
          "a long command or a dead round",
      );
    }
    await delay(pollMs);
  }
}
