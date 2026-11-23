// One account per mounted document. Switching accounts reloads the editor so
// open databases and pending workspace writes stay bound to their owner.
let storagePrefix = "";
export function bindAccountStorage(id: string, base: string) {
  const prefix = `auto-canvas:${encodeURIComponent(base)}:${id}:`;
  if (storagePrefix && prefix !== storagePrefix) throw Error("Account changed");
  storagePrefix = prefix;
}
export function accountKey(key: string): string {
  return storagePrefix + key;
}
