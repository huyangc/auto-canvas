import { mountWebEditor } from "./entries/web";

// A build-time literal (vite.config.ts): each build keeps one branch only.
if (import.meta.env.ICM_NOTEBOOK)
  void import("./entries/notebook").then((entry) =>
    entry.mountNotebookEditor(),
  );
else mountWebEditor();
