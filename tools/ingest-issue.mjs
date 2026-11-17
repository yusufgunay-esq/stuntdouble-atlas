#!/usr/bin/env node
// Extracts the JSON bundle and consent checkboxes from a GitHub issue form body.
// Prints "OK" or "E_CODE: message"; exit 0 or 2. Never executes submission content.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

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

export function extractBundleText(body) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    fail('E_NOJSON', 'issue body is empty');
  }
  const fenced = body.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return trimmed;
  fail('E_NOJSON', 'no JSON object found in issue body');
}

export function hasConsent(body) {
  const checked = (body.match(/^\s*-\s*\[[xX]\]/gm) || []).length;
  return checked >= 3;
}

export function ingestIssueBody(body) {
  if (!hasConsent(body)) {
    fail('E_CONSENT', 'all three consent checkboxes must be ticked');
  }
  return extractBundleText(body);
}

function parseArgs(argv) {
  const args = { body: undefined, output: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--body') {
      args.body = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--output') {
      args.output = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.body || !args.output) {
    console.log('E_ARGS: usage: ingest-issue.mjs --body <file> --output <file>');
    process.exit(2);
  }
  try {
    const text = fs.readFileSync(args.body, 'utf8');
    const bundleText = ingestIssueBody(text);
    fs.writeFileSync(args.output, bundleText + '\n', 'utf8');
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
