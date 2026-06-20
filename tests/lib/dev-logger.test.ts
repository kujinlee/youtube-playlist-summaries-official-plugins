/**
 * Tests for lib/dev-logger.ts
 * TDD: written before implementation — must be RED first, then GREEN after implementation.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { formatErrorChain, errorSummary, logError } from '../../lib/dev-logger';

// ---------------------------------------------------------------------------
// 1. formatErrorChain — nested error (3 levels)
// ---------------------------------------------------------------------------
describe('formatErrorChain', () => {
  it('contains all three messages in a nested error chain', () => {
    const err = new Error('top', { cause: new Error('mid', { cause: new Error('root') }) });
    const result = formatErrorChain(err);
    expect(result).toContain('top');
    expect(result).toContain('mid');
    expect(result).toContain('root');
  });

  it('includes "caused by:" label for deeper levels', () => {
    const err = new Error('top', { cause: new Error('mid', { cause: new Error('root') }) });
    const result = formatErrorChain(err);
    expect(result).toContain('caused by:');
  });

  // 2. formatErrorChain — non-Error value
  it('handles a plain string without throwing', () => {
    const result = formatErrorChain('plain string');
    expect(result).toContain('plain string');
  });

  it('handles null without throwing', () => {
    expect(() => formatErrorChain(null)).not.toThrow();
  });

  it('handles undefined without throwing', () => {
    expect(() => formatErrorChain(undefined)).not.toThrow();
  });

  it('caps depth at 10 to guard against infinite cause chains', () => {
    // Build a 15-level deep chain
    let err: Error = new Error('level-15');
    for (let i = 14; i >= 1; i--) {
      err = new Error(`level-${i}`, { cause: err });
    }
    // Should not throw, should not include levels past the cap
    const result = formatErrorChain(err);
    expect(result).toContain('level-1');
    expect(result).not.toContain('level-11');
  });

  it('guards against cycles in cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    // Manually create a cycle: a.cause = b (normally impossible via constructor but possible at runtime)
    (a as unknown as { cause: Error }).cause = b;
    expect(() => formatErrorChain(a)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. errorSummary — nested error messages joined with " ← "
// ---------------------------------------------------------------------------
describe('errorSummary', () => {
  it('joins all message levels with " ← "', () => {
    const err = new Error('top', { cause: new Error('mid', { cause: new Error('root') }) });
    const result = errorSummary(err);
    expect(result).toContain('top');
    expect(result).toContain('mid');
    expect(result).toContain('root');
    expect(result).toContain(' ← ');
  });

  it('equals the expected joined string for a 3-level chain', () => {
    const err = new Error('top', { cause: new Error('mid', { cause: new Error('root') }) });
    const result = errorSummary(err);
    expect(result).toBe('top ← mid ← root');
  });

  it('handles non-Error values', () => {
    expect(errorSummary('just a string')).toBe('just a string');
  });

  it('returns a single message (no arrow) for a plain error with no cause', () => {
    const result = errorSummary(new Error('boom'));
    expect(result).toBe('boom');
  });
});

// ---------------------------------------------------------------------------
// 4. logError — writes to a file with full chain and timestamp
// ---------------------------------------------------------------------------
describe('logError', () => {
  let tmpDir: string;
  const originalEnv = process.env.DEV_ERROR_LOG_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-logger-test-'));
    process.env.DEV_ERROR_LOG_DIR = tmpDir;
  });

  afterEach(() => {
    // Restore or delete the env var
    if (originalEnv === undefined) {
      delete process.env.DEV_ERROR_LOG_DIR;
    } else {
      process.env.DEV_ERROR_LOG_DIR = originalEnv;
    }
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a log file containing context, messages, and a timestamp', () => {
    logError('test:ctx', new Error('boom', { cause: new Error('why') }));

    const logPath = path.join(tmpDir, 'dev-errors.log');
    expect(fs.existsSync(logPath)).toBe(true);

    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('test:ctx');
    expect(content).toContain('boom');
    expect(content).toContain('why');
    // ISO-ish timestamp: at minimum it should contain a 4-digit year and a 'T'
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('creates the log directory if it does not exist', () => {
    const nestedDir = path.join(tmpDir, 'nested', 'logs');
    process.env.DEV_ERROR_LOG_DIR = nestedDir;
    expect(() => logError('ctx', new Error('test'))).not.toThrow();
    expect(fs.existsSync(path.join(nestedDir, 'dev-errors.log'))).toBe(true);
  });

  // 5. logError — never throws even with an invalid directory
  it('does not throw even if DEV_ERROR_LOG_DIR is an invalid path', () => {
    process.env.DEV_ERROR_LOG_DIR = '/dev/null/nope';
    expect(() => logError('ctx', new Error('oops'))).not.toThrow();
  });

  it('does not throw for non-Error values', () => {
    expect(() => logError('ctx', 'string error')).not.toThrow();
    expect(() => logError('ctx', 42)).not.toThrow();
    expect(() => logError('ctx', null)).not.toThrow();
  });

  it('appends multiple entries to the same file', () => {
    logError('ctx1', new Error('first'));
    logError('ctx2', new Error('second'));

    const content = fs.readFileSync(path.join(tmpDir, 'dev-errors.log'), 'utf-8');
    expect(content).toContain('ctx1');
    expect(content).toContain('first');
    expect(content).toContain('ctx2');
    expect(content).toContain('second');
  });
});
