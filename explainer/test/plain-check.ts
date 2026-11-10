/** Replays the beginner read on a stored job, optionally rewriting the narration to preview the result. Spends Bedrock calls. Args: <specKey> <jobId> [rewrite] */
import { readFileSync } from 'node:fs';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { parseNarration } from '../engine/narration';
import { shownOnScreen } from '../pipeline/fact-check';
import { PLAIN_AUDIT, PLAIN_CHECK_SYSTEM, PLAIN_REWRITE, plainProblems } from '../pipeline/plain-check';

const MODEL = 'us.anthropic.claude-sonnet-4-6';
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const s3 = new S3Client({ region: 'us-east-1' });
const [specArg, job, mode] = process.argv.slice(2);
const spec: any = job
  ? JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: 'video-block-app-8a21f4-prod-explainer', Key: `explainer/${job}/${specArg}` }))).Body!.transformToString())
  : JSON.parse(readFileSync(specArg, 'utf8'));

async function read(scenes: { id: string; said: string; shows?: string }[]) {
  const res = await bedrock.send(new ConverseCommand({
    modelId: MODEL, system: [{ text: PLAIN_CHECK_SYSTEM }],
    messages: [{ role: 'user', content: [{ text: `SCRIPT:\n${scenes.map((s) => `Scene "${s.id}": SAYS: ${s.said}\n  SHOWS: ${s.shows ?? ''}`).join('\n')}` }] }],
    inferenceConfig: { maxTokens: 6000, temperature: 0 },
    toolConfig: { tools: [{ toolSpec: { name: 'submit_reading', description: 'Report how the script reads.', inputSchema: { json: PLAIN_AUDIT as any } } }], toolChoice: { tool: { name: 'submit_reading' } } },
  }));
  return res.output?.message?.content?.find((c) => c.toolUse)?.toolUse?.input as any;
}

const said = spec.scenes.map((s: any) => ({ id: s.id, said: s.narration ? parseNarration(s.narration, spec.pronounce ?? {}).spokenText : '', shows: shownOnScreen(s) }));
const seconds = spec.targetSeconds ?? 120;
const audit = await read(said);
const heardText = (list: any[]) => list.map((s) => `${s.said} ${s.shows ?? ''}`).join(' ');
const problems = plainProblems(audit, seconds, heardText(said));
console.log(`PLAIN ${problems.length} problem(s)`);
for (const p of problems) console.log(`PLAIN - ${p}`);
console.log(`PLAIN soWhat: ${audit.soWhat}`);

if (mode === 'rewrite' && problems.length) {
  const root = new URL('../', import.meta.url).pathname;
  const system = `${readFileSync(`${root}SKILL.md`, 'utf8')}\n\n${readFileSync(`${root}references/script-craft.md`, 'utf8')}`;
  const res = await bedrock.send(new ConverseCommand({
    modelId: MODEL, system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: `Current script:\n${JSON.stringify(said.map(({ id, said }: any) => ({ id, said })))}\n\n${PLAIN_REWRITE}\n\n${problems.map((p) => `- ${p}`).join('\n')}\n\nReturn only the spoken words of each scene, with no cues.` }] }],
    inferenceConfig: { maxTokens: 4000, temperature: 0.4 },
    toolConfig: { tools: [{ toolSpec: { name: 'submit_script', description: 'The rewritten narration.', inputSchema: { json: { type: 'object', properties: { scenes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, said: { type: 'string' } }, required: ['id', 'said'] } } }, required: ['scenes'] } as any } } }], toolChoice: { tool: { name: 'submit_script' } } },
  }));
  const out = (res.output?.message?.content?.find((c) => c.toolUse)?.toolUse?.input as any).scenes;
  for (const s of out) console.log(`PLAIN [${s.id}] ${s.said}`);
  console.log(`PLAIN words ${out.map((s: any) => s.said).join(' ').split(/\s+/).length} (was ${said.map((s: any) => s.said).join(' ').split(/\s+/).length})`);
  const second = plainProblems(await read(out), seconds, heardText(out));
  console.log(`PLAIN re-read: ${second.length} problem(s)`);
  for (const p of second) console.log(`PLAIN - ${p}`);
}
