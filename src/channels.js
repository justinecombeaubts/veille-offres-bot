import { readFileSync } from 'node:fs';

export const CHANNELS = JSON.parse(readFileSync(new URL('../channels.json', import.meta.url), 'utf8'));
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key);
const byKey = new Map(CHANNELS.map((c) => [c.key, c]));

export const getChannel = (key) => byKey.get(key);

/** Liste des salons d'un propriétaire, telle qu'envoyée au LLM pour qu'il choisisse. */
export function channelsForPrompt(profil) {
  return CHANNELS.filter((c) => !profil || c.profil === profil)
    .map((c) => `- ${c.key} (catégorie ${c.categorie}) : ${c.sujet}`)
    .join('\n');
}

let webhooksCache;
function loadWebhooks() {
  if (webhooksCache) return webhooksCache;
  // Le JSON des salons peut être dans DISCORD_WEBHOOKS ou directement dans DISCORD_WEBHOOK_URL
  const legacy = process.env.DISCORD_WEBHOOK_URL?.trim();
  const raw = process.env.DISCORD_WEBHOOKS?.trim() || (legacy?.startsWith('{') ? legacy : '');
  try {
    webhooksCache = raw ? JSON.parse(raw) : {};
  } catch (err) {
    // Message d'erreur sans le contenu du secret, avec la position de l'erreur de syntaxe
    const msg = `Le JSON des webhooks est invalide (${err.message.replace(/"[^"]*https?:[^"]*"/g, '"…"')}). Vérifie les virgules et les guillemets.`;
    console.log(`::error title=JSON des webhooks::${msg}`);
    throw new Error(msg);
  }
  return webhooksCache;
}

/**
 * Trouve le webhook d'un salon. Si le salon n'a pas (encore) de webhook, on remonte
 * vers le salon « nouveautés » de sa catégorie, puis vers DISCORD_WEBHOOK_URL.
 * Renvoie { url, key } où key est le salon réellement utilisé.
 */
export function resolveWebhook(key) {
  const hooks = loadWebhooks();
  const visited = new Set();
  let current = key;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (hooks[current]) return { url: hooks[current], key: current };
    current = byKey.get(current)?.fallback;
  }
  const fallback = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (fallback && !fallback.startsWith('{')) return { url: fallback, key: 'défaut' };
  return null;
}
