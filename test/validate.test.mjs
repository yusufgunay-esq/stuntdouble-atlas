import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CodeError,
  bundleHash,
  validateSubmissionFile,
} from '../tools/validate-submission.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

const CASES = {
  'good-ghost-recon.json': 'OK',
  'good-odyssey.json': 'OK',
  'bad-url.json': 'E_URL',
  'bad-key.json': 'E_KEY',
  'bad-slug.json': 'E_SLUG',
  'bad-infinity.json': 'E_NUM',
  'bad-depth.json': 'E_DEPTH',
  'bad-pii.json': 'E_PII',
};

for (const [file, expected] of Object.entries(CASES)) {
  test(`${file} -> ${expected}`, () => {
    const full = path.join(fixtures, file);
    if (expected === 'OK') {
      assert.doesNotThrow(() => validateSubmissionFile(full));
      return;
    }
    assert.throws(
      () => validateSubmissionFile(full),
      (error) => error instanceof CodeError && error.code === expected,
    );
  });
}

test('oversized submission is rejected before parsing (9th fixture)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-size-'));
  const file = path.join(dir, 'huge.json');
  fs.writeFileSync(file, 'x'.repeat(260 * 1024));
  assert.throws(
    () => validateSubmissionFile(file),
    (error) => error instanceof CodeError && error.code === 'E_SIZE',
  );
});

test('identical submission is rejected as duplicate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dup-'));
  const bundleFile = path.join(fixtures, 'good-ghost-recon.json');
  const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
  const gameDir = path.join(root, bundle.game);
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'meta.json'), JSON.stringify({ hashes: [bundleHash(bundle)] }));
  assert.throws(
    () => validateSubmissionFile(bundleFile, { gamesDir: root }),
    (error) => error instanceof CodeError && error.code === 'E_DUP',
  );
});
