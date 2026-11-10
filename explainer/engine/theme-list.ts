/** Theme catalogue with no dependencies, shared by the engine, the API and the app. */
export const THEME_IDS = ['educloud', 'chalkboard', 'paper', 'greenboard', 'blueprint', 'graph', 'newsprint', 'kraft', 'diner', 'comic', 'terminal', 'synthwave', 'aurora', 'sunset'] as const;
export type ThemeName = (typeof THEME_IDS)[number];
export type ThemeChoice = ThemeName | 'auto';
export const isThemeName = (v: unknown): v is ThemeName => THEME_IDS.includes(v as ThemeName);

/** Name, mood and preview colours for pickers. `fit` guides Auto mode. */
export const THEME_META: Record<ThemeName, { name: string; vibe: string; fit: string; preview: string; ink: string; accent: string }> = {
  educloud: { name: 'Educloud', vibe: 'Your brand colours, hand-drawn', fit: 'the house style: anything about tech, cloud or AI', preview: 'radial-gradient(ellipse at 28% 30%,#EC489966,transparent 60%),radial-gradient(ellipse at 76% 70%,#FB923C55,transparent 60%),#0B0B10', ink: '#FFF7F0', accent: '#EC4899' },
  chalkboard: { name: 'Midnight', vibe: 'Sleek night-time board', fit: 'system design, cloud, general tech', preview: 'radial-gradient(circle at 50% 45%,#0E1320,#070A12)', ink: '#F4F1EA', accent: '#67E8F9' },
  paper: { name: 'Paper', vibe: 'Clean sketchbook', fit: 'gentle how-tos, beginner guides, anything calm', preview: '#FBF8F1', ink: '#1F2430', accent: '#2563EB' },
  greenboard: { name: 'Schoolroom', vibe: 'Dusty green chalkboard', fit: 'lessons, maths, science, history, fundamentals', preview: 'linear-gradient(135deg,#27493A,#16291F)', ink: '#F3F1E4', accent: '#FDE68A' },
  blueprint: { name: 'Blueprint', vibe: 'Engineer’s drawing', fit: 'architecture, infrastructure, how machines and buildings work', preview: 'linear-gradient(#ffffff22 1px,transparent 1px) 0 0/100% 10px,linear-gradient(90deg,#ffffff22 1px,transparent 1px) 0 0/10px 100%,#0F3A78', ink: '#EAF2FF', accent: '#7FE3F5' },
  graph: { name: 'Notebook', vibe: 'Graph paper with a red margin', fit: 'algorithms, finance, study notes, data', preview: 'linear-gradient(#93C5FD66 1px,transparent 1px) 0 0/100% 9px,linear-gradient(90deg,#93C5FD66 1px,transparent 1px) 0 0/9px 100%,#F7FAFC', ink: '#18304B', accent: '#DC2626' },
  newsprint: { name: 'Newsprint', vibe: 'Front page, serif headlines', fit: 'breaking news, incidents, business, explainers of events', preview: 'radial-gradient(#00000022 1px,transparent 1.4px) 0 0/6px 6px,#F3EEE1', ink: '#16130E', accent: '#B3261E' },
  kraft: { name: 'Kraft', vibe: 'Marker on butcher paper', fit: 'food, coffee, craft, artisan and small-business stories', preview: 'linear-gradient(135deg,#E3C6A3,#C8A680)', ink: '#2A1A0E', accent: '#7F1D1D' },
  diner: { name: 'Diner', vibe: 'Red gingham, retro script', fit: 'recipes, restaurants, menus, comfort food', preview: 'repeating-conic-gradient(#C8102E 0 25%,#FFF6E6 0 50%) 0 0/14px 14px', ink: '#2B1810', accent: '#C8102E' },
  comic: { name: 'Comic', vibe: 'Pop-art halftones, loud lines', fit: 'myths vs facts, kids, playful and high-energy shorts', preview: 'radial-gradient(#E0A80066 2px,transparent 2.4px) 0 0/8px 8px,#FFD93D', ink: '#111111', accent: '#B00020' },
  terminal: { name: 'Terminal', vibe: 'Green phosphor CRT', fit: 'security, hacking stories, command line, DevOps', preview: 'repeating-linear-gradient(#0000 0 2px,#4ADE8022 2px 3px),#06120B', ink: '#B8F5C8', accent: '#4ADE80' },
  synthwave: { name: 'Synthwave', vibe: 'Neon grid horizon', fit: 'AI, gaming, crypto, future tech, hype', preview: 'linear-gradient(#140A2E 55%,#FF5EC4 56%,#2A0F52 58%)', ink: '#F5EDFF', accent: '#22E6FF' },
  aurora: { name: 'Aurora', vibe: 'Northern lights drifting', fit: 'science, space, health, thoughtful and premium stories', preview: 'radial-gradient(ellipse at 30% 25%,#2DD4BF88,transparent 60%),radial-gradient(ellipse at 75% 60%,#8B5CF688,transparent 60%),#07171F', ink: '#EAF7F5', accent: '#5EEAD4' },
  sunset: { name: 'Golden hour', vibe: 'Warm peach and lilac glow', fit: 'lifestyle, wellness, travel, beauty, friendly brands', preview: 'linear-gradient(160deg,#FFD6B0,#FFB3BA,#E4B8E8)', ink: '#2D1238', accent: '#9F1239' },
};
