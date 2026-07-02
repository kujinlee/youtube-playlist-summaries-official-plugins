import { localPrincipal, LOCAL_PRINCIPAL_ID } from '@/lib/storage/principal';

describe('localPrincipal', () => {
  it('wraps an outputFolder with the local sentinel id', () => {
    const p = localPrincipal('/home/u/data');
    expect(p.id).toBe(LOCAL_PRINCIPAL_ID);
    expect(p.outputFolder).toBe('/home/u/data');
  });

  it('LOCAL_PRINCIPAL_ID is the string "local"', () => {
    expect(LOCAL_PRINCIPAL_ID).toBe('local');
  });
});
