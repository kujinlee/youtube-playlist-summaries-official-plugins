import type { PlaylistOption } from '../../../lib/playlists/types';

describe('PlaylistOption', () => {
  it('PlaylistOption is constructible with required + optional fields', () => {
    const o: PlaylistOption = {
      id: 'PLabc', title: 'X', url: 'https://youtube.com/playlist?list=PLabc',
      source: 'recent', meta: { videoCount: 3 },
    };
    expect(o.source).toBe('recent');
  });
});
