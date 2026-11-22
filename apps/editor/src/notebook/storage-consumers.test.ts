// The notebook build's Storage facades support only the six Storage members
// (no named properties): first-party code must not use any other form.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const SOURCE = resolve(import.meta.dirname, "..");
const MEMBERS = new Set([
  "getItem",
  "setItem",
  "removeItem",
  "key",
  "clear",
  "length",
]);

/** `localStorage` / `sessionStorage` followed by `[` or a member other than the six. */
function namedStorageAccess(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(
    /\b(localStorage|sessionStorage)\s*(?:\?\.\s*(\[)|\?\.\s*([\w$]+)|\.\s*([\w$]+)|(\[))/gu,
  )) {
    const member = match[3] ?? match[4];
    if (match[2] || match[5] || (member && !MEMBERS.has(member)))
      found.push(match[0]);
  }
  return found;
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) &&
      !/\.test\.(?:ts|tsx)$/u.test(entry.name)
      ? [path]
      : [];
  });
}

it("finds named and computed Storage access, and nothing else", () => {
  expect(
    namedStorageAccess(
      [
        "localStorage.theme;",
        "window.sessionStorage['k'];",
        "localStorage?.[key];",
        "globalThis.localStorage?.foo;",
        "localStorage.getItem('a'); sessionStorage?.setItem('b', 'c');",
        "localStorage.length; localStorage.key(0); localStorage.clear();",
        "localStorage . removeItem('x');",
      ].join("\n"),
    ),
  ).toEqual([
    "localStorage.theme",
    "sessionStorage[",
    "localStorage?.[",
    "localStorage?.foo",
  ]);
});

it("uses localStorage and sessionStorage only through the six Storage members", () => {
  const problems = sources(SOURCE).flatMap((path) =>
    namedStorageAccess(readFileSync(path, "utf8")).map(
      (access) => `${relative(SOURCE, path)}: ${access}`,
    ),
  );
  expect(problems).toEqual([]);
});
