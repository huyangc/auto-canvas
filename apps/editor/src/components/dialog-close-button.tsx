import type { Ref } from "react";

/**
 * The one way a web dialog is dismissed: a small × at the top right of its
 * header. Place it as the header's last child and give the header the
 * `dialog-header-with-close` class (styles: dialog-close-button.css, loaded
 * from styles/editor-entry.css so lazy dialogs find it already there).
 */
export function DialogCloseButton({
  onClick,
  "aria-label": label = "Close",
  title,
  disabled,
  ref,
  "data-testid": testId,
}: {
  onClick(): void;
  "aria-label"?: string;
  title?: string;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  "data-testid"?: string;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className="dialog-close-button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onClick()}
    >
      ×
    </button>
  );
}
