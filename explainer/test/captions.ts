/** Caption styles: chosen per video, key words found, and lines split for one-glance styles. */
import assert from 'node:assert/strict';
import { parseNarration } from '../engine/narration';
import { autoCaptionStyle, keyWords, wordGroups } from '../engine/captions';
import { autoCaptionChoices, captionFit } from '../engine/caption-list';
import { THEME_IDS } from '../engine/theme-list';

const keys = (s: string) => { const t = parseNarration(s).tokens; const k = keyWords(t); return t.filter((_, i) => k[i]).map((x) => x.display); };
assert.deepEqual(keys('Tickets go into an SQS queue. Then SQS triggers a Lambda function.'), ['SQS'], 'a name stands out once per scene');
assert.deepEqual(keys('AI models cost about twenty-two thousand dollars a month at AT&T.'), ['twenty-two', 'thousand', 'dollars', 'AT&T.'], 'money and names, not "AI"');
assert.deepEqual(keys('Costs fell 98% on DynamoDB.'), ['98%', 'DynamoDB.']);
assert.deepEqual(keys('She read the ticket and chose a label.'), []);

assert.deepEqual(wordGroups([{ text: 'One' }, { text: 'two,' }, { text: 'three' }, { text: 'four' }, { text: 'five' }, { text: 'six.' }]).map((g) => g.length), [2, 3, 1]);

for (const f of ['16:9', '9:16'] as const) {
  assert.equal(autoCaptionStyle('ex-abc', 'kraft', f), autoCaptionStyle('ex-abc', 'kraft', f), 'stable for one video');
  for (const t of THEME_IDS) {
    const choices = autoCaptionChoices(t, f);
    assert.ok(choices.length >= 2, `${t} ${f}: Auto has at least two styles to vary between`);
    const seen = new Set(Array.from({ length: 60 }, (_, i) => autoCaptionStyle(`ex-${i}`, t, f)));
    assert.deepEqual([...seen].sort(), [...choices].sort(), `${t} ${f}: Auto only picks styles rated best, and uses them all`);
  }
}
// Plain text never goes over a pattern, and a yellow highlighter never over a yellow page.
assert.equal(captionFit('highlight', 'diner', '9:16').fit, 'avoid');
assert.equal(captionFit('marker', 'comic', '9:16').fit, 'avoid');
assert.equal(captionFit('pop', 'diner', '9:16').fit, 'best');
assert.equal(captionFit('lowerthird', 'educloud', '16:9').fit, 'best');
console.log('captions: ok');

// Spaces between words sit in each style's container: it must carry the caption's font size, or words run together.
import { readFileSync } from 'node:fs';
const src = readFileSync('explainer/remotion/captions.tsx', 'utf8');
for (const name of ['Karaoke', 'Pop', 'Highlight', 'Marker']) {
  const body = src.slice(src.indexOf(`const ${name}:`), src.indexOf('\n};\n', src.indexOf(`const ${name}:`)));
  const outer = body.slice(body.indexOf('<div style={{'), body.indexOf('}}>', body.indexOf('<div style={{')));
  assert.match(outer, /fontSize/, `${name}: the line itself sets the font size`);
}
console.log('caption spacing: ok');
