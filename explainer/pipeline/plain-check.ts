/** A second reader who knows nothing about the topic. The writer can't judge this for itself: it already understands what it wrote. */
export const PLAIN_CHECK_SYSTEM = [
  'You are reading a script for a short video as a curious person who has never studied this topic. You use a phone and have heard of apps, websites and the internet. You know nothing else about the subject.',
  'Read the script once, in order, the way a listener hears it: you cannot pause or look anything up, and you only know what earlier lines told you.',
  'Be honest about where you would get lost. Sounding clever is not the same as being clear: a sentence can be true and still leave you with nothing to picture.',
  'If the notes from the creator name a different audience, judge the script as that audience.',
  'The words of the topic itself, and everyday words such as AI, app, chatbot, website, password and online shop, are not terms: a script about AI guardrails must be able to say AI.',
  'A term is any word or phrase a newcomer would not use at home, including ordinary words used in a special sense (a "loop", a "lens", "the iceberg model"), and product or organisation names.',
  'SHOWS lists what is drawn while a scene plays. You see it as you listen, so a drawn diagram counts as something to picture, and a term drawn and pointed at while it is explained counts as explained.',
  'Other forms of a term you already understand (hash, hashing) are not new terms. Do not ask for more than a newcomer needs: if you could retell the scene correctly and picture it, it is clear, even if you could not define every word.',
  'Scene names are labels for your report. Nobody hears them, so judge only the spoken words and the drawing.',
  'Scenes that only say the title are "clear" with carriedBy "none". A term heard in the title counts as explained if a later scene makes it clear.',
].join('\n');

const asReader = (what: string) => `${what} Answer as the newcomer, in everyday words.`;

export const PLAIN_AUDIT = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      description: 'Fill this first. One entry for EVERY term, the first time it is heard, in order.',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'string' },
          term: { type: 'string' },
          explainedAs: { type: 'string', description: 'The words the script uses at that moment to tell you what it means, or "none". A longer sentence made of other unfamiliar words counts as "none".' },
          verdict: { type: 'string', enum: ['everyday', 'explained', 'unexplained'] },
        },
        required: ['scene', 'term', 'explainedAs', 'verdict'],
      },
    },
    scenes: {
      type: 'array',
      description: 'One entry for every scene, in order.',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'string' },
          retelling: { type: 'string', description: asReader('What did this scene just tell you, in one sentence? Write "lost" if you could not say.') },
          picture: { type: 'string', description: asReader('What specific thing or situation are you picturing? Write "nothing" if only ideas come to mind.') },
          carriedBy: { type: 'string', enum: ['running-example', 'new-example', 'none'], description: 'Does the scene explain itself through the example the video started with, through a different example, or through none?' },
          verdict: { type: 'string', enum: ['clear', 'abstract', 'lost'], description: 'abstract: you can repeat the words, but neither the words nor the drawing give you anything to picture. lost: you could not retell it. Otherwise clear.' },
          quote: { type: 'string', description: 'When not clear, the exact words where you stopped following.' },
        },
        required: ['scene', 'retelling', 'picture', 'carriedBy', 'verdict'],
      },
    },
    soWhat: { type: 'string', description: asReader('Why would this matter to you personally? Write "none" if the script never makes you care.') },
  },
  required: ['terms', 'scenes', 'soWhat'],
};

/** One or two complaints about an otherwise clear script aren't worth a rewrite, which can damage what already works. */
export const PLAIN_REWRITE_FROM = 3;

/** Turns the reader's answers into problems. The limits live here so that they don't depend on the model's mood. */
export function plainProblems(audit: any, targetSeconds: number, script?: string): string[] {
  const problems: string[] = [];
  // Scene names aren't spoken, yet the reader sometimes reports them as terms it heard.
  const heard = (t: any) => !script || script.toLowerCase().includes(String(t.term).toLowerCase());
  const terms: any[] = (audit?.terms ?? []).filter(heard);
  const scenes: any[] = audit?.scenes ?? [];
  for (const t of terms) if (t.verdict === 'unexplained') problems.push(`Scene "${t.scene}": "${t.term}" is never explained in plain words. Explain it through the example, or leave it out.`);
  const named = terms.filter((t) => t.verdict !== 'everyday');
  const allowed = Math.max(3, Math.round(targetSeconds / 30));
  if (named.length > allowed) problems.push(`The video asks the viewer to learn ${named.length} new terms (${named.map((t) => t.term).join(', ')}). ${targetSeconds} seconds can carry ${allowed}. Keep the ones the video exists to teach and say the rest in everyday words.`);
  for (const s of scenes) {
    if (s.verdict === 'clear') continue;
    problems.push(`Scene "${s.scene}" is ${s.verdict === 'lost' ? 'lost on the viewer' : 'too abstract to picture'}${s.quote ? `, at "${s.quote}"` : ''}. They took away: "${s.retelling}".`);
  }
  const body = scenes.filter((s) => s !== scenes[0]);
  const unsupported = body.filter((s) => s.carriedBy === 'none');
  if (body.length && unsupported.length > body.length / 3) problems.push(`Scenes ${unsupported.map((s) => `"${s.scene}"`).join(', ')} have no example at all. Carry one everyday example through the video.`);
  if (/^\s*none\b/i.test(String(audit?.soWhat ?? ''))) problems.push('The viewer has no reason to care. Show in the first scenes what this changes in their own life or work.');
  return problems;
}

export const PLAIN_REWRITE = [
  'PLAIN-LANGUAGE REVIEW. A newcomer read this script and got lost at the places below. Rewrite the narration so they can follow it on first hearing, and change the boards to match.',
  '- Pick one everyday situation the viewer has lived through, and explain the whole idea through it from the first scene to the last. Earlier scenes that used a different example should move to this one if that makes it clearer.',
  '- Show it first, then name it: tell the small story, and only then say "that is called a feedback loop". Drop any name the viewer does not need.',
  '- Keep the words of the topic itself (if the topic is AI guardrails, say AI and guardrails).',
  '- Short common words. Say what happens, who does it, and what they see. Remove abstract nouns such as "interconnected", "dynamics", "holistic", "framework", "lens".',
  '- Keep the point the topic promises. If the topic says something is happening now, the video must still say why now, in plain words.',
  '- Teach one idea. Cut whatever does not serve it, even if it is true and sourced: statistics, frameworks, named reports, lists of industries. A cut scene is better than a confusing one. Never leave a question hanging or jump to a new subject.',
  '- Do not add facts, numbers or names that are not already in the script, and keep what stays true when you simplify. An everyday comparison is allowed; don\'t state invented details as fact.',
  '- Write natural spoken sentences, not fragments. Keep about the same total length by going deeper on the example, not by adding topics.',
].join('\n');
