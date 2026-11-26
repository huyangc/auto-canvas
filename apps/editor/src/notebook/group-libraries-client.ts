import { apiUrl } from "../lib/app-url";
import {
  parseSharedComponentEntry,
  type SharedComponent,
} from "@icm/component-library";
import type { SymbolDefinition } from "@icm/symbols";

export interface NotebookGroupInfo {
  id: string;
  name: string;
  kind: string;
  description: string;
  ownerId: string;
  myRole: string;
  isAdmin: boolean;
  memberCount: number;
  approvedProjectCount: number;
  approvedComponentCount: number;
  pendingProjectCount?: number;
  pendingComponentCount?: number;
}

export interface NotebookSpaceInfo {
  id: string;
  name: string;
  access: string;
  isAdmin: boolean;
}

export type GroupItemStatus = "pending" | "approved" | "rejected";
export type GroupListFilter = "approved" | "pending" | "mine";

export interface GroupProjectSummary {
  id: string;
  groupId?: string;
  notebookId?: string;
  authorId: string;
  authorName: string;
  sourceProjectId: string | null;
  name: string;
  description: string;
  status: GroupItemStatus;
  schemaVersion: number;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface GroupProjectDetail extends GroupProjectSummary {
  projectText: string;
}

export interface GroupComponentSummary {
  id: string;
  groupId?: string;
  notebookId?: string;
  authorId: string;
  authorName: string;
  sourceComponentId: string | null;
  name: string;
  description: string;
  status: GroupItemStatus;
  capability: string;
  pinCount: number;
  parameterCount: number;
  symbol: SymbolDefinition | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  fetchLike: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchLike(apiUrl(path), {
    cache: "no-store",
    ...init,
  });
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (!response.ok) {
    const code =
      payload && typeof payload.error === "string" ? payload.error : "";
    throw new Error(code || `Request failed (${response.status})`);
  }
  if (!payload) throw new Error("Invalid server response");
  return payload;
}

export function groupProjectPreviewUrl(
  groupId: string,
  projectId: string,
): string {
  return apiUrl(
    `notebook/groups/${encodeURIComponent(groupId)}/projects/${encodeURIComponent(projectId)}/preview.svg`,
  );
}

export function notebookProjectPreviewUrl(
  notebookId: string,
  projectId: string,
): string {
  return apiUrl(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/projects/${encodeURIComponent(projectId)}/preview.svg`,
  );
}

export async function listNotebookGroups(
  fetchLike: typeof fetch = fetch,
): Promise<NotebookGroupInfo[]> {
  const data = await requestJson<{ groups: NotebookGroupInfo[] }>(
    "notebook/groups",
    {},
    fetchLike,
  );
  return data.groups;
}

export async function listGroupProjects(
  groupId: string,
  status: GroupListFilter = "approved",
  fetchLike: typeof fetch = fetch,
): Promise<{
  group: NotebookGroupInfo;
  projects: GroupProjectSummary[];
  pendingCount?: number;
}> {
  return requestJson(
    `notebook/groups/${encodeURIComponent(groupId)}/projects?status=${encodeURIComponent(status)}`,
    {},
    fetchLike,
  );
}

export async function openGroupProject(
  groupId: string,
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<GroupProjectDetail> {
  const data = await requestJson<{ project: GroupProjectDetail }>(
    `notebook/groups/${encodeURIComponent(groupId)}/projects/${encodeURIComponent(projectId)}`,
    {},
    fetchLike,
  );
  return data.project;
}

export async function submitGroupProject(
  groupId: string,
  input: {
    name?: string;
    description?: string;
    projectText?: string;
    sourceProjectId?: string;
  },
  fetchLike: typeof fetch = fetch,
): Promise<GroupProjectSummary> {
  const data = await requestJson<{ project: GroupProjectSummary }>(
    `notebook/groups/${encodeURIComponent(groupId)}/projects`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    fetchLike,
  );
  return data.project;
}

export async function reviewGroupProject(
  groupId: string,
  projectId: string,
  decision: "approve" | "reject",
  note = "",
  fetchLike: typeof fetch = fetch,
): Promise<GroupProjectSummary> {
  const data = await requestJson<{ project: GroupProjectSummary }>(
    `notebook/groups/${encodeURIComponent(groupId)}/projects/${encodeURIComponent(projectId)}/review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note }),
    },
    fetchLike,
  );
  return data.project;
}

export async function deleteGroupProject(
  groupId: string,
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    `notebook/groups/${encodeURIComponent(groupId)}/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
    fetchLike,
  );
}

export async function listGroupComponents(
  groupId: string,
  status: GroupListFilter = "approved",
  fetchLike: typeof fetch = fetch,
): Promise<{
  group: NotebookGroupInfo;
  components: GroupComponentSummary[];
  pendingCount?: number;
}> {
  return requestJson(
    `notebook/groups/${encodeURIComponent(groupId)}/components?status=${encodeURIComponent(status)}`,
    {},
    fetchLike,
  );
}

export async function readGroupComponent(
  groupId: string,
  componentId: string,
  fetchLike: typeof fetch = fetch,
): Promise<{ component: GroupComponentSummary; entry: SharedComponent }> {
  const data = await requestJson<{
    component: GroupComponentSummary;
    entry: unknown;
  }>(
    `notebook/groups/${encodeURIComponent(groupId)}/components/${encodeURIComponent(componentId)}`,
    {},
    fetchLike,
  );
  return {
    component: data.component,
    entry: parseSharedComponentEntry(data.entry),
  };
}

export async function submitGroupComponent(
  groupId: string,
  input: {
    sourceComponentId?: string;
    definition?: unknown;
    circuit?: unknown;
    description?: string;
  },
  fetchLike: typeof fetch = fetch,
): Promise<GroupComponentSummary> {
  const data = await requestJson<{ component: GroupComponentSummary }>(
    `notebook/groups/${encodeURIComponent(groupId)}/components`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    fetchLike,
  );
  return data.component;
}

export async function reviewGroupComponent(
  groupId: string,
  componentId: string,
  decision: "approve" | "reject",
  note = "",
  fetchLike: typeof fetch = fetch,
): Promise<GroupComponentSummary> {
  const data = await requestJson<{ component: GroupComponentSummary }>(
    `notebook/groups/${encodeURIComponent(groupId)}/components/${encodeURIComponent(componentId)}/review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note }),
    },
    fetchLike,
  );
  return data.component;
}

export async function deleteGroupComponent(
  groupId: string,
  componentId: string,
  fetchLike: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    `notebook/groups/${encodeURIComponent(groupId)}/components/${encodeURIComponent(componentId)}`,
    { method: "DELETE" },
    fetchLike,
  );
}

// --- Per-notebook circuit projects & components ---

export async function listNotebookProjects(
  notebookId: string,
  status: GroupListFilter = "approved",
  fetchLike: typeof fetch = fetch,
): Promise<{
  notebook: NotebookSpaceInfo;
  projects: GroupProjectSummary[];
  pendingCount?: number;
}> {
  return requestJson(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/projects?status=${encodeURIComponent(status)}`,
    {},
    fetchLike,
  );
}

export async function openNotebookProject(
  notebookId: string,
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<GroupProjectDetail> {
  const data = await requestJson<{ project: GroupProjectDetail }>(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/projects/${encodeURIComponent(projectId)}`,
    {},
    fetchLike,
  );
  return data.project;
}

export async function submitNotebookProject(
  notebookId: string,
  input: {
    name?: string;
    description?: string;
    projectText?: string;
    sourceProjectId?: string;
  },
  fetchLike: typeof fetch = fetch,
): Promise<GroupProjectSummary> {
  const data = await requestJson<{ project: GroupProjectSummary }>(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/projects`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    fetchLike,
  );
  return data.project;
}

export async function reviewNotebookProject(
  notebookId: string,
  projectId: string,
  decision: "approve" | "reject",
  note = "",
  fetchLike: typeof fetch = fetch,
): Promise<GroupProjectSummary> {
  const data = await requestJson<{ project: GroupProjectSummary }>(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/projects/${encodeURIComponent(projectId)}/review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note }),
    },
    fetchLike,
  );
  return data.project;
}

export async function deleteNotebookProject(
  notebookId: string,
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
    fetchLike,
  );
}

export async function listNotebookComponents(
  notebookId: string,
  status: GroupListFilter = "approved",
  fetchLike: typeof fetch = fetch,
): Promise<{
  notebook: NotebookSpaceInfo;
  components: GroupComponentSummary[];
  pendingCount?: number;
}> {
  return requestJson(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/components?status=${encodeURIComponent(status)}`,
    {},
    fetchLike,
  );
}

export async function readNotebookComponent(
  notebookId: string,
  componentId: string,
  fetchLike: typeof fetch = fetch,
): Promise<{ component: GroupComponentSummary; entry: SharedComponent }> {
  const data = await requestJson<{
    component: GroupComponentSummary;
    entry: unknown;
  }>(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/components/${encodeURIComponent(componentId)}`,
    {},
    fetchLike,
  );
  return {
    component: data.component,
    entry: parseSharedComponentEntry(data.entry),
  };
}

export async function submitNotebookComponent(
  notebookId: string,
  input: {
    sourceComponentId?: string;
    definition?: unknown;
    circuit?: unknown;
    description?: string;
  },
  fetchLike: typeof fetch = fetch,
): Promise<GroupComponentSummary> {
  const data = await requestJson<{ component: GroupComponentSummary }>(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/components`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    fetchLike,
  );
  return data.component;
}

export async function reviewNotebookComponent(
  notebookId: string,
  componentId: string,
  decision: "approve" | "reject",
  note = "",
  fetchLike: typeof fetch = fetch,
): Promise<GroupComponentSummary> {
  const data = await requestJson<{ component: GroupComponentSummary }>(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/components/${encodeURIComponent(componentId)}/review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note }),
    },
    fetchLike,
  );
  return data.component;
}

export async function deleteNotebookComponent(
  notebookId: string,
  componentId: string,
  fetchLike: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    `notebook/notebooks/${encodeURIComponent(notebookId)}/components/${encodeURIComponent(componentId)}`,
    { method: "DELETE" },
    fetchLike,
  );
}
