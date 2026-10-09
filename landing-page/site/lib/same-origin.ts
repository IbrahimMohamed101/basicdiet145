/**
 * Validate browser Origin against the public Host header received by Railway.
 * request.nextUrl.origin can be an internal proxy URL and must not be used.
 * Requests without Origin retain the existing server-to-server behavior.
 */
export function isAllowedSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.host.toLowerCase() !== host.toLowerCase()) return false;
    if (parsed.protocol === "https:") return true;
    // HTTP is only accepted for local development; production must use HTTPS.
    return parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  } catch {
    return false;
  }
}
