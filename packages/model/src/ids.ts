const ID_PREFIX_PATTERN = /^[a-z][a-z0-9-]*$/;
const NON_ASCII = /[^\x00-\x7f]/;
const encoder = new TextEncoder();

function assertPrefix(prefix: string): void {
  if (!ID_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid ID prefix: ${prefix}`);
  }
}

function fnv1a64(value: string): string {
  let lo = 0x84222325;
  let hi = 0xcbf29ce4;
  // The prime is 2^40 + 435. The low-word product fits exactly in a
  // Number, including the carry into the high word.
  const bytes = NON_ASCII.test(value) ? encoder.encode(value) : undefined;
  const length = bytes?.length ?? value.length;
  for (let index = 0; index < length; index++) {
    lo = (lo ^ (bytes ? bytes[index]! : value.charCodeAt(index))) >>> 0;
    const product = lo * 435;
    hi =
      (Math.imul(hi, 435) + (lo << 8) + Math.floor(product / 0x100000000)) >>>
      0;
    lo = product >>> 0;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

export function deriveStableId(
  prefix: string,
  ...identityParts: string[]
): string {
  assertPrefix(prefix);
  if (identityParts.length === 0) {
    throw new Error("A stable ID requires at least one identity part");
  }
  const framed = identityParts
    .map((part) => `${part.length}:${part}`)
    .join("|");
  return `${prefix}-${fnv1a64(framed)}`;
}

export function createId(prefix: string, randomUuid?: () => string): string {
  assertPrefix(prefix);
  const uuidFactory = randomUuid ?? (() => globalThis.crypto.randomUUID());
  return `${prefix}-${uuidFactory()}`;
}
