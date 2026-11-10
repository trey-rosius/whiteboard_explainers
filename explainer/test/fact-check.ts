/** Replays the fact-check on the AWS short that passed with prices in the wrong context. Spends one Bedrock call. */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { parseNarration } from '../engine/narration';
import { FACT_CHECK_SYSTEM, NUMBER_AUDIT, auditProblems, shownOnScreen } from '../pipeline/fact-check';
const s3 = new S3Client({ region: 'us-east-1' });
const get = async (k: string) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: 'video-block-app-8a21f4-prod-explainer', Key: `explainer/${process.argv[3] ?? 'ex-rad9abdd47f5b20'}/${k}` }))).Body!.transformToString());
const spec = await get(process.argv[2]);
const research = await get('research.json');
const lines = spec.scenes.map((sc: any) => `Scene "${sc.id}": SAYS: ${sc.narration ? parseNarration(sc.narration, spec.pronounce ?? {}).spokenText : ''}\n  SHOWS: ${[sc.title, sc.heading, shownOnScreen(sc)].filter(Boolean).join(' ')}`);
const brief = (research.facts ?? []).map((f: any) => `- ${f.claim} (${f.confidence})`).join('\n');
const res = await new BedrockRuntimeClient({ region: 'us-east-1' }).send(new ConverseCommand({
  modelId: 'us.anthropic.claude-sonnet-4-6', system: [{ text: FACT_CHECK_SYSTEM }],
  messages: [{ role: 'user', content: [{ text: `RESEARCH BRIEF:\n${brief}\n\nSCRIPT:\n${lines.join('\n')}` }] }],
  inferenceConfig: { maxTokens: 6000, temperature: 0 },
  toolConfig: { tools: [{ toolSpec: { name: 'report', description: 'Report problems.', inputSchema: { json: { type: 'object', properties: { numbers: NUMBER_AUDIT as any, problems: { type: 'array', items: { type: 'object', properties: { scene: { type: 'string' }, quote: { type: 'string' }, problem: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor'] } }, required: ['scene', 'quote', 'problem', 'severity'] } } }, required: ['numbers', 'problems'] } } } }], toolChoice: { tool: { name: 'report' } } },
}));
const out: any = res.output?.message?.content?.find((c) => c.toolUse)?.toolUse?.input ?? {};
for (const p of [...auditProblems(out.numbers), ...(out.problems ?? [])]) console.log(`[${p.severity}] ${p.scene}: "${p.quote}" — ${String(p.problem).slice(0, 220)}`);
