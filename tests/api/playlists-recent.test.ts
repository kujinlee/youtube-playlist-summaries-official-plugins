jest.mock('../../lib/playlists/recent-provider', () => ({
  listRecentPlaylists: jest.fn(() => [{ id: 'PLa', title: 'X', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: {} }]),
}));
import { GET } from '../../app/api/playlists/recent/route';

const req = (u: string) => new Request(u);

it('400 when root is missing', async () => {
  expect((await GET(req('http://x/api/playlists/recent'))).status).toBe(400);
});
it('400 when root fails the home guard', async () => {
  expect((await GET(req('http://x/api/playlists/recent?root=' + encodeURIComponent('/etc')))).status).toBe(400);
});
it('200 { playlists } for a valid root', async () => {
  const res = await GET(req('http://x/api/playlists/recent?root=' + encodeURIComponent(process.env.HOME + '/some-data-root')));
  expect(res.status).toBe(200);
  expect((await res.json()).playlists[0].id).toBe('PLa');
});
