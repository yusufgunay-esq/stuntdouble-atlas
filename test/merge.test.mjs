import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { mergeSubmission } from '../tools/merge-submission.mjs';
import { CodeError } from '../tools/validate-submission.mjs';

function bundle(overrides = {}) {
  return {
    atlasVersion: 1,
    game: 'merge-sample',
    source: 'observed',
    profile: {
      aggression: 0.5,
      discipline: 0.5,
      cinematicFlair: 0.5,
      reactionDelayMs: 200,
      preferredRange: 10,
      defaultPresentationMode: 'TACTICAL',
    },
    seams: [],
    tuning: {},
    ...overrides,
  };
}

const BUNDLES = [
  bundle({
    profile: { ...bundle().profile, aggression: 0.4, reactionDelayMs: 120, preferredRange: 6 },
    seams: ['alpha', 'beta'],
    tuning: { radius: 10, hold: 'x' },
  }),
  bundle({
    profile: { ...bundle().profile, aggression: 0.5, reactionDelayMs: 180, preferredRange: 9 },
    seams: ['beta', 'gamma'],
    tuning: { radius: 20 },
  }),
  bundle({
    profile: {
      ...bundle().profile,
      aggression: 0.6,
      reactionDelayMs: 240,
      preferredRange: 12,
      defaultPresentationMode: 'CINEMATIC_LIVE',
    },
    seams: ['beta'],
    tuning: { radius: 30 },
  }),
];

function prepareRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-merge-'));
  const files = BUNDLES.map((value, index) => {
    const file = path.join(root, `bundle-${index}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  });
  return { root, files };
}

function snapshot(root) {
  const gamesDir = path.join(root, 'games');
  const out = {};
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out[path.relative(root, full).replaceAll('\\', '/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(gamesDir);
  return out;
}

test('median consensus, mode and seam ordering', () => {
  const { root, files } = prepareRoot();
  files.forEach((file) => mergeSubmission(file, root, '2026-11-17T00:00:00.000Z'));
  const gamesDir = path.join(root, 'games', 'merge-sample');
  const profile = JSON.parse(fs.readFileSync(path.join(gamesDir, 'profile.json'), 'utf8'));
  const seams = JSON.parse(fs.readFileSync(path.join(gamesDir, 'seams.json'), 'utf8'));
  const tuning = JSON.parse(fs.readFileSync(path.join(gamesDir, 'tuning.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(gamesDir, 'meta.json'), 'utf8'));

  assert.equal(profile.aggression, 0.5);
  assert.equal(profile.reactionDelayMs, 180);
  assert.equal(profile.preferredRange, 9);
  assert.equal(profile.defaultPresentationMode, 'TACTICAL');
  assert.deepEqual(seams, ['beta', 'alpha', 'gamma']);
  assert.equal(tuning.radius, 20);
  assert.equal(tuning.hold, 'x');
  assert.equal(meta.contributors, 3);
  assert.equal(meta.confidence, 0.7);
  assert.equal(meta.updatedAt, '2026-11-17T00:00:00.000Z');
  assert.equal(meta.hashes.length, 3);
});

test('same input produces byte-identical output on two runs', () => {
  const first = prepareRoot();
  const second = prepareRoot();
  first.files.forEach((file) => mergeSubmission(file, first.root, '2026-11-17T00:00:00.000Z'));
  second.files.forEach((file) => mergeSubmission(file, second.root, '2026-11-17T00:00:00.000Z'));
  assert.deepEqual(snapshot(first.root), snapshot(second.root));
});

test('identical bundle is rejected on merge', () => {
  const { root, files } = prepareRoot();
  mergeSubmission(files[0], root, '2026-11-17T00:00:00.000Z');
  assert.throws(
    () => mergeSubmission(files[0], root, '2026-11-17T00:00:00.000Z'),
    (error) => error instanceof CodeError && error.code === 'E_DUP',
  );
});
