# Card Sourcing - contexte produit et technique

Ce document sert de handoff pour reprendre l'application sans perdre le contexte métier.

## Vision

Card Sourcing est une application privée pour repérer des cartes NBA sous-cotées, principalement vendues depuis la Chine, afin de les acheter au meilleur prix puis les revendre en France.

L'objectif n'est pas seulement d'afficher des résultats eBay. L'app doit aider à décider vite :

- quelle carte mérite une enchère maintenant ;
- quel vendeur mérite d'être exploré pour grouper plusieurs achats ;
- quels résultats sont du bruit et doivent être ignorés ;
- quelles opportunités sont compatibles avec une marge réaliste à la revente.

La cible produit est un cockpit de sourcing, pas un moteur de recherche générique.

## Besoin métier

Le workflow réel est :

1. Créer des recherches ciblées sur des joueurs, sets, autos, inserts ou rookies NBA.
2. Scanner les annonces actives eBay, avec priorité aux enchères et aux cartes localisées en Chine.
3. Identifier les cartes pas chères ou peu visibles.
4. Regrouper par vendeur quand plusieurs cartes intéressantes existent chez le même vendeur.
5. Arbitrer les enchères proches de la fin.
6. Mettre de côté les cartes à suivre, ignorer le bruit, marquer les achats.
7. A terme, comparer avec une valeur de revente France pour estimer une marge.

Le problème principal aujourd'hui : l'interface affiche beaucoup d'informations, mais elle ne raconte pas encore assez clairement quoi faire en premier. Sur mobile en particulier, le résultat peut paraître incompréhensible si la hiérarchie visuelle et les libellés ne sont pas limpides.

## Etat actuel

Stack :

- Backend : FastAPI
- Frontend : Vite + React + TypeScript
- Auth et données : Supabase
- Marketplace : eBay Browse API
- Déploiement : Coolify / Docker

URLs connues :

- Frontend : `https://sourcing.cardvaults.app`
- Backend prévu : `https://sourcing-api.cardvaults.app`
- Backend temp Coolify : `http://v11bw5l15ycr7dwldgma1c08.178.105.44.71.sslip.io`

Repo local :

- `/home/fxa/.openclaw/workspace/projects/card-sourcing`

## Fonctionnalités implémentées

### Auth et données

- Connexion Supabase.
- Données privées par utilisateur.
- Watchlists avec :
  - nom ;
  - requête eBay ;
  - prix maximum ;
  - marketplace ;
  - pays ;
  - type d'achat : toutes annonces, enchères, achat immédiat.

### Scan eBay

- Scan manuel d'une watchlist via eBay Browse API.
- Filtrage par pays, prix max et type d'achat.
- Tri côté eBay par prix pour les scans principaux.
- Stockage des résultats dans `sourcing_items`.
- Déduplication par `external_id`.
- Mise à jour des annonces déjà vues.
- Fallback de requête textuelle si la requête stricte ne retourne rien.

### Informations récupérées

Pour chaque annonce :

- titre ;
- prix ;
- devise ;
- frais de port si disponibles ;
- image ;
- URL ;
- vendeur ;
- feedback vendeur ;
- pays ;
- condition ;
- options d'achat ;
- date de fin d'enchère ;
- nombre d'enchères ;
- requête matchée ;
- qualité de match `exact` ou `partial`.

### Triage

Statuts disponibles :

- `new`
- `watching`
- `ignored`
- `bought`
- `too_expensive`

### Workflow vendeur

- Regroupement des cartes actives par vendeur.
- Mise en favori locale des vendeurs.
- Panneau vendeur pour explorer les enchères terminant bientôt chez un vendeur donné.
- Endpoint backend dédié :
  - `GET /api/sellers/{seller_username}/ending-auctions`

### Cockpit d'action

Le frontend a été orienté autour de trois files :

- `Maintenant` : enchères à arbitrer rapidement.
- `Panier` : vendeurs intéressants à explorer.
- `Ménage` : résultats faibles ou inutilisables à nettoyer.

Un score d'opportunité existe côté frontend. Il est pragmatique, pas une vraie estimation de marge :

- prix bas par rapport au max de la watchlist ;
- urgence de fin d'enchère ;
- densité vendeur ;
- vendeur favori ;
- pénalité si beaucoup d'enchères.

## Limites importantes

### Le scoring n'est pas une vérité métier

Aujourd'hui, l'app ne sait pas automatiquement si une carte est vraiment une bonne affaire. Elle ne connaît pas encore :

- les ventes terminées ;
- les comps eBay ;
- la liquidité en France ;
- les frais complets ;
- la TVA/douane ;
- le risque de contrefaçon ;
- la désirabilité réelle du joueur ou du set ;
- l'état exact de la carte.

Il faut donc éviter de présenter le score comme une marge ou une recommandation certaine. C'est un priorisateur de tri.

### L'UX actuelle reste trop dense

Xavier a explicitement remonté que l'ensemble était incompréhensible. Il faut donc simplifier.

Direction recommandée :

- une vue principale orientée décision ;
- moins de widgets simultanés ;
- une hiérarchie forte : action prioritaire, raison, bouton ;
- des libellés métier courts ;
- une expérience mobile pensée en premier ;
- éviter les panneaux qui se ressemblent visuellement.

### Les colonnes Supabase optionnelles doivent être vérifiées

Le backend contient une compatibilité si certaines colonnes n'existent pas encore :

- `auction_end_at`
- `bid_count`
- `match_query`
- `match_quality`

Le SQL source est dans :

- `backend/sql/001_sourcing_schema.sql`

Il faut vérifier en production Supabase que ces colonnes sont bien appliquées.

## Priorités produit recommandées

### P1 - Rendre l'app compréhensible

Priorité absolue : refaire la surface de décision.

Idée de direction :

- Une seule question visible : "Qu'est-ce que j'achète ou j'ignore maintenant ?"
- Une carte prioritaire à la fois ou une liste très courte.
- Chaque opportunité doit afficher :
  - prix total ;
  - temps restant ;
  - vendeur ;
  - raison de priorité ;
  - risque principal ;
  - actions : suivre, ignorer, ouvrir eBay, voir vendeur.

Sur mobile, éviter d'empiler cockpit, vendeurs, stats et cartes dans le même écran.

### P2 - Construire le vrai workflow achat

Fonctions utiles :

- queue "à enchérir" ;
- champ prix maximum que Xavier accepte de mettre ;
- rappel avant fin d'enchère ;
- statut `bid_planned` ou équivalent ;
- notes privées par item ;
- favoris persistés en base plutôt qu'en localStorage ;
- regroupement vendeur avec total estimé frais inclus.

### P3 - Estimation de marge semi-manuelle

Ne pas promettre une auto-détection parfaite trop tôt.

Approche raisonnable :

- champ manuel "valeur de revente estimée" ;
- frais estimés configurables ;
- marge calculée ;
- tag confiance : faible, moyen, fort ;
- possibilité d'ajouter un lien de comp ou une note.

Ensuite seulement, automatiser partiellement les comps.

### P4 - Qualité de données

- Mieux parser les frais de port.
- Afficher prix carte + shipping + total.
- Identifier les annonces sans image ou sans vendeur comme bruit.
- Normaliser les pays.
- Garder l'historique des scans.
- Repérer les annonces qui baissent ou reviennent souvent.

## Fichiers clés

- `frontend/src/main.tsx` : logique principale du frontend, cockpit, watchlists, cards, sellers.
- `frontend/src/styles.css` : tout le layout et responsive actuel.
- `frontend/src/types/index.ts` : types frontend.
- `frontend/src/api/client.ts` : client API.
- `backend/routers/sourcing.py` : endpoints watchlists, items, scans, sellers.
- `backend/services/ebay_service.py` : appels eBay Browse API et parsing.
- `backend/services/supabase_rest.py` : wrapper Supabase REST.
- `backend/sql/001_sourcing_schema.sql` : schéma Supabase.

## Points d'attention techniques

- Le frontend est encore très concentré dans `main.tsx`. Si gros refactor, extraire des composants par workflow :
  - `ActionBoard`
  - `WatchlistSidebar`
  - `OpportunityCard`
  - `SellerPanel`
  - `MobileNavigation`
- Ne pas refactorer tout le projet juste pour faire joli. La priorité est la clarté utilisateur.
- Les favoris vendeurs sont actuellement en `localStorage`, donc pas partagés entre devices.
- Le score est calculé côté frontend. C'est acceptable pour l'UX, mais pas pour une logique métier durable.
- Les endpoints eBay dépendent des limites et comportements de Browse API. Ne pas supposer que toutes les infos visibles sur eBay web sont disponibles.
- Attention aux libellés : l'utilisateur final doit comprendre en 3 secondes pourquoi une carte est affichée.

## Critère de succès

Une bonne version de l'app doit permettre à Xavier d'ouvrir l'app et de répondre rapidement :

- "Je dois regarder ces 3 enchères maintenant."
- "Ce vendeur vaut un panier groupé."
- "Cette carte est trop chère ou trop risquée, je la vire."
- "Cette opportunité peut avoir une marge, je la suis."

Si l'écran demande une explication externe pour être compris, l'UX a échoué.
