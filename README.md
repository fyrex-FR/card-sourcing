# Card Sourcing — alerteur eBay

Surveille eBay en continu et te prévient sur Telegram quand une carte correspondant à tes recherches apparaît.

- **Interface web** : créer et régler les recherches (avec aperçu des annonces en ligne), voir l'historique des alertes, suivre les cartes à acheter, gérer les vendeurs bloqués, le quota et les frais d'import.
- **Telegram** : les alertes (boutons Suivre, Ignorer, Bloquer le vendeur) et les rappels avant la fin des enchères suivies.

Connexion à l'interface sans mot de passe : un lien et un code à usage unique sont envoyés sur ton Telegram.

## Alertes

- 🆕 **Nouvelle annonce** : une annonce qui correspond vient d'être publiée (et coûte au plus le prix max, si tu en as fixé un).
- 📉 **Sous ton prix max** : une annonce plus ancienne passe sous ton prix max (baisse de prix).
- ⏰ **Enchère pas chère qui se termine** : une enchère au plus au prix max se termine dans la fenêtre choisie (60 min par défaut).

Les prix sont comparés en **coût rendu France** : carte + port vers la France, convertis en EUR (taux BCE), plus, pour un vendeur hors UE, la TVA d'import (20 % par défaut) et des frais de dédouanement au-delà de 150 € de marchandise (réglables). Les annonces non livrables en France sont exclues.

## Filtres d'une recherche

Mots exclus et obligatoires, cartes gradées ou non (PSA, BGS, SGC… dans le titre, ou état « Graded »), exclusion des lots, vendeur fiable (pourcentage d'avis positifs et nombre d'évaluations minimum), pays du vendeur, sites eBay.

Une carte remise en ligne par le même vendeur (même titre) n'est pas signalée une deuxième fois, et une carte ignorée le reste après remise en ligne.

## Suivi d'achat

Chaque carte peut être **suivie**, **à enchérir** (avec un plafond en coût rendu) ou **achetée**. Pour une enchère suivie, un rappel Telegram arrive avant la fin (10 min par défaut), avec l'enchère en cours relue sur eBay et la **mise max à saisir** pour respecter le plafond. La vue « Par vendeur » regroupe les cartes d'un même vendeur pour grouper le port.

Chaque alerte propose deux boutons : 🙈 Ignorer (plus d'alerte pour cette carte) et 🚫 Bloquer le vendeur. Quand tu crées une recherche, les annonces déjà en ligne sont enregistrées sans alerte : tu reçois un résumé des moins chères, puis seulement les nouveautés.

## Commandes Telegram (facultatives, tout se fait aussi sur le web)

```
/login         lien de connexion à l'interface web
/add wembanyama prizm silver max=80 type=auction pays=CN fin=30 sites=US,GB -reprint -lot
/list          liste des recherches, /s3 pour gérer la n°3 (boutons)
/status        rythme de vérification et quota eBay du jour
/pause /resume
/blocked       vendeurs bloqués
```

## Quota eBay

La Browse API autorise 5000 appels par jour. Chaque recherche coûte 1 appel par site eBay et par passage, plus 1 si elle surveille les fins d'enchères (prix max défini, type « tout » ou « enchères »). Chaque rappel d'enchère suivie coûte 1 appel. L'intervalle entre deux passages est calculé pour rester sous `EBAY_DAILY_BUDGET` (4500). Par exemple, 10 recherches sur EBAY_US donnent un passage toutes les ~6 min.

## Stack

Node 22+ et TypeScript, avec :
- [Hono](https://hono.dev) pour l'API et le service de l'interface ;
- React, Vite et TanStack Query pour l'interface web (`web/`) ;
- [grammY](https://grammy.dev) pour le bot Telegram (long polling) ;
- Postgres et [Drizzle](https://orm.drizzle.team) pour la base (migrations appliquées au démarrage) ;
- Zod pour la validation ;
- Vitest pour les tests (Postgres en mémoire via PGlite).

```
src/
  main.ts              démarrage et câblage
  config.ts            variables d'environnement (validées)
  alerts/rules.ts      règles d'alerte et filtres (fonctions pures)
  alerts/pricing.ts    coût rendu France, mise max, empreinte anti-doublon
  alerts/reminders.ts  rappels avant la fin des enchères suivies
  alerts/poller.ts     boucle de surveillance, envoi, quota
  alerts/pacing.ts     calcul du rythme
  ebay/                client Browse API et parsing des annonces
  bot/                 commandes, boutons, textes, envoi Telegram
  web/                 API HTTP, connexion, validation
  db/                  schéma Drizzle, connexion, requêtes
web/                   interface React (servie par le même process)
drizzle/               migrations SQL générées
```

## Développement

```bash
cp .env.example .env    # puis remplis-le
npm install
npm run dev             # serveur + bot (port 3000), rechargement auto
npm run dev:web         # interface sur http://localhost:5173 (API proxifiée vers :3000)
npm test
npm run typecheck
```

Après une modification de `src/db/schema.ts`, lance `npm run db:generate` pour créer la migration, puis commite-la.

## Déploiement

Sur Coolify avec Nixpacks, sans Dockerfile : un seul service, port 3000, health check `/api/health`. Voir [SETUP_COOLIFY.md](SETUP_COOLIFY.md).
