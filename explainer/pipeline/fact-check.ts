/** What the fact-checker is told, and how a scene's on-screen content is described to it. */
export const FACT_CHECK_SYSTEM = [
  'You are a meticulous fact-checker for short technical explainer videos. Flag only real problems. Well-established general concepts are fine.',
  'Flag as major:',
  '1. A specific claim (number, date, name, event, quote, capability) that contradicts the brief, or that is specific and recent yet absent from the brief.',
  '2. A real number used in the wrong context. Read the full wording of the matching claim in the brief, including what it applies to and what it includes. Examples: a price for one service attached to several things, or marked "each"; a combined rate quoted for a case where only part of it applies; a limit or discount stated as typical when the brief says "up to".',
  '3. Saying and showing different things: a number on screen that differs from the number spoken in that scene.',
  '4. A number on screen that neither the narration nor the brief supports, unless it is clearly labelled as an example.',
  '5. Absolute promises the brief does not make, such as never, always, guarantees or exactly, especially when a later line contradicts them.',
  '6. Wrong attribution: saying a source said something it did not, or merging separate lists from the brief under one label or count ("three failure modes" when the brief lists a different three).',
  '7. Crediting a product with something the developer has to build or configure, or implying a product alone is the fix.',
  '8. A chart whose values are placeholders with no real meaning.',
  'For each problem, quote the exact words or on-screen text and give the corrected wording. Also write the publishing description, using only claims the brief supports.',
].join('\n');

export function shownOnScreen(sc: any): string {
  const parts: string[] = [];
  for (const el of sc.elements ?? []) {
    for (const key of ['label', 'sub', 'text', 'title', 'unit']) if (typeof el[key] === 'string') parts.push(`${key}: ${el[key]}`);
    if (Array.isArray(el.items)) parts.push(`items: ${el.items.join(' | ')}`);
    if (Array.isArray(el.messages)) parts.push(`chat: ${el.messages.map((m: any) => `${m.from}: ${m.text}`).join(' | ')}`);
    if (Array.isArray(el.bars)) parts.push(`chart: ${el.bars.map((b: any) => `${b.label} = ${b.value}${el.unit ?? ''}`).join(', ')}`);
    if (Array.isArray(el.rows)) parts.push(`table: ${el.rows.map((r: string[]) => r.join(' / ')).join(' ; ')}`);
    if (Array.isArray(el.lines)) parts.push(`code: ${el.lines.join(' ; ')}`);
  }
  for (const st of sc.steps ?? []) if (st.do === 'set') parts.push(`later becomes: ${['label', 'sub', 'text'].map((k) => st[k]).filter(Boolean).join(' ')}${st.values ? ` values ${st.values.join(', ')}` : ''}`);
  return parts.join(' ; ');
}

/** Asking for a verdict on each number makes the model check it, instead of skimming for what looks wrong. */
export const NUMBER_AUDIT = {
  type: 'array',
  description: 'Fill this first. One entry for EVERY number, price, percentage or limit spoken or shown, in order.',
  items: {
    type: 'object',
    properties: {
      scene: { type: 'string' },
      quote: { type: 'string', description: 'The exact words or on-screen text, including what the number is attached to.' },
      claim: { type: 'string', description: 'The wording of the matching brief claim, or "none".' },
      scope: { type: 'string', description: 'What the brief says the number covers, and what the script attaches it to.' },
      verdict: { type: 'string', enum: ['matches', 'wrong-context', 'unsupported'], description: 'wrong-context if the script attaches it to anything the brief does not: another service, several things, or a case where only part of the figure applies. unsupported if no claim backs it and it is not labelled as an example.' },
      fix: { type: 'string', description: 'Corrected wording, when the verdict is not matches.' },
    },
    required: ['scene', 'quote', 'claim', 'scope', 'verdict'],
  },
};

/** Models sometimes send a list as a JSON string; a crash here used to skip the whole fact-check. */
export function asList(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [p]; } catch { return []; } }
  return [];
}

export function auditProblems(audit: unknown) {
  return asList(audit).filter((n) => n.verdict === 'wrong-context' || n.verdict === 'unsupported')
    .map((n) => ({ scene: n.scene, quote: n.quote, problem: `${n.verdict}: ${n.scope} (brief: ${n.claim})`, fix: n.fix, severity: 'major' }));
}
