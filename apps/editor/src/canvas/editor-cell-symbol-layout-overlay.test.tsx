import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorCellSymbolLayoutOverlay } from "./editor-cell-symbol-layout-overlay";

describe("cell symbol layout overlay", () => {
  it("places body and pin handles in instance coordinates", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <EditorCellSymbolLayoutOverlay
          placement={{
            position: { x: 100, y: 200 },
            rotation: 0,
            mirror: "none",
          }}
          body={{ left: -20, right: 20, top: -10, bottom: 10 }}
          pins={[
            {
              terminalId: "input",
              pin: {
                name: "IN",
                role: "input",
                at: { x: -30, y: 0 },
                direction: "west",
                presentation: { visibility: "visible" },
              },
            },
          ]}
          onDragStart={vi.fn()}
        />
      </svg>,
    );

    expect(markup).toContain('data-testid="cell-symbol-body-handle"');
    expect(markup).toContain('cx="120"');
    expect(markup).toContain('cy="210"');
    expect(markup).toContain('data-testid="cell-symbol-pin-handle-input"');
    expect(markup).toContain('cx="80"');
  });
});
