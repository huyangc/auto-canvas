// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { EmptyStateCard } from "./empty-state-card";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("offers the four starts, listing examples only once asked", async () => {
  const handlers = {
    onChooseNetlist: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenExample: vi.fn(),
    onDraw: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <EmptyStateCard
        examples={[
          { id: "two-stage-op-amp", name: "Two-Stage Op Amp", description: "" },
        ]}
        {...handlers}
      />,
    ),
  );
  const click = (testId: string) =>
    act(async () =>
      host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.click(),
    );
  expect(host.textContent).not.toContain("Two-Stage Op Amp");
  await click("empty-choose-netlist");
  await click("empty-open-project");
  await click("empty-draw");
  await click("empty-examples");
  expect(host.textContent).toContain("Two-Stage Op Amp");
  await click("empty-example-two-stage-op-amp");
  expect(handlers.onChooseNetlist).toHaveBeenCalledOnce();
  expect(handlers.onOpenProject).toHaveBeenCalledOnce();
  expect(handlers.onDraw).toHaveBeenCalledOnce();
  expect(handlers.onOpenExample).toHaveBeenCalledWith("two-stage-op-amp");
});
