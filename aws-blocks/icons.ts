/**
 * Icon Packs Helper Module
 * Provides unified access to:
 * 1. Official AWS Architecture Icons (aws-icons)
 * 2. 3000+ Brand & Technology Icons (simple-icons - Redis, Kafka, Postgres, etc.)
 * 3. General UI & System Icons (lucide-static)
 */
import * as simpleIcons from 'simple-icons';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache for AWS SVGs read from disk
const awsIconCache = new Map<string, string>();

/**
 * Get an official AWS Architecture Service SVG
 * @param serviceName e.g. "AmazonDynamoDB", "AmazonSQS", "AmazonSNS", "AWSLambda", "AmazonBedrock", "AmazonS3", "AmazonApiGateway", "ElasticLoadBalancing"
 */
export function getAwsServiceIconSvg(serviceName: string): string | null {
  if (awsIconCache.has(serviceName)) {
    return awsIconCache.get(serviceName)!;
  }

  // Normalize name
  const cleanName = serviceName.replace(/[^a-zA-Z0-9]/g, '');
  const possiblePaths = [
    path.join(__dirname, '..', 'node_modules', 'aws-icons', 'icons', 'architecture-service', `${cleanName}.svg`),
    path.join(__dirname, '..', 'node_modules', 'aws-icons', 'icons', 'architecture-service', `Amazon${cleanName}.svg`),
    path.join(__dirname, '..', 'node_modules', 'aws-icons', 'icons', 'architecture-service', `AWS${cleanName}.svg`),
    path.join(__dirname, '..', 'node_modules', 'aws-icons', 'icons', 'resource', `${cleanName}.svg`),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const svg = fs.readFileSync(p, 'utf-8');
      awsIconCache.set(serviceName, svg);
      return svg;
    }
  }

  return null;
}

/**
 * Get a Technology / Database / Brand Icon from simple-icons
 * @param slug e.g. "redis", "apachekafka", "postgresql", "mongodb", "docker", "kubernetes", "graphql"
 */
export function getTechIconSvg(slug: string): { title: string; svg: string; hex: string; path: string } | null {
  const normalizedKey = 'si' + slug.charAt(0).toUpperCase() + slug.slice(1).replace(/[^a-zA-Z0-9]/g, '');
  const icon = (simpleIcons as any)[normalizedKey] || (simpleIcons as any)['si' + slug.toUpperCase()] || (simpleIcons as any)[slug];

  if (icon) {
    return {
      title: icon.title,
      svg: icon.svg,
      hex: `#${icon.hex}`,
      path: icon.path,
    };
  }

  // Fallback search through all icons
  for (const key of Object.keys(simpleIcons)) {
    const item = (simpleIcons as any)[key];
    if (item && item.slug && (item.slug === slug.toLowerCase() || item.title?.toLowerCase() === slug.toLowerCase())) {
      return {
        title: item.title,
        svg: item.svg,
        hex: `#${item.hex}`,
        path: item.path,
      };
    }
  }

  return null;
}

/**
 * List available common AWS architecture service icons
 */
export const COMMON_AWS_ICONS = [
  'AmazonDynamoDB',
  'AmazonSQS',
  'AmazonSNS',
  'AmazonEventBridge',
  'AWSLambda',
  'AmazonBedrock',
  'AmazonApiGateway',
  'AmazonS3',
  'AmazonCloudFront',
  'ElasticLoadBalancing',
  'AmazonEC2',
  'AmazonECS',
  'AmazonEKS',
  'AmazonRDS',
  'AmazonElastiCache',
  'AmazonKinesis',
  'AmazonCognito',
  'AWSStepFunctions',
  'AmazonCloudWatch',
  'AmazonOpenSearchService',
];

/**
 * List available common Tech Brand icons
 */
export const COMMON_TECH_ICONS = [
  'redis',
  'apachekafka',
  'postgresql',
  'mysql',
  'mongodb',
  'docker',
  'kubernetes',
  'nginx',
  'graphql',
  'rabbitmq',
  'elasticsearch',
  'apachecassandra',
  'react',
  'typescript',
  'python',
  'go',
  'rust',
];

