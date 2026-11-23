// A file dragged from outside onto the editor window is imported as the
// matching command would import it: a netlist through Import netlist…, a
// Project file (.json) through File → Import → Project File…. The listeners
// sit on window in the capture phase so they cover the top bar, the canvas
// and dialogs portaled to body, and stop a file event before CodeMirror's
// own drop handler (which inserts the text) or the browser's file view sees
// it. Every drag that carries no files is left alone.
import { useEffect, useRef, useState } from "react";

import { modalDialogOpen } from "./editor-mode";

const carriesFiles = (event: DragEvent): boolean =>
  [...(event.dataTransfer?.types ?? [])].includes("Files");

const isFolderItem = (item: DataTransferItem): boolean =>
  item.webkitGetAsEntry?.()?.isDirectory === true;

const isProjectFile = (file: File): boolean => /\.json$/iu.test(file.name);

export function useFileDrop(options: {
  /** Must start reading the files before it first suspends. */
  importNetlist: (files: FileList) => Promise<void>;
  openProjectFile: (file: File) => Promise<unknown>;
  setStatus: (status: string) => void;
}): { dragActive: boolean } {
  const optionsRef = useRef(options);
  // Files over the window, counted per element entered: a drag over a child
  // fires dragenter on it after dragenter on its parent without a dragleave
  // for the parent first.
  const depthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const refresh = () => {
      setDragActive(depthRef.current > 0 && !modalDialogOpen());
    };

    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current += 1;
      refresh();
    };

    const onDragOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = modalDialogOpen() ? "none" : "copy";
      refresh();
    };

    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      refresh();
    };

    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = 0;
      setDragActive(false);
      // A button behind a modal starts nothing either.
      if (modalDialogOpen()) return;
      const { importNetlist, openProjectFile, setStatus } = optionsRef.current;
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;
      if ([...dataTransfer.items].some(isFolderItem)) {
        setStatus("Drop the file itself, not a folder");
        return;
      }
      const files = [...dataTransfer.files];
      if (files.length === 0) return;
      // A Project file is a document of its own; it opens instead of
      // importing, and only alone.
      const [only] = files;
      if (files.some(isProjectFile)) {
        if (only && files.length === 1) void openProjectFile(only);
        else setStatus("Drop one Project file at a time");
        return;
      }
      // The file list is read inside this event; the call must start here.
      importNetlist(dataTransfer.files).catch(() =>
        setStatus("Couldn't read the dropped file"),
      );
    };

    const listeners: [string, (event: DragEvent) => void][] = [
      ["dragenter", onDragEnter],
      ["dragover", onDragOver],
      ["dragleave", onDragLeave],
      ["drop", onDrop],
    ];
    for (const [type, listener] of listeners)
      window.addEventListener(type, listener as EventListener, true);
    return () => {
      for (const [type, listener] of listeners)
        window.removeEventListener(type, listener as EventListener, true);
    };
  }, []);

  return { dragActive };
}
