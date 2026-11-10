/** Live check of the research agent (Bedrock + Tavily). No rendering.  npx tsx --env-file=.env explainer/test/research-check.ts "topic" */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { runResearch, researchPrompt } from '../pipeline/research';
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1', maxAttempts: 8, retryMode: 'adaptive' });
const topics = process.argv.slice(2);
for (const topic of topics) {
  console.log(`\n━━ ${topic}`);
  const t0 = Date.now();
  const r = await runResearch(topic, undefined, { bedrock, model: 'us.anthropic.claude-sonnet-4-6', tavilyKey: process.env.TAVILY_API_KEY, emit: async (d) => console.log('   ·', d) });
  console.log(`   verdict=${r.verdict}${r.rejectReason ? ` (${r.rejectReason})` : ''} kind=${r.kind} facts=${r.facts.length} sources=${r.sources.length} ${JSON.stringify(r.stats)} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (r.verdict === 'ok') console.log(researchPrompt(r).split('\n').slice(0, 9).map((l) => '   ' + l.slice(0, 170)).join('\n'));
}
