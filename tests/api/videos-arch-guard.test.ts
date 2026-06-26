// tests/api/videos-arch-guard.test.ts
//
// Architectural guard for the serial-prefix regression class.
//
// A filename-stripping migration once lived in `GET /api/videos` and silently
// stripped `NNN_` serial prefixes off index path fields on every request. The
// migration belongs in the CLI (`scripts/backfill-serial-prefix.ts`), never in
// a request handler. This guard fails if any stripper re-enters the request path.
import fs from 'fs';
import path from 'path';

const API_DIR = path.join(process.cwd(), 'app', 'api');

/** All `route.ts` files under app/api — the request-handler surface. */
function routeFiles(): string[] {
  const entries = fs.readdirSync(API_DIR, { recursive: true }) as string[];
  return entries
    .filter((rel) => path.basename(rel) === 'route.ts')
    .map((rel) => path.join(API_DIR, rel));
}

const FORBIDDEN: Array<{ symbol: string; why: string }> = [
  { symbol: 'stripSerialPrefix', why: 'serial-prefix stripper must stay in the CLI, not a request handler' },
  { symbol: 'migrateToSlugFilenames', why: 'legacy per-request migrator strips serial prefixes' },
];

// Match real usage (a call or an import), never a prose mention. A comment like
// `// stripSerialPrefix must NOT be called here` is documentation, not a regression,
// and must not trip the guard.
function usagePatterns(symbol: string): RegExp[] {
  return [
    new RegExp(`\\b${symbol}\\s*\\(`),       // call site:   stripSerialPrefix(
    new RegExp(`import\\b[^;]*\\b${symbol}\\b`), // import binding
  ];
}

// Note: this guard's own RED-ness (it fails when a stripper is present) is
// verified manually during development by injecting a call/import into a route
// and watching it fail + name the file, then reverting. It is not auto-mutated
// here — mutating production source inside a test run is the riskier option.
describe('request-path arch-guard: no serial-prefix stripper', () => {
  const files = routeFiles();

  it('finds the route handlers to guard', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(path.join('videos', 'route.ts')))).toBe(true);
  });

  it.each(FORBIDDEN)('no request handler calls or imports $symbol ($why)', ({ symbol }) => {
    const patterns = usagePatterns(symbol);
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return patterns.some((p) => p.test(src));
    });
    expect(offenders).toEqual([]);
  });
});
