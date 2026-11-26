import { useCallback, useEffect, useState } from "react";
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
  initialGroupId?: string | null | undefined;
  notebookId?: string | null | undefined;
  notebookName?: string | null | undefined;
  onSelectGroup?: ((groupId: string) => void) | undefined;
  onOpenGroupProject(name: string, projectText: string): void;
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

export function GroupProjectsPanel({
  currentProject,
  initialGroupId,
  notebookId,
  notebookName,
  onSelectGroup,
  onOpenGroupProject,
}: GroupProjectsPanelProps) {
  const isNotebookScope = Boolean(notebookId);
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitName, setSubmitName] = useState(
    currentProject?.name.trim() || "",
  );
  const [submitDesc, setSubmitDesc] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const selectedGroup = isNotebookScope
    ? null
    : (groups.find((item) => item.id === selectedGroupId) ?? null);
  const canAdmin = isNotebookScope
    ? Boolean(notebookSpace?.isAdmin)
    : Boolean(selectedGroup?.isAdmin);
  const targetName = isNotebookScope
    ? (notebookSpace?.name ?? notebookName ?? "当前笔记本")
    : (selectedGroup?.name ?? "");

  const refreshGroups = useCallback(async () => {
    if (isNotebookScope) {
      setGroupsLoading(false);
      return;
    }
    setGroupsLoading(true);
    setError(null);
    try {
      const list = await listNotebookGroups();
      setGroups(list);
      setSelectedGroupId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        if (initialGroupId && list.some((item) => item.id === initialGroupId))
          return initialGroupId;
        return list[0]?.id ?? "";
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "无法加载 Silicon Notebook 群组列表",
      );
    } finally {
      setGroupsLoading(false);
    }
  }, [initialGroupId, isNotebookScope]);

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  const refreshProjects = useCallback(async () => {
    if (isNotebookScope && notebookId) {
      setLoading(true);
      setError(null);
      try {
        const data = await listNotebookProjects(notebookId, filter);
        setNotebookSpace(data.notebook);
        setProjects(data.projects);
        if (data.pendingCount !== undefined) setPendingCount(data.pendingCount);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载笔记本电路库失败");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!selectedGroupId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listGroupProjects(selectedGroupId, filter);
      setProjects(data.projects);
      if (data.pendingCount !== undefined) setPendingCount(data.pendingCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载群组电路工程失败");
    } finally {
      setLoading(false);
    }
  }, [isNotebookScope, notebookId, selectedGroupId, filter]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!canAdmin && filter === "pending") setFilter("approved");
  }, [canAdmin, filter]);

  const handleOpen = async (item: GroupProjectSummary) => {
    setBusyId(item.id);
    setError(null);
    try {
      const detail =
        isNotebookScope && notebookId
          ? await openNotebookProject(notebookId, item.id)
          : await openGroupProject(item.groupId ?? selectedGroupId, item.id);
      onOpenGroupProject(detail.name, detail.projectText);
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
      await Promise.all([refreshGroups(), refreshProjects()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交电路工程失败");
    } finally {
      setBusyId(null);
    }
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
          item.groupId ?? selectedGroupId,
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
      await Promise.all([refreshGroups(), refreshProjects()]);
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
        await deleteGroupProject(item.groupId ?? selectedGroupId, item.id);
      }
      setNotice(
        item.status === "approved"
          ? `已移除「${item.name}」。`
          : `已撤回「${item.name}」。`,
      );
      await Promise.all([refreshGroups(), refreshProjects()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  if (groupsLoading) {
    return <p className="group-lib-empty">正在加载 Silicon Notebook 群组…</p>;
  }

  if (!isNotebookScope && groups.length === 0) {
    return (
      <div className="group-lib-panel">
        {error ? <div className="group-lib-error">{error}</div> : null}
        <p className="group-lib-empty">
          你目前尚未加入任何 Silicon Notebook 群组。请先在 Silicon Notebook
          的群组页面创建或加入群组。
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
              }}
            >
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

        {currentProject && (isNotebookScope || selectedGroup) ? (
          <button
            type="button"
            className="group-lib-btn group-lib-btn-primary"
            onClick={() => {
              setSubmitName(currentProject.name.trim() || "");
              setSubmitOpen((open) => !open);
            }}
          >
            {submitOpen
              ? "取消上传"
              : isNotebookScope
                ? "上传当前电路到本笔记本"
                : "上传当前电路到本群组"}
          </button>
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
      ) : projects.length === 0 ? (
        <p className="group-lib-empty">
          {filter === "approved"
            ? isNotebookScope
              ? "本笔记本还没有已入库的电路工程。"
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
