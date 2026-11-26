import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";

/** A local second step, not a modal: keep the decision beside its trigger. */
export function InlineConfirm({
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  promptLabel,
  dismissOnOutsideClick = false,
  onConfirm,
  open: controlledOpen,
  onOpenChange,
  ...triggerProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmLabel?: string;
  cancelLabel?: string;
  promptLabel?: string;
  dismissOnOutsideClick?: boolean;
  onConfirm(): void | Promise<unknown>;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const open = controlledOpen ?? localOpen;
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
  const confirm = async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await onConfirm();
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
      setPending(false);
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
              <button
                type="button"
                className="inline-confirm-danger"
                disabled={pending || triggerProps.disabled}
                onClick={() => void confirm()}
              >
                {pending ? "Working…" : confirmLabel}
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
          {error ? (
            <span className="inline-confirm-error" role="alert">
              {error}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
