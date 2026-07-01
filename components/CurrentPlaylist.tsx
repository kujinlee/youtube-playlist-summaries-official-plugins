type Props = { title: string; url?: string };

export default function CurrentPlaylist({ title, url }: Props) {
  return (
    <div className="pl-1">
      <p className="truncate text-sm text-zinc-100">{title}</p>
      {url && (
        <a
          href={url} target="_blank" rel="noopener noreferrer" title={url}
          className="block truncate text-xs text-zinc-500 hover:underline"
        >
          {url}
        </a>
      )}
    </div>
  );
}
