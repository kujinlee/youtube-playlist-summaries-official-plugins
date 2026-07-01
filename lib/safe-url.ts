/**
 * Returns the URL only if it uses an http(s) scheme; otherwise null.
 * Guards against javascript:/data: URIs reaching an anchor href (XSS). Zod's
 * `.url()` validates syntax but NOT scheme, so this is a separate render-time gate.
 */
export function safeHttpUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
