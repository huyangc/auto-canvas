import { useEffect } from "react";

/**
 * The browser tab names what it shows (2026-10-14): the open Project in the
 * editor, else the page; several tabs of the site were all "Auto Canvas".
 */
export function usePageTitle(name: string | null | undefined, enabled = true) {
  useEffect(() => {
    if (!enabled || !name?.trim()) return;
    const previous = window.document.title;
    window.document.title = `${name.trim()} — Auto Canvas`;
    return () => {
      window.document.title = previous;
    };
  }, [name, enabled]);
}
