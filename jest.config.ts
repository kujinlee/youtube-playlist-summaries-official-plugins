import type { Config } from 'jest';

const tsJestOptions = {
  tsconfig: {
    moduleResolution: 'node16',
    module: 'commonjs',
    jsx: 'react-jsx',
  },
};

const config: Config = {
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/tests/lib/**/*.test.ts',
        '<rootDir>/tests/api/**/*.test.ts',
        '<rootDir>/tests/smoke.test.ts',
      ],
      transform: { '^.+\\.tsx?$': ['ts-jest', tsJestOptions] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jest-environment-jsdom',
      testMatch: ['<rootDir>/tests/components/**/*.test.tsx'],
      transform: { '^.+\\.tsx?$': ['ts-jest', tsJestOptions] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    },
  ],
};

export default config;
