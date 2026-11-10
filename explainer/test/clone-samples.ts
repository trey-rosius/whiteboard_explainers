/**
 * Compare settings for a cloned voice: same narration, different model/settings. Writes out/voice-samples/clone-*.mp3
 * and reports whether word alignment comes back (required for sync).
 *   npx tsx --env-file=.env explainer/test/clone-samples.ts <voiceId>
 */
import fs from 'node:fs';
import path from 'node:path';

const voiceId = process.argv[2];
const key = process.env.ELEVENLABS_API_KEY;
if (!key || !voiceId) throw new Error('Need ELEVENLABS_API_KEY and a voice id');
const TEXT = "So here's the problem. Your API is getting hammered: one client is firing ten thousand requests a second. How do you slow them down, without blocking everyone else? That's exactly what a token bucket does. Let's build one.";
const s = (stability: number, similarity_boost: number, style = 0) => ({ stability, similarity_boost, style, use_speaker_boost: true, speed: 1 });
const variants = [
  { name: 'clone-1-v2-faithful', model_id: 'eleven_multilingual_v2', voice_settings: s(0.5, 0.95) },
  { name: 'clone-2-v2-steady', model_id: 'eleven_multilingual_v2', voice_settings: s(0.75, 1) },
  { name: 'clone-3-v3-robust', model_id: 'eleven_v3', voice_settings: s(1, 0.95) },
  { name: 'clone-4-v3-natural', model_id: 'eleven_v3', voice_settings: s(0.5, 0.95) },
  { name: 'clone-5-turbo', model_id: 'eleven_turbo_v2_5', voice_settings: s(0.5, 0.95) },
];
const out = path.join(process.cwd(), 'out', 'voice-samples');
fs.mkdirSync(out, { recursive: true });
for (const v of variants) {
  const { name, ...body } = v;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: TEXT, ...body }),
  });
  if (!res.ok) { console.log(`✖ ${name}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`); continue; }
  const j: any = await res.json();
  const al = j.alignment ?? j.normalized_alignment;
  const dur = al?.character_end_times_seconds?.at(-1) ?? 0;
  fs.writeFileSync(path.join(out, `${name}.mp3`), Buffer.from(j.audio_base64, 'base64'));
  console.log(`✔ ${name}: alignment ${al?.characters?.length ? 'yes' : 'NO'} · ${dur.toFixed(1)}s · ${Math.round(TEXT.split(/\s+/).length / (dur || 1) * 60)} wpm`);
}
