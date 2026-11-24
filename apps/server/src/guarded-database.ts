/**
 * Database guards for running the canvas as a silicon-notebook companion
 * service. They are used only when `--require-canvas-database` or
 * `--init-empty-database` is given; a standalone start never calls them.
 *
 * Messages name the reason (and, for the notebook's `.env`, the line number)
 * but never a value: a refused value can hold a password.
 */

/** A configuration the guarded start refuses before it connects anywhere. */
export class GuardedConfigurationError extends Error {
  override name = "GuardedConfigurationError";
}

// postgresql:// or postgres://, optional user[:password]@, a non-empty host
// (a name, an IPv4 address or a bracketed IPv6 address), an optional numeric
// port, "/" and a database name PostgreSQL keeps whole (63 bytes at most). No
// query string, no fragment, no percent sign in the host or the name: in this
// form libpq and `pg` resolve the same host and database.
const GUARDED_URL =
  /^postgres(?:ql)?:\/\/(?:[^@/?#\\\s[\]]+@)?(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::([0-9]{1,5}))?\/([A-Za-z0-9_-]{1,63})$/u;

/**
 * Returns the database name of a PostgreSQL URL in the guarded form, and
 * refuses everything else.
 */
export function guardedPostgresUrl(value: string | undefined): string {
  if (value === undefined || value === "")
    throw new GuardedConfigurationError("is missing or empty");
  const match = GUARDED_URL.exec(value);
  if (!match)
    throw new GuardedConfigurationError(
      "is not postgresql://[user[:password]@]host[:port]/name with a host, a database name of at most 63 letters, digits, _ or - and no query or fragment",
    );
  // The lexical form admits a bracketed host that is no IPv6 address
  // (`[:::]`); `pg` would refuse it only when it connects.
  if (!URL.canParse(value))
    throw new GuardedConfigurationError("has a host that is not valid");
  // `pg` decodes the credentials when it connects; a stray percent sign
  // would fail there, after the pool exists.
  const { username, password } = new URL(value);
  try {
    decodeURIComponent(username);
    decodeURIComponent(password);
  } catch {
    throw new GuardedConfigurationError(
      "has a user name or password that is not valid percent-encoding",
    );
  }
  const port = match[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
    throw new GuardedConfigurationError("has a port outside 1-65535");
  return match[2]!;
}

// Assigning these changes how Bash reads the rest of the file or what
// DATABASE_URL ends up as (some are evaluated arithmetically even when
// quoted; others make Bash touch files).
const SPECIAL_PREFIXES = ["BASH", "HIST", "COMP_", "READLINE_", "PROMPT_"];
const SPECIAL_NAMES = new Set([
  "_",
  "OPTIND",
  "OPTARG",
  "OPTERR",
  "RANDOM",
  "SRANDOM",
  "SECONDS",
  "LINENO",
  "EPOCHSECONDS",
  "EPOCHREALTIME",
  "IFS",
  "PPID",
  "UID",
  "EUID",
  "GROUPS",
  "SHELLOPTS",
  "FUNCNAME",
  "FUNCNEST",
  "DIRSTACK",
  "PIPESTATUS",
  "ENV",
  "POSIXLY_CORRECT",
  "GLOBIGNORE",
  "MAILCHECK",
  "TMOUT",
  "IGNOREEOF",
  "histchars",
  "PS0",
  "PS1",
  "PS2",
  "PS3",
  "PS4",
]);

const BLANK = /^[ \t]*$/u;
const COMMENT = /^[ \t]*#/u;
// Optional blanks, optional `export`, a key, `=`, a value that is empty,
// unquoted without whitespace or shell syntax, single-quoted without `'`, or
// double-quoted without $ ` \ ", then optional trailing blanks.
const ASSIGNMENT =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=((?:[^\s$`\\"';&|<>(){}*?[\]~#!]+|'[^']*'|"[^$`\\"]*")?)[ \t]*$/u;
// Any control character except tab and LF.
const CONTROL = /[^\P{Cc}\t\n]/u;

/**
 * Reads the database silicon-notebook's `.env` names, without a shell: the
 * whole file must fit a grammar whose meaning Bash cannot change. Returns
 * the PostgreSQL database name, or null for silicon-notebook's SQLite form.
 */
export function notebookDatabase(envFileText: string): string | null {
  const refuse = (line: number, reason: string) =>
    new GuardedConfigurationError(`line ${line}: ${reason}`);
  const control = CONTROL.exec(envFileText);
  if (control)
    throw refuse(
      envFileText.slice(0, control.index).split("\n").length,
      "holds a control character (a carriage return, a NUL or another)",
    );
  let database: { line: number; value: string } | null = null;
  const lines = envFileText.split("\n");
  for (const [index, text] of lines.entries()) {
    const line = index + 1;
    if (BLANK.test(text) || COMMENT.test(text)) continue;
    const assignment = ASSIGNMENT.exec(text);
    if (!assignment)
      throw refuse(
        line,
        "is not a blank line, a comment or a literal assignment",
      );
    const key = assignment[1]!;
    if (
      SPECIAL_NAMES.has(key) ||
      SPECIAL_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
      throw refuse(line, "assigns a variable Bash treats specially");
    if (key === "SILICON_NOTEBOOK_ENV_FILE")
      throw refuse(
        line,
        "sets SILICON_NOTEBOOK_ENV_FILE, which makes silicon-notebook read another file",
      );
    if (key !== "DATABASE_URL") {
      if (key.toUpperCase() === "DATABASE_URL")
        throw refuse(line, "assigns a differently-cased DATABASE_URL");
      continue;
    }
    if (database) throw refuse(line, "assigns DATABASE_URL a second time");
    database = { line, value: unquote(assignment[2]!) };
  }
  if (!database)
    throw new GuardedConfigurationError("has no DATABASE_URL assignment");
  if (/^sqlite:\/\/\/./u.test(database.value)) return null;
  try {
    return guardedPostgresUrl(database.value);
  } catch (error) {
    if (!(error instanceof GuardedConfigurationError)) throw error;
    throw refuse(
      database.line,
      `DATABASE_URL is not sqlite:///<path>, and as a PostgreSQL URL it ${error.message}`,
    );
  }
}

function unquote(value: string): string {
  return value.startsWith("'") || value.startsWith('"')
    ? value.slice(1, -1)
    : value;
}
