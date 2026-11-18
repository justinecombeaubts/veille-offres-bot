// Envoie une offre fictive dans le salon pour prévisualiser la mise en forme.
// Usage : DEMO_SALON=alternance npm run demo   (par défaut : chaque salon relié à un webhook)
import { buildPayload, sendToDiscord } from './discord.js';
import { resolveWebhook, getChannel, CHANNELS } from './channels.js';

const keys = process.env.DEMO_SALON ? [process.env.DEMO_SALON] : CHANNELS.filter((c) => resolveWebhook(c.key)).map((c) => c.key);
if (!keys.length) throw new Error('Aucun salon relié à un webhook');

let failures = 0;
for (const key of keys) {
  const channel = getChannel(key);
  const target = channel && resolveWebhook(key);
  if (!target) {
    failures++;
    console.log(`::error title=Démo ${key}::${channel ? 'aucun webhook pour ce salon' : 'salon inconnu'}`);
    continue;
  }
  const offer = {
    link: 'https://github.com/justinecombeaubts/veille-offres-bot',
    company: 'Entreprise exemple',
    origin: 'La bonne alternance',
    siteUrl: 'https://labonnealternance.apprentissage.beta.gouv.fr',
    logo: null,
    location: '75 - Paris',
    contract: 'Alternance · Apprentissage',
    duration: '12 mois',
    start: 'décembre 2026',
    remote: 'Hybride',
    salary: null,
    date: new Date(),
  };
  const verdict = {
    note: 8,
    salon: key,
    titre: `Exemple d'offre pour ${channel.salon}`,
    accroche: 'Ceci est un message de démonstration : voici à quoi ressembleront les offres retenues dans ce salon.',
    missions: ['Les missions principales de l’offre, résumées en français', 'Une ligne par mission concrète'],
    pourquoi: 'Cette section cite uniquement les compétences de ton CV qui collent à l’offre (ex. Node.js, n8n, API LLM).',
    a_verifier: 'Ce qui peut bloquer : rythme non précisé, niveau d’anglais, date de début.',
    rythme: '3 j entreprise / 2 j école',
    anglais: '',
    stack: ['node.js', 'n8n', 'api-llm'],
  };
  try {
    await sendToDiscord(target.url, buildPayload(offer, verdict));
    console.log(`✓ Exemple envoyé (${target.key})`);
  } catch (err) {
    failures++;
    console.log(`::error title=Démo ${key}::${err.message.slice(0, 300)}`);
  }
}
if (failures) process.exit(1);
