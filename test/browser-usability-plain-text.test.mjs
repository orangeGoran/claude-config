// Tests for the title and summary checks of the browser-usability-test report page.
//   node --test test/browser-usability-plain-text.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryWarnings, titleWarnings } from '../skills/browser-usability-test/scripts/plain-text.mjs';

const plain =
  'We tested what happens when two people verify the same 8D step at the same time. ' +
  'The screen now shows the step as done and does not send a second request. ' +
  'We found no problems.';

test('a short plain summary gives no warning', () => {
  assert.deepEqual(summaryWarnings(plain), []);
});

test('a missing summary gives one warning', () => {
  assert.equal(summaryWarnings('').length, 1);
  assert.equal(summaryWarnings(undefined).length, 1);
});

test('more than four sentences gives a warning', () => {
  const w = summaryWarnings('One. Two. Three. Four. Five.');
  assert.ok(w.some((x) => x.includes('5 sentences')), w.join('\n'));
});

test('a sentence longer than 25 words gives a warning', () => {
  const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ') + '.';
  assert.ok(summaryWarnings(long).some((x) => x.includes('longer than 25 words')));
});

test('HTTP codes, methods, file names and routes give warnings', () => {
  const w = summaryWarnings('The API answers 409. Old code sends 2 POSTs. See StepBar.tsx. Open /cases/:id/8d.');
  for (const what of ['HTTP status code', 'HTTP method', 'file name', 'route or path'])
    assert.ok(w.some((x) => x.includes(what)), `${what} missing in:\n${w.join('\n')}`);
});

test('the report summary that started this check gives warnings', () => {
  const dense =
    'Every check of the plan passes on the new code. The local API answers 409 on a second verify of each step (D0 to D8). ' +
    'Old code: the 409 text shows and the step stays editable. New code: the same text shows and the step bar turns into the verified line. ' +
    'Two clicks in one task on Verify D5: old 2 POSTs (200, then 409 with an error under a verified step), new 1. No defects found.';
  assert.ok(summaryWarnings(dense).length >= 3);
});

test('a long or technical title gives a warning, a short one does not', () => {
  assert.deepEqual(titleWarnings('Two people can verify the same 8D step safely'), []);
  assert.deepEqual(titleWarnings(undefined), []);
  const w = titleWarnings('Second 8D verify answers 409: the step refreshes; D2 confirms the SolveR occurrence (#834)');
  assert.ok(w.some((x) => x.includes('words')) && w.some((x) => x.includes('status code')), w.join('\n'));
});
