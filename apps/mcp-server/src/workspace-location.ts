import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function userWorkspaceRoot(
  env: Record<string, string | undefined> = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  const base =
    platform === "win32"
      ? env.LOCALAPPDATA || join(home, "AppData", "Local")
      : platform === "darwin"
        ? join(home, "Library", "Application Support")
        : env.XDG_DATA_HOME || join(home, ".local", "share");
  if (!isAbsolute(base))
    throw new Error("WORKSPACE_DATA_ROOT_MUST_BE_ABSOLUTE");
  return join(base, "analog-canvas", "workspaces");
}

/** One small pointer per server/active Project identity. No credentials or migration. */
