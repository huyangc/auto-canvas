/**
 * A loopback reverse proxy may terminate TLS. Trust only its single scheme
 * header, keeping Host authoritative and ignoring forwarded host/path values.
 */
export function publicUrl(
  requestUrl: string,
  forwardedProto: string | null | undefined,
  peerAddress: string | undefined,
): URL {
  const url = new URL(requestUrl);
  if (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peerAddress ?? "") &&
    (forwardedProto === "http" || forwardedProto === "https")
  )
    url.protocol = `${forwardedProto}:`;
  return url;
}
