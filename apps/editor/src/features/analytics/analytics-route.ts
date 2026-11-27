import { appUrl } from "../../lib/app-url";

export function isAnalyticsPath(
  pathname: string,
  base = import.meta.env.BASE_URL,
) {
  const path = appUrl("analytics", base);
  return pathname === path || pathname === path + "/";
}
