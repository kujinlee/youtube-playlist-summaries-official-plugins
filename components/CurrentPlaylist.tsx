import { safeHttpUrl } from '../lib/safe-url';

type Props = { title: string; url?: string };

export default function CurrentPlaylist({ title, url }: Props) {
  const safeUrl = safeHttpUrl(url);
  return (
    <div className="pl-1">
      <p className="truncate text-sm text-zinc-100">{title}</p>
      {safeUrl && (
        <a
          href={safeUrl} target="_blank" rel="noopener noreferrer" title={safeUrl}
          className="block truncate text-xs text-zinc-500 hover:underline"
        >
          {safeUrl}
        </a>
      )}
    </div>
  );
}
