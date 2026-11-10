/** Smoke-checks the deployed explainer API (voices, list pagination, realtime channel) via the Blocks client. */
import '../node/service-access';
import { ApiNamespaceClient } from '@aws-blocks/blocks/client';
import '@aws-blocks/bb-realtime/aws-middleware';
const ex: any = ApiNamespaceClient('explainer', { url: process.argv[2] });
console.log('voices:', JSON.stringify((await ex.voices()).map((v: any) => v.name)));
const page = await ex.list({ page: 1, pageSize: 9 });
console.log('list:', { total: page.total, pages: page.pages, first: page.items[0]?.status?.title ?? page.items[0]?.topic, poster: !!page.items[0]?.status?.posterUrl });
const ch = await ex.watch(page.items[0]?.jobId ?? 'probe');
const sub = ch.subscribe(() => {});
await Promise.race([sub.established.then(() => console.log('realtime: subscribed ✔')), new Promise((r) => setTimeout(() => { console.log('realtime: no confirmation in 8s'); r(0); }, 8000))]);
sub.unsubscribe();
process.exit(0);
