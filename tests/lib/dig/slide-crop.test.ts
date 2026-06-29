import { computeTrim } from '../../../lib/dig/slide-crop';

// Build a height-H profile where rows in [from,to) have the given bright fraction.
const prof = (H: number, bands: Array<[number, number, number]>): number[] => {
  const a = new Array(H).fill(0);
  for (const [from, to, frac] of bands) for (let i = from; i < to; i++) a[i] = frac;
  return a;
};

describe('computeTrim', () => {
  const H = 720;

  it('letterboxed bright-heading slide → trims top dead band, keeps content+footer', () => {
    const top = prof(H, [[200, 230, 0.1], [300, 460, 0.2]]);
    const bot = prof(H, [[200, 690, 0.2]]);
    const box = computeTrim(top, bot)!;
    expect(box).not.toBeNull();
    expect(box.trimTop).toBeGreaterThan(0.2);   // ~28% above heading removed
    expect(box.trimTop).toBeLessThan(0.3);
    expect(box.trimBot).toBeLessThan(0.06);      // only near-black below footer
  });

  it('heading flush at top, content to bottom → no/near-zero trim (under MIN_TRIM) → null', () => {
    const top = prof(H, [[2, 30, 0.2], [300, 700, 0.2]]); // bright from row 2
    const bot = prof(H, [[2, 718, 0.2]]);                 // content to near-bottom
    expect(computeTrim(top, bot)).toBeNull();             // pad makes trim < MIN_TRIM
  });

  it('all-dim slide (nothing above THR_TOP) → null', () => {
    expect(computeTrim(prof(H, []), prof(H, [[100, 600, 0.2]]))).toBeNull();
  });

  it('retained band below MIN_RETAIN → null', () => {
    expect(computeTrim(prof(H, [[350, 360, 0.1]]), prof(H, [[350, 360, 0.1]]))).toBeNull();
  });

  it('total trim below MIN_TRIM → null', () => {
    expect(computeTrim(prof(H, [[5, 715, 0.2]]), prof(H, [[5, 715, 0.2]]))).toBeNull();
  });

  it('REGRESSION (160-214-222): dim card content below last bright row is NOT cut', () => {
    const top = prof(H, [[180, 210, 0.1], [300, 430, 0.2]]);
    const bot = prof(H, [[180, 470, 0.2], [660, 695, 0.05]]); // descriptions to 470, footer 660-695
    const box = computeTrim(top, bot)!;
    expect((1 - box.trimBot) * H).toBeGreaterThan(470);  // bottom anchored below the descriptions
  });

  it('mismatched profile lengths → null', () => {
    expect(computeTrim([0, 0, 0], [0, 0])).toBeNull();
  });
});
