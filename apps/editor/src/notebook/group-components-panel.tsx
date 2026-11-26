import { useCallback, useEffect, useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import type { SharedComponent } from "@icm/component-library";
import { SymbolArtwork } from "../features/component-insert/symbol-artwork";
import { loadSharedComponentSummaries } from "../features/user-components/component-library-client";
import {
  deleteGroupComponent,
  deleteNotebookComponent,
  listGroupComponents,
  listNotebookComponents,
  listNotebookGroups,
  readGroupComponent,
  readNotebookComponent,
  reviewGroupComponent,
  reviewNotebookComponent,
  submitGroupComponent,
  submitNotebookComponent,
  type GroupComponentSummary,
  type GroupListFilter,
  type NotebookGroupInfo,
  type NotebookSpaceInfo,
} from "./group-libraries-client";
import "./group-libraries.css";

export interface GroupComponentsPanelProps {
  initialGroupId?: string | null | undefined;
  notebookId?: string | null | undefined;
  notebookName?: string | null | undefined;
  onSelectGroup?: ((groupId: string) => void) | undefined;
  onInsertComponent(entry: SharedComponent): void | Promise<void>;
}

const STATUS_LABEL: Record<GroupComponentSummary["status"], string> = {
  approved: "已入库",
  pending: "待审核",
  rejected: "已驳回",
};

const CAPABILITY_LABEL: Record<string, string> = {
  "with-circuit": "含子电路",
  "symbol-only": "仅符号",
  "needs-repair": "待修复",
};

export function GroupComponentsPanel({
  initialGroupId,
  notebookId,
  notebookName,
  onSelectGroup,
  onInsertComponent,
}: GroupComponentsPanelProps) {
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
  const [components, setComponents] = useState<GroupComponentSummary[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [availableSources, setAvailableSources] = useState<
    ComponentLibrarySummary[]
  >([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceComponentId, setSourceComponentId] = useState("");
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

  const refreshComponents = useCallback(async () => {
    if (isNotebookScope && notebookId) {
      setLoading(true);
      setError(null);
      try {
        const data = await listNotebookComponents(notebookId, filter);
        setNotebookSpace(data.notebook);
        setComponents(data.components);
        if (data.pendingCount !== undefined) setPendingCount(data.pendingCount);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载笔记本器件库失败");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!selectedGroupId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listGroupComponents(selectedGroupId, filter);
      setComponents(data.components);
      if (data.pendingCount !== undefined) setPendingCount(data.pendingCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载群组器件库失败");
    } finally {
      setLoading(false);
    }
  }, [isNotebookScope, notebookId, selectedGroupId, filter]);

  useEffect(() => {
    void refreshComponents();
  }, [refreshComponents]);

  useEffect(() => {
    if (!canAdmin && filter === "pending") setFilter("approved");
  }, [canAdmin, filter]);

  useEffect(() => {
    if (!submitOpen) return;
    let active = true;
    setSourcesLoading(true);
    void loadSharedComponentSummaries("", null, false)
      .then((page) => {
        if (!active) return;
        setAvailableSources(page.entries);
        setSourceComponentId((current) => current || page.entries[0]?.id || "");
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error ? err.message : "加载可发布的器件列表失败",
          );
      })
      .finally(() => {
        if (active) setSourcesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [submitOpen]);

  const handlePlace = async (item: GroupComponentSummary) => {
    setBusyId(item.id);
    setError(null);
    try {
      const { entry } =
        isNotebookScope && notebookId
          ? await readNotebookComponent(notebookId, item.id)
          : await readGroupComponent(item.groupId ?? selectedGroupId, item.id);
      await onInsertComponent(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载器件失败");
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmit = async () => {
    if ((!isNotebookScope && !selectedGroup) || !sourceComponentId) {
      setError("请选择要发布的自定义器件");
      return;
    }
    setBusyId("submit");
    setError(null);
    setNotice(null);
    try {
      const payload = {
        sourceComponentId,
        description: submitDesc.trim(),
      };
      const created =
        isNotebookScope && notebookId
          ? await submitNotebookComponent(notebookId, payload)
          : await submitGroupComponent(selectedGroup!.id, payload);
      setSubmitOpen(false);
      setSubmitDesc("");
      setNotice(
        created.status === "approved"
          ? `器件「${created.name}」已直接入库到「${targetName}」。`
          : `器件「${created.name}」已提交到「${targetName}」，等待管理员审核。`,
      );
      await Promise.all([refreshGroups(), refreshComponents()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交器件失败");
    } finally {
      setBusyId(null);
    }
  };

  const handleReview = async (
    item: GroupComponentSummary,
    decision: "approve" | "reject",
  ) => {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      if (isNotebookScope && notebookId) {
        await reviewNotebookComponent(
          notebookId,
          item.id,
          decision,
          reviewNotes[item.id] ?? "",
        );
      } else {
        await reviewGroupComponent(
          item.groupId ?? selectedGroupId,
          item.id,
          decision,
          reviewNotes[item.id] ?? "",
        );
      }
      setNotice(
        decision === "approve"
          ? `已审核通过器件「${item.name}」并入库。`
          : `已驳回器件「${item.name}」。`,
      );
      await Promise.all([refreshGroups(), refreshComponents()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "审核操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: GroupComponentSummary) => {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      if (isNotebookScope && notebookId) {
        await deleteNotebookComponent(notebookId, item.id);
      } else {
        await deleteGroupComponent(item.groupId ?? selectedGroupId, item.id);
      }
      setNotice(
        item.status === "approved"
          ? `已移除「${item.name}」。`
          : `已撤回「${item.name}」。`,
      );
      await Promise.all([refreshGroups(), refreshComponents()]);
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
          你目前尚未加入任何 Silicon Notebook 群组。
        </p>
      </div>
    );
  }

  return (
    <div className="group-lib-panel" data-testid="group-components-panel">
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
                  {group.isAdmin && (group.pendingComponentCount ?? 0) > 0
                    ? `（待审 ${group.pendingComponentCount}）`
                    : ""}
                </option>
              ))}
            </select>
          )}

          <div
            className="group-lib-subtabs"
            role="tablist"
            aria-label="器件库视图"
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
          <button
            type="button"
            className="group-lib-btn group-lib-btn-primary"
            onClick={() => setSubmitOpen((open) => !open)}
          >
            {submitOpen
              ? "取消发布"
              : isNotebookScope
                ? "发布器件到本笔记本"
                : "发布器件到本群组"}
          </button>
        ) : null}
      </div>

      {submitOpen && (isNotebookScope || selectedGroup) ? (
        <div className="group-lib-submit-box">
          {sourcesLoading ? (
            <p className="group-lib-hint">正在加载已发布的自定义器件…</p>
          ) : availableSources.length === 0 ? (
            <p className="group-lib-hint">
              当前还没有可发布的自定义器件，请先点击右上角「Create
              Component…」创建并保存器件。
            </p>
          ) : (
            <>
              <div className="group-lib-submit-row">
                <select
                  className="group-lib-select"
                  aria-label="选择要发布的器件"
                  value={sourceComponentId}
                  onChange={(event) => setSourceComponentId(event.target.value)}
                >
                  {availableSources.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}（{entry.author}）
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  className="group-lib-input"
                  placeholder="简要说明（可选）"
                  aria-label="器件说明"
                  maxLength={500}
                  value={submitDesc}
                  onChange={(event) => setSubmitDesc(event.target.value)}
                />
                <button
                  type="button"
                  className="group-lib-btn group-lib-btn-primary"
                  disabled={busyId !== null || !sourceComponentId}
                  onClick={() => void handleSubmit()}
                >
                  {busyId === "submit" ? "提交中…" : "确认发布"}
                </button>
              </div>
              <p className="group-lib-hint">
                {canAdmin
                  ? "你有管理权限，发布的器件将直接入库。"
                  : "普通成员提交后，需要由管理员审核通过才能入库。"}
              </p>
            </>
          )}
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
      ) : components.length === 0 ? (
        <p className="group-lib-empty">
          {filter === "approved"
            ? isNotebookScope
              ? "本笔记本还没有已入库的器件。"
              : "该群组还没有已入库的共享器件。"
            : filter === "pending"
              ? "当前没有待审核的器件提交。"
              : "你还没有提交过器件。"}
        </p>
      ) : (
        <div className="group-lib-grid">
          {components.map((item) => (
            <article className="group-lib-card" key={item.id}>
              <div className="group-lib-preview">
                {item.symbol ? (
                  <SymbolArtwork
                    symbol={item.symbol}
                    fitContent
                    className="user-component-art"
                  />
                ) : (
                  <span className="group-lib-meta">无符号预览</span>
                )}
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
                作者：{item.authorName} ·{" "}
                {CAPABILITY_LABEL[item.capability] ?? item.capability} ·{" "}
                {item.pinCount} 引脚
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
                  onClick={() => void handlePlace(item)}
                >
                  {busyId === item.id ? "加载中…" : "放置到画布"}
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
