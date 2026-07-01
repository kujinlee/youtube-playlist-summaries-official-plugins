export type PlaylistSource = 'recent' | 'channel'; // 'oauth' added by roadmap item C

export type PlaylistOption = {
  /** list= id — machine key, e.g. PLXX3HKP5ZNN3upet7agBU2W4l3jkYstZ2 */
  id: string;
  /** Human name shown in the UI. */
  title: string;
  /** Canonical https://youtube.com/playlist?list=<id> (no si=). */
  url: string;
  source: PlaylistSource;
  meta?: { videoCount?: number; channelTitle?: string; thumbnailUrl?: string };
};
