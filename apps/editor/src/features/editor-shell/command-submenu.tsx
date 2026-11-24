import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * A menu row that expands its options beneath it: Right or Down opens it and
 * focuses the first option, Left collapses it and hands focus back. File's
 * Import, Export and Cloud Projects use it, and so does the account menu's
 * My Cloud Projects.
 */
export function CommandSubmenu({
  id,
  title,
  label = title,
  open,
  onToggle,
  onClose,
  children,
}: {
  id: string;
  title: string;
  /** The options' accessible name, when it is not the title. */
  label?: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = options.current?.closest<HTMLElement>(
      ".file-command-popover, .project-menu-popover, .header-account-popover",
    );
    if (!open || !menu || getComputedStyle(menu).overflowY !== "auto") return;
    const bottom = options.current!.getBoundingClientRect().bottom;
    menu.scrollTop += Math.max(0, bottom - menu.getBoundingClientRect().bottom);
  }, [open]);
  return (
    <div
      className="export-submenu"
      onKeyDown={(event) => {
        if (open && event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) onToggle();
            requestAnimationFrame(() =>
              trigger.current?.parentElement
                ?.querySelector<HTMLElement>(
                  ".export-submenu-options button, .export-submenu-options .file-import",
                )
                ?.focus(),
            );
          }
        }}
      >
        {title}
        <span aria-hidden="true">›</span>
      </button>
      <div
        ref={options}
        className="export-submenu-options"
        id={id}
        role="group"
        aria-label={label}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
