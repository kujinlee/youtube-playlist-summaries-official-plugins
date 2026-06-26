import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

// Component tests declare /** @jest-environment jsdom */ at the top of each file.
// All other tests (lib, api, smoke) run in the default node environment.
const jestConfig = createJestConfig({
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/tests/lib/**/*.test.ts',
    '<rootDir>/tests/api/**/*.test.ts',
    '<rootDir>/tests/scripts/**/*.test.ts',
    '<rootDir>/tests/smoke.test.ts',
    '<rootDir>/tests/components/**/*.test.tsx',
  ],
});

// forceExit is required because md-to-pdf (Puppeteer) keeps an async handle
// open after tests finish. This prevents jest from hanging indefinitely.
export default async () => ({ ...(await jestConfig()), forceExit: true });
