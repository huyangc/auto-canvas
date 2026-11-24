/** The web and desktop editors both support a native modal HTML dialog. */
export function chooseMosSymbol(name: string): Promise<string | null> {
  const dialog = document.createElement("dialog");
  dialog.className = "editor-action-dialog";
  const question = `Which symbol should the drawing use for ${name}?`;
  dialog.setAttribute("aria-label", question);
  const heading = document.createElement("h2");
  heading.textContent = question;
  const header = document.createElement("header");
  header.className = "editor-action-dialog-header";
  header.append(heading);
  const form = document.createElement("form");
  form.method = "dialog";
  form.className = "editor-action-dialog-actions";
  for (const [label, value] of [
    ["Cancel", ""],
    ["NMOS", "nmos"],
    ["PMOS", "pmos"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = label;
    button.value = value;
    form.append(button);
  }
  dialog.append(header, form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const choice = dialog.returnValue || null;
        dialog.remove();
        resolve(choice);
      },
      { once: true },
    );
    dialog.showModal();
  });
}
