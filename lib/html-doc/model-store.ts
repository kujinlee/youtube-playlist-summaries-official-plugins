import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { MagazineModelSchema } from './types';

/**
 * The persisted summary-model file: the Gemini transform output plus provenance.
 * `sourceSections` is the section titles the model was built against — the drift guard the
 * re-render path compares the current .md's section titles against.
 */
export const ModelEnvelopeSchema = z
  .object({
    sourceMd: z.string().min(1),
    generatedAt: z.string().min(1),
    sourceSections: z.array(z.string()),
    model: MagazineModelSchema,
  })
  .strict();

export type ModelEnvelope = z.infer<typeof ModelEnvelopeSchema>;

function modelPath(outputFolder: string, base: string): string {
  return path.join(outputFolder, 'models', `${base}.json`);
}

/**
 * Atomically write the envelope to models/<base>.json (temp file → rename). Validated on write:
 * an invalid model throws here rather than producing a file the reader would reject.
 */
export function writeModelEnvelope(outputFolder: string, base: string, envelope: ModelEnvelope): void {
  ModelEnvelopeSchema.parse(envelope); // fail loud on an invalid model
  const dir = path.join(outputFolder, 'models');
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = modelPath(outputFolder, base);
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** Read + validate the envelope. Returns null if absent, unparseable, or schema-invalid. */
export function readModelEnvelope(outputFolder: string, base: string): ModelEnvelope | null {
  let raw: string;
  try {
    raw = fs.readFileSync(modelPath(outputFolder, base), 'utf-8');
  } catch {
    return null; // absent — not an error
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(`[model-store] malformed JSON in models/${base}.json — ignoring`);
    return null;
  }
  const parsed = ModelEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`[model-store] models/${base}.json failed schema validation — ignoring`);
    return null;
  }
  return parsed.data;
}
