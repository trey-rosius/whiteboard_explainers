/**
 * Explainer DSL — the ONLY thing an LLM writes.
 *
 * Design rules:
 *  - The LLM describes *what* is on the board and *when* it changes (via narration cues).
 *  - It never writes pixels, frames, easing, fonts or hex colours. The harness owns all of that.
 *  - Everything is strictly validated; unknown keys are rejected so typos surface as errors.
 */
import { TITLE_STYLES } from './title';
import { CAPTION_STYLES } from './captions';
import { THEME_IDS } from './theme-list';
import { z } from 'zod';

export const COLORS = ['ink', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'gray'] as const;
export type ColorName = (typeof COLORS)[number];

const Color = z.enum(COLORS);
const Id = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'ids must be kebab-case (lowercase letters, digits, dashes), start with a letter');
/** Grid position of the element's centre: [x, y] in grid units (16:9 → x 0..12, y 0..6; 9:16 → x 0..6, y 0..10). */
const Pos = z.tuple([z.number(), z.number()]);
const Size = z.enum(['s', 'm', 'l']);

const placed = {
  id: Id,
  at: Pos,
  size: Size.optional(),
  color: Color.optional(),
  /** When shown, the element flies out of this element (clone / split / spawn effect). */
  emergeFrom: Id.optional(),
};

export const NodeEl = z.object({
  ...placed,
  type: z.literal('node'),
  icon: z.string().min(1),
  label: z.string().min(1),
  sub: z.string().optional(),
}).strict();

export const DbEl = z.object({
  ...placed,
  type: z.literal('db'),
  label: z.string().min(1),
  sub: z.string().optional(),
  icon: z.string().optional(),
}).strict();

export const ServerEl = z.object({
  ...placed,
  type: z.literal('server'),
  label: z.string().min(1),
  sub: z.string().optional(),
  stack: z.number().int().min(1).max(3).optional(),
}).strict();

export const ClientEl = z.object({
  ...placed,
  type: z.literal('client'),
  variant: z.enum(['user', 'laptop', 'phone', 'browser']).default('laptop'),
  label: z.string().min(1),
  sub: z.string().optional(),
}).strict();

export const QueueEl = z.object({
  ...placed,
  type: z.literal('queue'),
  label: z.string().min(1),
  items: z.array(z.string()).max(8).default([]),
  slots: z.number().int().min(3).max(8).default(5),
}).strict();

export const TableEl = z.object({
  ...placed,
  type: z.literal('table'),
  title: z.string().min(1),
  columns: z.array(z.string()).min(1).max(5),
  rows: z.array(z.array(z.string())).max(7),
}).strict();

export const CodeEl = z.object({
  ...placed,
  type: z.literal('code'),
  title: z.string().optional(),
  lines: z.array(z.string()).min(1).max(12),
}).strict();

export const ListEl = z.object({
  ...placed,
  type: z.literal('list'),
  title: z.string().optional(),
  items: z.array(z.string()).min(1).max(6),
  ordered: z.boolean().optional(),
  /** If true, items appear one by one with `reveal` steps instead of all at once on `show`. */
  stepwise: z.boolean().optional(),
}).strict();

/** A chat conversation, the way it looks in a messaging app. Use it for real or realistic exchanges with a chatbot or agent. */
export const ChatEl = z.object({
  ...placed,
  type: z.literal('chat'),
  /** Who the bot is, shown in the header ("Car Dealer Assistant"). */
  title: z.string().optional(),
  messages: z.array(z.object({ from: z.enum(['user', 'bot']), text: z.string() }).strict()).min(1).max(6),
  /** If true, messages appear one by one with `reveal` steps instead of all at once on `show`. */
  stepwise: z.boolean().optional(),
}).strict();

export const TextEl = z.object({
  ...placed,
  type: z.literal('text'),
  text: z.string().min(1),
  /** `stamp`: one huge tilted word that lands with a thud, once, at the turning point. It may sit over the diagram. */
  style: z.enum(['headline', 'statement', 'label', 'stamp']).default('statement'),
}).strict();

/** A small solid pill: the thing the story follows. `move` it from stage to stage, `set` its text as it changes. */
export const ChipEl = z.object({
  ...placed,
  type: z.literal('chip'),
  text: z.string().min(1),
}).strict();

export const NoteEl = z.object({
  ...placed,
  type: z.literal('note'),
  text: z.string().min(1),
}).strict();

export const BarsEl = z.object({
  ...placed,
  type: z.literal('bars'),
  title: z.string().optional(),
  unit: z.string().optional(),
  bars: z.array(z.object({ label: z.string(), value: z.number().min(0) }).strict()).min(1).max(6),
  max: z.number().positive().optional(),
}).strict();

/** A circle (hash ring, token ring, round-robin…). Put `marker`s on it; centre shows label/sub. */
export const RingEl = z.object({
  ...placed,
  type: z.literal('ring'),
  label: z.string().optional(),
  sub: z.string().optional(),
}).strict();

/** A point on a ring at `angle` degrees (0 = top, clockwise). kind: server (box), key (dot), vnode (dashed box). */
export const MarkerEl = z.object({
  id: Id,
  type: z.literal('marker'),
  ring: Id,
  angle: z.number().min(0).max(360),
  kind: z.enum(['server', 'key', 'vnode']).default('server'),
  label: z.string().optional(),
  color: Color.optional(),
  emergeFrom: Id.optional(),
}).strict();

export const GroupEl = z.object({
  id: Id,
  type: z.literal('group'),
  label: z.string().min(1),
  contains: z.array(Id).min(1),
  color: Color.optional(),
}).strict();

export const ArrowEl = z.object({
  id: Id,
  type: z.literal('arrow'),
  from: Id,
  to: Id,
  label: z.string().optional(),
  style: z.enum(['solid', 'dashed']).default('solid'),
  both: z.boolean().optional(),
  /** Curvature: -1..1 (0 = straight). Use to route around elements or separate parallel arrows. */
  bend: z.number().min(-1).max(1).optional(),
  color: Color.optional(),
}).strict();

export const Element = z.discriminatedUnion('type', [
  NodeEl, DbEl, ServerEl, ClientEl, QueueEl, TableEl, CodeEl, ListEl, ChatEl, TextEl, ChipEl, NoteEl, BarsEl, RingEl, MarkerEl, GroupEl, ArrowEl,
]);
export type Element = z.infer<typeof Element>;
export type PlacedElement = Exclude<Element, { type: 'group' } | { type: 'arrow' }>;

/**
 * When a step fires:
 *  - "cueName"        → the moment the narrator says the word right after {cueName}
 *  - "cueName+0.6"    → 0.6 s after that cue (negative allowed)
 *  - "start" | "end"  → scene start / just before scene end
 *  - number           → seconds from the start of narration
 */
const At = z.union([z.string().min(1), z.number().min(0)]);

const step = { at: At };
const Targets = z.array(Id).min(1);

export const Step = z.discriminatedUnion('do', [
  z.object({ ...step, do: z.literal('show'), targets: Targets, stagger: z.number().min(0).max(1.5).optional() }).strict(),
  z.object({ ...step, do: z.literal('hide'), targets: Targets }).strict(),
  z.object({
    ...step,
    do: z.literal('flow'),
    /** Arrow ids in travel order (multi-hop allowed). */
    path: z.array(Id).min(1).max(6),
    label: z.string().optional(),
    color: Color.optional(),
    count: z.number().int().min(1).max(5).default(1),
    reverse: z.boolean().optional(),
    speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
  }).strict(),
  z.object({
    ...step,
    do: z.literal('highlight'),
    target: Id,
    color: Color.optional(),
    /** Table: 0-based data row. Code: 0-based line. List: 0-based item. Bars: 0-based bar. */
    row: z.number().int().min(0).optional(),
    /** Seconds; omit to keep highlighted until `unhighlight` or scene end. */
    for: z.number().positive().optional(),
  }).strict(),
  z.object({ ...step, do: z.literal('unhighlight'), target: Id }).strict(),
  z.object({ ...step, do: z.literal('pulse'), target: Id }).strict(),
  z.object({ ...step, do: z.literal('shake'), target: Id, for: z.number().positive().max(6).optional() }).strict(),
  z.object({ ...step, do: z.literal('mark'), target: Id, kind: z.enum(['check', 'cross', 'warn']) }).strict(),
  z.object({ ...step, do: z.literal('unmark'), target: Id }).strict(),
  /** Crosses the element out with a red pen stroke: this rule, formula or idea just stopped working. */
  z.object({ ...step, do: z.literal('strike'), target: Id }).strict(),
  z.object({ ...step, do: z.literal('unstrike'), target: Id }).strict(),
  z.object({ ...step, do: z.literal('dim'), targets: Targets }).strict(),
  z.object({ ...step, do: z.literal('undim'), targets: Targets }).strict(),
  z.object({ ...step, do: z.literal('focus'), targets: Targets, zoom: z.number().min(1.1).max(2.2).optional() }).strict(),
  z.object({ ...step, do: z.literal('unfocus') }).strict(),
  z.object({ ...step, do: z.literal('move'), target: Id, to: Pos }).strict(),
  z.object({
    ...step,
    do: z.literal('set'),
    target: Id,
    label: z.string().optional(),
    sub: z.string().optional(),
    text: z.string().optional(),
    items: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())).optional(),
    values: z.array(z.number().min(0)).optional(),
  }).strict(),
  z.object({ ...step, do: z.literal('reveal'), target: Id, count: z.number().int().min(1).max(6).default(1) }).strict(),
  z.object({
    ...step,
    do: z.literal('travel'),
    /** A marker (usually a key) whose packet walks CLOCKWISE along its ring to `to`. */
    target: Id,
    to: Id,
    label: z.string().optional(),
    color: Color.optional(),
    speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
  }).strict(),
  z.object({
    ...step,
    do: z.literal('span'),
    /** Ring id; lights up the clockwise arc from marker `from` to marker `to`. */
    target: Id,
    from: Id,
    to: Id,
    color: Color.optional(),
    for: z.number().positive().optional(),
  }).strict(),
  z.object({ ...step, do: z.literal('unspan'), target: Id }).strict(),
]);
export type Step = z.infer<typeof Step>;

export const TitleScene = z.object({
  id: Id,
  kind: z.literal('title'),
  kicker: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  /** Title-screen design; picked automatically when left out. */
  titleStyle: z.enum(TITLE_STYLES).optional(),
  /** Topic icon, drawn large by the `hero` design. */
  icon: z.string().optional(),
  narration: z.string().optional(),
}).strict();

export const BoardScene = z.object({
  id: Id,
  kind: z.literal('board'),
  heading: z.string().optional(),
  narration: z.string().min(1),
  /** Keep everything still visible at the end of the previous board scene (same positions, no transition). */
  continue: z.boolean().optional(),
  elements: z.array(Element).default([]),
  steps: z.array(Step).min(1),
}).strict();

export const Scene = z.discriminatedUnion('kind', [TitleScene, BoardScene]);
export type Scene = z.infer<typeof Scene>;
export type BoardScene = z.infer<typeof BoardScene>;
export type TitleScene = z.infer<typeof TitleScene>;

export const VideoSpec = z.object({
  id: Id,
  title: z.string().min(1),
  format: z.enum(['16:9', '9:16']).default('16:9'),
  theme: z.enum(THEME_IDS).default('chalkboard'),
  /** Leave out: the harness varies the caption design between videos. */
  captions: z.enum(CAPTION_STYLES).optional(),
  brand: z.string().max(24).optional(),
  /** Set by the pipeline, not the writer: corner logo and closing card. */
  brandKit: z.object({ logo: z.string(), mark: z.string(), url: z.string(), line: z.string().optional() }).strict().optional(),
  voice: z
    .object({
      provider: z.enum(['elevenlabs', 'none']).default('elevenlabs'),
      voiceId: z.string().optional(),
      model: z.string().optional(),
      stability: z.number().min(0).max(1).optional(),
      /** How closely to match the source voice. Set high for clones so they keep the speaker's accent. */
      similarity: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
      speed: z.number().min(0.7).max(1.2).optional(),
    })
    .strict()
    .default({ provider: 'elevenlabs' }),
  /** Spoken replacements, e.g. { "PostgreSQL": "post-gress Q L", "K8s": "Kubernetes" }. Captions still show the key. */
  pronounce: z.record(z.string()).default({}),
  music: z.object({ src: z.string(), volume: z.number().min(0).max(1).default(0.12) }).strict().optional(),
  /** Set by the pipeline, not the writer: the narrator records their face, shown in a circle in the bottom-right corner, so the board keeps that corner clear. */
  presenter: z.boolean().optional(),
  /** Requested length; the validator rejects videos more than 20% off (warns beyond 10%). */
  targetSeconds: z.number().positive().optional(),
  scenes: z.array(Scene).min(1),
}).strict();
export type VideoSpec = z.infer<typeof VideoSpec>;
export type VideoSpecInput = z.input<typeof VideoSpec>;
