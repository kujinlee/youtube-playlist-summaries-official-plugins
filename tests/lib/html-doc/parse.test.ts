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
});
