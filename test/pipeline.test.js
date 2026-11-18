// Tests hors ligne : les API, le LLM et Discord sont simulés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFranceTravail, normalizeLba, fetchAllSources } from '../src/sources.js';
import { parseVerdict } from '../src/llm.js';
import { buildPayload } from '../src/discord.js';
import { dedupKey } from '../src/index.js';

const FT_OFFER = {
  id: '201ABCD',
  intitule: 'Développeur web Node.js en alternance (H/F)',
  description: 'Au sein de notre équipe, tu développeras des automatisations n8n et des API Node.js. Rythme 3 jours / 2 jours.',
  dateCreation: new Date().toISOString(),
  lieuTravail: { libelle: '75 - PARIS 11' },
  entreprise: { nom: 'ACME SAS' },
  typeContratLibelle: 'Contrat à durée déterminée - 12 Mois',
  natureContrat: "Contrat d'apprentissage",
  dureeTravailLibelle: '35H/semaine',
  langues: [{ libelle: 'Anglais', exigence: 'S' }],
  competences: [{ libelle: 'Développer des API' }],
};

const LBA_JOB = {
  identifier: { id: '6740aa', partner_label: 'Hellowork' },
  workplace: { name: 'Studio Lumen', website: 'https://lumen.example', location: { address: '10 rue X 75010 Paris' } },
  apply: { url: 'https://labonnealternance.apprentissage.beta.gouv.fr/offre/6740aa' },
  contract: { type: ['Apprentissage'], duration: 12, start: '2026-12-01T00:00:00.000Z', remote: 'hybrid' },
  offer: { title: 'Alternance automatisation IA', description: 'Make, n8n, API LLM', desired_skills: ['n8n'], publication: { creation: new Date().toISOString() }, target_diploma: { label: 'Licence, BUT (niveau 6)' } },
};

test('normalise une offre France Travail', () => {
  const o = normalizeFranceTravail(FT_OFFER, { name: 'FT', hint: 'alternance' });
  assert.equal(o.id, 'ft:201ABCD');
  assert.equal(o.link, 'https://candidat.francetravail.fr/offres/recherche/detail/201ABCD');
  assert.equal(o.company, 'ACME SAS');
  assert.deepEqual(o.languages, ['Anglais (souhaité)']);
});

test('normalise une offre La bonne alternance', () => {
  const o = normalizeLba(LBA_JOB, { name: 'LBA', hint: 'alternance' });
  assert.equal(o.id, 'lba:6740aa');
  assert.equal(o.remote, 'Hybride');
  assert.equal(o.duration, '12 mois');
  assert.match(o.origin, /Hellowork/);
});

test('une même offre sur deux sites a la même clé de doublon', () => {
  const a = normalizeFranceTravail(FT_OFFER, { name: 'FT', hint: 'alternance' });
  assert.equal(dedupKey(a), dedupKey({ ...a, id: 'lba:x', title: 'Développeur Web Node.js en alternance H/F' }));
});

test('verdict : salon inconnu → note 0', () => {
  assert.equal(parseVerdict('{"note":8,"salon":"cdi"}').note, 0);
  const v = parseVerdict('```json\n{"note":9,"salon":"alternance","titre":"Dev","missions":["a"],"stack":["Node JS"]}\n```');
  assert.equal(v.note, 9);
  assert.deepEqual(v.stack, ['node-js']);
});

test('embed Discord complet', () => {
  const o = normalizeLba(LBA_JOB, { name: 'LBA', hint: 'alternance' });
  const p = buildPayload(o, parseVerdict('{"note":9,"salon":"alternance","titre":"Alternance automatisation IA","accroche":"x","missions":["m1"],"pourquoi":"n8n","a_verifier":"rythme","rythme":"","anglais":"","stack":["n8n"]}'));
  const e = p.embeds[0];
  assert.match(e.title, /^🎓 /);
  assert.equal(e.color, 0xF2A65A);
  assert.ok(e.fields.some((f) => f.name === '🏠 Mode' && f.value === 'Hybride'));
  assert.ok(e.description.includes(o.link));
  assert.ok(JSON.stringify(p).length < 6000);
});

test('récupère les deux API (fetch simulé), en envoyant les bons paramètres', async () => {
  process.env.FRANCE_TRAVAIL_CLIENT_ID = 'id';
  process.env.FRANCE_TRAVAIL_CLIENT_SECRET = 'secret';
  process.env.LBA_API_KEY = 'key';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('access_token')) return json({ access_token: 'tok', expires_in: 1499 });
    if (String(url).includes('francetravail.io')) return json({ resultats: [FT_OFFER] }, 206);
    if (String(url).includes('apprentissage')) return json({ jobs: [LBA_JOB], recruiters: [{}], warnings: [] });
    throw new Error('url inattendue');
  };
  try {
    const offers = await fetchAllSources([
      { name: 'FT', api: 'francetravail', hint: 'alternance', params: { motsCles: 'développeur', region: '11', natureContrat: 'E2,FS' } },
      { name: 'LBA', api: 'labonnealternance', hint: 'alternance', params: { romes: 'M1805', departements: ['75', '92'] } },
    ]);
    assert.equal(offers.length, 2);
    const ft = calls.find((c) => c.url.includes('offres/search'));
    assert.equal(ft.init.headers.authorization, 'Bearer tok');
    assert.match(ft.url, /natureContrat=E2%2CFS/);
    const lba = calls.find((c) => c.url.includes('job/v1/search'));
    assert.match(lba.url, /departements=75&departements=92/);
    assert.equal(lba.init.headers.authorization, 'Bearer key');
  } finally {
    globalThis.fetch = realFetch;
  }
});
