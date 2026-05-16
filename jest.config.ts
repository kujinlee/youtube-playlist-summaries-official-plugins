import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

// Component tests declare /** @jest-environment jsdom */ at the top of each file.
// All other tests (lib, api, smoke) run in the default node environment.
export default createJestConfig({
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/tests/lib/**/*.test.ts',
    '<rootDir>/tests/api/**/*.test.ts',
    '<rootDir>/tests/smoke.test.ts',
    '<rootDir>/tests/components/**/*.test.tsx',
  ],
});
