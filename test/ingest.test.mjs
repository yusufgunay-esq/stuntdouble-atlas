import test from 'node:test';
import assert from 'node:assert/strict';

import { CodeError, ingestIssueBody } from '../tools/ingest-issue.mjs';

const CONSENT = [
  '- [X] I created this bundle.',
  '- [x] It contains no personal data.',
  '- [X] I agree to CC BY 4.0.',
].join('\n');

const BODY = [
  '### Game slug',
  '',
  'ghost-recon-breakpoint',
  '',
  '### JSON bundle',
  '',
  '```json',
  '{ "atlasVersion": 1 }',
  '```',
  '',
  '### Consent (all three required)',
  '',
  CONSENT,
  '',
].join('\n');

test('fenced JSON with three consent ticks passes', () => {
  assert.equal(ingestIssueBody(BODY), '{ "atlasVersion": 1 }');
});

test('two consent ticks are rejected', () => {
  const body = BODY.replace('- [X] I agree to CC BY 4.0.', '- [ ] I agree to CC BY 4.0.');
  assert.throws(
    () => ingestIssueBody(body),
    (error) => error instanceof CodeError && error.code === 'E_CONSENT',
  );
});

test('missing JSON block is rejected', () => {
  const body = BODY.replace('```json', '```').replace('```\n\n### Consent', '\n### Consent');
  assert.throws(
    () => ingestIssueBody(body),
    (error) => error instanceof CodeError && error.code === 'E_NOJSON',
  );
});
