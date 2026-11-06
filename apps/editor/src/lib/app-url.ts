/** Paths within this editor deployment; Vite supplies a trailing-slash base. */
export function appUrl(path: string, base = import.meta.env.BASE_URL): string {
  return `${base}${path}`;
}

export function apiUrl(path: string, base = import.meta.env.BASE_URL): string {
  return appUrl(`api/${path}`, base);
}
