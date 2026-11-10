/** Runs deterministic auto-layout on a spec and reports what changed + remaining layout errors. */
import fs from 'node:fs';
import { autofixLayout } from '../engine/autofix';
import { validate, formatIssues } from '../engine/validate';
import { resolveIcon } from '../node/icons';
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const t = Date.now();
const r = autofixLayout(spec, { resolveIcon });
console.log(`autofix: ${r.changes.length} change(s), ${r.remaining} layout error(s) left, ${Date.now() - t}ms`);
r.changes.forEach((c) => console.log('  ·', c));
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(r.spec, null, 2));
console.log(formatIssues(validate(r.spec, { resolveIcon })).split('\n').filter((l) => /^(✖|⚠|✔)/.test(l)).join('\n'));
