/**
 * Human-facing playlist title with a fallback chain.
 * Priority: explicit title → folder slug (from a resolved `<root>/<slug>/raw` target)
 * → "Untitled playlist". When the target ends in the canonical `/raw` leaf the slug is
 * its parent segment; otherwise it is the last path segment.
 */
export function playlistDisplayTitle(title?: string, folderTarget?: string): string {
  const t = (title ?? '').trim();
  if (t) return t;
  return folderSlug(folderTarget) || 'Untitled playlist';
}

function folderSlug(target?: string): string {
  if (!target) return '';
  const parts = target.split('/').filter(Boolean);
  if (parts.length === 0) return '';
  const last = parts[parts.length - 1];
  if (last === 'raw' && parts.length >= 2) return parts[parts.length - 2];
  return last;
}
