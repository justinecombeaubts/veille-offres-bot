// Récupère les offres des API publiques et les normalise dans un même format.
// Une source en erreur (ou sans clé) est ignorée : les autres continuent.

const UA = 'veille-offres-bot/1.0 (+https://github.com/justinecombeaubts)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nettoie un texte (HTML éventuel, espaces) et le coupe. */
export function cleanText(html = '', max = 2500) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;/g, "'")
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

// ───────────────────────── Toutes les sources ─────────────────────────

const FETCHERS = { francetravail: fetchFranceTravail, labonnealternance: fetchLba };
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
