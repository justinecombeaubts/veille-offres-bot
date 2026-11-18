import { readFile } from 'node:fs/promises';
import { fetchAllSources } from './sources.js';
import { scoreOffer } from './llm.js';
import { buildPayload, sendToDiscord } from './discord.js';
import { resolveWebhook } from './channels.js';
import { loadSeen, saveSeen } from './state.js';

const MIN_SCORE = Number(process.env.MIN_SCORE ?? 6);
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? 7);
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN ?? 60);
const DRY_RUN = process.env.DRY_RUN === '1';
const LLM_DELAY_MS = Number(process.env.LLM_DELAY_MS ?? 1000);
// Le job GitHub est coupé à 30 min : on garde le temps de sauvegarder seen.json
const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MIN ?? 22) * 60 * 1000;
const MAX_LLM_FAILURES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Même offre publiée sur plusieurs sites : on la repère par entreprise + intitulé
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\(h\/f\)|\(f\/h\)|h\/f|f\/h/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const dedupKey = (o) => (o.company ? `${norm(o.company)}|${norm(o.title)}` : o.id);

async function main() {
  const sources = JSON.parse(await readFile(new URL('../sources.json', import.meta.url), 'utf8'));
  const seen = await loadSeen();
  const now = new Date();
  const minDate = now.getTime() - MAX_AGE_DAYS * 24 * 3600 * 1000;

  const all = await fetchAllSources(sources);

  const keys = new Set();
  const fresh = all
    .filter((o) => !seen[o.id] && !seen[dedupKey(o)])
    .filter((o) => !o.date || o.date.getTime() >= minDate)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .filter((o) => {
      const key = dedupKey(o);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    })
    .slice(0, MAX_PER_RUN);

  console.log(`\n${fresh.length} nouvelle(s) offre(s) à analyser${DRY_RUN ? ' (mode test, rien ne sera envoyé)' : ''}\n`);

  const markSeen = (o) => {
    seen[o.id] = now.toISOString();
    seen[dedupKey(o)] = now.toISOString();
  };

  let sent = 0;
  let llmFailures = 0;
  for (const [i, offer] of fresh.entries()) {
    if (Date.now() - now.getTime() > RUN_BUDGET_MS) {
      console.log(`::warning title=Temps écoulé::Analyse arrêtée après ${i} offre(s), la suite au prochain passage`);
      break;
    }
    if (i > 0) await sleep(LLM_DELAY_MS);
    const label = `${offer.title} — ${offer.company ?? '?'}`;
    if (offer.enrich) {
      try {
        await offer.enrich(); // fiche détaillée (HelloWork) lue seulement pour les offres nouvelles
      } catch (err) {
        console.warn(`   ⚠️ fiche illisible pour « ${label} » : ${err.message}`);
      }
    }
    let verdict;
    try {
      verdict = await scoreOffer(offer);
      llmFailures = 0;
    } catch (err) {
      console.error(`⚠️ Échec sur « ${label} » : ${err.message}`);
      llmFailures++;
      if (err.daily || llmFailures >= MAX_LLM_FAILURES) {
        const why = err.daily ? 'quota du jour du LLM épuisé' : `${llmFailures} échecs du LLM d'affilée`;
        console.log(`::warning title=LLM indisponible::Analyse arrêtée (${why}), la suite au prochain passage`);
        break;
      }
      continue;
    }
    try {
      const kept = verdict.note >= MIN_SCORE;
      const target = kept ? resolveWebhook(verdict.salon) : null;
      const why = !kept && verdict.exclusion ? ` (${verdict.exclusion})` : '';
      const route = !kept ? '' : target ? ` → #${target.key}` : ' → aucun webhook configuré';
      console.log(`${kept ? '✅' : '⛔'} ${verdict.note}/10 [${verdict.salon ?? 'écartée'}] ${label}${why}${route}`);

      if (kept && !target && !DRY_RUN) {
        markSeen(offer);
        continue;
      }
      if (kept) {
        const payload = buildPayload(offer, verdict);
        if (DRY_RUN) console.log(`   ${payload.embeds[0].title}`);
        else await sendToDiscord(target.url, payload);
        sent++;
      }
      markSeen(offer);
    } catch (err) {
      console.error(`⚠️ Échec sur « ${label} » : ${err.message}`);
      if (/Discord/.test(err.message)) console.log(`::warning title=Discord::${err.message.slice(0, 300)}`);
    }
  }

  if (!DRY_RUN) await saveSeen(seen);
  console.log(`\nTerminé : ${sent} offre(s) envoyée(s) sur ${fresh.length} analysée(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
