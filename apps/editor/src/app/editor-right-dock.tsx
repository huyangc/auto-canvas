import type { ReactNode } from "react";

export function EditorRightDock(props: {
  project?: ReactNode;
  properties: ReactNode;
}) {
  return (
    <aside className="editor-right-dock">
      {props.project ?? props.properties}
    </aside>
  );
}
