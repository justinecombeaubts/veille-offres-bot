import { readFile, writeFile } from 'node:fs/promises';

const STATE_URL = new URL('../data/seen.json', import.meta.url);
const RETENTION_DAYS = 60;

/** Charge la liste des offres déjà traitées : { [lien]: dateISO }. */
export async function loadSeen() {
  try {
    return JSON.parse(await readFile(STATE_URL, 'utf8'));
  } catch {
    return {};
  }
}

/** Sauvegarde en oubliant les entrées de plus de 60 jours. */
export async function saveSeen(seen) {
  const limit = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const pruned = Object.fromEntries(
    Object.entries(seen)
      .filter(([, iso]) => new Date(iso).getTime() >= limit)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(STATE_URL, `${JSON.stringify(pruned, null, 2)}\n`);
}
