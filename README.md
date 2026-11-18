# 🎓 ColibrIA Alternance — veille d'offres sur Discord

Le petit frère de [ColibrIA](https://github.com/justinecombeaubts/veille-ia-bot), avec le même fonctionnement et le même style de messages. Toutes les 12 heures, GitHub Actions lit les offres d'alternance de HelloWork (sans clé) et, si tu as ajouté leurs clés, des API publiques France Travail et La bonne alternance, écarte les doublons, fait noter chaque **nouvelle** offre par un LLM selon `profil.md` (tiré de mon CV), puis poste les offres pertinentes (note ≥ 6) dans mon salon Discord dédié.

```
API d'offres ─► nouvelles offres (< 7 j, sans doublon) ─► LLM + profil.md ─► note ≥ 6 ? ─► webhook Discord
                                                                    └─ sinon écartée (pas une alternance, anglais C1+, hors IDF…)
```

## Le salon

Toutes les offres retenues arrivent dans **un seul salon** (celui que tu as déjà créé pour l'alternance). Le LLM écarte tout ce qui n'est pas une alternance (CDI, stage, freelance…), même si une recherche l'a fait remonter.

Chaque message contient : l'entreprise et la source, le titre du poste, une accroche, les missions, « Pourquoi toi » (seulement des compétences de mon CV), « À vérifier » (rythme, anglais, diplôme…), une jauge de pertinence, le lieu, le contrat, le rythme ou la durée, la date de début, le mode (sur site / hybride), le salaire s'il est indiqué, la stack et le lien pour postuler.

## Mise en place

### 1. Discord

Dans le salon de l'alternance : **Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL**.

### 2. Les clés d'API (gratuites)

- **France Travail** : crée un compte sur [francetravail.io](https://francetravail.io), puis **Mes applications → Créer une application**, et ajoute l'API **« Offres d'emploi v2 »**. Note l'**identifiant client** et la **clé secrète**.
- **La bonne alternance** : crée un compte sur [api.apprentissage.beta.gouv.fr](https://api.apprentissage.beta.gouv.fr), puis **Mon compte → Générer une clé d'API**.
- **Gemini** : la même clé que pour ColibrIA convient (Google AI Studio).

### 3. Les secrets GitHub

Dans ce dépôt : **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Valeur |
|---|---|
| `DISCORD_WEBHOOK_URL` | l'URL du webhook du salon, telle quelle |
| `FRANCE_TRAVAIL_CLIENT_ID` | identifiant client France Travail |
| `FRANCE_TRAVAIL_CLIENT_SECRET` | clé secrète France Travail |
| `LBA_API_KEY` | clé d'API La bonne alternance |
| `GEMINI_API_KEY` | clé API Gemini |

Pour séparer plus tard les offres dans plusieurs salons, ajoute-les dans `channels.json` et mets un JSON `{"clé-du-salon": "url", …}` dans un secret `DISCORD_WEBHOOKS`, comme dans ColibrIA.

**HelloWork marche sans aucune clé** : avec seulement `DISCORD_WEBHOOK_URL` et `GEMINI_API_KEY`, le bot tourne déjà. Une API sans clé est simplement ignorée, tu peux ajouter La bonne alternance ou France Travail plus tard.

### 4. Lancer

Onglet **Actions → Veille offres → Run workflow**. Coche **demo** pour envoyer d'abord une offre fictive dans le salon et voir la mise en forme. Les logs indiquent pour chaque offre sa note, le salon, ou la raison de l'exclusion.

## Personnaliser

| Je veux… | Je modifie… |
|---|---|
| changer ce que je cherche ou ce que j'exclus | `profil.md` (envoyé tel quel au LLM) |
| ajouter une recherche (mots-clés, département, codes ROME) | `sources.json` |
| vérifier que les sources répondent | `npm run check` (sans LLM ni Discord) |
| être plus ou moins sélective | variable `MIN_SCORE` (défaut `6`) |
| remonter plus loin dans le temps | variable `MAX_AGE_DAYS` (défaut `7`) |
| changer de modèle | variable `LLM_MODEL` (défaut `gemini-3.5-flash-lite`) |
| changer la fréquence | le `cron` dans `.github/workflows/veille-offres.yml` |

Paramètres utiles dans `sources.json` :

- **HelloWork** : `k` (mots-clés) et `l` (lieu, ex. `Île-de-France` ou `Paris`) ; le filtre alternance est ajouté automatiquement.

- **France Travail** : `motsCles`, `region` (`11` = Île-de-France) ou `departement` (jusqu'à 5, séparés par des virgules), `natureContrat` (`E2` = apprentissage, `FS` = professionnalisation), `typeContrat`, `tempsPlein`, et `publieeDepuis` (jours, défaut 7) à côté de `params`.
- **La bonne alternance** : `romes` (`M1805` = études et développement informatique, `M1806` = conseil et maîtrise d'ouvrage en SI, `M1810` = production et exploitation de SI), `departements` (liste), `target_diploma_level` (`6` = bac+3).

## Tester en local

```bash
npm test                                   # tests hors ligne (API et Discord simulés)
FRANCE_TRAVAIL_CLIENT_ID=… FRANCE_TRAVAIL_CLIENT_SECRET=… LBA_API_KEY=… GEMINI_API_KEY=… npm run test:dry   # notes et salons, sans rien envoyer
```

Aucune dépendance npm : Node 20+ suffit.

## Comment ça marche

- `src/sources.js` : interroge France Travail (jeton OAuth2) et La bonne alternance, puis normalise les offres dans un même format.
- `src/llm.js` : envoie `profil.md`, les salons et l'offre au LLM, qui renvoie un JSON (`note`, `salon`, `exclusion`, `titre`, `accroche`, `missions`, `pourquoi`, `a_verifier`, `rythme`, `anglais`, `stack`). L'offre est traitée comme une donnée, jamais comme une instruction.
- `src/discord.js` : embed coloré, logo de l'entreprise quand la source le fournit, gestion du rate limit.
- `data/seen.json` : offres déjà traitées (60 jours), par identifiant **et** par « entreprise + intitulé » pour ne pas recevoir deux fois la même offre publiée sur plusieurs sites.

## Bon à savoir

- **Il n'existe pas de flux RSS d'offres fiable** (Indeed a fermé les siens ; Welcome to the Jungle, LinkedIn et HelloWork n'en ont pas). HelloWork est donc lu directement : page de résultats, puis la fiche de chaque nouvelle offre (données structurées JobPosting). Si HelloWork change sa mise en page, cette source affichera « aucune offre lue » dans les logs et les autres continueront.
- Beaucoup d'annonces HelloWork viennent d'écoles ou de CFA qui recrutent pour leur formation : le LLM les écarte (le secteur de l'employeur lui est transmis).
- Conditions d'utilisation : La bonne alternance est gratuite pour un usage non commercial ; France Travail demande de citer la source, ce que fait l'en-tête de chaque message.
