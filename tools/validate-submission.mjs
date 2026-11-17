#!/usr/bin/env node
// Deterministic submission validator. No runtime dependencies, no network, no execution
// of submission content. Prints "OK" or "E_CODE: message"; exit 0 or 2.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const LIMITS = {
  maxBytes: 256 * 1024,
  maxDepth: 8,
  maxArray: 50,
  maxString: 500,
  maxSeam: 160,
  maxBase64: 120,
};

const TOP_KEYS = new Set([
  'atlasVersion', 'game', 'source', 'observedSeconds', 'profile', 'seams', 'tuning', 'notes',
]);
const PROFILE_KEYS = new Set([
  'aggression', 'discipline', 'cinematicFlair', 'reactionDelayMs',
  'preferredRange', 'defaultPresentationMode', 'archetype',
]);
const FORBIDDEN_KEYS = new Set(['name', 'email', 'steamid', 'discord']);

const URL_RE = /https?:\/\//i;
const WWW_RE = /www\./i;
const SECRET_RES = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const PATH_RES = [/[A-Za-z]:[\\/]/, /\/home\//, /\/usr\//, /~[\\/]/, /\.\./];
const B64_RE = /^[A-Za-z0-9+/=_-]{120,}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ARCHETYPE_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

export class CodeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CodeError';
  }
}

function fail(code, message) {
  throw new CodeError(code, message);
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function bundleHash(bundle) {
  return crypto.createHash('sha256').update(stableStringify(bundle), 'utf8').digest('hex');
}

function checkString(value, where, maxLen = LIMITS.maxString) {
  if (value.length > maxLen) fail('E_STR', `${where}: string longer than ${maxLen}`);
  if (CONTROL_RE.test(value)) fail('E_CTRL', `${where}: control character`);
  if (URL_RE.test(value) || WWW_RE.test(value)) fail('E_URL', `${where}: URL is not allowed`);
  for (const re of SECRET_RES) {
    if (re.test(value)) fail('E_KEY', `${where}: secret-like token`);
  }
  for (const re of PATH_RES) {
    if (re.test(value)) fail('E_PATH', `${where}: filesystem path`);
  }
  if (value.includes('@')) fail('E_PII', `${where}: personal identifier`);
  if (B64_RE.test(value)) fail('E_B64', `${where}: base64-like blob`);
}

function walk(node, depth, where) {
  if (depth > LIMITS.maxDepth) {
    fail('E_DEPTH', `${where}: nesting deeper than ${LIMITS.maxDepth}`);
  }
  if (typeof node === 'string') {
    checkString(node, where);
    return;
  }
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) fail('E_NUM', `${where}: not a finite number`);
    return;
  }
  if (node === null || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    if (node.length > LIMITS.maxArray) {
      fail('E_ARRAY', `${where}: array longer than ${LIMITS.maxArray}`);
    }
    node.forEach((item, index) => walk(item, depth + 1, `${where}[${index}]`));
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        fail('E_PII', `${where}.${key}: personal-data key`);
      }
      walk(value, depth + 1, `${where}.${key}`);
    }
    return;
  }
  fail('E_TYPE', `${where}: unsupported value type`);
}

function requireFiniteNumber(value, where) {
  if (typeof value !== 'number') fail('E_TYPE', `${where}: must be a number`);
  if (!Number.isFinite(value)) fail('E_NUM', `${where}: not a finite number`);
}

export function validateBundleObject(bundle) {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    fail('E_TYPE', 'bundle must be a JSON object');
  }
  for (const key of Object.keys(bundle)) {
    if (!TOP_KEYS.has(key)) fail('E_KEYS', `unknown key: ${key}`);
  }
  if (bundle.atlasVersion !== 1) fail('E_TYPE', 'atlasVersion must be 1');
  if (
    typeof bundle.game !== 'string' ||
    bundle.game.length < 3 ||
    bundle.game.length > 40 ||
    !SLUG_RE.test(bundle.game)
  ) {
    fail('E_SLUG', 'game must be 3-40 lowercase words joined by hyphens');
  }
  if (!['observed', 'tuned', 'derived'].includes(bundle.source)) {
    fail('E_TYPE', 'source must be observed, tuned or derived');
  }
  if (bundle.observedSeconds !== undefined) {
    if (!Number.isInteger(bundle.observedSeconds) || bundle.observedSeconds < 0 || bundle.observedSeconds > 360000) {
      fail('E_RANGE', 'observedSeconds out of range');
    }
  }

  const profile = bundle.profile;
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    fail('E_TYPE', 'profile must be an object');
  }
  for (const key of Object.keys(profile)) {
    if (!PROFILE_KEYS.has(key)) fail('E_KEYS', `unknown profile key: ${key}`);
  }
  const unit = ['aggression', 'discipline', 'cinematicFlair'];
  for (const field of unit) {
    requireFiniteNumber(profile[field], `profile.${field}`);
    if (profile[field] < 0 || profile[field] > 1) fail('E_RANGE', `profile.${field} out of range`);
  }
  requireFiniteNumber(profile.reactionDelayMs, 'profile.reactionDelayMs');
  if (!Number.isInteger(profile.reactionDelayMs) || profile.reactionDelayMs < 20 || profile.reactionDelayMs > 500) {
    fail('E_RANGE', 'profile.reactionDelayMs out of range');
  }
  requireFiniteNumber(profile.preferredRange, 'profile.preferredRange');
  if (profile.preferredRange < 0.5 || profile.preferredRange > 100) {
    fail('E_RANGE', 'profile.preferredRange out of range');
  }
  if (!['TACTICAL', 'CINEMATIC_LIVE', 'CINEMATIC_RESOLVE'].includes(profile.defaultPresentationMode)) {
    fail('E_TYPE', 'profile.defaultPresentationMode invalid');
  }
  if (profile.archetype !== undefined) {
    if (
      typeof profile.archetype !== 'string' ||
      profile.archetype.length < 1 ||
      profile.archetype.length > 48 ||
      !ARCHETYPE_RE.test(profile.archetype)
    ) {
      fail('E_TYPE', 'profile.archetype invalid');
    }
  }

  if (bundle.seams !== undefined) {
    if (!Array.isArray(bundle.seams)) fail('E_TYPE', 'seams must be an array');
    if (bundle.seams.length > 40) fail('E_ARRAY', 'seams longer than 40');
    bundle.seams.forEach((seam, index) => {
      if (typeof seam !== 'string' || seam.length < 1) fail('E_TYPE', `seams[${index}] must be a string`);
      checkString(seam, `seams[${index}]`, LIMITS.maxSeam);
    });
  }
  if (bundle.tuning !== undefined) {
    if (bundle.tuning === null || typeof bundle.tuning !== 'object' || Array.isArray(bundle.tuning)) {
      fail('E_TYPE', 'tuning must be an object');
    }
  }
  if (bundle.notes !== undefined && typeof bundle.notes !== 'string') {
    fail('E_TYPE', 'notes must be a string');
  }

  walk(bundle, 0, 'bundle');
}

export function checkDuplicate(bundle, gamesDir) {
  const metaFile = path.join(gamesDir, bundle.game, 'meta.json');
  if (!fs.existsSync(metaFile)) return;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch {
    return;
  }
  if (Array.isArray(meta.hashes) && meta.hashes.includes(bundleHash(bundle))) {
    fail('E_DUP', 'identical submission already merged');
  }
}

export function validateSubmissionFile(file, options = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    fail('E_READ', 'cannot read submission file');
  }
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxBytes) {
    fail('E_SIZE', 'submission larger than 256 KB');
  }
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch {
    fail('E_PARSE', 'submission is not valid JSON');
  }
  validateBundleObject(bundle);
  if (options.gamesDir) checkDuplicate(bundle, options.gamesDir);
  return bundle;
}

function parseArgs(argv) {
  const args = { file: undefined, gamesDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--games') {
      args.gamesDir = argv[i + 1];
      i += 1;
    } else if (!args.file) {
      args.file = argv[i];
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.log('E_ARGS: usage: validate-submission.mjs <bundle.json> [--games <dir>]');
    process.exit(2);
  }
  try {
    validateSubmissionFile(args.file, { gamesDir: args.gamesDir });
    console.log('OK');
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
