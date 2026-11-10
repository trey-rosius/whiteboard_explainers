/** Research briefs survive malformed input. npx tsx explainer/test/research-parse.ts */
import { normalizeBrief } from '../pipeline/research';
let fails = 0; const ok = (c: unknown, l: string, x = '') => { console.log(`${c ? '✔' : '✖'} ${l}${x ? ` — ${x}` : ''}`); if (!c) fails++; };
const good = { claim: 'A token is a small chunk of text.', sources: [1], confidence: 'high' };
ok(normalizeBrief({ facts: [good, good] }).facts.length === 2, 'normal list passes');
ok(normalizeBrief({ facts: JSON.stringify([good, good]) }).facts.length === 2, 'list sent as a JSON string is recovered');
ok(normalizeBrief({ facts: [good, { claim: 'x'.repeat(900), sources: [2] }] }).facts.length === 2, 'over-long fact is trimmed, not fatal');
ok(normalizeBrief({ facts: [good, 'A plain text fact here'] }).facts.length === 2, 'plain-text fact is kept');
ok(normalizeBrief({ facts: [good, null, { claim: '' }] }).facts.length === 1, 'junk items are dropped, good ones kept');
ok(normalizeBrief({ facts: [{ claim: 'Has sources as text', sources: '[1, 2]' }] }).facts[0].sources.length === 2, 'sources sent as a string are recovered');
ok(normalizeBrief({}).facts.length === 0, 'missing facts is empty, so the agent gets sent back');
process.exit(fails ? 1 : 0);
