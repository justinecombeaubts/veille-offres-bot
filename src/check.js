// Vérifie les sources sans LLM ni Discord : nombre d'offres par source et un exemple complet.
// Usage : npm run check
import { readFile } from 'node:fs/promises';
import { fetchAllSources } from './sources.js';

const sources = JSON.parse(await readFile(new URL('../sources.json', import.meta.url), 'utf8'));
const offers = await fetchAllSources(sources);
const sample = offers.find((o) => o.enrich) ?? offers[0];
if (sample?.enrich) await sample.enrich();
if (sample) {
  const { enrich, ...data } = sample;
  console.log('\nExemple :', JSON.stringify({ ...data, description: `${data.description.slice(0, 300)}…` }, null, 2));
}
console.log(`\n${offers.length} offre(s) au total.`);
