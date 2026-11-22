/**
 * The notebook build's three gate screens and its loading line, written with
 * plain DOM operations: they appear before React is loaded, and the
 * account-changed screen replaces a React root that has been unmounted.
 */

export type GateScreen = "loading" | "signed-out" | "error" | "account-changed";

export function showGateScreen(
  container: HTMLElement,
  screen: GateScreen,
  retry?: () => void,
  reload: () => void = () => container.ownerDocument.location.reload(),
): void {
  const page = container.ownerDocument;
  const paragraph = (text: string) => {
    const element = page.createElement("p");
    element.textContent = text;
    return element;
  };
  if (screen === "loading") {
    const status = page.createElement("div");
    status.setAttribute("role", "status");
    status.textContent = "Loading…";
    container.replaceChildren(status);
    return;
  }
  const main = page.createElement("main");
  main.setAttribute("data-testid", `notebook-${screen}`);
  if (screen === "signed-out") {
    const text = paragraph(
      "The canvas needs a silicon-notebook session: sign in to ",
    );
    const link = page.createElement("a");
    link.href = "/";
    link.textContent = "silicon-notebook";
    text.append(link, ".");
    main.append(text);
  } else if (screen === "error") {
    main.setAttribute("role", "alert");
    const button = page.createElement("button");
    button.type = "button";
    if (retry) {
      main.append(
        paragraph(
          "The canvas could not confirm your silicon-notebook session right now.",
        ),
      );
      button.textContent = "Retry";
      button.addEventListener("click", () => retry());
    } else {
      // Nothing in this page can be tried again (the editor failed to start).
      main.append(
        paragraph("The canvas could not start. Reload the page to try again."),
      );
      button.textContent = "Reload";
      button.addEventListener("click", () => reload());
    }
    main.append(button);
  } else {
    main.setAttribute("role", "status");
    main.append(
      paragraph(
        "Your silicon-notebook session changed, so the canvas is reloading.",
      ),
    );
  }
  container.replaceChildren(main);
}
