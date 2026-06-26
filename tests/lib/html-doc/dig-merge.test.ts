/**
 * Tests for lib/html-doc/dig-merge.ts
 *
 * All fixtures are pure in-memory objects — no fs access.
 * Covers all 9 behaviors from the task-3-brief.
 */

import { mergeDigDoc, MergedSection, MergeResult } from '../../../lib/html-doc/dig-merge';
import type { ParsedSummary, ParsedSection } from '../../../lib/html-doc/types';
import type { ModelEnvelope } from '../../../lib/html-doc/model-store';
import type { DugSection } from '../../../lib/dig/companion-doc';
import { DIG_GENERATOR_VERSION } from '../../../lib/dig/generate';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeSection(
  title: string,
  startSec: number | null = null,
  numeral: string | null = null,
): ParsedSection {
  return {
    numeral,
    title,
    prose: `Prose for ${title}`,
    timeRange: startSec !== null ? { startSec, endSec: startSec + 60, label: `${startSec}s`, url: `https://yt.test/?t=${startSec}s` } : null,
  };
}

function makeSummary(sections: ParsedSection[]): ParsedSummary {
  return {
    title: 'Test Video',
    channel: null,
    duration: null,
    url: null,
    lang: 'EN',
    videoId: null,
    tldr: null,
    takeaways: [],
    sections,
    sourceMd: null,
  };
}

function makeEnvelope(sourceSections: string[], modelSections: { lead: string; bullets: { label: string; text: string }[] }[]): ModelEnvelope {
  return {
    sourceMd: 'test.md',
    generatedAt: '2024-01-01T00:00:00Z',
    sourceSections,
    model: { sections: modelSections },
  };
}

function makeModelSection(lead: string = 'Lead text', bulletCount: number = 3) {
  return {
    lead,
    bullets: Array.from({ length: bulletCount }, (_, i) => ({ label: `L${i}`, text: `Bullet ${i}` })),
  };
}

function makeDug(sectionId: number, title: string, startSec?: number, genVersion = DIG_GENERATOR_VERSION): DugSection {
  return {
    sectionId,
    startSec: startSec ?? sectionId,
    title,
    bodyMarkdown: `Body for ${title}`,
    generatedAt: '2024-01-01T00:00:00Z',
    genVersion,
  };
}

// ── Behavior 1: 7 sections / 0 dug → 7 gists, no dug, no orphan ─────────────

describe('Behavior 1: 7 sections, 0 dug → 7 gists, no dug, no orphan', () => {
  it('produces one MergedSection per summary section in order', () => {
    const titles = ['Intro', 'Background', 'Method', 'Results', 'Discussion', 'Conclusion', 'Appendix'];
    const sections = titles.map((t, i) => makeSection(t, i * 60, String(i + 1)));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map((t) => makeModelSection(`Lead for ${t}`)));

    const result = mergeDigDoc(summary, envelope, []);

    expect(result.sections).toHaveLength(7);
    expect(result.orphans).toHaveLength(0);
    result.sections.forEach((ms, i) => {
      expect(ms.index).toBe(i);
      expect(ms.title).toBe(titles[i]);
      expect(ms.gist).not.toBeNull();
      expect(ms.dug).toBeNull();
    });
  });

  it('preserves order (index matches array position)', () => {
    const titles = ['A', 'B', 'C'];
    const sections = titles.map((t, i) => makeSection(t, i * 10));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    const result = mergeDigDoc(summary, envelope, []);

    expect(result.sections.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(result.sections.map((s) => s.title)).toEqual(titles);
  });
});

// ── Behavior 2: dug by sectionId ─────────────────────────────────────────────

describe('Behavior 2: dug section matched by sectionId === startSec', () => {
  it('attaches dug content when sectionId matches the section startSec', () => {
    const titles = ['Intro', 'Methods', 'Results'];
    const startSecs = [0, 120, 300];
    const sections = titles.map((t, i) => makeSection(t, startSecs[i], String(i + 1)));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));
    const dug = [makeDug(120, 'Methods')]; // sectionId = 120 = startSec of "Methods"

    const result = mergeDigDoc(summary, envelope, dug);

    expect(result.sections[0].dug).toBeNull();  // Intro: no dug
    expect(result.sections[1].dug).not.toBeNull(); // Methods: matched
    expect(result.sections[1].dug?.bodyMarkdown).toBe('Body for Methods');
    expect(result.sections[2].dug).toBeNull();  // Results: no dug
    expect(result.orphans).toHaveLength(0);
  });

  it('does not consume a dug section for a different sectionId', () => {
    const titles = ['Intro', 'Methods'];
    const sections = titles.map((t, i) => makeSection(t, i * 100));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));
    const dug = [makeDug(999, 'Methods')]; // sectionId 999 ≠ any startSec

    const result = mergeDigDoc(summary, envelope, dug);

    // sectionId 999 ≠ startSecs [0, 100]; title "Methods" matches section[1] via fallback
    expect(result.sections[1].dug).not.toBeNull();
    expect(result.sections[1].dug?.bodyMarkdown).toBe('Body for Methods');
    expect(result.orphans).toHaveLength(0);
  });
});

// ── Behavior 2b: duplicate sectionId → matched one attaches, duplicate → orphan ─

describe('Behavior 2b: duplicate sectionId → first attaches, duplicate goes to orphans (never dropped)', () => {
  it('sends the extra DugSection with duplicate sectionId to orphans[]', () => {
    // One summary section with startSec=120; two DugSections both claim sectionId=120.
    // The first one should attach to the section; the duplicate must appear in orphans[].
    const titles = ['Intro', 'Methods', 'Results'];
    const startSecs = [0, 120, 300];
    const sections = titles.map((t, i) => makeSection(t, startSecs[i], String(i + 1)));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    const dugFirst: DugSection = {
      sectionId: 120,
      startSec: 120,
      title: 'Methods',
      bodyMarkdown: 'First body for Methods',
      generatedAt: '2024-01-01T00:00:00Z',
      genVersion: DIG_GENERATOR_VERSION,
    };
    const dugDuplicate: DugSection = {
      sectionId: 120,
      startSec: 120,
      title: 'Methods',
      bodyMarkdown: 'Duplicate body for Methods',
      generatedAt: '2024-01-02T00:00:00Z',
      genVersion: DIG_GENERATOR_VERSION,
    };
    const dug = [dugFirst, dugDuplicate];

    const result = mergeDigDoc(summary, envelope, dug);

    // The matched one attaches to the summary section
    expect(result.sections[1].dug).not.toBeNull();
    expect(result.sections[1].dug?.bodyMarkdown).toBe('First body for Methods');

    // The duplicate must appear in orphans[], never silently dropped
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].sectionId).toBe(120);
    expect(result.orphans[0].bodyMarkdown).toBe('Duplicate body for Methods');

    // Unrelated sections unaffected
    expect(result.sections[0].dug).toBeNull();
    expect(result.sections[2].dug).toBeNull();
  });
});

// ── Behavior 3: title-fallback re-anchor ─────────────────────────────────────

describe('Behavior 3: title-fallback re-anchor (sectionId ≠ startSec, title matches)', () => {
  it('matches via title when sectionId does not equal startSec', () => {
    const titles = ['Introduction', 'Core Concepts', 'Wrap-Up'];
    const startSecs = [0, 200, 500];
    const sections = titles.map((t, i) => makeSection(t, startSecs[i]));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    // DugSection was generated when "Core Concepts" started at 180 (now 200 after re-summarize)
    const dug = [makeDug(180, 'Core Concepts', 180)]; // sectionId=180 ≠ startSec=200

    const result = mergeDigDoc(summary, envelope, dug);

    expect(result.sections[1].dug).not.toBeNull();
    expect(result.sections[1].dug?.bodyMarkdown).toBe('Body for Core Concepts');
    expect(result.orphans).toHaveLength(0);
  });

  it('title fallback is only used for not-yet-dug sections', () => {
    const titles = ['A', 'A-twin']; // different titles
    const sections = titles.map((t, i) => makeSection(t, i * 100));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    const dug = [
      makeDug(0, 'A'),          // sectionId=0 matches "A" at startSec=0 (step 1)
      makeDug(999, 'A'),        // sectionId=999 ≠ any startSec; title "A" already consumed
    ];

    const result = mergeDigDoc(summary, envelope, dug);

    // The second dug has title "A" but "A" section is already consumed → orphan
    expect(result.sections[0].dug).not.toBeNull();
    expect(result.sections[1].dug).toBeNull();
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].sectionId).toBe(999);
  });
});

// ── Behavior 4: true orphan ───────────────────────────────────────────────────

describe('Behavior 4: true orphan (id & title absent from summary)', () => {
  it('puts unmatched DugSection into orphans[], never drops it', () => {
    const titles = ['Intro', 'Conclusion'];
    const sections = titles.map((t, i) => makeSection(t, i * 100));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    const dug = [
      makeDug(999, 'Ghost Section'), // sectionId 999 ≠ any startSec; title not in summary
    ];

    const result = mergeDigDoc(summary, envelope, dug);

    expect(result.sections[0].dug).toBeNull();
    expect(result.sections[1].dug).toBeNull();
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].sectionId).toBe(999);
    expect(result.orphans[0].title).toBe('Ghost Section');
    expect(result.orphans[0].bodyMarkdown).toBe('Body for Ghost Section');
  });

  it('collects multiple orphans', () => {
    const titles = ['Only Section'];
    const sections = titles.map((t) => makeSection(t, 0));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    const dug = [
      makeDug(111, 'Ghost 1'),
      makeDug(222, 'Ghost 2'),
    ];

    const result = mergeDigDoc(summary, envelope, dug);

    expect(result.orphans).toHaveLength(2);
    expect(result.orphans.map((o) => o.sectionId).sort()).toEqual([111, 222]);
  });
});

// ── Behavior 5: timeRange null → startSec null, gist set, no dug ─────────────

describe('Behavior 5: timeRange null → startSec null, gist set, no dug', () => {
  it('returns startSec null when section has no timeRange', () => {
    const section = makeSection('No-timestamp Section', null); // null → no timeRange
    const summary = makeSummary([section]);
    const envelope = makeEnvelope(['No-timestamp Section'], [makeModelSection()]);

    const result = mergeDigDoc(summary, envelope, []);

    expect(result.sections[0].startSec).toBeNull();
    expect(result.sections[0].gist).not.toBeNull();
    expect(result.sections[0].dug).toBeNull();
  });

  it('dug sections cannot match a null-startSec section by sectionId (step 1 skipped)', () => {
    const section = makeSection('No Timestamp', null);
    const summary = makeSummary([section]);
    const envelope = makeEnvelope(['No Timestamp'], [makeModelSection()]);

    // A dug section with sectionId=0 should NOT match since startSec is null
    const dug = [makeDug(0, 'No Timestamp')];

    const result = mergeDigDoc(summary, envelope, dug);

    // Step 1 is skipped (startSec is null), but step 2 title "No Timestamp" matches
    expect(result.sections[0].dug).not.toBeNull();
    expect(result.orphans).toHaveLength(0);
  });

  it('dug cannot match null-startSec when title also differs → orphan', () => {
    const section = makeSection('Different Title', null);
    const summary = makeSummary([section]);
    const envelope = makeEnvelope(['Different Title'], [makeModelSection()]);

    const dug = [makeDug(0, 'No Timestamp')]; // title doesn't match "Different Title"

    const result = mergeDigDoc(summary, envelope, dug);

    expect(result.sections[0].dug).toBeNull();
    expect(result.orphans).toHaveLength(1);
  });
});

// ── Behavior 6: envelope null → all gist null ─────────────────────────────────

describe('Behavior 6: envelope null → all gist null', () => {
  it('returns gist=null for all sections when envelope is null', () => {
    const titles = ['Sec A', 'Sec B', 'Sec C'];
    const sections = titles.map((t, i) => makeSection(t, i * 60));
    const summary = makeSummary(sections);

    const result = mergeDigDoc(summary, null, []);

    expect(result.sections).toHaveLength(3);
    result.sections.forEach((ms) => {
      expect(ms.gist).toBeNull();
    });
    expect(result.orphans).toHaveLength(0);
  });

  it('dug sections still match when envelope is null', () => {
    const titles = ['Sec A', 'Sec B'];
    const sections = titles.map((t, i) => makeSection(t, i * 60));
    const summary = makeSummary(sections);
    const dug = [makeDug(60, 'Sec B')];

    const result = mergeDigDoc(summary, null, dug);

    expect(result.sections[0].gist).toBeNull();
    expect(result.sections[1].gist).toBeNull();
    expect(result.sections[1].dug).not.toBeNull();
  });
});

// ── Behavior 7: !sameTitles → all gist null ───────────────────────────────────

describe('Behavior 7: sameTitles mismatch → all gist null (model drift skeleton)', () => {
  it('returns gist=null for all sections when titles do not match sourceSections', () => {
    const summaryTitles = ['Intro', 'New Section', 'Conclusion'];
    const modelTitles = ['Intro', 'Old Section', 'Conclusion']; // mismatch
    const sections = summaryTitles.map((t, i) => makeSection(t, i * 60));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(modelTitles, summaryTitles.map(() => makeModelSection()));

    const result = mergeDigDoc(summary, envelope, []);

    result.sections.forEach((ms) => {
      expect(ms.gist).toBeNull();
    });
  });

  it('returns gist=null when title arrays have different lengths', () => {
    const summaryTitles = ['A', 'B', 'C'];
    const modelTitles = ['A', 'B']; // length mismatch
    const sections = summaryTitles.map((t, i) => makeSection(t, i * 60));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(modelTitles, summaryTitles.map(() => makeModelSection()));

    const result = mergeDigDoc(summary, envelope, []);

    result.sections.forEach((ms) => {
      expect(ms.gist).toBeNull();
    });
  });
});

// ── Behavior 8: model shorter than summary → overflow gist null, no crash ─────

describe('Behavior 8: model shorter than summary → overflow gist null, no crash', () => {
  it('returns gist=null for sections beyond model.sections length', () => {
    const summaryTitles = ['A', 'B', 'C', 'D'];
    // Model only has 2 sections but titles match (unusual edge case where model is truncated)
    // NOTE: ModelEnvelopeSchema requires min(1) for bullets and sections must exist.
    // But sourceSections must match summaryTitles — if they match, model.sections length
    // could still be shorter than summary sections.
    // For this test: sourceSections matches, but we'll use a model with fewer sections
    // by using the raw object without going through Zod (since the schema would reject it).
    // Actually: sameTitles compares parsedTitles vs sourceSections, not model.sections.
    // If sourceSections matches but model.sections is shorter, overflow sections get null.
    const sections = summaryTitles.map((t, i) => makeSection(t, i * 60));
    const summary = makeSummary(sections);

    // Manually construct envelope where sourceSections matches but model.sections is shorter
    const envelope: ModelEnvelope = {
      sourceMd: 'test.md',
      generatedAt: '2024-01-01T00:00:00Z',
      sourceSections: summaryTitles, // matches all 4 summary titles
      model: {
        sections: [
          makeModelSection('Lead A'),
          makeModelSection('Lead B'),
          // C and D are missing from model.sections
        ],
      },
    };

    const result = mergeDigDoc(summary, envelope, []);

    expect(result.sections).toHaveLength(4);
    expect(result.sections[0].gist).not.toBeNull();
    expect(result.sections[0].gist?.lead).toBe('Lead A');
    expect(result.sections[1].gist).not.toBeNull();
    expect(result.sections[1].gist?.lead).toBe('Lead B');
    // Overflow: model.sections[2] and [3] don't exist
    expect(result.sections[2].gist).toBeNull();
    expect(result.sections[3].gist).toBeNull();
    expect(result.orphans).toHaveLength(0);
  });

  it('does not crash with 0 model sections (edge case)', () => {
    // This requires bypassing Zod's min(1) check — we test the pure logic
    const sections = [makeSection('Only Section', 0)];
    const summary = makeSummary(sections);

    const envelope: ModelEnvelope = {
      sourceMd: 'test.md',
      generatedAt: '2024-01-01T00:00:00Z',
      sourceSections: ['Only Section'],
      model: {
        sections: [],
      } as unknown as ModelEnvelope['model'], // bypass Zod: just for pure logic test
    };

    expect(() => mergeDigDoc(summary, envelope, [])).not.toThrow();
    const result = mergeDigDoc(summary, envelope, []);
    expect(result.sections[0].gist).toBeNull();
  });
});

// ── Behavior 9: zero dug, model present → gists, no orphan ───────────────────

describe('Behavior 9: zero dug, model present → gists, no orphan', () => {
  it('returns gists and no orphans when dug array is empty', () => {
    const titles = ['Sec 1', 'Sec 2'];
    const sections = titles.map((t, i) => makeSection(t, i * 90));
    const summary = makeSummary(sections);
    const modelSections = [makeModelSection('Lead 1'), makeModelSection('Lead 2')];
    const envelope = makeEnvelope(titles, modelSections);

    const result = mergeDigDoc(summary, envelope, []);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].gist?.lead).toBe('Lead 1');
    expect(result.sections[1].gist?.lead).toBe('Lead 2');
    expect(result.sections[0].dug).toBeNull();
    expect(result.sections[1].dug).toBeNull();
    expect(result.orphans).toHaveLength(0);
  });
});

// ── Additional structural shape tests ─────────────────────────────────────────

describe('MergedSection shape', () => {
  it('includes correct numeral and startSec fields', () => {
    const section = makeSection('Test', 45, '2');
    const summary = makeSummary([section]);
    const envelope = makeEnvelope(['Test'], [makeModelSection('My Lead')]);

    const result = mergeDigDoc(summary, envelope, []);

    expect(result.sections[0]).toMatchObject({
      index: 0,
      numeral: '2',
      title: 'Test',
      startSec: 45,
    });
    expect(result.sections[0].gist?.lead).toBe('My Lead');
  });

  it('gist includes lead and bullets from model', () => {
    const section = makeSection('Test Section', 10);
    const summary = makeSummary([section]);
    const modelSection = {
      lead: 'The lead sentence',
      bullets: [
        { label: 'Point 1', text: 'First point' },
        { label: 'Point 2', text: 'Second point' },
        { label: 'Point 3', text: 'Third point' },
      ],
    };
    const envelope = makeEnvelope(['Test Section'], [modelSection]);

    const result = mergeDigDoc(summary, envelope, []);

    expect(result.sections[0].gist).toEqual({
      lead: 'The lead sentence',
      bullets: modelSection.bullets,
    });
  });
});

// ── Behavior 2c: duplicate sectionId, NEITHER matched → exactly 2 orphans ────
//
// Regression: when two DugSections share a sectionId that matches NO summary
// section (neither by startSec nor by title), the earlier orphan-build path
// pushed the first entry to postOrphans AND the duplicate to preOrphans,
// resulting in 3 entries for 2 inputs.  The fix emits each input exactly once.

describe('Behavior 2c: duplicate sectionId, all unmatched → exactly 2 orphans (no triplication)', () => {
  it('produces orphans.length === 2 when both DugSections are unmatched', () => {
    // Summary has sections that share NO sectionId or title with the dug input.
    const titles = ['Intro', 'Conclusion'];
    const startSecs = [0, 300];
    const sections = titles.map((t, i) => makeSection(t, startSecs[i]));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    const dugA: DugSection = {
      sectionId: 999,          // does not match any startSec (0 or 300)
      startSec: 999,
      title: 'Ghost Section',  // does not match any summary title
      bodyMarkdown: 'body-a',
      generatedAt: '2024-01-01T00:00:00Z',
      genVersion: DIG_GENERATOR_VERSION,
    };
    const dugB: DugSection = {
      sectionId: 999,          // same id — duplicate
      startSec: 999,
      title: 'Ghost Section',
      bodyMarkdown: 'body-b',
      generatedAt: '2024-01-02T00:00:00Z',
      genVersion: DIG_GENERATOR_VERSION,
    };
    const dug = [dugA, dugB];

    const result = mergeDigDoc(summary, envelope, dug);

    // Neither should attach to a summary section.
    result.sections.forEach((ms) => expect(ms.dug).toBeNull());

    // Exactly two orphan entries — one per input DugSection, not three.
    expect(result.orphans).toHaveLength(2);

    const bodies = result.orphans.map((o) => o.bodyMarkdown).sort();
    expect(bodies).toEqual(['body-a', 'body-b']);

    // Both share the same sectionId (preserved faithfully).
    expect(result.orphans.every((o) => o.sectionId === 999)).toBe(true);
  });
});

// ── Step-1 priority over step-2 ──────────────────────────────────────────────

describe('sectionId match (step 1) takes priority over title match (step 2)', () => {
  it('step-1 match wins even when another dug section has the same title', () => {
    const titles = ['Alpha', 'Beta'];
    const startSecs = [0, 100];
    const sections = titles.map((t, i) => makeSection(t, startSecs[i]));
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, titles.map(() => makeModelSection()));

    // Two dug sections for "Beta": one matches by sectionId, one would match by title
    const dug = [
      makeDug(100, 'Beta'),    // sectionId=100 = startSec of "Beta" → step 1 match
      makeDug(999, 'Beta'),    // sectionId=999 ≠ any startSec; title "Beta" already consumed
    ];

    const result = mergeDigDoc(summary, envelope, dug);

    expect(result.sections[1].dug?.bodyMarkdown).toBe('Body for Beta'); // from sectionId=100
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].sectionId).toBe(999);
  });
});

// ── Task 4: isStale flag on MergedSection ─────────────────────────────────────

const summaryWithOneSection = makeSummary([makeSection('Intro', 0)]);
const envelopeForOneSection = makeEnvelope(['Intro'], [makeModelSection()]);

describe('isStale: sectionId-match path (construction site 1)', () => {
  it('marks a matched section stale when its genVersion < current', () => {
    const { sections } = mergeDigDoc(
      summaryWithOneSection,
      envelopeForOneSection,
      [makeDug(0, 'Intro', 0, DIG_GENERATOR_VERSION - 1)],
    );
    expect(sections.find((x) => x.dug !== null)!.isStale).toBe(true);
  });

  it('marks a matched section fresh when genVersion === current', () => {
    const { sections } = mergeDigDoc(
      summaryWithOneSection,
      envelopeForOneSection,
      [makeDug(0, 'Intro', 0, DIG_GENERATOR_VERSION)],
    );
    expect(sections.find((x) => x.dug !== null)!.isStale).toBe(false);
  });

  it('treats a zero genVersion as stale (legacy doc)', () => {
    const { sections } = mergeDigDoc(
      summaryWithOneSection,
      envelopeForOneSection,
      [makeDug(0, 'Intro', 0, 0)],
    );
    expect(sections.find((x) => x.dug !== null)!.isStale).toBe(true);
  });

  it('non-dug sections are never stale', () => {
    const { sections } = mergeDigDoc(summaryWithOneSection, envelopeForOneSection, []);
    expect(sections.every((x) => x.isStale === false)).toBe(true);
  });
});

describe('isStale: title-match path (mutation site 2)', () => {
  it('marks a title-matched section stale when genVersion < current', () => {
    // DugSection sectionId=180 does NOT equal startSec=200 → step-1 miss → title fallback
    const titles = ['Core Concepts'];
    const sections = [makeSection('Core Concepts', 200)];
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, [makeModelSection()]);
    const dug = [makeDug(180, 'Core Concepts', 180, DIG_GENERATOR_VERSION - 1)];

    const { sections: merged } = mergeDigDoc(summary, envelope, dug);
    const ms = merged.find((x) => x.dug !== null)!;
    expect(ms).toBeDefined();
    expect(ms.isStale).toBe(true);
  });

  it('marks a title-matched section fresh when genVersion === current', () => {
    const titles = ['Core Concepts'];
    const sections = [makeSection('Core Concepts', 200)];
    const summary = makeSummary(sections);
    const envelope = makeEnvelope(titles, [makeModelSection()]);
    const dug = [makeDug(180, 'Core Concepts', 180, DIG_GENERATOR_VERSION)];

    const { sections: merged } = mergeDigDoc(summary, envelope, dug);
    const ms = merged.find((x) => x.dug !== null)!;
    expect(ms).toBeDefined();
    expect(ms.isStale).toBe(false);
  });
});
