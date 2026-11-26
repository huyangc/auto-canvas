import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import type { SharedComponent } from "@icm/component-library";
import { SymbolArtwork } from "../features/component-insert/symbol-artwork";
import { loadSharedComponentSummaries } from "../features/user-components/component-library-client";
import type { ScopedComponentLibraryOrigin } from "../features/user-components/component-placement";
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
  onInsertComponent(
    entry: SharedComponent,
    scope: ScopedComponentLibraryOrigin,
  ): void | Promise<void>;
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
  const [reloadTick, setReloadTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [availableSources, setAvailableSources] = useState<
    ComponentLibrarySummary[]
  >([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceNextCursor, setSourceNextCursor] = useState<string | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesLoadingMore, setSourcesLoadingMore] = useState(false);
  const [sourceComponentId, setSourceComponentId] = useState("");
  const [submitDesc, setSubmitDesc] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const listRequestSeq = useRef(0);
  const sourcesRequestSeq = useRef(0);
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
      const current = selectedGroupIdRef.current;
      let nextGroupId = "";
      let missingDeepLink = false;
      if (current && list.some((item) => item.id === current)) {
        nextGroupId = current;
      } else if (initialGroupId) {
        if (list.some((item) => item.id === initialGroupId)) {
          nextGroupId = initialGroupId;
        } else {
          missingDeepLink = true;
        }
      } else {
        nextGroupId = list[0]?.id ?? "";
      }
      setSelectedGroupId(nextGroupId);
      if (missingDeepLink) {
        setComponents([]);
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
  }, [initialGroupId, isNotebookScope]);

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  const refreshComponents = useCallback(async () => {
    const seq = ++listRequestSeq.current;
    if (isNotebookScope && notebookId) {
      setLoading(true);
      setComponents([]);
      setError(null);
      try {
        const data = await listNotebookComponents(notebookId, filter);
        if (listRequestSeq.current !== seq) return;
        setNotebookSpace(data.notebook);
        setComponents(data.components);
        setPendingCount(data.pendingCount ?? 0);
      } catch (err) {
        if (listRequestSeq.current !== seq) return;
        setError(err instanceof Error ? err.message : "加载笔记本器件库失败");
      } finally {
        if (listRequestSeq.current === seq) setLoading(false);
      }
      return;
    }
    if (!selectedGroupId || !selectedGroup) {
      setComponents([]);
      setPendingCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setComponents([]);
    setError(null);
    try {
      const data = await listGroupComponents(selectedGroupId, filter);
      if (listRequestSeq.current !== seq) return;
      setComponents(data.components);
      setPendingCount(data.pendingCount ?? 0);
    } catch (err) {
      if (listRequestSeq.current !== seq) return;
      setError(err instanceof Error ? err.message : "加载群组器件库失败");
    } finally {
      if (listRequestSeq.current === seq) setLoading(false);
    }
  }, [isNotebookScope, notebookId, selectedGroupId, selectedGroup, filter]);

  useEffect(() => {
    void refreshComponents();
  }, [refreshComponents, reloadTick]);

  useEffect(() => {
    if (!canAdmin && filter === "pending") setFilter("approved");
  }, [canAdmin, filter]);

  useEffect(() => {
    if (!submitOpen) {
      setSourcesLoadingMore(false);
      return;
    }
    const seq = ++sourcesRequestSeq.current;
    const controller = new AbortController();
    setSourcesLoading(true);
    setSourcesLoadingMore(false);
    setSourceNextCursor(null);
    void loadSharedComponentSummaries(
      sourceQuery.trim(),
      null,
      false,
      controller.signal,
    )
      .then((page) => {
        if (sourcesRequestSeq.current !== seq) return;
        setAvailableSources(page.entries);
        setSourceNextCursor(page.nextCursor);
        setSourceComponentId((current) =>
          page.entries.some((entry) => entry.id === current)
            ? current
            : (page.entries[0]?.id ?? ""),
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || sourcesRequestSeq.current !== seq)
          return;
        setError(
          err instanceof Error ? err.message : "加载可发布的器件列表失败",
        );
      })
      .finally(() => {
        if (sourcesRequestSeq.current === seq) setSourcesLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [submitOpen, sourceQuery]);

  const handleLoadMoreSources = async () => {
    if (!sourceNextCursor || sourcesLoadingMore) return;
    const seq = sourcesRequestSeq.current;
    setSourcesLoadingMore(true);
    try {
      const page = await loadSharedComponentSummaries(
        sourceQuery.trim(),
        sourceNextCursor,
        false,
      );
      if (sourcesRequestSeq.current !== seq) return;
      setAvailableSources((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...page.entries.filter((item) => !seen.has(item.id))];
      });
      setSourceNextCursor(page.nextCursor);
    } catch (err) {
      if (sourcesRequestSeq.current === seq) {
        setError(err instanceof Error ? err.message : "加载更多器件失败");
      }
    } finally {
      if (sourcesRequestSeq.current === seq) setSourcesLoadingMore(false);
    }
  };

  const handlePlace = async (item: GroupComponentSummary) => {
    setBusyId(item.id);
    setError(null);
    try {
      const scope: ScopedComponentLibraryOrigin =
        isNotebookScope && notebookId
          ? {
              kind: "notebook",
              scopeId: notebookId,
              itemId: item.id,
              status: item.status,
            }
          : {
              kind: "group",
              scopeId: selectedGroupId,
              itemId: item.id,
              status: item.status,
            };
      const { entry } =
        scope.kind === "notebook"
          ? await readNotebookComponent(scope.scopeId, item.id)
          : await readGroupComponent(scope.scopeId, item.id);
      await onInsertComponent(entry, scope);
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
      setReloadTick((v) => v + 1);
      await refreshGroups();
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
          selectedGroupId,
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
      setReloadTick((v) => v + 1);
      await refreshGroups();
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
        await deleteGroupComponent(selectedGroupId, item.id);
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
          <div className="group-lib-submit-row">
            <input
              type="search"
              className="group-lib-input"
              placeholder="搜索自定义器件名称…"
              aria-label="搜索可发布的器件"
              value={sourceQuery}
              onChange={(event) => setSourceQuery(event.target.value)}
            />
            {sourceNextCursor ? (
              <button
                type="button"
                className="group-lib-btn"
                disabled={sourcesLoading || sourcesLoadingMore}
                onClick={() => void handleLoadMoreSources()}
              >
                {sourcesLoadingMore ? "加载中…" : "加载更多器件"}
              </button>
            ) : null}
          </div>
          {sourcesLoading ? (
            <p className="group-lib-hint">正在加载已发布的自定义器件…</p>
          ) : availableSources.length === 0 ? (
            <p className="group-lib-hint">
              {sourceQuery.trim()
                ? "未找到匹配的自定义器件，请调整关键词后重试。"
                : "当前还没有可发布的自定义器件，请先点击右上角「Create Component…」创建并保存器件。"}
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
      ) : !isNotebookScope && !selectedGroup ? (
        <p className="group-lib-empty">请先在上方选择一个目标群组。</p>
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
