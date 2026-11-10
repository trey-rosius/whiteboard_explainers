/**
 * Text-to-speech with word-accurate timings. Pure I/O (no filesystem) so the same code runs
 * in the CLI and inside a Lambda durable function.
 *
 * Providers:
 *  - elevenlabs: /with-timestamps → per-character alignment → exact word timings (recommended)
 */
import crypto from 'node:crypto';
import { alignFromChars, alignProportional, type ParsedNarration, type WordTime } from '../engine/narration';

export interface VoiceConfig {
  provider: 'elevenlabs' | 'none';
  voiceId?: string;
  model?: string;
  stability?: number;
  similarity?: number;
  style?: number;
  speed?: number;
}

export interface TtsResult {
  audio: Buffer;
  ext: 'mp3' | 'wav';
  durationSec: number;
  words: WordTime[];
  /** ElevenLabs request id — pass to the next scene for seamless stitching. */
  requestId?: string;
}

export interface TtsContext {
  previousText?: string;
  nextText?: string;
  /** Up to 3 request ids of the immediately preceding generations (ElevenLabs request stitching). */
  previousRequestIds?: string[];
}

export const DEFAULT_TTS_MODEL = 'eleven_v3';
const isV3 = (voice: VoiceConfig) => (voice.model ?? DEFAULT_TTS_MODEL) === 'eleven_v3';

/**
 * Narration-tuned settings per model. Natural speed (1.0): slowing ElevenLabs below 1.0 flattens prosody and is
 * the main cause of a "robotic" read. v3 is the most expressive model and only accepts stability 0 / 0.5 / 1.
 */
export function voiceSettings(voice: VoiceConfig) {
  if (isV3(voice)) {
    const st = voice.stability ?? 0.5;
    return { stability: st < 0.25 ? 0 : st > 0.75 ? 1 : 0.5, similarity_boost: voice.similarity ?? 0.75, style: 0, use_speaker_boost: true, speed: voice.speed ?? 1 };
  }
  return { stability: voice.stability ?? 0.35, similarity_boost: voice.similarity ?? 0.75, style: voice.style ?? 0.45, use_speaker_boost: true, speed: voice.speed ?? 1 };
}

export function ttsHash(spokenText: string, voice: VoiceConfig, context = ''): string {
  return crypto.createHash('sha256').update(JSON.stringify([spokenText, voice.provider, voice.voiceId, voice.model, voiceSettings(voice), context])).digest('hex').slice(0, 16);
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      if (e?.fatal) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${(last as Error)?.message ?? last}`);
}

export async function synthesize(
  parsed: ParsedNarration,
  voice: VoiceConfig,
  ctx: TtsContext = {},
): Promise<TtsResult> {
  if (voice.provider === 'elevenlabs') return elevenLabs(parsed, voice, ctx);
  throw new Error('voice.provider "none" produces no audio');
}

async function elevenLabs(parsed: ParsedNarration, voice: VoiceConfig, ctx: TtsContext): Promise<TtsResult> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw Object.assign(new Error('ELEVENLABS_API_KEY is not set'), { fatal: true });
  const voiceId = voice.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw Object.assign(new Error('No voiceId (set voice.voiceId in the spec or ELEVENLABS_VOICE_ID)'), { fatal: true });

  // Continuity across scenes: request stitching (same voice "take") when we have the previous request id,
  // otherwise neighbouring text so prosody still flows. next_text always helps the ending intonation.
  // v3 takes no stitching/context fields; v2 gets request stitching (or neighbouring text) for continuity.
  const v3 = isV3(voice);
  const baseBody = {
    text: parsed.spokenText,
    model_id: voice.model ?? DEFAULT_TTS_MODEL,
    voice_settings: voiceSettings(voice),
    ...(!v3 ? { apply_text_normalization: 'auto' } : {}),
    ...(!v3 && ctx.nextText ? { next_text: ctx.nextText } : {}),
  };
  const call = async (stitch: boolean) => {
    const body = {
      ...baseBody,
      ...(v3 ? {} : stitch && ctx.previousRequestIds?.length ? { previous_request_ids: ctx.previousRequestIds.slice(-3) } : ctx.previousText ? { previous_text: ctx.previousText } : {}),
    };
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err: any = new Error(`ElevenLabs ${res.status}: ${txt.slice(0, 300)}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) err.fatal = true;
      err.status = res.status;
      throw err;
    }
    return { json: (await res.json()) as any, requestId: res.headers.get('request-id') ?? undefined };
  };
  let out: { json: any; requestId?: string };
  try {
    out = await withRetry(() => call(true), 'ElevenLabs TTS');
  } catch (e: any) {
    // Stale/foreign request ids → retry without stitching.
    if (!ctx.previousRequestIds?.length || !(e?.status >= 400 && e?.status < 500)) throw e;
    out = await withRetry(() => call(false), 'ElevenLabs TTS (unstitched)');
  }
  const json = out.json;

  const al = json.alignment ?? json.normalized_alignment;
  if (!json.audio_base64 || !al) throw new Error('ElevenLabs response missing audio or alignment');
  const starts: number[] = al.character_start_times_seconds;
  const ends: number[] = al.character_end_times_seconds;
  let words: WordTime[];
  if ((al.characters as string[]).join('') === parsed.spokenText) {
    words = alignFromChars(parsed.tokens, starts, ends);
  } else {
    // Provider normalised the text; fall back to proportional mapping on its own characters.
    const chars: string[] = al.characters;
    const pw: Array<{ word: string; start: number; end: number }> = [];
    let cur = '', s0 = 0, e0 = 0;
    chars.forEach((c, i) => {
      if (/\s/.test(c)) { if (cur) pw.push({ word: cur, start: s0, end: e0 }); cur = ''; return; }
      if (!cur) s0 = starts[i];
      cur += c; e0 = ends[i];
    });
    if (cur) pw.push({ word: cur, start: s0, end: e0 });
    words = alignProportional(parsed.tokens, pw);
  }
  const durationSec = (ends[ends.length - 1] ?? 0) + 0.15;
  return { audio: Buffer.from(json.audio_base64, 'base64'), ext: 'mp3', durationSec, words, requestId: out.requestId };
}

