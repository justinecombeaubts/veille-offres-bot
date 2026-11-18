import { getChannel } from './channels.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hexToInt = (hex) => parseInt(String(hex || '#F2A65A').replace('#', ''), 16);
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function formatDateFr(date) {
  if (!date || Number.isNaN(date.getTime())) return 'date inconnue';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** Jauge de pertinence : ▰▰▰▰▰▰▰▱▱▱ */
export function scoreBar(note) {
  return '▰'.repeat(note) + '▱'.repeat(10 - note);
}

function favicon(siteUrl) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(siteUrl).hostname}&sz=64`;
  } catch {
    return undefined;
  }
}

/** Construit le message Discord (embed) pour une offre retenue. */
export function buildPayload(offer, verdict) {
  const channel = getChannel(verdict.salon) ?? {};
  const emoji = channel.emoji ?? '💼';

  const parts = [];
  if (verdict.accroche) parts.push(`> *${verdict.accroche}*`);
  if (verdict.missions.length) parts.push(`**📌 Missions**\n${verdict.missions.map((m) => `▸ ${m}`).join('\n')}`);
  if (verdict.pourquoi) parts.push(`**💡 Pourquoi toi**\n${verdict.pourquoi}`);
  if (verdict.a_verifier) parts.push(`**⚠️ À vérifier**\n${verdict.a_verifier}`);
  parts.push(`[**Voir l'offre et postuler →**](${offer.link})`);

  const fields = [
    { name: 'Pertinence', value: `\`${scoreBar(verdict.note)}\` **${verdict.note}**/10${verdict.note >= 9 ? ' 🔥' : ''}`, inline: false },
    { name: '📍 Lieu', value: offer.location ?? 'non précisé', inline: true },
    { name: '📄 Contrat', value: offer.contract ?? 'non précisé', inline: true },
  ];
  const rythme = verdict.rythme || offer.duration;
  if (rythme) fields.push({ name: '⏱️ Rythme / durée', value: cut(rythme, 100), inline: true });
  if (offer.start) fields.push({ name: '🗓️ Début', value: offer.start, inline: true });
  if (offer.remote) fields.push({ name: '🏠 Mode', value: offer.remote, inline: true });
  if (offer.salary) fields.push({ name: '💶 Salaire', value: cut(offer.salary, 100), inline: true });
  if (verdict.anglais) fields.push({ name: '🇬🇧 Anglais', value: cut(verdict.anglais, 100), inline: true });
  if (verdict.stack.length) fields.push({ name: 'Stack', value: verdict.stack.map((t) => `\`#${t}\``).join(' '), inline: false });

  const embed = {
    author: {
      name: cut(`${offer.company ?? 'Entreprise non précisée'} · via ${offer.origin}`, 250),
      url: offer.siteUrl ?? undefined,
      icon_url: offer.logo ?? favicon(offer.siteUrl),
    },
    title: cut(`${emoji} ${verdict.titre || offer.title}`, 256),
    url: offer.link,
    color: hexToInt(channel.couleur),
    description: cut(parts.join('\n\n'), 3800),
    fields,
    footer: {
      text: `ColibrIA · ${channel.categorie ?? 'Offres'} · ${channel.salon ?? ''} · publiée le ${formatDateFr(offer.date)}`,
      ...(process.env.FOOTER_ICON_URL ? { icon_url: process.env.FOOTER_ICON_URL } : {}),
    },
  };
  if (offer.logo) embed.thumbnail = { url: offer.logo };

  return { allowed_mentions: { parse: [] }, embeds: [embed] };
}

/** Envoie un message sur un webhook, en respectant le rate limit Discord. */
export async function sendToDiscord(url, payload, attempt = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.status === 429 && attempt <= 3) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after ?? 2) * 1000));
    return sendToDiscord(url, payload, attempt + 1);
  }
  // Un logo refusé par Discord ne doit pas faire perdre l'offre : on renvoie sans lui
  if (res.status === 400 && attempt === 1 && (payload.embeds?.[0]?.thumbnail || payload.embeds?.[0]?.author?.icon_url)) {
    const { thumbnail, author, ...rest } = payload.embeds[0];
    return sendToDiscord(url, { ...payload, embeds: [{ ...rest, author: { name: author.name, url: author.url } }] }, attempt + 1);
  }
  if (!res.ok) throw new Error(`Discord ${res.status} : ${await res.text()}`);
  await sleep(1200); // espace les messages pour rester sous la limite des webhooks
}
