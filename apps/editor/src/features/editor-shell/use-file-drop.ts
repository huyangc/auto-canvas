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
  // The frame follows the drag's latest event rather than counting paired
  // enters and leaves: an element that unmounts under the file can swallow
  // its own dragleave, and a leave that names no destination (the window,
  // and every in-page move in older Safari) cannot be told from one.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const cancelHide = (): void => {
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
    // Every file event re-arms the frame's lifetime, so a drag that stops
    // reporting (a target unmounted under it, a cancelled external drag, the
    // window left without a leave that reaches us) hides it by itself.
    const armHide = (delay: number): void => {
      cancelHide();
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        setDragActive(false);
      }, delay);
    };
    const show = (): void => {
      setDragActive(!modalDialogOpen());
      armHide(1000);
    };

    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      show();
    };

    const onDragOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = modalDialogOpen() ? "none" : "copy";
      show();
    };

    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      // A move between elements is followed by an enter or over at once; a
      // leave with nothing after it, as leaving the window or a cancel,
      // hides the frame shortly.
      armHide(150);
    };

    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      cancelHide();
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

    // A drag the page started itself ends here; an outside drag's dragend
    // belongs to the OS source, so the leave timer above covers it.
    const onDragEnd = (): void => {
      cancelHide();
      setDragActive(false);
    };

    const listeners: [string, (event: DragEvent) => void][] = [
      ["dragenter", onDragEnter],
      ["dragover", onDragOver],
      ["dragleave", onDragLeave],
      ["drop", onDrop],
      ["dragend", onDragEnd],
    ];
    for (const [type, listener] of listeners)
      window.addEventListener(type, listener as EventListener, true);
    return () => {
      for (const [type, listener] of listeners)
        window.removeEventListener(type, listener as EventListener, true);
      cancelHide();
    };
  }, []);

  return { dragActive };
}
