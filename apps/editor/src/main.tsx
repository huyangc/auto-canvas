import { mountWebEditor } from "./entries/web";

// A build-time literal (vite.config.ts): each build keeps one branch only.
if (import.meta.env.ICM_NOTEBOOK)
  void import("./entries/notebook").then(
    (entry) => entry.mountNotebookEditor(),
    () => {
      // The entry chunk did not load (a network failure, a stale
      // deployment), so no module of it can draw this: plain DOM only.
      const container = document.getElementById("root");
      if (!container) return;
      const main = document.createElement("main");
      main.setAttribute("data-testid", "notebook-error");
      main.setAttribute("role", "alert");
      const text = document.createElement("p");
      text.textContent =
        "The canvas could not be loaded. Reload the page to try again.";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Reload";
      button.addEventListener("click", () => window.location.reload());
      main.append(text, button);
      container.replaceChildren(main);
    },
  );
else mountWebEditor();
