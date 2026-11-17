import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowFile = path.join(here, '..', '.github', 'workflows', 'intake.yml');
const raw = fs.readFileSync(workflowFile, 'utf8');

test('workflow parses as YAML and triggers on issues', () => {
  const doc = yaml.load(raw);
  assert.ok(doc);
  const triggers = doc.on ?? doc[true];
  assert.ok(triggers.issues, 'issues trigger missing');
  assert.deepEqual(triggers.issues.types, ['opened', 'reopened', 'labeled']);
});

test('workflow never uses pull_request_target', () => {
  assert.equal(raw.includes('pull_request_target'), false);
});

test('workflow writes contents and issues with the default token', () => {
  const doc = yaml.load(raw);
  assert.equal(doc.permissions.contents, 'write');
  assert.equal(doc.permissions.issues, 'write');
  assert.equal(doc.jobs.intake['runs-on'], 'ubuntu-latest');
});

test('third-party actions are pinned to a major version', () => {
  const doc = yaml.load(raw);
  const uses = doc.jobs.intake.steps.filter((step) => step.uses).map((step) => step.uses);
  assert.ok(uses.length > 0);
  uses.forEach((ref) => assert.match(ref, /@v\d+$/));
});
