// Récupère les offres des API publiques et les normalise dans un même format.
// Une source en erreur (ou sans clé) est ignorée : les autres continuent.

const UA = 'veille-offres-bot/1.0 (+https://github.com/justinecombeaubts)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMED = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
/** Décode les entités HTML (&#xE9; &#233; &amp;…). */
export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** Nettoie un texte (HTML éventuel, entités, espaces) et le coupe. */
export function cleanText(html = '', max = 2500) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const toDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// ───────────────────────── France Travail (Offres d'emploi v2) ─────────────────────────
// Compte gratuit sur francetravail.io → application avec l'API « Offres d'emploi v2 ».

const FT_TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const FT_SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
let ftToken;

async function franceTravailToken() {
  if (ftToken && ftToken.expires > Date.now()) return ftToken.value;
  const { FRANCE_TRAVAIL_CLIENT_ID: id, FRANCE_TRAVAIL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('secrets FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET absents');
  const res = await fetch(FT_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'api_offresdemploiv2 o2dsoffre' }),
  });
  if (!res.ok) throw new Error(`jeton France Travail refusé (${res.status}) : ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  ftToken = { value: data.access_token, expires: Date.now() + ((data.expires_in ?? 1400) - 60) * 1000 };
  return ftToken.value;
}

export function normalizeFranceTravail(o, source) {
  const langues = (o.langues ?? []).map((l) => `${l.libelle}${l.exigence === 'E' ? ' (exigé)' : l.exigence === 'S' ? ' (souhaité)' : ''}`);
  const competences = (o.competences ?? []).map((c) => c.libelle).filter(Boolean);
  return {
    id: `ft:${o.id}`,
    source: source.name,
    origin: 'France Travail',
    siteUrl: 'https://www.francetravail.fr',
    hint: source.hint,
    title: cleanText(o.intitule, 200),
    company: cleanText(o.entreprise?.nom, 120) || null,
    logo: /^https:\/\//.test(o.entreprise?.logo ?? '') ? o.entreprise.logo : null,
    location: cleanText(o.lieuTravail?.libelle, 120) || null,
    contract: [o.typeContratLibelle, o.natureContrat].filter(Boolean).join(' · ') || null,
    duration: cleanText(o.dureeTravailLibelle, 120) || null,
    start: null,
    remote: null,
    salary: cleanText(o.salaire?.libelle || o.salaire?.commentaire, 120) || null,
    diploma: (o.formations ?? []).map((f) => f.niveauLibelle || f.domaineLibelle).filter(Boolean).join(', ') || null,
    languages: langues,
    skills: competences.slice(0, 10),
    description: cleanText(o.description),
    date: toDate(o.dateCreation),
    link: `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
  };
}

async function fetchFranceTravail(source) {
  const token = await franceTravailToken();
  const params = new URLSearchParams({ sort: '1', range: '0-49', publieeDepuis: String(source.publieeDepuis ?? 7), ...source.params });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${FT_SEARCH_URL}?${params}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA } });
    if (res.status === 204) return []; // aucune offre
    if (res.status === 429 && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`France Travail ${res.status} : ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data.resultats ?? []).map((o) => normalizeFranceTravail(o, source));
  }
}

// ───────────────────────── La bonne alternance (api.apprentissage.beta.gouv.fr) ─────────────────────────
// Compte gratuit sur api.apprentissage.beta.gouv.fr → Mon compte → générer une clé d'API.

const LBA_SEARCH_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search';
const REMOTE = { onsite: 'Sur site', remote: 'Télétravail', hybrid: 'Hybride' };

export function normalizeLba(j, source) {
  const id = j.identifier?.id ?? j.identifier?.partner_job_id;
  const contractTypes = Array.isArray(j.contract?.type) ? j.contract.type : [j.contract?.type].filter(Boolean);
  const start = toDate(j.contract?.start);
  return {
    id: `lba:${id}`,
    source: source.name,
    origin: j.identifier?.partner_label ? `La bonne alternance · ${j.identifier.partner_label}` : 'La bonne alternance',
    siteUrl: j.workplace?.website || 'https://labonnealternance.apprentissage.beta.gouv.fr',
    hint: source.hint,
    title: cleanText(j.offer?.title, 200),
    company: cleanText(j.workplace?.name || j.workplace?.brand || j.workplace?.legal_name, 120) || null,
    logo: null,
    location: cleanText(j.workplace?.location?.address, 120) || null,
    contract: contractTypes.length ? `Alternance · ${contractTypes.join(' / ')}` : 'Alternance',
    duration: j.contract?.duration ? `${j.contract.duration} mois` : null,
    start: start ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(start) : null,
    remote: REMOTE[j.contract?.remote] ?? null,
    salary: null,
    diploma: j.offer?.target_diploma?.label ?? null,
    languages: [],
    skills: [...(j.offer?.desired_skills ?? []), ...(j.offer?.to_be_acquired_skills ?? [])].map((s) => cleanText(s, 120)).slice(0, 10),
    description: cleanText([j.offer?.description, j.offer?.access_conditions?.join?.(' · ')].filter(Boolean).join(' — ')),
    date: toDate(j.offer?.publication?.creation),
    link: j.apply?.url || `https://labonnealternance.apprentissage.beta.gouv.fr/`,
  };
}

async function fetchLba(source) {
  const key = process.env.LBA_API_KEY;
  if (!key) throw new Error('secret LBA_API_KEY absent');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(source.params ?? {})) {
    for (const item of Array.isArray(v) ? v : [v]) params.append(k, String(item)); // departements=75&departements=92
  }
  const res = await fetch(`${LBA_SEARCH_URL}?${params}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`La bonne alternance ${res.status} : ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  for (const w of data.warnings ?? []) console.warn(`   ⚠️ ${source.name} : ${w.message}`);
  // Seules les vraies offres nous intéressent (pas les « recruteurs » sans offre publiée)
  return (data.jobs ?? []).map((j) => normalizeLba(j, source)).filter((o) => o.id !== 'lba:undefined');
}


// ───────────────────────── HelloWork (pages publiques, sans clé) ─────────────────────────
// Pas de flux RSS : on lit la page de résultats, puis la fiche de chaque NOUVELLE offre
// (données structurées JobPosting, celles que lit Google). Si HelloWork change sa mise en page,
// seule cette source s'arrête.

const HW_BASE = 'https://www.hellowork.com';
const HW_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': HW_UA, accept: 'text/html', 'accept-language': 'fr-FR,fr;q=0.9' } });
  if (!res.ok) throw new Error(`HelloWork ${res.status}`);
  return res.text();
}

/** « il y a 2 jours », « il y a 5 heures », « aujourd'hui » → date approximative. */
export function relativeDate(text, now = Date.now()) {
  const t = String(text).toLowerCase();
  const n = Number(t.match(/(\d+)/)?.[1] ?? 0);
  if (/minute|heure|aujourd/.test(t)) return new Date(now);
  if (/hier/.test(t)) return new Date(now - 864e5);
  if (/jour/.test(t)) return new Date(now - n * 864e5);
  if (/semaine/.test(t)) return new Date(now - n * 7 * 864e5);
  if (/mois/.test(t)) return new Date(now - n * 30 * 864e5);
  return null;
}

/** Lit les cartes d'offres d'une page de résultats HelloWork. */
export function parseHelloworkList(html, source) {
  const offers = [];
  const cards = html.split('data-cy="serpCard"').slice(1);
  for (const card of cards) {
    const href = card.match(/href="(\/fr-fr\/emplois\/(\d+)\.html)"/);
    if (!href) continue;
    const title = cleanText(card.match(/data-cy="offerTitle"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? card.match(/title="([^"]+)"/)?.[1], 200);
    const company = cleanText(card.match(/data-cy="offerTitle"[\s\S]*?<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/)?.[1], 120);
    const tag = (name) => cleanText(card.match(new RegExp(`data-cy="${name}"[^>]*>([\\s\\S]*?)<\/div>`))?.[1], 120) || null;
    const salary = cleanText(card.match(/typo-s-bold[^"]*"[^>]*>([^<]*(?:€|&#x20AC;)[^<]*)</i)?.[1], 120) || null;
    const when = card.match(/text-grey-500[^>]*>\s*(il y a[^<]*|aujourd[^<]*|hier[^<]*)</i)?.[1];
    offers.push({
      id: `hw:${href[2]}`,
      source: source.name,
      origin: 'HelloWork',
      siteUrl: HW_BASE,
      hint: source.hint,
      title,
      company: company || null,
      logo: null,
      location: tag('localisationCard'),
      contract: tag('contractCard'),
      duration: tag('contractTag'),
      start: null,
      remote: null,
      salary,
      diploma: null,
      languages: [],
      skills: [],
      description: '',
      date: when ? relativeDate(when) : null,
      link: `${HW_BASE}${href[1]}`,
    });
  }
  return offers;
}

/** Complète une offre avec la fiche détaillée (JSON-LD JobPosting). */
export function applyJobPosting(offer, html) {
  const scripts = [...html.matchAll(/<script[^>]*type="application\/ld(?:\+|&#x2B;)json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of scripts) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const job = [data, ...(data['@graph'] ?? [])].find((d) => d?.['@type'] === 'JobPosting');
    if (!job) continue;
    const org = job.hiringOrganization ?? {};
    const addr = job.jobLocation?.address ?? {};
    const industry = [].concat(job.industry ?? []).join(', ');
    offer.title = cleanText(job.title, 200) || offer.title;
    offer.company = cleanText(org.name, 120) || offer.company;
    if (/^https:\/\//.test(org.logo ?? '')) offer.logo = org.logo;
    offer.location = offer.location || cleanText([addr.addressLocality, addr.addressRegion].filter(Boolean).join(', '), 120) || null;
    offer.date = toDate(job.datePosted) ?? offer.date;
    offer.skills = [].concat(job.skills ?? []).map((s) => cleanText(s, 60)).slice(0, 10);
    offer.description = cleanText(`${industry ? `Secteur de l'employeur : ${industry}. ` : ''}${job.description ?? ''}`);
    return true;
  }
  return false;
}

async function fetchHellowork(source) {
  const params = new URLSearchParams({ c: 'Alternance', ...source.params });
  const html = await getHtml(`${HW_BASE}/fr-fr/emploi/recherche.html?${params}`);
  const offers = parseHelloworkList(html, source);
  if (!offers.length) throw new Error('aucune offre lue sur la page (mise en page modifiée ?)');
  // La fiche n'est lue que pour les offres nouvelles, au moment de l'analyse (voir index.js)
  for (const offer of offers) {
    offer.enrich = async () => {
      if (!applyJobPosting(offer, await getHtml(offer.link))) console.warn(`   ⚠️ fiche HelloWork sans données structurées : ${offer.link}`);
    };
  }
  return offers;
}

// ───────────────────────── Toutes les sources ─────────────────────────

const FETCHERS = { francetravail: fetchFranceTravail, labonnealternance: fetchLba, hellowork: fetchHellowork };
const MAX_PER_SOURCE = Number(process.env.MAX_PER_SOURCE || 30);

export async function fetchAllSources(sources) {
  const offers = [];
  // Séquentiel : les deux API limitent le débit
  for (const source of sources) {
    const fetcher = FETCHERS[source.api];
    try {
      if (!fetcher) throw new Error(`API inconnue « ${source.api} »`);
      const list = (await fetcher(source)).filter((o) => o.title).sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, MAX_PER_SOURCE);
      console.log(`✓ ${source.name} : ${list.length} offre(s)`);
      offers.push(...list);
    } catch (err) {
      console.warn(`✗ ${source.name} : ${err.message}`);
    }
    await sleep(300);
  }
  return offers;
}
