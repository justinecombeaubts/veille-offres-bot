import { readFile } from 'node:fs/promises';
import { fetchAllSources } from './src/sources.js';
import { dedupKey } from './src/index.js';
const sources = JSON.parse(await readFile('sources.json', 'utf8'));
const all = await fetchAllSources(sources);
const seen = new Set(); const uniq = all.filter((o) => { const k = dedupKey(o); if (seen.has(k)) return false; seen.add(k); return true; });
console.log('UNIQ', uniq.length);
for (const o of uniq) {
  try { await o.enrich?.(); } catch (e) { console.log('ERR', o.link, e.message); }
  await new Promise((r) => setTimeout(r, 700));
  console.log('OFFER ' + JSON.stringify({ t: o.title, c: o.company, l: o.location, d: o.duration, s: o.salary, date: o.date, u: o.link, desc: o.description.slice(0, 700) }));
}
