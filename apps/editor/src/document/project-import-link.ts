import { appUrl } from "../lib/app-url";

// Keep the compressed snapshot within a browser URL and bound the expanded
// file before passing it to the same validator as a local Project file.
const MAX_PAYLOAD = 128 * 1024;
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const TOO_LARGE =
  "Project is too large for a link. Export a Project File instead.";

export async function createProjectImportLink(text: string): Promise<string> {
  const file = new Blob([text]);
  if (file.size > MAX_PROJECT_BYTES) throw new Error(TOO_LARGE);
  const compressed = await new Response(
    file.stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  const bytes = new Uint8Array(compressed);
  if (4 * Math.ceil(bytes.length / 3) > MAX_PAYLOAD) throw new Error(TOO_LARGE);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const url = new URL(appUrl("editor"), window.location.origin);
  url.searchParams.set("import", "1");
  url.hash = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return url.href;
}

export async function projectFileFromImportLink(hash: string): Promise<File> {
  const payload = hash.slice(1);
  if (payload.length > MAX_PAYLOAD) throw new Error(TOO_LARGE);
  if (!/^[A-Za-z0-9_-]+$/u.test(payload))
    throw new Error("Incomplete project link");
  const bytes = Uint8Array.from(
    atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
    (ch) => ch.charCodeAt(0),
  );
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PROJECT_BYTES) {
      await reader.cancel();
      throw new Error(TOO_LARGE);
    }
    chunks.push(new Uint8Array(value));
  }
  return new File(chunks, "Shared project.icproj.json", {
    type: "application/json",
  });
}
