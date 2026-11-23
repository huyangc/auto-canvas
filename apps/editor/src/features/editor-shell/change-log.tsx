import { useState } from "react";
import { createPortal } from "react-dom";

const updates = [
  {
    date: "2026-11-22",
    title: "Open the editor over LAN HTTP",
    detail:
      "You can open Auto Canvas from a local network address over plain HTTP.",
  },
  {
    date: "2026-11-21",
    title: "More room for a single project",
    detail:
      "The tab strip appears when you open a second project. With one project open, its actions are in the File menu.",
  },
];

export function ChangeLog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="statusbar-change-log"
        data-testid="statusbar-change-log"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Change Log
      </button>
      {open &&
        createPortal(
          <dialog
            className="editor-action-dialog change-log-dialog"
            aria-labelledby="change-log-title"
            ref={(dialog) => {
              if (dialog && !dialog.open) dialog.showModal();
            }}
            onClose={() => setOpen(false)}
          >
            <header className="editor-action-dialog-header">
              <h2 id="change-log-title">Change Log</h2>
            </header>
            <div className="editor-action-dialog-body">
              {updates.map(({ date, title, detail }) => (
                <article key={title}>
                  <time dateTime={date}>{date}</time>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
            <form method="dialog" className="editor-action-dialog-actions">
              <button type="submit">Close</button>
            </form>
          </dialog>,
          document.body,
        )}
    </>
  );
}
