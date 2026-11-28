import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { ApiImage } from "../components/api-image";
import {
  deleteGroupProject,
  deleteNotebookProject,
  groupProjectPreviewUrl,
  listGroupProjects,
  listNotebookGroups,
  listNotebookProjects,
  notebookProjectPreviewUrl,
  openGroupProject,
  openNotebookProject,
  reviewGroupProject,
  reviewNotebookProject,
  submitGroupProject,
  submitNotebookProject,
  type GroupListFilter,
  type GroupProjectSummary,
  type NotebookGroupInfo,
  type NotebookSpaceInfo,
} from "./group-libraries-client";
import "./group-libraries.css";

export interface GroupProjectsPanelProps {
  currentProject?: CircuitProject | undefined;
  groupVisibility?: "all" | "private" | "public" | undefined;
  initialGroupId?: string | null | undefined;
  strictInitialGroup?: boolean | undefined;
  notebookId?: string | null | undefined;
  notebookName?: string | null | undefined;
  onSelectGroup?: ((groupId: string) => void) | undefined;
  onDeepLinkVisibilityMismatch?:
    ((visibility: "private" | "public") => void) | undefined;
  onOpenGroupProject(
    name: string,
    projectText: string,
  ): void | boolean | Promise<void | boolean>;
}

const STATUS_LABEL: Record<GroupProjectSummary["status"], string> = {
  approved: "已入库",
  pending: "待审核",
  rejected: "已驳回",
};

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function extractBatchProjectName(
  fileName: string,
  projectText: string,
): string {
  try {
    const parsed = JSON.parse(projectText) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { name?: unknown }).name === "string"
    ) {
      const candidate = (parsed as { name: string }).name.trim();
      if (candidate) return candidate.slice(0, 120);
    }
  } catch {
    // Fall back to filename stem; server validates the project payload.
  }
  const stem = fileName
    .replace(/\.icproj\.json$/iu, "")
    .replace(/\.json$/iu, "")
    .trim();
  return (stem || "Untitled").slice(0, 120);
}

interface BatchUploadFailure {
  fileName: string;
  reason: string;
}

interface BatchUploadState {
  running: boolean;
  current: number;
  total: number;
  summary: string | null;
  failures: BatchUploadFailure[];
  completedSeq: number;
}

const EMPTY_BATCH_STATE: BatchUploadState = {
  running: false,
  current: 0,
  total: 0,
  summary: null,
  failures: [],
  completedSeq: 0,
};

// Module-level in-memory store (no browser storage) so batch upload progress
// and final reports survive dialog closes and tab switches within the session.
const batchStates = new Map<string, BatchUploadState>();
const batchCancelled = new Set<string>();
const batchListeners = new Set<() => void>();
let batchCompletedCounter = 0;

function emitBatchChange(): void {
  for (const listener of batchListeners) listener();
}

function subscribeBatchStore(listener: () => void): () => void {
  batchListeners.add(listener);
  return () => {
    batchListeners.delete(listener);
  };
}

function getBatchState(key: string): BatchUploadState {
  if (!key) return EMPTY_BATCH_STATE;
  return batchStates.get(key) ?? EMPTY_BATCH_STATE;
}

function clearBatchReport(key: string): void {
  const existing = batchStates.get(key);
  if (!existing || existing.running) return;
  batchStates.delete(key);
  emitBatchChange();
}

function cancelBatchUpload(key: string): void {
  if (!batchStates.get(key)?.running) return;
  batchCancelled.add(key);
  emitBatchChange();
}

async function runBatchUpload(params: {
  key: string;
  targetNotebookId: string | null;
  targetGroupId: string | null;
  scopeLabel: string;
  files: File[];
}): Promise<void> {
  const { key, targetNotebookId, targetGroupId, scopeLabel, files } = params;
  if (batchStates.get(key)?.running) return;
  batchCancelled.delete(key);
  batchStates.set(key, {
    running: true,
    current: 0,
    total: files.length,
    summary: null,
    failures: [],
    completedSeq: batchStates.get(key)?.completedSeq ?? 0,
  });
  emitBatchChange();

  let approvedCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  const failures: BatchUploadFailure[] = [];

  for (let index = 0; index < files.length; index++) {
    if (batchCancelled.has(key)) {
      cancelledCount = files.length - index;
      break;
    }
    const file = files[index]!;
    const prev = batchStates.get(key) ?? EMPTY_BATCH_STATE;
    batchStates.set(key, {
      ...prev,
      running: true,
      current: index + 1,
      total: files.length,
    });
    emitBatchChange();
    try {
      const projectText = await file.text();
      const name = extractBatchProjectName(file.name, projectText);
      const payload = { name, description: "", projectText };
      const created = targetNotebookId
        ? await submitNotebookProject(targetNotebookId, payload)
        : await submitGroupProject(targetGroupId!, payload);
      if (created.status === "approved") approvedCount += 1;
      else pendingCount += 1;
    } catch (err) {
      failures.push({
        fileName: file.name,
        reason: err instanceof Error ? err.message : "上传失败",
      });
    }
  }

  batchCancelled.delete(key);
  const succeeded = approvedCount + pendingCount;
  const summaryParts: string[] = [];
  if (succeeded > 0) {
    const detailParts: string[] = [];
    if (approvedCount > 0) detailParts.push(`${approvedCount} 个已入库`);
    if (pendingCount > 0) detailParts.push(`${pendingCount} 个待审核`);
    summaryParts.push(`成功 ${succeeded} 个（${detailParts.join("，")}）`);
  }
  if (failures.length > 0) summaryParts.push(`失败 ${failures.length} 个`);
  if (cancelledCount > 0) summaryParts.push(`已取消剩余 ${cancelledCount} 个`);

  const summary =
    summaryParts.length > 0
      ? `批量上传到「${scopeLabel}」${cancelledCount > 0 ? "已停止" : "完成"}：${summaryParts.join("，")}。`
      : null;

  const nextCompletedSeq =
    succeeded > 0
      ? ++batchCompletedCounter
      : (batchStates.get(key)?.completedSeq ?? 0);

  batchStates.set(key, {
    running: false,
    current: 0,
    total: 0,
    summary,
    failures,
    completedSeq: nextCompletedSeq,
  });
  emitBatchChange();
}

/** Test-only reset to keep unit tests isolated. */
export function resetBatchUploadStateForTests(): void {
  batchStates.clear();
  batchCancelled.clear();
  batchCompletedCounter = 0;
  emitBatchChange();
}

export function GroupProjectsPanel({
  currentProject,
  groupVisibility = "all",
  initialGroupId,
  strictInitialGroup = true,
  notebookId,
  notebookName,
  onSelectGroup,
  onDeepLinkVisibilityMismatch,
  onOpenGroupProject,
}: GroupProjectsPanelProps) {
  const isNotebookScope = Boolean(notebookId);
  const isPublicScope = !isNotebookScope && groupVisibility === "public";
  const [notebookSpace, setNotebookSpace] = useState<NotebookSpaceInfo | null>(
    null,
  );
  const [groups, setGroups] = useState<NotebookGroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(!isNotebookScope);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    initialGroupId ?? "",
  );
  const [filter, setFilter] = useState<GroupListFilter>("approved");
  const [projects, setProjects] = useState<GroupProjectSummary[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitName, setSubmitName] = useState(
    currentProject?.name.trim() || "",
  );
  const [submitDesc, setSubmitDesc] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const listRequestSeq = useRef(0);
  const selectedGroupIdRef = useRef(selectedGroupId);
  selectedGroupIdRef.current = selectedGroupId;

  const selectedGroup = isNotebookScope
    ? null
    : (groups.find((item) => item.id === selectedGroupId) ?? null);
  const canAdmin = isNotebookScope
    ? Boolean(notebookSpace?.isAdmin)
    : Boolean(selectedGroup?.isAdmin);
  const targetName = isNotebookScope
    ? (notebookSpace?.name ?? notebookName ?? "当前笔记本")
    : (selectedGroup?.name ?? "");
  const batchKey = isNotebookScope
    ? notebookId
      ? `notebook:${notebookId}`
      : ""
    : selectedGroup
      ? `group:${selectedGroup.id}`
      : "";
  const batchState = useSyncExternalStore(
    subscribeBatchStore,
    () => getBatchState(batchKey),
    () => EMPTY_BATCH_STATE,
  );
  const isBusy = busyId !== null || batchState.running;
  const lastSeenBatchSeq = useRef(batchState.completedSeq);

  const refreshGroups = useCallback(async () => {
    if (isNotebookScope) {
      setGroupsLoading(false);
      return;
    }
    setGroupsLoading(true);
    setError(null);
    try {
      const allGroups = await listNotebookGroups();
      const list =
        groupVisibility === "public"
          ? allGroups.filter((item) => item.isPublic === true)
          : groupVisibility === "private"
            ? allGroups.filter((item) => !item.isPublic)
            : allGroups;
      setGroups(list);
      const current = selectedGroupIdRef.current;
      let nextGroupId = "";
      let missingDeepLink = false;
      if (current && list.some((item) => item.id === current)) {
        nextGroupId = current;
      } else if (initialGroupId) {
        if (list.some((item) => item.id === initialGroupId)) {
          nextGroupId = initialGroupId;
        } else if (strictInitialGroup) {
          const matchedInAll = allGroups.find(
            (item) => item.id === initialGroupId,
          );
          if (matchedInAll && onDeepLinkVisibilityMismatch) {
            onDeepLinkVisibilityMismatch(
              matchedInAll.isPublic ? "public" : "private",
            );
            return;
          }
          missingDeepLink = true;
        } else {
          nextGroupId = list[0]?.id ?? "";
        }
      } else {
        nextGroupId = list[0]?.id ?? "";
      }
      setSelectedGroupId(nextGroupId);
      if (missingDeepLink) {
        setProjects([]);
        setPendingCount(0);
        setError(
          "链接指定的群组不可访问或你已不在该群组中，请先手动选择一个目标群组。",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "无法加载 Silicon Notebook 群组列表",
      );
    } finally {
      setGroupsLoading(false);
    }
  }, [
    groupVisibility,
    initialGroupId,
    isNotebookScope,
    onDeepLinkVisibilityMismatch,
    strictInitialGroup,
  ]);

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  const refreshProjects = useCallback(async () => {
    const seq = ++listRequestSeq.current;
    if (isNotebookScope && notebookId) {
      setLoading(true);
      setProjects([]);
      setError(null);
      try {
        const data = await listNotebookProjects(notebookId, filter);
        if (listRequestSeq.current !== seq) return;
        setNotebookSpace(data.notebook);
        setProjects(data.projects);
        setPendingCount(data.pendingCount ?? 0);
      } catch (err) {
        if (listRequestSeq.current !== seq) return;
        setError(err instanceof Error ? err.message : "加载笔记本电路库失败");
      } finally {
        if (listRequestSeq.current === seq) setLoading(false);
      }
      return;
    }
    if (!selectedGroupId || !selectedGroup) {
      setProjects([]);
      setPendingCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setProjects([]);
    setError(null);
    try {
      const data = await listGroupProjects(selectedGroupId, filter);
      if (listRequestSeq.current !== seq) return;
      setProjects(data.projects);
      setPendingCount(data.pendingCount ?? 0);
    } catch (err) {
      if (listRequestSeq.current !== seq) return;
      setError(err instanceof Error ? err.message : "加载群组电路工程失败");
    } finally {
      if (listRequestSeq.current === seq) setLoading(false);
    }
  }, [isNotebookScope, notebookId, selectedGroupId, selectedGroup, filter]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects, reloadTick]);

  useEffect(() => {
    if (!canAdmin && filter === "pending") setFilter("approved");
  }, [canAdmin, filter]);

  useEffect(() => {
    if (batchState.completedSeq !== lastSeenBatchSeq.current) {
      lastSeenBatchSeq.current = batchState.completedSeq;
      if (batchState.completedSeq > 0) {
        setReloadTick((v) => v + 1);
        void refreshGroups();
      }
    }
  }, [batchState.completedSeq, refreshGroups]);

  const handleOpen = async (item: GroupProjectSummary) => {
    setBusyId(item.id);
    setError(null);
    try {
      const detail =
        isNotebookScope && notebookId
          ? await openNotebookProject(notebookId, item.id)
          : await openGroupProject(selectedGroupId, item.id);
      await onOpenGroupProject(detail.name, detail.projectText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开电路工程失败");
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmit = async () => {
    if (!currentProject || (!isNotebookScope && !selectedGroup)) return;
    const trimmedName = submitName.trim() || currentProject.name.trim();
    if (!trimmedName) {
      setError("请填写电路工程名称");
      return;
    }
    setBusyId("submit");
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: trimmedName,
        description: submitDesc.trim(),
        projectText: serializeProject(currentProject),
      };
      const created =
        isNotebookScope && notebookId
          ? await submitNotebookProject(notebookId, payload)
          : await submitGroupProject(selectedGroup!.id, payload);
      setSubmitOpen(false);
      setSubmitDesc("");
      setNotice(
        created.status === "approved"
          ? `「${created.name}」已直接入库到「${targetName}」。`
          : `「${created.name}」已提交到「${targetName}」，等待管理员审核。`,
      );
      setReloadTick((v) => v + 1);
      await refreshGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交电路工程失败");
    } finally {
      setBusyId(null);
    }
  };

  const handleBatchUpload = (files: FileList | null) => {
    if (!files || files.length === 0 || !batchKey) return;
    const selectedFiles = Array.from(files);
    if (batchInputRef.current) batchInputRef.current.value = "";
    const targetNotebookId = isNotebookScope ? (notebookId ?? null) : null;
    const targetGroupId = !isNotebookScope ? (selectedGroup?.id ?? null) : null;
    if (!targetNotebookId && !targetGroupId) return;
    const scopeLabel = targetName || "当前电路库";
    setError(null);
    setNotice(null);
    void runBatchUpload({
      key: batchKey,
      targetNotebookId,
      targetGroupId,
      scopeLabel,
      files: selectedFiles,
    });
  };

  const handleReview = async (
    item: GroupProjectSummary,
    decision: "approve" | "reject",
  ) => {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      if (isNotebookScope && notebookId) {
        await reviewNotebookProject(
          notebookId,
          item.id,
          decision,
          reviewNotes[item.id] ?? "",
        );
      } else {
        await reviewGroupProject(
          selectedGroupId,
          item.id,
          decision,
          reviewNotes[item.id] ?? "",
        );
      }
      setNotice(
        decision === "approve"
          ? `已审核通过「${item.name}」并入库。`
          : `已驳回「${item.name}」。`,
      );
      setReloadTick((v) => v + 1);
      await refreshGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "审核操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: GroupProjectSummary) => {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      if (isNotebookScope && notebookId) {
        await deleteNotebookProject(notebookId, item.id);
      } else {
        await deleteGroupProject(selectedGroupId, item.id);
      }
      setNotice(
        item.status === "approved"
          ? `已移除「${item.name}」。`
          : `已撤回「${item.name}」。`,
      );
      setReloadTick((v) => v + 1);
      await refreshGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  if (groupsLoading) {
    return (
      <p className="group-lib-empty">
        {isPublicScope
          ? "正在加载公共电路库…"
          : "正在加载 Silicon Notebook 群组…"}
      </p>
    );
  }

  if (!isNotebookScope && groups.length === 0) {
    return (
      <div className="group-lib-panel">
        {error ? <div className="group-lib-error">{error}</div> : null}
        <p className="group-lib-empty">
          {isPublicScope
            ? "当前暂未配置全员可见的公共群组，请联系系统管理员在 Silicon Notebook 中创建或开启默认公共群组。"
            : "你目前尚未加入任何 Silicon Notebook 群组。请先在 Silicon Notebook 的群组页面创建或加入群组。"}
        </p>
      </div>
    );
  }

  return (
    <div className="group-lib-panel" data-testid="group-projects-panel">
      <div className="group-lib-toolbar">
        <div className="group-lib-selectors">
          {isNotebookScope ? (
            <strong className="group-lib-card-title">{targetName}</strong>
          ) : (
            <select
              className="group-lib-select"
              aria-label="选择群组"
              value={selectedGroupId}
              onChange={(event) => {
                const next = event.target.value;
                setSelectedGroupId(next);
                onSelectGroup?.(next);
                setNotice(null);
                setError(null);
              }}
            >
              {!selectedGroupId ? (
                <option value="" disabled>
                  请选择目标群组…
                </option>
              ) : null}
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                  {group.isAdmin && (group.pendingProjectCount ?? 0) > 0
                    ? `（待审 ${group.pendingProjectCount}）`
                    : ""}
                </option>
              ))}
            </select>
          )}

          <div
            className="group-lib-subtabs"
            role="tablist"
            aria-label="电路工程视图"
          >
            <button
              type="button"
              role="tab"
              className="group-lib-subtab"
              aria-selected={filter === "approved"}
              onClick={() => setFilter("approved")}
            >
              已入库
            </button>
            {canAdmin ? (
              <button
                type="button"
                role="tab"
                className="group-lib-subtab"
                aria-selected={filter === "pending"}
                onClick={() => setFilter("pending")}
              >
                待审核
                {pendingCount > 0 ? (
                  <span className="group-lib-badge">{pendingCount}</span>
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              className="group-lib-subtab"
              aria-selected={filter === "mine"}
              onClick={() => setFilter("mine")}
            >
              我的提交
            </button>
          </div>
        </div>

        {isNotebookScope || selectedGroup ? (
          <div className="group-lib-toolbar-actions">
            <input
              ref={batchInputRef}
              type="file"
              multiple
              accept=".json,.icproj.json"
              aria-label="选择批量上传电路文件"
              style={{ display: "none" }}
              onChange={(event) => handleBatchUpload(event.target.files)}
            />
            <button
              type="button"
              className="group-lib-btn"
              disabled={isBusy}
              onClick={() => batchInputRef.current?.click()}
            >
              {batchState.running
                ? `批量上传中 (${batchState.current}/${batchState.total})…`
                : "批量上传文件…"}
            </button>
            {batchState.running ? (
              <button
                type="button"
                className="group-lib-btn group-lib-btn-danger"
                onClick={() => cancelBatchUpload(batchKey)}
              >
                停止剩余上传
              </button>
            ) : null}
            {currentProject ? (
              <button
                type="button"
                className="group-lib-btn group-lib-btn-primary"
                disabled={batchState.running}
                onClick={() => {
                  setSubmitName(currentProject.name.trim() || "");
                  setSubmitOpen((open) => !open);
                }}
              >
                {submitOpen
                  ? "取消上传"
                  : isNotebookScope
                    ? "上传当前电路到本笔记本"
                    : isPublicScope
                      ? "上传当前电路到公共电路库"
                      : "上传当前电路到本群组"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {submitOpen && (isNotebookScope || selectedGroup) && currentProject ? (
        <div className="group-lib-submit-box">
          <div className="group-lib-submit-row">
            <input
              type="text"
              className="group-lib-input"
              placeholder="电路工程名称"
              aria-label="电路工程名称"
              maxLength={120}
              value={submitName}
              onChange={(event) => setSubmitName(event.target.value)}
            />
            <input
              type="text"
              className="group-lib-input"
              placeholder="简要说明（可选）"
              aria-label="简要说明"
              maxLength={500}
              value={submitDesc}
              onChange={(event) => setSubmitDesc(event.target.value)}
            />
            <button
              type="button"
              className="group-lib-btn group-lib-btn-primary"
              disabled={busyId !== null}
              onClick={() => void handleSubmit()}
            >
              {busyId === "submit" ? "提交中…" : "确认发布"}
            </button>
          </div>
          <p className="group-lib-hint">
            {canAdmin
              ? "你有管理权限，发布的电路工程将直接入库。"
              : "普通成员提交后，需要由管理员审核通过才能入库。"}
          </p>
        </div>
      ) : null}

      {batchState.running ? (
        <div className="group-lib-notice" role="status">
          正在批量上传电路文件（{batchState.current} / {batchState.total}
          ），切换标签页或关闭弹窗不会中断，重新打开后可继续查看进度与结果。
        </div>
      ) : null}
      {!batchState.running && batchState.summary ? (
        <div className="group-lib-notice group-lib-notice-row" role="status">
          <span>{batchState.summary}</span>
          <button
            type="button"
            className="group-lib-btn"
            onClick={() => clearBatchReport(batchKey)}
          >
            关闭
          </button>
        </div>
      ) : null}
      {!batchState.running && batchState.failures.length > 0 ? (
        <div className="group-lib-error" role="alert">
          以下 {batchState.failures.length} 个文件上传失败：
          {batchState.failures
            .map((item) => `${item.fileName}（${item.reason}）`)
            .join("；")}
        </div>
      ) : null}
      {notice ? (
        <div className="group-lib-notice" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="group-lib-error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="group-lib-empty">加载中…</p>
      ) : !isNotebookScope && !selectedGroup ? (
        <p className="group-lib-empty">请先在上方选择一个目标群组。</p>
      ) : projects.length === 0 ? (
        <p className="group-lib-empty">
          {filter === "approved"
            ? isNotebookScope
              ? "本笔记本还没有已入库的电路工程。"
              : isPublicScope
                ? "公共电路库还没有已入库的电路工程。"
                : "该群组还没有已入库的电路工程。"
            : filter === "pending"
              ? "当前没有待审核的电路工程提交。"
              : "你还没有提交过电路工程。"}
        </p>
      ) : (
        <div className="group-lib-grid">
          {projects.map((item) => (
            <article className="group-lib-card" key={item.id}>
              <div className="group-lib-preview">
                <ApiImage
                  src={
                    isNotebookScope && notebookId
                      ? notebookProjectPreviewUrl(notebookId, item.id)
                      : groupProjectPreviewUrl(
                          item.groupId ?? selectedGroupId,
                          item.id,
                        )
                  }
                  alt={item.name}
                  loading="lazy"
                />
              </div>
              <div className="group-lib-card-head">
                <h3 className="group-lib-card-title">{item.name}</h3>
                <span
                  className={`group-lib-status group-lib-status-${item.status}`}
                >
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              <p className="group-lib-meta">
                作者：{item.authorName} · {formatTime(item.updatedAt)}
              </p>
              {item.description ? (
                <p className="group-lib-desc">{item.description}</p>
              ) : null}
              {item.reviewNote ? (
                <p className="group-lib-review-note">
                  审核意见（{item.reviewerName ?? "管理员"}）：{item.reviewNote}
                </p>
              ) : null}

              {filter === "pending" && canAdmin ? (
                <input
                  type="text"
                  className="group-lib-input"
                  placeholder="审核备注（可选）"
                  aria-label={`审核备注 ${item.name}`}
                  maxLength={500}
                  value={reviewNotes[item.id] ?? ""}
                  onChange={(event) =>
                    setReviewNotes((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                />
              ) : null}

              <div className="group-lib-actions">
                <button
                  type="button"
                  className="group-lib-btn group-lib-btn-primary"
                  disabled={busyId !== null}
                  onClick={() => void handleOpen(item)}
                >
                  {busyId === item.id
                    ? "打开中…"
                    : item.status === "pending"
                      ? "在画布预览"
                      : "打开副本"}
                </button>
                {filter === "pending" && canAdmin ? (
                  <>
                    <button
                      type="button"
                      className="group-lib-btn"
                      disabled={busyId !== null}
                      onClick={() => void handleReview(item, "approve")}
                    >
                      通过入库
                    </button>
                    <button
                      type="button"
                      className="group-lib-btn group-lib-btn-danger"
                      disabled={busyId !== null}
                      onClick={() => void handleReview(item, "reject")}
                    >
                      驳回
                    </button>
                  </>
                ) : null}
                {(canAdmin || item.status !== "approved") &&
                filter !== "pending" ? (
                  <button
                    type="button"
                    className="group-lib-btn group-lib-btn-danger"
                    disabled={busyId !== null}
                    onClick={() => void handleDelete(item)}
                  >
                    {item.status === "approved" ? "移除" : "撤回"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
