#!/usr/bin/env node
// Merges one accepted bundle into games/<slug>/ deterministically.
// Consensus: median per numeric field, mode for categorical fields, frequency order for seams.
// Output bytes depend only on submission content and the --at argument.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CodeError,
  bundleHash,
  stableStringify,
  validateBundleObject,
} from './validate-submission.mjs';

const PROFILE_NUMERIC = ['aggression', 'discipline', 'cinematicFlair', 'reactionDelayMs', 'preferredRange'];

export function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(sortDeep(value), null, 2) + '\n', 'utf8');
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mode(values) {
  const counts = new Map();
  const firstSeen = new Map();
  values.forEach((value, index) => {
    const key = stableStringify(value);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!firstSeen.has(key)) firstSeen.set(key, index);
  });
  let best;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && firstSeen.get(key) < firstSeen.get(best))) {
      best = key;
      bestCount = count;
    }
  }
  return JSON.parse(best);
}

function mergeProfile(bundles) {
  const profile = {};
  for (const field of PROFILE_NUMERIC) {
    const values = bundles.map((bundle) => bundle.profile[field]).filter((value) => Number.isFinite(value));
    let value = round6(median(values));
    if (field === 'reactionDelayMs') value = Math.round(value);
    profile[field] = value;
  }
  profile.defaultPresentationMode = mode(bundles.map((bundle) => bundle.profile.defaultPresentationMode));
  const archetypes = bundles.map((bundle) => bundle.profile.archetype).filter(Boolean);
  if (archetypes.length > 0) profile.archetype = mode(archetypes);
  return profile;
}

function mergeSeams(bundles) {
  const counts = new Map();
  const firstSeen = new Map();
  let index = 0;
  for (const bundle of bundles) {
    for (const seam of bundle.seams || []) {
      counts.set(seam, (counts.get(seam) || 0) + 1);
      if (!firstSeen.has(seam)) {
        firstSeen.set(seam, index);
        index += 1;
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || firstSeen.get(a[0]) - firstSeen.get(b[0]))
    .map(([seam]) => seam)
    .slice(0, 40);
}

function mergeTuning(bundles) {
  const keys = new Set();
  for (const bundle of bundles) {
    if (bundle.tuning) Object.keys(bundle.tuning).forEach((key) => keys.add(key));
  }
  const tuning = {};
  for (const key of [...keys].sort()) {
    const values = bundles
      .filter((bundle) => bundle.tuning && bundle.tuning[key] !== undefined)
      .map((bundle) => bundle.tuning[key]);
    if (values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      tuning[key] = round6(median(values));
    } else {
      tuning[key] = mode(values);
    }
  }
  return tuning;
}

export function mergeSubmission(bundleFile, repoRoot, at = '1970-01-01T00:00:00.000Z') {
  const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
  validateBundleObject(bundle);

  const slug = bundle.game;
  const gameDir = path.join(repoRoot, 'games', slug);
  const submissionsDir = path.join(gameDir, 'submissions');
  fs.mkdirSync(submissionsDir, { recursive: true });

  const existing = fs
    .readdirSync(submissionsDir)
    .filter((name) => /^\d{3}\.json$/.test(name))
    .sort();
  const hash = bundleHash(bundle);
  for (const name of existing) {
    const previous = JSON.parse(fs.readFileSync(path.join(submissionsDir, name), 'utf8'));
    if (bundleHash(previous) === hash) {
      throw new CodeError('E_DUP', 'identical submission already merged');
    }
  }

  const fileName = String(existing.length + 1).padStart(3, '0') + '.json';
  writeJson(path.join(submissionsDir, fileName), bundle);

  const bundles = fs
    .readdirSync(submissionsDir)
    .filter((name) => /^\d{3}\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(submissionsDir, name), 'utf8')));

  const profile = mergeProfile(bundles);
  const seams = mergeSeams(bundles);
  const tuning = mergeTuning(bundles);
  const contributors = bundles.length;
  const confidence = Math.round(Math.min(1, 0.25 + 0.15 * contributors) * 100) / 100;
  const meta = {
    contributors,
    confidence,
    hashes: bundles.map(bundleHash).slice(-200),
    updatedAt: at,
  };

  writeJson(path.join(gameDir, 'profile.json'), profile);
  writeJson(path.join(gameDir, 'seams.json'), seams);
  writeJson(path.join(gameDir, 'tuning.json'), tuning);
  writeJson(path.join(gameDir, 'meta.json'), meta);

  return { slug, contributors, confidence };
}

function parseArgs(argv) {
  const args = { bundle: undefined, repo: '.', at: '1970-01-01T00:00:00.000Z' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') {
      args.repo = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--at') {
      args.at = argv[i + 1];
      i += 1;
    } else if (!args.bundle) {
      args.bundle = argv[i];
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bundle) {
    console.log('E_ARGS: usage: merge-submission.mjs <bundle.json> [--repo <root>] [--at <iso>]');
    process.exit(2);
  }
  try {
    const result = mergeSubmission(args.bundle, args.repo, args.at);
    console.log(`OK ${result.slug} contributors=${result.contributors} confidence=${result.confidence}`);
  } catch (error) {
    if (error instanceof CodeError) {
      console.log(`${error.code}: ${error.message}`);
    } else {
      console.log(`E_INTERNAL: ${error.message}`);
    }
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
