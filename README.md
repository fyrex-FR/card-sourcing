# Card Sourcing — alerteur eBay

Bot Telegram privé qui surveille eBay en continu et t'écrit quand une carte correspondant à tes recherches apparaît.

## Alertes

- 🆕 **Nouvelle annonce** : une annonce qui correspond vient d'être publiée (et coûte au plus le prix max, si tu en as fixé un).
- 📉 **Sous ton prix max** : une annonce plus ancienne passe sous ton prix max (baisse de prix).
- ⏰ **Enchère pas chère qui se termine** : une enchère au plus au prix max se termine dans la fenêtre choisie (60 min par défaut).

Les prix sont comparés **port inclus** et convertis en EUR (taux BCE). Le port est calculé pour une livraison en France, et les annonces non livrables en France sont exclues.

Chaque alerte propose deux boutons : 🙈 Ignorer (plus d'alerte pour cette carte) et 🚫 Bloquer le vendeur. Quand tu crées une recherche, les annonces déjà en ligne sont enregistrées sans alerte : tu reçois un résumé des moins chères, puis seulement les nouveautés.

## Commandes Telegram

```
/add wembanyama prizm silver max=80 type=auction pays=CN fin=30 sites=US,GB -reprint -lot
/list          liste des recherches, /s3 pour gérer la n°3 (boutons)
/status        rythme de vérification et quota eBay du jour
/pause /resume
/blocked       vendeurs bloqués
```

## Quota eBay

La Browse API autorise 5000 appels par jour. Chaque recherche coûte 1 appel par site eBay et par passage, plus 1 si elle surveille les fins d'enchères (prix max défini, type « tout » ou « enchères »). L'intervalle entre deux passages est calculé pour rester sous `EBAY_DAILY_BUDGET` (4500). Par exemple, 10 recherches sur EBAY_US donnent un passage toutes les ~6 min.

## Stack

Node 22+ et TypeScript, avec :
- [grammY](https://grammy.dev) pour le bot Telegram (long polling, donc pas d'URL publique) ;
- Postgres et [Drizzle](https://orm.drizzle.team) pour la base (migrations appliquées au démarrage) ;
- Zod pour la validation ;
- Vitest pour les tests (Postgres en mémoire via PGlite).

```
src/
  main.ts              démarrage et câblage
  config.ts            variables d'environnement (validées)
  alerts/rules.ts      règles d'alerte (fonction pure)
  alerts/poller.ts     boucle de surveillance, envoi, quota
  alerts/pacing.ts     calcul du rythme
  ebay/                client Browse API et parsing des annonces
  bot/                 commandes, boutons, textes, envoi Telegram
  db/                  schéma Drizzle, connexion, requêtes
drizzle/               migrations SQL générées
```

## Développement

```bash
cp .env.example .env    # puis remplis-le
npm install
npm run dev             # lance le bot en rechargement auto
npm test
npm run typecheck
```

Après une modification de `src/db/schema.ts`, lance `npm run db:generate` pour créer la migration, puis commite-la.

## Déploiement

Sur Coolify avec Nixpacks, sans Dockerfile. Voir [SETUP_COOLIFY.md](SETUP_COOLIFY.md).
