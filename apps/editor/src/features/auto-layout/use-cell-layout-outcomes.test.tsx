// @vitest-environment jsdom
import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { EditorDocumentController } from "../../document/document-controller";
import { createLibraryExampleProject } from "../../examples/library-examples";
import type { AutoLayoutCellVerdicts } from "./auto-layout-session";
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

const refused = (documentId: string, reason: string, revision = 1) => ({
  documentId,
  outcome: "refused" as const,
  reason,
  revision,
});
const applied = (documentId: string) => ({
  documentId,
  outcome: "applied" as const,
});
const verdicts = (
  owner: FakeController,
  ...cells: AutoLayoutCellVerdicts["cells"]
): AutoLayoutCellVerdicts => ({
  owner,
  projectSessionId: owner.projectSessionId,
  cells,
});

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

async function mount(initial: FakeController) {
  const view: {
    outcomes?: ReturnType<typeof useCellLayoutOutcomes>;
    setController?: Dispatch<SetStateAction<FakeController>>;
  } = {};
  function Harness() {
    const [controller, setController] = useState(initial);
    view.setController = setController;
    view.outcomes = useCellLayoutOutcomes(controller);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  const record = (record: AutoLayoutCellVerdicts) =>
    act(async () => view.outcomes!.record(record));
  const reason = (controller: FakeController, id: string) =>
    view.outcomes!.reasonFor(
      controller.project.documents.find((d) => d.id === id)!,
    );
  return { view, record, reason };
}

describe("retained Auto Layout outcomes per Cell", () => {
  it("keeps a refused Cell's reason until a later run applies it", async () => {
    const tab = controllerOf("top", "chain");
    const { record, reason } = await mount(tab);
    expect(reason(tab, "chain")).toBeUndefined();
    await record(verdicts(tab, applied("top"), refused("chain", "too big")));
    expect(reason(tab, "chain")).toBe("too big");
    expect(reason(tab, "top")).toBeUndefined();
    // A run that does not mention the Cell leaves its reason alone.
    await record(verdicts(tab, applied("top")));
    expect(reason(tab, "chain")).toBe("too big");
    await record(verdicts(tab, applied("chain")));
    expect(reason(tab, "chain")).toBeUndefined();
  });

  it("drops a reason once the Cell's Document changes", async () => {
    const tab = controllerOf("top", "chain");
    const { record, reason } = await mount(tab);
    await record(verdicts(tab, refused("chain", "too big")));
    tab.project.documents[1]!.revision = 2;
    expect(reason(tab, "chain")).toBeUndefined();
  });

  it("keeps each run's verdicts with the tab it names", async () => {
    const first = controllerOf("top", "chain");
    const second = controllerOf("top", "chain");
    const { view, record, reason } = await mount(second);
    // The first tab's run reports while the second is open.
    await record(verdicts(first, refused("chain", "too big")));
    expect(reason(second, "chain")).toBeUndefined();
    await act(async () => view.setController!(first));
    expect(reason(first, "chain")).toBe("too big");
  });

  it("starts another Project opened in the tab with no reasons", async () => {
    const tab = controllerOf("top", "chain");
    const { record, reason } = await mount(tab);
    await record(verdicts(tab, refused("chain", "too big")));
    // Same ids and revisions, another Project session (a replacement).
    tab.projectSessionId = "session-2";
    expect(reason(tab, "chain")).toBeUndefined();
  });

  it("hides a reason after an edit of the real Document, also after Undo", async () => {
    const controller = new EditorDocumentController(
      createLibraryExampleProject("two-stage-op-amp")!,
    );
    const view: { outcomes?: ReturnType<typeof useCellLayoutOutcomes> } = {};
    function Harness() {
      view.outcomes = useCellLayoutOutcomes(controller);
      return null;
    }
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(<Harness />));
    const reason = () => view.outcomes!.reasonFor(controller.document);
    await act(async () =>
      view.outcomes!.record({
        owner: controller,
        projectSessionId: controller.projectSessionId,
        cells: [
          refused(
            controller.activeDocumentId,
            "too big",
            controller.document.revision,
          ),
        ],
      }),
    );
    expect(reason()).toBe("too big");
    const instance = controller.document.instances[0]!;
    expect(
      controller.transact([
        {
          kind: "move_instance",
          instanceId: instance.id,
          position: { x: instance.placement!.position.x + 40, y: 0 },
        },
      ]).ok,
    ).toBe(true);
    expect(reason()).toBeUndefined();
    // Undo restores the drawing, not the run's verdict on it.
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(controller.document.instances[0]!.placement).toEqual(
      instance.placement,
    );
    expect(reason()).toBeUndefined();
  });
});
