import { directNotebookGet, readNotebookCapped } from "./notebook-identity.js";

export interface NotebookGroup {
  id: string;
  name: string;
  kind: string;
  description: string;
  ownerId: string;
  myRole: string;
  isAdmin: boolean;
  memberCount: number;
}

export interface NotebookSpace {
  id: string;
  name: string;
  access: string;
  isAdmin: boolean;
}

export type NotebookGroupListResult =
  { ok: true; groups: NotebookGroup[] } | { ok: false; status: 401 | 503 };

export type NotebookGroupResolveResult =
  { ok: true; group: NotebookGroup } | { ok: false; status: 401 | 404 | 503 };

export type NotebookSpaceResolveResult =
  | { ok: true; notebook: NotebookSpace }
  | { ok: false; status: 401 | 404 | 503 };

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const MAX_GROUP_BODY_BYTES = 512 * 1024;

export function isValidGroupId(id: string): boolean {
  return RESOURCE_ID_PATTERN.test(id);
}

function parseGroup(raw: unknown, systemAdmin: boolean): NotebookGroup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !isValidGroupId(id) || !name) return null;
  const kind =
    typeof record.kind === "string" && record.kind.trim()
      ? record.kind.trim()
      : "project";
  const description =
    typeof record.description === "string" ? record.description : "";
  const ownerId = typeof record.owner_id === "string" ? record.owner_id : "";
  const myRole = typeof record.my_role === "string" ? record.my_role : "";
  const memberCount =
    typeof record.member_count === "number" &&
    Number.isInteger(record.member_count) &&
    record.member_count >= 0
      ? record.member_count
      : 0;
  return {
    id,
    name,
    kind,
    description,
    ownerId,
    myRole,
    isAdmin: myRole === "admin" || systemAdmin,
    memberCount,
  };
}

function parseNotebook(
  raw: unknown,
  systemAdmin: boolean,
): NotebookSpace | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !isValidGroupId(id)) return null;
  const access = typeof record.access === "string" ? record.access : "reader";
  const canManage =
    record.can_manage_notebook === true || record.can_manage_content === true;
  return {
    id,
    name: name || id,
    access,
    isAdmin: access === "owner" || canManage || systemAdmin,
  };
}

/**
 * Queries silicon-notebook's group and notebook endpoints directly over
 * loopback using the caller's bearer token. No membership or permission is
 * cached across requests so revocations take effect immediately.
 */
export function createNotebookGroups({
  notebookApi,
  fetch,
  timeoutMs = 5000,
}: {
  notebookApi: URL;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): {
  list(token: string, systemAdmin: boolean): Promise<NotebookGroupListResult>;
  resolve(
    token: string,
    groupId: string,
    systemAdmin: boolean,
  ): Promise<NotebookGroupResolveResult>;
  resolveNotebook(
    token: string,
    notebookId: string,
    systemAdmin: boolean,
  ): Promise<NotebookSpaceResolveResult>;
} {
  const send = fetch ?? directNotebookGet;

  async function requestJson(
    path: string,
    token: string,
  ): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
    const url = new URL(path, notebookApi);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([
        send(url, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "manual",
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        return { ok: false, status: response.status };
      }
      const text = await Promise.race([
        readNotebookCapped(response, controller.signal, MAX_GROUP_BODY_BYTES),
        timeout,
      ]);
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: 503 };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }

  return {
    async list(token, systemAdmin) {
      let result = await requestJson(
        systemAdmin ? "/api/groups?scope=all" : "/api/groups?scope=mine",
        token,
      );
      if (!result.ok && systemAdmin && result.status === 403)
        result = await requestJson("/api/groups?scope=mine", token);
      if (!result.ok)
        return {
          ok: false,
          status: result.status === 401 ? 401 : 503,
        };
      if (!Array.isArray(result.data)) return { ok: false, status: 503 };
      const groups: NotebookGroup[] = [];
      for (const item of result.data) {
        const parsed = parseGroup(item, systemAdmin);
        if (parsed) groups.push(parsed);
      }
      return { ok: true, groups };
    },

    async resolve(token, groupId, systemAdmin) {
      if (!isValidGroupId(groupId)) return { ok: false, status: 404 };
      const result = await requestJson(
        `/api/groups/${encodeURIComponent(groupId)}`,
        token,
      );
      if (!result.ok) {
        if (result.status === 401) return { ok: false, status: 401 };
        if (result.status === 404 || result.status === 403)
          return { ok: false, status: 404 };
        return { ok: false, status: 503 };
      }
      const group = parseGroup(result.data, systemAdmin);
      if (!group) return { ok: false, status: 503 };
      if (!group.myRole && !systemAdmin) return { ok: false, status: 404 };
      return { ok: true, group };
    },

    async resolveNotebook(token, notebookId, systemAdmin) {
      if (!isValidGroupId(notebookId)) return { ok: false, status: 404 };
      const result = await requestJson(
        `/api/notebooks/${encodeURIComponent(notebookId)}`,
        token,
      );
      if (!result.ok) {
        if (result.status === 401) return { ok: false, status: 401 };
        if (result.status === 404 || result.status === 403)
          return { ok: false, status: 404 };
        return { ok: false, status: 503 };
      }
      const notebook = parseNotebook(result.data, systemAdmin);
      if (!notebook) return { ok: false, status: 503 };
      return { ok: true, notebook };
    },
  };
}
