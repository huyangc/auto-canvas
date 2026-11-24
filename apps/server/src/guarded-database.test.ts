import { describe, expect, it } from "vitest";
import {
  GuardedConfigurationError,
  guardedPostgresUrl,
  notebookDatabase,
} from "./guarded-database.js";

const name63 = "n".repeat(63);

describe("guardedPostgresUrl", () => {
  it.each([
    ["postgresql://h/db", "db"],
    ["postgres://u:p@h:5432/db", "db"],
    ["postgresql://u@127.0.0.1/a_b-1", "a_b-1"],
    ["postgresql://[::1]:5432/db", "db"],
    [`postgresql://h/${name63}`, name63],
  ])("accepts %s", (value, database) => {
    expect(guardedPostgresUrl(value)).toBe(database);
  });

  it.each([
    ["an empty value", ""],
    ["no value", undefined],
    ["a SQLite URL", "sqlite:///x"],
    ["another scheme", "mysql://h/db"],
    ["no host", "postgresql:///db"],
    ["no database name", "postgresql://h/"],
    ["?dbname=", "postgresql://h/db?dbname=other"],
    ["?host=", "postgresql://h/db?host=/tmp"],
    ["?service=", "postgresql://h/db?service=x"],
    ["?options=", "postgresql://h/db?options=-csearch_path%3Dx"],
    ["a fragment", "postgresql://h/db#x"],
    ["a percent sign in the name", "postgresql://h/d%62"],
    ["a percent sign in the host", "postgresql://%2Ftmp/db"],
    ["a second path segment", "postgresql://h/db/extra"],
    ["a space in the name", "postgresql://h/my db"],
    ["a 64-character name", `postgresql://h/${"n".repeat(64)}`],
    ["a non-numeric port", "postgresql://h:port/db"],
    ["a port outside 1-65535", "postgresql://h:65536/db"],
    ["text before the scheme", " postgresql://h/db"],
    ["a socket directory as host", "postgresql://%2Fvar%2Frun/db"],
    ["a bracketed host that is no IPv6 address", "postgresql://[:::]/db"],
    ["a bracketed host with too few groups", "postgresql://[1:2:3]/db"],
  ])("refuses %s", (_case, value) => {
    expect(() => guardedPostgresUrl(value)).toThrow(GuardedConfigurationError);
  });

  it("never names the password of a refused value", () => {
    for (const value of [
      "postgresql://u:S3cretPw@h/db?dbname=x",
      "postgresql://u:S3cretPw@/db",
      "postgresql://u:S3cretPw@h/db#x",
      "postgresql://u:S3cretPw@h:99999/db",
    ]) {
      let message = "";
      try {
        guardedPostgresUrl(value);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("S3cretPw");
    }
  });
});

const VALID = "DATABASE_URL=postgresql://u:p@h/db";
const lines = (...text: string[]) => text.join("\n") + "\n";

function refusal(text: string): string {
  try {
    notebookDatabase(text);
  } catch (error) {
    expect(error).toBeInstanceOf(GuardedConfigurationError);
    return (error as Error).message;
  }
  throw new Error("notebookDatabase accepted the file");
}

describe("notebookDatabase", () => {
  it.each([
    ["an unquoted value", VALID],
    ["export", "export DATABASE_URL=postgresql://u:p@h/db"],
    ["a double-quoted value", 'DATABASE_URL="postgresql://u:p@h/db"'],
    ["a single-quoted value", "DATABASE_URL='postgresql://u:p@h/db'"],
    [
      "leading and trailing blanks",
      " \t export  DATABASE_URL=postgresql://u:p@h/db \t",
    ],
    [
      "a commented assignment beside a real one",
      lines("# DATABASE_URL=sqlite:///.local/x.db", VALID),
    ],
    [
      "keys that only resemble DATABASE_URL",
      lines(
        "SHADOW_DATABASE_URL=postgresql://h/shadow",
        VALID,
        "DATABASE_URL_BACKUP=postgresql://h/backup",
        "AUTO_CANVAS_DATABASE_URL=postgresql://h/canvas",
      ),
    ],
    [
      "other keys with empty, quoted and unquoted literal values",
      lines(
        "EMPTY=",
        'QUOTED="a b !"',
        "SINGLE='$HOME `x`'",
        "PLAIN=a:b,c=d",
        VALID,
      ),
    ],
    [
      "plain strings a deployment may set",
      lines(
        "PATH=/usr/bin:/bin",
        "HOSTNAME=box",
        "LANG=C.UTF-8",
        "LC_ALL=C",
        VALID,
      ),
    ],
    ["no trailing newline", `# comment\n\n${VALID}`],
  ])("accepts %s", (_case, text) => {
    expect(notebookDatabase(text)).toBe("db");
  });

  it("returns null for silicon-notebook's SQLite form", () => {
    expect(notebookDatabase("DATABASE_URL=sqlite:///x\n")).toBeNull();
    expect(
      notebookDatabase('DATABASE_URL="sqlite:///.local/silicon_notebook.db"'),
    ).toBeNull();
  });

  it.each([
    ["no DATABASE_URL key", lines("OTHER=1"), "no DATABASE_URL"],
    ["two DATABASE_URL keys", lines(VALID, "OTHER=1", VALID), "line 3"],
    [
      "a database_url key alone",
      lines("database_url=postgresql://h/db"),
      "line 1",
    ],
    [
      "a database_url key beside the upper-case one",
      lines(VALID, "Database_Url=postgresql://h/other"),
      "line 2",
    ],
    [
      "a default expansion",
      lines("A=1", 'DATABASE_URL="${DATABASE_URL:-sqlite:///x}"'),
      "line 2",
    ],
    ["a variable", lines("DATABASE_URL=$OTHER"), "line 1"],
    ["a backquoted command", lines("DATABASE_URL=`cmd`"), "line 1"],
    ["a command substitution", lines("DATABASE_URL=$(cmd)"), "line 1"],
    ["an inactive assignment", lines("if false; then", VALID, "fi"), "line 1"],
    [
      "a value continued inside quotes",
      lines('DATABASE_URL="postgresql://u:p@h/', 'db"'),
      "line 1",
    ],
    ["a command after a value", lines(`${VALID}; other`), "line 1"],
    [
      "an unterminated quote",
      lines("A=1", "DATABASE_URL='postgresql://h/db"),
      "line 2",
    ],
    ["echo elsewhere", lines(VALID, "echo hi"), "line 2"],
    ["unset elsewhere", lines(VALID, "unset DATABASE_URL"), "line 2"],
    ["source elsewhere", lines("source other", VALID), "line 1"],
    ["another key with an expansion", lines(VALID, "OTHER=$HOME"), "line 2"],
    ["CRLF line ends", `A=1\r\n${VALID}\r\n`, "line 1"],
    ["a NUL inside a comment", `A=1\n# x\0y\n${VALID}\n`, "line 2"],
    ["OPTIND", lines("OPTIND=2", VALID), "line 1"],
    ["BASH_ENV", lines(VALID, "BASH_ENV=/tmp/x"), "line 2"],
    ["HISTFILESIZE", lines(VALID, "HISTFILESIZE=1"), "line 2"],
    ["IFS", lines("IFS=x", VALID), "line 1"],
    [
      "SILICON_NOTEBOOK_ENV_FILE",
      lines(VALID, "SILICON_NOTEBOOK_ENV_FILE=/tmp/other.env"),
      "line 2",
    ],
    [
      "a SQLite URL with a host",
      lines("A=1", "DATABASE_URL=sqlite://host/x"),
      "line 2",
    ],
    ["a SQLite URL without a path", lines("DATABASE_URL=sqlite:///"), "line 1"],
    [
      "a PostgreSQL URL outside the guarded form",
      lines("DATABASE_URL=postgresql:///db"),
      "line 1",
    ],
    ["an empty value", lines("DATABASE_URL="), "line 1"],
  ])("refuses %s", (_case, text, expected) => {
    expect(refusal(text)).toContain(expected);
  });

  it("never names a value from the file", () => {
    const secret = "S3cretValue";
    for (const text of [
      lines(`DATABASE_URL=postgresql://u:${secret}@h/db?dbname=x`),
      lines(`DATABASE_URL="${secret}$HOME"`),
      lines(VALID, `OTHER=${secret}$x`),
      lines(`database_url=${secret}`),
      `DATABASE_URL=${secret}\r\n`,
      lines(VALID, `IFS=${secret}`),
    ])
      expect(refusal(text)).not.toContain(secret);
  });

  it("reads silicon-notebook's shipped .env.example", () => {
    // The active lines of silicon-notebook's .env.example at the revision the
    // T164 plan cites, secret-looking values replaced; a copy, so the test
    // does not depend on the sibling checkout.
    const example = lines(
      "SILICON_NOTEBOOK_ENV=development",
      "SILICON_NOTEBOOK_ADMIN_PASSWORD=change-me",
      "SILICON_NOTEBOOK_AUTH_OPTIONAL=false",
      "DATABASE_URL=postgresql://silicon_app:change-me@127.0.0.1:5432/silicon_notebook",
      "# DATABASE_URL=sqlite:///.local/silicon_notebook.db",
      "SILICON_NOTEBOOK_STORAGE_DIR=.local/storage",
      "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api",
      "MODEL_SERVICES_CONFIG=.local/model-services.toml",
      'SYSTEM_GENERAL_API_KEY=""',
      'SYSTEM_REASONING_API_KEY=""',
      'SYSTEM_EMBEDDING_API_KEY=""',
      'SYSTEM_RERANK_API_KEY=""',
      "EMBED_DIM=1024",
    );
    expect(notebookDatabase(example)).toBe("silicon_notebook");
  });
});
