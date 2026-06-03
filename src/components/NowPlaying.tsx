interface NowPlayingProps {
  title?: string;
  artist?: string;
}

export function NowPlaying({ title, artist }: NowPlayingProps) {
  if (!title) return null;

  return (
    <div className="flex-shrink-0 px-5 py-3 border-b border-white/10">
      <p className="text-white text-sm font-semibold truncate leading-tight">{title}</p>
      {artist && (
        <p className="text-white/50 text-xs truncate mt-0.5">{artist}</p>
      )}
    </div>
  );
}
