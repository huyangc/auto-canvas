import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";

/** A local second step, not a modal: keep the decision beside its trigger. */
export function InlineConfirm({
  children,
  primaryLabel,
  primaryPendingLabel = "Saving…",
  onPrimary,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  promptLabel,
  externalError = null,
  dismissOnOutsideClick = false,
  onConfirm,
  open: controlledOpen,
  onOpenChange,
  ...triggerProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primaryLabel?: string | undefined;
  primaryPendingLabel?: string | undefined;
  onPrimary?: (() => void | Promise<unknown>) | undefined;
  confirmLabel?: string;
  cancelLabel?: string;
  promptLabel?: string;
  externalError?: string | null | undefined;
  dismissOnOutsideClick?: boolean;
  onConfirm(): void | Promise<unknown>;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "primary" | "confirm" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const open = controlledOpen ?? localOpen;
  const pending = pendingAction !== null;
  const shownError = error ?? externalError;
  const change = (next: boolean) => {
    setLocalOpen(next);
    onOpenChangeRef.current?.(next);
    setError(null);
  };
  useEffect(() => {
    if (open) cancel.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const details = root.current?.closest("details");
    const closed = () => {
      if (details && !details.open && !running.current) change(false);
    };
    details?.addEventListener("toggle", closed);
    return () => details?.removeEventListener("toggle", closed);
  }, [open]);
  useEffect(() => {
    if (!open || !dismissOnOutsideClick) return;
    const handleOutside = (event: PointerEvent) => {
      if (
        !running.current &&
        !root.current?.contains(event.target as Node | null)
      )
        change(false);
    };
    window.addEventListener("pointerdown", handleOutside, true);
    return () => window.removeEventListener("pointerdown", handleOutside, true);
  }, [open, dismissOnOutsideClick]);
  const dismiss = () => {
    if (running.current) return;
    change(false);
    requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  };
  const runAction = async (
    kind: "primary" | "confirm",
    action: () => void | Promise<unknown>,
  ) => {
    if (running.current) return;
    running.current = true;
    setPendingAction(kind);
    setError(null);
    try {
      await action();
      const restoreFocus = root.current?.contains(document.activeElement);
      change(false);
      if (restoreFocus)
        requestAnimationFrame(() =>
          trigger.current?.focus({ preventScroll: true }),
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete this action. Try again.",
      );
    } finally {
      running.current = false;
      setPendingAction(null);
    }
  };
  return (
    <span
      className="inline-confirm"
      ref={root}
      onClick={(event) => event.stopPropagation()}
      data-expanded={open || undefined}
      onKeyDown={(event) => {
        if (!open) return;
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <button
        {...triggerProps}
        type="button"
        ref={trigger}
        hidden={open}
        aria-expanded={open}
        onClick={() => change(true)}
      >
        {children}
      </button>
      {open ? (
        <span
          className="inline-confirm-decision"
          role="group"
          aria-label={triggerProps["aria-label"] ?? confirmLabel}
        >
          <span className="inline-confirm-row">
            {promptLabel ? (
              <span className="inline-confirm-prompt">{promptLabel}</span>
            ) : null}
            <span className="inline-confirm-actions">
              {primaryLabel && onPrimary ? (
                <button
                  type="button"
                  className="inline-confirm-primary"
                  disabled={pending || triggerProps.disabled}
                  onClick={() => void runAction("primary", onPrimary)}
                >
                  {pendingAction === "primary"
                    ? primaryPendingLabel
                    : primaryLabel}
                </button>
              ) : null}
              <button
                type="button"
                className="inline-confirm-danger"
                disabled={pending || triggerProps.disabled}
                onClick={() => void runAction("confirm", onConfirm)}
              >
                {pendingAction === "confirm" ? "Working…" : confirmLabel}
              </button>
              <button
                type="button"
                ref={cancel}
                disabled={pending}
                onClick={dismiss}
              >
                {cancelLabel}
              </button>
            </span>
          </span>
          {shownError ? (
            <span className="inline-confirm-error" role="alert">
              {shownError}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
