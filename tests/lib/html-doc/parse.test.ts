import { parseSummaryMarkdown } from '../../../lib/html-doc/parse';

const SAMPLE = `---
tags:
  - video-summary
video_id: "7xTGNNLPyMI"
lang: EN
score: 4.8
---

# Deep Dive into LLMs like ChatGPT

**Channel:** Andrej Karpathy | **Duration:** 3:31:24 | **URL:** https://www.youtube.com/watch?v=7xTGNNLPyMI

> [!summary] Quick Reference
> **TL;DR:** This video details how LLMs are built.
>
> **Key Takeaways:**
> - LLMs begin with filtered internet text.
> - Pre-training predicts the next token.
>
> **Concepts:** llms · training

---

## 1. The Foundation: Data and Tokenization
First paragraph of section one.

Second paragraph of section one.
---
## 2. Pre-training
Body of section two.
---
## Conclusion
Wrap-up text.
`;

describe('parseSummaryMarkdown', () => {
  const parsed = parseSummaryMarkdown(SAMPLE);

  it('extracts header meta', () => {
    expect(parsed.title).toBe('Deep Dive into LLMs like ChatGPT');
    expect(parsed.channel).toBe('Andrej Karpathy');
    expect(parsed.duration).toBe('3:31:24');
    expect(parsed.url).toBe('https://www.youtube.com/watch?v=7xTGNNLPyMI');
    expect(parsed.lang).toBe('EN');
    expect(parsed.videoId).toBe('7xTGNNLPyMI');
  });

  it('extracts tldr and takeaways from the callout', () => {
    expect(parsed.tldr).toBe('This video details how LLMs are built.');
    expect(parsed.takeaways).toEqual([
      'LLMs begin with filtered internet text.',
      'Pre-training predicts the next token.',
    ]);
  });

  it('splits sections and strips the leading ordinal into numeral', () => {
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[0]).toMatchObject({ numeral: '1', title: 'The Foundation: Data and Tokenization' });
    expect(parsed.sections[0].prose).toContain('First paragraph of section one.');
    expect(parsed.sections[0].prose).toContain('Second paragraph of section one.');
    expect(parsed.sections[0].prose).not.toContain('---');
  });

  it('gives Conclusion a null numeral', () => {
    const last = parsed.sections[2];
    expect(last.numeral).toBeNull();
    expect(last.title).toBe('Conclusion');
  });

  it('returns null tldr and empty takeaways when no callout present', () => {
    const noCallout = parseSummaryMarkdown(`# T\n\n**Channel:** C | **Duration:** 1:00 | **URL:** http://x\n\n## 1. A\nbody\n`);
    expect(noCallout.tldr).toBeNull();
    expect(noCallout.takeaways).toEqual([]);
  });

  it('throws when there are zero sections', () => {
    expect(() => parseSummaryMarkdown(`# T\n\nno sections here\n`)).toThrow(/no sections/i);
  });

  it('strips multi-dash (-----) dividers from prose while still splitting sections', () => {
    const md = `# T

**Channel:** C | **Duration:** 1:00 | **URL:** http://x

## 1. First
First section prose.
-----
## 2. Second
Second section prose.
-----
## Conclusion
Wrap up.
`;
    const p = parseSummaryMarkdown(md);
    expect(p.sections).toHaveLength(3);
    expect(p.sections[0].prose).toContain('First section prose.');
    expect(p.sections[0].prose).not.toContain('-----');
    expect(p.sections[0].prose).not.toMatch(/-{3,}/);
    expect(p.sections[1]).toMatchObject({ numeral: '2', title: 'Second' });
    expect(p.sections[1].prose).not.toMatch(/-{3,}/);
  });

  it('parses Korean content (title, takeaways, section)', () => {
    const ko = `---
video_id: "vid123"
lang: KO
---

# 한국어 제목

**Channel:** 채널 | **Duration:** 9:58 | **URL:** https://youtu.be/k

> [!summary] Quick Reference
> **TL;DR:** 핵심 요약입니다.
>
> **Key Takeaways:**
> - 첫 번째 요점.
>
> **Concepts:** 가 · 나

---

## 1. 첫 번째 섹션
첫 번째 섹션 본문.
`;
    const p = parseSummaryMarkdown(ko);
    expect(p.title).toBe('한국어 제목');
    expect(p.lang).toBe('KO');
    expect(p.tldr).toBe('핵심 요약입니다.');
    expect(p.takeaways).toEqual(['첫 번째 요점.']);
    expect(p.sections[0]).toMatchObject({ numeral: '1', title: '첫 번째 섹션' });
    expect(p.sections[0].prose).toContain('첫 번째 섹션 본문.');
  });

  it('keeps a channel that contains " | " (does not truncate at the first pipe)', () => {
    const md = `# T

**Channel:** Studio A | Host B | **Duration:** 12:34 | **URL:** https://youtu.be/x

## 1. Sec
body
`;
    const p = parseSummaryMarkdown(md);
    expect(p.channel).toBe('Studio A | Host B');
    expect(p.duration).toBe('12:34');
  });

  it('parses takeaways when the input uses CRLF line endings', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const p = parseSummaryMarkdown(crlf);
    expect(p.takeaways.length).toBeGreaterThanOrEqual(1);
    expect(p.takeaways).toEqual([
      'LLMs begin with filtered internet text.',
      'Pre-training predicts the next token.',
    ]);
    expect(p.tldr).toBe('This video details how LLMs are built.');
  });

  it('does not split on ## inside a fenced code block, and preserves fenced content verbatim', () => {
    const md = `# T

**Channel:** C | **Duration:** 1:00 | **URL:** http://x

## 1. Real Section
Intro prose.

\`\`\`md
## Not A Heading
-----
fenced dashes kept
\`\`\`

After the fence.
## 2. Second Real Section
second body
`;
    const p = parseSummaryMarkdown(md);
    expect(p.sections).toHaveLength(2);
    expect(p.sections[0]).toMatchObject({ numeral: '1', title: 'Real Section' });
    expect(p.sections[1]).toMatchObject({ numeral: '2', title: 'Second Real Section' });
    // The fenced "## Not A Heading" survives in prose and did not create a third section.
    expect(p.sections[0].prose).toContain('## Not A Heading');
    expect(p.sections[0].prose).toContain('-----'); // dash divider inside fence preserved
    expect(p.sections[0].prose).toContain('fenced dashes kept');
    expect(p.sections[0].prose).toContain('After the fence.');
  });
});

const WITH_TS = `# T

**URL:** https://www.youtube.com/watch?v=vid123

---

## 1. Core Claim
▶ [2:15–5:30](https://www.youtube.com/watch?v=vid123&t=135s)

First paragraph.
---
## 2. No Timestamp
Body only.
---
## Conclusion
▶ [10:00–10:30](https://www.youtube.com/watch?v=vid123&t=600s)

Wrap-up.
`;

describe('parseSummaryMarkdown — section timestamps', () => {
  const parsed = parseSummaryMarkdown(WITH_TS);

  it('lifts the ▶ line into timeRange and removes it from prose', () => {
    const s0 = parsed.sections[0];
    expect(s0.timeRange).toEqual({
      startSec: 135,
      endSec: 330,
      label: '2:15–5:30',
      url: 'https://www.youtube.com/watch?v=vid123&t=135s',
    });
    expect(s0.prose).toBe('First paragraph.');
    expect(s0.prose).not.toContain('▶');
  });

  it('sets timeRange null when a section has no ▶ line', () => {
    expect(parsed.sections[1].timeRange ?? null).toBeNull();
    expect(parsed.sections[1].prose).toBe('Body only.');
  });

  it('resolves the Conclusion timestamp too', () => {
    expect(parsed.sections[2].timeRange?.startSec).toBe(600);
    expect(parsed.sections[2].timeRange?.endSec).toBe(630);
  });

  it('handles a section whose only content is the ▶ line (prose empty)', () => {
    const md = `# T

---

## 1. A
▶ [2:15–5:30](https://www.youtube.com/watch?v=vid123&t=135s)
`;
    const p = parseSummaryMarkdown(md);
    expect(p.sections[0].timeRange?.startSec).toBe(135);
    expect(p.sections[0].prose).toBe('');
  });

  it('does not throw and sets null on a malformed ▶ line', () => {
    const malformed = `# T

---

## 1. A
▶ not a link

body
`;
    const p = parseSummaryMarkdown(malformed);
    expect(p.sections[0].timeRange ?? null).toBeNull();
  });
});
