import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CodeError,
  bundleHash,
  validateBundleObject,
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
  'bad-path.json': 'E_PATH',
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

const BASE_BUNDLE = JSON.parse(
  fs.readFileSync(path.join(fixtures, 'good-ghost-recon.json'), 'utf8'),
);

function expectCode(mutate, code) {
  const bundle = structuredClone(BASE_BUNDLE);
  mutate(bundle);
  assert.throws(
    () => validateBundleObject(bundle),
    (error) => error instanceof CodeError && error.code === code,
  );
}

test('control character -> E_CTRL', () => {
  expectCode((bundle) => { bundle.notes = 'bad\u0007char'; }, 'E_CTRL');
});

test('string longer than 500 -> E_STR', () => {
  expectCode((bundle) => { bundle.notes = 'x'.repeat(501); }, 'E_STR');
});

test('array longer than 50 -> E_ARRAY', () => {
  expectCode((bundle) => {
    bundle.seams = Array.from({ length: 41 }, (_, index) => `seam-${index}`);
  }, 'E_ARRAY');
});

test('base64-like blob -> E_B64', () => {
  expectCode((bundle) => { bundle.notes = 'A'.repeat(130); }, 'E_B64');
});

test('out-of-range value -> E_RANGE', () => {
  expectCode((bundle) => { bundle.profile.aggression = 1.5; }, 'E_RANGE');
});

test('unknown top-level key -> E_KEYS', () => {
  expectCode((bundle) => { bundle.extra = 1; }, 'E_KEYS');
});

test('missing required profile field -> E_TYPE', () => {
  expectCode((bundle) => { delete bundle.profile.preferredRange; }, 'E_TYPE');
});

test('invalid JSON -> E_PARSE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-parse-'));
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(
    () => validateSubmissionFile(file),
    (error) => error instanceof CodeError && error.code === 'E_PARSE',
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
