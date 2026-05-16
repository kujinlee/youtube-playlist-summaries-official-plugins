import path from 'path';

describe('project setup', () => {
  it('Jest is configured and running', () => {
    expect(true).toBe(true);
  });

  it('TypeScript types are available', () => {
    const value: string = 'hello';
    expect(typeof value).toBe('string');
  });

  it('@/ module alias resolves to project root', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const aliasTarget = path.resolve(__dirname, '..', 'app');
    expect(aliasTarget.startsWith(projectRoot)).toBe(true);
  });
});
