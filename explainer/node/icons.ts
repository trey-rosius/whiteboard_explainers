/**
 * Icon resolution (Node only). Icons are inlined into the plan as data URIs,
 * so renders are self-contained (local, Studio, Lambda) with no network fetches.
 *
 *   lucide:<name>   ~1,600 line icons, drawn in the element colour (best match for the sketch look)
 *   aws:<service>   official AWS architecture icons (full colour), e.g. aws:lambda, aws:s3, aws:dynamodb
 *   si:<slug>       3,000+ tech brand logos, monochrome in the element colour, e.g. si:redis, si:postgresql
 *   brand:<slug>    same as si: but in the official brand colour
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const dirOf = (pkg: string) => path.dirname(req.resolve(`${pkg}/package.json`));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const AWS_ALIASES: Record<string, string> = {
  s3: 'AmazonSimpleStorageService', sqs: 'AmazonSimpleQueueService', sns: 'AmazonSimpleNotificationService',
  ses: 'AmazonSimpleEmailService', alb: 'ElasticLoadBalancing', elb: 'ElasticLoadBalancing', nlb: 'ElasticLoadBalancing',
  loadbalancer: 'ElasticLoadBalancing', apigw: 'AmazonAPIGateway', stepfunctions: 'AWSStepFunctions', sfn: 'AWSStepFunctions',
  redis: 'AmazonElastiCache', glacier: 'AmazonSimpleStorageServiceGlacier', ddb: 'AmazonDynamoDB',
};

interface Index {
  lucide: Map<string, string>; // name → file
  aws: Map<string, string>; // normalized key → file
  awsNames: string[];
  si: Map<string, { title: string; slug: string; path: string; hex: string }>;
}

let INDEX: Index | null = null;

function index(): Index {
  if (INDEX) return INDEX;
  const lucideDir = path.join(dirOf('lucide-static'), 'icons');
  const lucide = new Map<string, string>();
  for (const f of fs.readdirSync(lucideDir)) if (f.endsWith('.svg')) lucide.set(f.slice(0, -4), path.join(lucideDir, f));

  const awsRoot = path.join(dirOf('aws-icons'), 'icons');
  const aws = new Map<string, string>();
  const awsNames: string[] = [];
  for (const sub of ['architecture-service', 'resource', 'architecture-group', 'category']) {
    const d = path.join(awsRoot, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.svg')) continue;
      const name = f.slice(0, -4);
      const file = path.join(d, f);
      const keys = [norm(name), norm(name.replace(/^(Amazon|AWS)/, ''))];
      for (const k of keys) if (!aws.has(k)) aws.set(k, file);
      if (sub === 'architecture-service') awsNames.push(name);
    }
  }
  for (const [alias, name] of Object.entries(AWS_ALIASES)) {
    const f = aws.get(norm(name));
    if (f) aws.set(alias, f);
  }

  const si = new Map<string, { title: string; slug: string; path: string; hex: string }>();
  const siMod = req('simple-icons');
  for (const v of Object.values(siMod) as any[]) {
    if (v && typeof v === 'object' && v.slug && v.path) {
      si.set(v.slug, v);
      if (!si.has(norm(v.title))) si.set(norm(v.title), v);
    }
  }
  INDEX = { lucide, aws, awsNames, si };
  return INDEX;
}

const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const resolved = new Map<string, string | null>();

export function resolveIcon(id: string, hex: string): string | null {
  const key = `${id}|${hex}`;
  if (!resolved.has(key)) resolved.set(key, resolveIconUncached(id, hex));
  return resolved.get(key)!;
}

function resolveIconUncached(id: string, hex: string): string | null {
  const ix = index();
  const [prefix, ...rest] = id.includes(':') ? id.split(':') : ['', id];
  const name = rest.join(':') || prefix;

  const lucide = (n: string) => {
    const f = ix.lucide.get(n);
    if (!f) return null;
    let svg = fs.readFileSync(f, 'utf8').replace(/<!--.*?-->/gs, '');
    svg = svg.replace(/currentColor/g, hex).replace(/stroke-width="2"/, 'stroke-width="1.7"');
    return uri(svg);
  };
  const aws = (n: string) => {
    const f = ix.aws.get(norm(n));
    return f ? uri(fs.readFileSync(f, 'utf8')) : null;
  };
  const si = (n: string, brand: boolean) => {
    const v = ix.si.get(n.toLowerCase()) ?? ix.si.get(norm(n));
    if (!v) return null;
    return uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${brand ? `#${v.hex}` : hex}" d="${v.path}"/></svg>`);
  };

  switch (prefix) {
    case 'lucide': return lucide(name);
    case 'aws': return aws(name);
    case 'si': return si(name, false);
    case 'brand': return si(name, true);
    default: return lucide(id) ?? aws(id) ?? si(id, false);
  }
}

export function searchIcons(query: string, limit = 30): string[] {
  const ix = index();
  const q = norm(query);
  const scored: Array<[number, string]> = [];
  const score = (key: string) => (key === q ? 0 : key.startsWith(q) ? 1 : key.includes(q) ? 2 : 99);
  for (const n of ix.lucide.keys()) { const s = score(norm(n)); if (s < 99) scored.push([s, `lucide:${n}`]); }
  for (const n of ix.awsNames) { const s = Math.min(score(norm(n)), score(norm(n.replace(/^(Amazon|AWS)/, '')))); if (s < 99) scored.push([s + 0.1, `aws:${norm(n.replace(/^(Amazon|AWS)/, ''))}`]); }
  for (const alias of Object.keys(AWS_ALIASES)) { const s = score(alias); if (s < 99) scored.push([s + 0.1, `aws:${alias}`]); }
  const seenSi = new Set<string>();
  for (const v of ix.si.values()) {
    if (seenSi.has(v.slug)) continue;
    seenSi.add(v.slug);
    const s = Math.min(score(v.slug), score(norm(v.title)));
    if (s < 99) scored.push([s + 0.2, `si:${v.slug}`]);
  }
  return [...new Set(scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length).map((x) => x[1]))].slice(0, limit);
}
