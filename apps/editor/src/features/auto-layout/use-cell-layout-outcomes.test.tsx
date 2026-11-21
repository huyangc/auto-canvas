// @vitest-environment jsdom
import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AutoLayoutCellReport,
  AutoLayoutRunReport,
} from "./auto-layout-session";
import { useCellLayoutOutcomes } from "./use-cell-layout-outcomes";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface FakeDocument {
  id: string;
  revision: number;
}
interface FakeController {
  projectSessionId: string;
  project: { documents: FakeDocument[] };
}

const controllerOf = (...ids: string[]): FakeController => ({
  projectSessionId: "session-1",
  project: { documents: ids.map((id) => ({ id, revision: 1 })) },
});

const cell = (
  documentId: string,
  outcome: AutoLayoutCellReport["outcome"],
  reason?: string,
): AutoLayoutCellReport => ({
  documentId,
  cellName: documentId,
  outcome,
  ...(reason === undefined ? {} : { reason }),
  diagnostics: [],
});

const run = (...cells: AutoLayoutCellReport[]): AutoLayoutRunReport => ({
  run: "import",
  cells,
});

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

async function mount(initial: FakeController) {
  const view: {
    reasonFor?: ReturnType<typeof useCellLayoutOutcomes>;
    setReport?: Dispatch<SetStateAction<AutoLayoutRunReport | null>>;
    setController?: Dispatch<SetStateAction<FakeController>>;
  } = {};
  function Harness() {
    const [report, setReport] = useState<AutoLayoutRunReport | null>(null);
    const [controller, setController] = useState(initial);
    view.setReport = setReport;
    view.setController = setController;
    view.reasonFor = useCellLayoutOutcomes(report, controller);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  const reason = (controller: FakeController, id: string) =>
    view.reasonFor!(controller.project.documents.find((d) => d.id === id)!);
  return { view, reason };
}

describe("retained Auto Layout outcomes per Cell", () => {
  it("keeps a refused Cell's reason after the report is cleared", async () => {
    const tab = controllerOf("top", "chain");
    const { view, reason } = await mount(tab);
    expect(reason(tab, "chain")).toBeUndefined();
    await act(async () =>
      view.setReport!(
        run(cell("top", "applied"), cell("chain", "refused", "too big")),
      ),
    );
    expect(reason(tab, "chain")).toBe("too big");
    expect(reason(tab, "top")).toBeUndefined();
    // Details closed: the report goes, the reason stays.
    await act(async () => view.setReport!(null));
    expect(reason(tab, "chain")).toBe("too big");
  });

  it("drops a reason once the Cell's Document changes", async () => {
    const tab = controllerOf("top", "chain");
    const { view, reason } = await mount(tab);
    await act(async () =>
      view.setReport!(run(cell("chain", "refused", "too big"))),
    );
    tab.project.documents[1]!.revision = 2;
    expect(reason(tab, "chain")).toBeUndefined();
  });

  it("clears a Cell's reason when a later run applies it", async () => {
    const tab = controllerOf("top", "chain");
    const { view, reason } = await mount(tab);
    await act(async () =>
      view.setReport!(run(cell("chain", "refused", "too big"))),
    );
    // A run that does not mention the Cell leaves its reason alone.
    await act(async () => view.setReport!(run(cell("top", "applied"))));
    expect(reason(tab, "chain")).toBe("too big");
    await act(async () => view.setReport!(run(cell("chain", "applied"))));
    expect(reason(tab, "chain")).toBeUndefined();
  });

  it("keeps each tab's reasons with its controller", async () => {
    const first = controllerOf("top", "chain");
    const second = controllerOf("top", "chain");
    const { view, reason } = await mount(first);
    await act(async () =>
      view.setReport!(run(cell("chain", "refused", "too big"))),
    );
    // A tab switch clears the report and binds another controller.
    await act(async () => {
      view.setReport!(null);
      view.setController!(second);
    });
    expect(reason(second, "chain")).toBeUndefined();
    await act(async () => view.setController!(first));
    expect(reason(first, "chain")).toBe("too big");
  });

  it("starts another Project opened in the tab with no reasons", async () => {
    const tab = controllerOf("top", "chain");
    const { view, reason } = await mount(tab);
    await act(async () =>
      view.setReport!(run(cell("chain", "refused", "too big"))),
    );
    // Same ids and revisions, another Project session (a replacement).
    tab.projectSessionId = "session-2";
    expect(reason(tab, "chain")).toBeUndefined();
  });
});
