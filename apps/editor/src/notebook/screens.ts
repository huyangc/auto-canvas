/**
 * The notebook build's three gate screens and its loading line, written with
 * plain DOM operations: they appear before React is loaded, and the
 * account-changed screen replaces a React root that has been unmounted.
 */

export type GateScreen = "loading" | "signed-out" | "error" | "account-changed";

const SIGN_IN_RETURN_PARAM = "next";
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds silicon-notebook's sign-in URL carrying the current same-origin
 * canvas location in `?next=…` so signing in (locally or via SSO) returns
 * straight back to this canvas page instead of silicon-notebook's home.
 *
 * Mirrors silicon-notebook's `localReturnLocation` rules: only a same-origin
 * path starting with `/` (never `//`, never containing backslashes or ASCII
 * control characters, and never `/auth/sso/callback`) is passed; root `/` or
 * anything invalid falls back to `"/"`.
 */
export function notebookSignInHref(
  location:
    | Pick<Location, "origin" | "pathname" | "search" | "hash">
    | null
    | undefined,
): string {
  if (!location) return "/";
  const raw = `${location.pathname ?? ""}${location.search ?? ""}${location.hash ?? ""}`;
  if (
    !raw ||
    raw === "/" ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/u.test(raw)
  ) {
    return "/";
  }
  try {
    const origin =
      location.origin && location.origin !== "null"
        ? location.origin
        : "http://localhost";
    const parsed = new URL(raw, origin);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (
      parsed.origin !== origin ||
      decodedPath.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/u.test(decodedPath) ||
      decodedPath.replace(/\/{2,}/gu, "/").replace(/\/+$/u, "") ===
        "/auth/sso/callback"
    ) {
      return "/";
    }
    const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (target === "/" || /[\\\u0000-\u0020\u007f]/u.test(target)) return "/";
    return `/?${SIGN_IN_RETURN_PARAM}=${encodeURIComponent(target)}`;
  } catch {
    return "/";
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  page: Document,
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = page.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs))
    element.setAttribute(name, value);
  return element;
}

/** Inline Auto Canvas NMOS mark so gate screens make zero network requests. */
function createBrandMark(page: Document): SVGSVGElement {
  const svg = svgEl(page, "svg", {
    class: "notebook-gate-mark",
    viewBox: "-24 -24 48 48",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(
    svgEl(page, "rect", {
      x: "-23.25",
      y: "-23.25",
      width: "46.5",
      height: "46.5",
      rx: "9",
      fill: "#ffffff",
      stroke: "#d9dde3",
      "stroke-width": "1.2",
    }),
  );
  const symbol = svgEl(page, "g", {
    transform: "translate(-2.7265 -0.551) scale(0.95) translate(4.709302 0)",
    fill: "none",
    stroke: "#1f2328",
    "stroke-width": "2.2",
    "stroke-linecap": "butt",
    "stroke-linejoin": "miter",
    "stroke-miterlimit": "4",
  });
  symbol.append(
    svgEl(page, "polyline", {
      points: "-4.244186,-6.976744 10,-6.976744 10,-20",
    }),
    svgEl(page, "polygon", {
      points:
        "-11.802326,-9.593023 -11.802326,9.593023 -8.895349,9.593023 -8.895349,-9.593023",
      fill: "#1f2328",
      stroke: "#1f2328",
      "stroke-width": "0.6",
    }),
    svgEl(page, "polygon", {
      points: "-6.569767,-12.5 -6.569767,12.5 -3.662791,12.5 -3.662791,-12.5",
      fill: "#1f2328",
      stroke: "#1f2328",
      "stroke-width": "0.6",
    }),
    svgEl(page, "line", { x1: "-8.895349", y1: "0", x2: "-20", y2: "0" }),
    svgEl(page, "polyline", { points: "-3.662791,6.976744 10,6.976744 10,20" }),
    svgEl(page, "polygon", {
      points: "10.581395,6.976744 1.27907,2.906977 1.27907,11.046512",
      fill: "#1f2328",
      stroke: "#1f2328",
      "stroke-width": "0.6",
    }),
  );
  svg.append(symbol);
  return svg;
}

function createBrandHeader(page: Document): HTMLElement {
  const header = page.createElement("div");
  header.className = "notebook-gate-header";
  const brand = page.createElement("div");
  brand.className = "notebook-gate-brand";
  const name = page.createElement("span");
  name.className = "notebook-gate-brand-name";
  name.textContent = "Auto Canvas";
  brand.append(createBrandMark(page), name);
  const badge = page.createElement("span");
  badge.className = "notebook-gate-badge";
  badge.textContent = "Silicon Notebook";
  header.append(brand, badge);
  return header;
}

function createSpinner(page: Document): HTMLElement {
  const spinner = page.createElement("span");
  spinner.className = "notebook-gate-spinner";
  spinner.setAttribute("aria-hidden", "true");
  return spinner;
}

export function showGateScreen(
  container: HTMLElement,
  screen: GateScreen,
  retry?: () => void,
  reload: () => void = () => container.ownerDocument.location.reload(),
): void {
  const page = container.ownerDocument;
  const paragraph = (text: string, className = "notebook-gate-copy") => {
    const element = page.createElement("p");
    element.className = className;
    element.textContent = text;
    return element;
  };
  if (screen === "loading") {
    const shell = page.createElement("div");
    shell.className = "notebook-gate";
    const card = page.createElement("div");
    card.className = "notebook-gate-card notebook-gate-card--compact";
    const status = page.createElement("div");
    status.className = "notebook-gate-status-text";
    status.setAttribute("role", "status");
    status.textContent = "Loading…";
    card.append(createSpinner(page), status);
    shell.append(card);
    container.replaceChildren(shell);
    return;
  }
  const main = page.createElement("main");
  main.className = "notebook-gate";
  main.setAttribute("data-testid", `notebook-${screen}`);
  const card = page.createElement("section");
  card.className = "notebook-gate-card";
  card.append(createBrandHeader(page));

  const body = page.createElement("div");
  body.className = "notebook-gate-body";

  if (screen === "signed-out") {
    const title = page.createElement("h1");
    title.className = "notebook-gate-title";
    title.textContent = "请先登录 Silicon Notebook";
    body.append(
      title,
      paragraph(
        "Auto Canvas 使用你的 Silicon Notebook 账号会话。请先完成登录，随后将自动返回当前电路画布。",
      ),
    );
    const link = page.createElement("a");
    link.className = "notebook-gate-action";
    link.href = notebookSignInHref(page.location);
    link.textContent = "前往 Silicon Notebook 登录 →";
    const hint = paragraph(
      "登录完成后会自动回到当前页面，无需重新打开链接。",
      "notebook-gate-hint",
    );
    card.append(body, link, hint);
  } else if (screen === "error") {
    main.setAttribute("role", "alert");
    const statusRow = page.createElement("div");
    statusRow.className = "notebook-gate-status-row";
    const dot = page.createElement("span");
    dot.className = "notebook-gate-alert-dot";
    dot.setAttribute("aria-hidden", "true");
    const title = page.createElement("h1");
    title.className = "notebook-gate-title";
    const button = page.createElement("button");
    button.type = "button";
    button.className = "notebook-gate-action";
    if (retry) {
      title.textContent = "Unable to confirm session";
      statusRow.append(dot, title);
      body.append(
        statusRow,
        paragraph(
          "The canvas could not confirm your silicon-notebook session right now.",
          "notebook-gate-copy notebook-gate-copy--error",
        ),
      );
      button.textContent = "Retry";
      button.addEventListener("click", () => retry());
    } else {
      // Nothing in this page can be tried again (the editor failed to start).
      title.textContent = "Unable to start canvas";
      statusRow.append(dot, title);
      body.append(
        statusRow,
        paragraph(
          "The canvas could not start. Reload the page to try again.",
          "notebook-gate-copy notebook-gate-copy--error",
        ),
      );
      button.textContent = "Reload";
      button.addEventListener("click", () => reload());
    }
    card.append(body, button);
  } else {
    main.setAttribute("role", "status");
    const statusRow = page.createElement("div");
    statusRow.className = "notebook-gate-status-row";
    const title = page.createElement("h1");
    title.className = "notebook-gate-title";
    title.textContent = "Switching session";
    statusRow.append(createSpinner(page), title);
    body.append(
      statusRow,
      paragraph(
        "Your silicon-notebook session changed, so the canvas is reloading.",
      ),
    );
    card.append(body);
  }
  main.append(card);
  container.replaceChildren(main);
}
