/**
 * A/B voice samples: same narration, different ElevenLabs model/settings. Also reports whether each variant
 * returns character alignment (required for word-level sync). Writes out/voice-samples/*.mp3.
 *   npx tsx --env-file=.env explainer/test/voice-samples.ts <voiceId>
 */
import fs from 'node:fs';
import path from 'node:path';

const voiceId = process.argv[2] ?? process.env.YOUNG_JAMAL_VOICE_ID ?? process.env.ELEVENLABS_VOICE_ID;
const key = process.env.ELEVENLABS_API_KEY;
if (!key || !voiceId) throw new Error('Need ELEVENLABS_API_KEY and a voice id');

const TEXT =
  "So here's the problem. Your API is getting hammered: one client is firing ten thousand requests a second. " +
  "How do you slow them down, without blocking everyone else? That's exactly what a token bucket does. Let's build one.";

const variants: Array<{ name: string; body: Record<string, unknown> }> = [
  { name: 'A-current-v2-speed0.9', body: { model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.22, use_speaker_boost: true, speed: 0.9 } } },
  { name: 'B-v2-natural-speed1.0', body: { model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.35, similarity_boost: 0.75, style: 0.45, use_speaker_boost: true, speed: 1.0 } } },
  { name: 'C-v3-natural', body: { model_id: 'eleven_v3', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 } } },
];

const outDir = path.join(process.cwd(), 'out', 'voice-samples');
fs.mkdirSync(outDir, { recursive: true });
for (const v of variants) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: TEXT, ...v.body }),
  });
  if (!res.ok) { console.log(`✖ ${v.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
  const json: any = await res.json();
  const al = json.alignment ?? json.normalized_alignment;
  const chars = al?.characters?.length ?? 0;
  const dur = al?.character_end_times_seconds?.at(-1) ?? 0;
  const words = TEXT.split(/\s+/).length;
  fs.writeFileSync(path.join(outDir, `${v.name}.mp3`), Buffer.from(json.audio_base64, 'base64'));
  console.log(`✔ ${v.name}: alignment ${chars ? `yes (${chars} chars)` : 'NO'} · ${dur.toFixed(1)}s · ${(words / (dur || 1) * 60).toFixed(0)} wpm`);
}
console.log(`→ ${outDir}`);
