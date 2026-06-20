import { buildDeepDivePrompt } from '../../lib/gemini';

it('demands comprehensive, structured, grounded exposition and drops critique', () => {
  const p = buildDeepDivePrompt('English', 'transcript');
  expect(p).toMatch(/## /);                                  // headed sections
  expect(p).toMatch(/every (major )?topic/i);                // comprehensive
  expect(p).toMatch(/```ascii/);                             // diagram rules retained
  expect(p).not.toMatch(/include[^.\n]*critical evaluation/i); // OLD positive directive removed
  expect(p).toMatch(/do not add outside opinion/i);          // NEW negative guard present
});

it('combined mode instructs transcript grounding with video as visual support', () => {
  const p = buildDeepDivePrompt('English', 'combined');
  expect(p).toMatch(/ground.*transcript/i);
  expect(p).toMatch(/video.*(visual|on-screen)/i);
});
