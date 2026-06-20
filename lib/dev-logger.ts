import fs from 'fs';
import path from 'path';

const MAX_DEPTH = 10;
const MAX_STACK_FRAMES = 5;

/**
 * Walk the error's .cause chain, collecting each node.
 * Caps at MAX_DEPTH levels and uses a Set to guard against cycles.
 */
function collectChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current !== undefined && current !== null && chain.length < MAX_DEPTH) {
    if (typeof current === 'object' && seen.has(current)) break;
    if (typeof current === 'object') seen.add(current);
    chain.push(current);
    if (current instanceof Error) {
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return chain;
}

/**
 * Format a single error node into "Name: message" plus up to MAX_STACK_FRAMES stack frames.
 */
function formatNode(node: unknown): string {
  if (node instanceof Error) {
    const header = `${node.name}: ${node.message}`;
    if (!node.stack) return header;
    // Stack typically starts with "ErrorName: message\n    at ...\n    at ..."
    const frames = node.stack
      .split('\n')
      .slice(1) // drop the first line (header already included)
      .filter((line) => line.trim().startsWith('at '))
      .slice(0, MAX_STACK_FRAMES)
      .join('\n');
    return frames ? `${header}\n${frames}` : header;
  }
  return String(node);
}

/**
 * Full chain: each Error's "Name: message" + first ~5 stack frames,
 * then "caused by:" for each subsequent level.
 * With cycle + depth guards.
 */
export function formatErrorChain(err: unknown): string {
  const chain = collectChain(err);
  return chain
    .map((node, i) => {
      const formatted = formatNode(node);
      return i === 0 ? formatted : `caused by: ${formatted}`;
    })
    .join('\n');
}

/**
 * Concise: just the message of each level joined " ← " (no stack).
 * For the UI.
 * With cycle + depth guards.
 */
export function errorSummary(err: unknown): string {
  const chain = collectChain(err);
  return chain
    .map((node) => (node instanceof Error ? node.message : String(node)))
    .join(' ← ');
}

/**
 * Best-effort: console.error the full chain AND append a timestamped block to the log file.
 * MUST NEVER THROW.
 */
export function logError(context: string, err: unknown): void {
  let chain = '';
  try {
    chain = formatErrorChain(err);
  } catch {
    chain = String(err);
  }

  try {
    console.error(`[${context}] ${chain}`);
  } catch {
    // ignore console.error failures
  }

  try {
    const logDir = process.env.DEV_ERROR_LOG_DIR ?? path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'dev-errors.log');
    const timestamp = new Date().toISOString();
    const block = `\n[${timestamp}] [${context}]\n${chain}\n`;
    fs.appendFileSync(logFile, block, 'utf-8');
  } catch {
    // swallow — logging must never throw
  }
}
