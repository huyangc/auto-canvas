import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EditorRightDock } from "./editor-right-dock";

it("shows Properties unless a Project panel is open", () => {
  expect(
    renderToStaticMarkup(<EditorRightDock properties={<p>properties</p>} />),
  ).toContain("properties");
  const html = renderToStaticMarkup(
    <EditorRightDock properties={<p>properties</p>} project={<p>project</p>} />,
  );
  expect(html).toContain("project");
  expect(html).not.toContain("properties");
});
