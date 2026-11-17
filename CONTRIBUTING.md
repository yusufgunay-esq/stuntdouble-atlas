# Contributing to the atlas

This repository accepts **data only**. One submission = one issue.

## Send a bundle

1. Open a new issue with the **Game data submission** form.
2. Paste one JSON object following [`schema/bundle.schema.json`](schema/bundle.schema.json).
3. Tick all three consent boxes and submit.

The intake action extracts the JSON, checks it and decides on its own:

- **Pass:** stored under `games/<slug>/submissions/`, consensus regenerated, issue closed as accepted.
- **Fail:** issue closed with a rejection code such as `E_URL`, `E_SIZE`, `E_RANGE`, `E_DUP`.

No human reviews your bundle. Do not ask for exceptions in the issue body; free text outside the
JSON block is ignored.

## Hard rules

- JSON only, at most 256 KB, nesting depth at most 8, strings at most 500 characters.
- No URLs, no filesystem paths, no e-mail addresses or handles, no keys or tokens, no base64 blobs.
- No game files, memory dumps, decompiled code, extracted assets or binaries.
- Values must come from your own play or tuning. Do not submit leaked or scraped data.

## What the consensus means

`profile.json` is the median of every numeric field across all submissions for that slug;
`seams.json` keeps seams ordered by how often they were reported; `meta.json` reports how many
submissions support the result and a confidence score from 0.4 (one submission) towards 1.0.

## License

By submitting you agree the data is published under CC BY 4.0 (see `LICENSE`) and may be merged
automatically. Submissions are attributed to the repository, not to individual contributors.
