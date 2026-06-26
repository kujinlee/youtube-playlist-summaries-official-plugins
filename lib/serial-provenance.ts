function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Rewrite the content of <meta name="source-md" content="..."> (no-op if absent). */
export function rewriteSourceMdMeta(html: string, newMdName: string): string {
  return html.replace(
    /(<meta name="source-md" content=")[^"]*(">)/,
    `$1${escAttr(newMdName)}$2`,
  );
}

/** Rewrite the top-level "sourceMd" string in a model-envelope JSON (parse→set→stringify). */
export function rewriteEnvelopeSourceMd(jsonText: string, newMdName: string): string {
  const obj = JSON.parse(jsonText) as Record<string, unknown>;
  obj.sourceMd = newMdName;
  return JSON.stringify(obj);
}
