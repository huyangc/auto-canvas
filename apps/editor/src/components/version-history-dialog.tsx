import { branchProjectVersion } from "./version-project";
import { useEffect, useRef, useState } from "react";
import type { CircuitProject } from "@icm/model";
import { VersionHistoryComparison } from "./version-history-comparison";

export interface ProjectVersion {
  versionId: string;
  versionNo: number;
  name: string;
  author: string;
  tags: string[];
  createdAt: string;
}

/** Storage operations for private Cloud Project history. */
export interface VersionHistorySource {
  currentLabel: string;
  loadVersions(): Promise<ProjectVersion[] | null>;
  loadProject(versionId?: string): Promise<CircuitProject>;
  previewUrl(versionId: string): string;
  restore(versionId: string): Promise<void>;
  branch(project: CircuitProject): Promise<boolean>;
}

export interface VersionHistoryDialogProps {
  source: VersionHistorySource;
  entryId: string;
  entryName: string;
  onRestored(result: { previewRevision?: string }): void;
  onClose(): void;
}

export function VersionHistoryDialog({
  entryId,
  entryName,
  onRestored,
  onClose,
  source,
}: VersionHistoryDialogProps) {
  const modal = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [comparison, setComparison] = useState<{
    versionNo: number;
    before: CircuitProject;
    after: CircuitProject;
  } | null>(null);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    const request = ++generation.current;
    setVersions(null);
    setComparison(null);
    setError(null);
    void source
      .loadVersions()
      .catch(() => null)
      .then((loaded) => {
        if (request !== generation.current) return;
        setVersions(loaded);
        if (!loaded)
          setError(
            "Could not load history. Sign in as the owner or try again.",
          );
      });
    return () => {
      generation.current += 1;
    };
  }, [entryId, retry, source]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    const request = generation.current;
    try {
      await action();
    } catch (error) {
      if (request === generation.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function compare(version: ProjectVersion) {
    const request = generation.current;
    const [before, after] = await Promise.all([
      source.loadProject(version.versionId),
      source.loadProject(),
    ]);
    if (request === generation.current)
      setComparison({ versionNo: version.versionNo, before, after });
  }
  async function branch(version: ProjectVersion) {
    const request = generation.current;
    const project = await source.loadProject(version.versionId);
    if (request !== generation.current) return;
    await source.branch(branchProjectVersion(project, version.versionNo));
  }
  async function restore(versionId: string) {
    const request = generation.current;
    await source.restore(versionId);
    if (request === generation.current) onRestored({});
  }

  return (
    <dialog
      ref={modal}
      aria-labelledby="version-history-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="version-history-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className={`version-history-dialog${comparison ? " is-comparing" : ""}`}
        data-testid="version-history-dialog"
      >
        <header className="version-history-header">
          <p>Latest 3 historical versions · current draft kept separately</p>
          <h2 id="version-history-title">Version history — {entryName}</h2>
          <button
            type="button"
            className="version-history-dismiss"
            aria-label="Close version history"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {versions === null && !error ? (
          <p className="version-history-note">Loading history…</p>
        ) : versions?.length === 0 ? (
          <p className="version-history-note" data-testid="version-empty">
            No earlier versions yet — history starts with the first update.
          </p>
        ) : (
          <div className="version-list">
            {versions?.map((version) => (
              <article
                key={version.versionId}
                className="version-row"
                data-testid={`version-${version.versionNo}`}
              >
                <img
                  src={source.previewUrl(version.versionId)}
                  alt={`Version ${version.versionNo} preview`}
                  loading="lazy"
                />
                <div className="version-copy">
                  <b>
                    v{version.versionNo} · {version.name}
                  </b>
                  <small>
                    {version.author ? `${version.author} · ` : ""}
                    {new Date(version.createdAt).toLocaleString()}
                    {version.tags.length > 0
                      ? ` · ${version.tags.join(", ")}`
                      : ""}
                  </small>
                </div>
                <div className="version-row-actions">
                  <button
                    type="button"
                    disabled={busy}
                    data-testid={`version-compare-${version.versionNo}`}
                    onClick={() => void run(() => compare(version))}
                  >
                    Compare
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    data-testid={`version-branch-${version.versionNo}`}
                    onClick={() => void run(() => branch(version))}
                  >
                    Branch
                  </button>
                  <button
                    type="button"
                    className="version-history-primary"
                    data-testid={`version-restore-${version.versionNo}`}
                    disabled={busy}
                    onClick={() => void run(() => restore(version.versionId))}
                  >
                    Restore
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {comparison ? (
          <section aria-label={`Compare version ${comparison.versionNo}`}>
            <h3>
              v{comparison.versionNo} → {source.currentLabel}
            </h3>
            <VersionHistoryComparison
              key={comparison.versionNo}
              before={comparison.before}
              after={comparison.after}
            />
          </section>
        ) : null}
        {error ? (
          <p role="alert" className="version-history-error">
            {error}{" "}
            {versions === null ? (
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="version-history-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </dialog>
  );
}
