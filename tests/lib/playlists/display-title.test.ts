import { playlistDisplayTitle } from '../../../lib/playlists/display-title';

describe('playlistDisplayTitle', () => {
  it('returns the explicit title when present', () => {
    expect(playlistDisplayTitle('건강', '/data/plugins/x/raw')).toBe('건강');
  });
  it('trims the title', () => {
    expect(playlistDisplayTitle('  Agentic AI  ')).toBe('Agentic AI');
  });
  it('falls back to the folder slug when the title is blank', () => {
    expect(playlistDisplayTitle('   ', '/data/plugins/건강/raw')).toBe('건강');
  });
  it('parses the slug from a canonical <slug>/raw target', () => {
    expect(playlistDisplayTitle(undefined, '/data/plugins/건강/raw')).toBe('건강');
  });
  it('uses the last segment when there is no raw leaf', () => {
    expect(playlistDisplayTitle(undefined, '/data/plugins/건강')).toBe('건강');
  });
  it('tolerates a trailing slash', () => {
    expect(playlistDisplayTitle(undefined, '/data/plugins/건강/raw/')).toBe('건강');
  });
  it('returns "Untitled playlist" with no title and no target', () => {
    expect(playlistDisplayTitle()).toBe('Untitled playlist');
  });
  it('returns "Untitled playlist" for an empty target', () => {
    expect(playlistDisplayTitle('', '')).toBe('Untitled playlist');
  });
});
