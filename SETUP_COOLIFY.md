# Mise en place sur Coolify

Instructions pour déployer l'alerteur eBay. Elles sont écrites pour être suivies par un agent (OpenClaw) ou à la main.

L'app est un **seul service Node** qui fait trois choses :
- héberger l'**interface web**, où l'on configure les recherches (port 3000) ;
- faire tourner le **bot Telegram** qui envoie les alertes (long polling) ;
- exécuter la **boucle** qui interroge eBay.

## 1. Base de données

Utiliser le **PostgreSQL applicatif (postgres:16)** du VPS. Ne **jamais** utiliser `coolify-db`.

Créer une base et un utilisateur dédiés :

```sql
CREATE USER card_alerter WITH PASSWORD '<mot de passe fort généré>';
CREATE DATABASE card_alerter OWNER card_alerter;
```

L'URL de connexion utilise le nom d'hôte **interne** du conteneur Postgres dans le réseau Docker de Coolify :

```
postgres://card_alerter:<mot de passe>@<hôte interne postgres16>:5432/card_alerter
```

Ne crée pas les tables à la main : l'app applique ses migrations (dossier `drizzle/`) à chaque démarrage.

## 2. Bot Telegram

C'est au propriétaire du bot de le faire, depuis son téléphone : créer un bot avec [@BotFather](https://t.me/BotFather) (`/newbot`), puis transmettre le token.

## 3. Application

- Nouvelle ressource : **Application**, depuis le dépôt GitHub `fyrex-FR/card-sourcing`, branche **`v2`**.
- Build pack : **Nixpacks**. Il détecte Node et lance `npm ci`, `npm run build` (serveur et interface web) puis `npm start`. Ne pas surcharger ces commandes.
- Port exposé : **3000**.
- Domaine : un sous-domaine en HTTPS, par exemple `https://alertes.cardvaults.app`, avec un enregistrement DNS pointant vers le VPS.
- Health check : chemin **`/api/health`** (répond `{"ok":true}` sans connexion).
- Une seule instance. Deux instances se disputeraient le bot Telegram (erreur 409 « Conflict »).

## 4. Variables d'environnement

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | URL de l'étape 1 |
| `TELEGRAM_BOT_TOKEN` | token BotFather |
| `TELEGRAM_CHAT_ID` | **vide** au premier déploiement (voir étape 5) |
| `EBAY_CLIENT_ID` | clé eBay de production, à reprendre de l'ancien service backend « card-sourcing » sur Coolify |
| `EBAY_CLIENT_SECRET` | idem |
| `PUBLIC_URL` | l'adresse du domaine de l'étape 3, sans `/` final, par exemple `https://alertes.cardvaults.app` |
| `SESSION_SECRET` | une chaîne aléatoire longue, par exemple `openssl rand -hex 32` |

`PUBLIC_URL` sert à construire le lien de connexion envoyé sur Telegram. Elle doit être exacte et en `https://`, sinon le cookie de session n'est pas marqué sécurisé.

Variables facultatives (les valeurs par défaut conviennent) : `PORT=3000`, `DEFAULT_MARKETPLACES=EBAY_US`, `DELIVERY_COUNTRY=FR`, `DELIVERY_ZIP=75001`, `HOME_CURRENCY=EUR`, `EBAY_LINK_DOMAIN=www.ebay.fr`, `EBAY_DAILY_BUDGET=4500`, `MIN_INTERVAL_SECONDS=120`, `MAX_ALERTS_PER_SEARCH_CYCLE=10`.

Attention au quota eBay : la limite de 5000 appels par jour est partagée par **tout ce qui utilise ces clés**. Si l'ancien backend tourne encore avec son planificateur, il consomme aussi du quota.

## 5. Premier démarrage

1. Déployer. Les logs doivent afficher `[web] interface sur https://…` et `@<nom_du_bot> en écoute`.
2. Le propriétaire envoie n'importe quel message au bot. Celui-ci répond `Ton chat id est 123456789`.
3. Renseigner `TELEGRAM_CHAT_ID` avec cette valeur, puis redéployer.
4. Le bot envoie « 🟢 Alerteur démarré ». À partir de là, il ignore tout autre chat.

## 6. Connexion et vérification

- Ouvrir `PUBLIC_URL`, puis cliquer sur « Recevoir un lien sur Telegram ». Le bot envoie un lien et un code à 6 chiffres, valables 10 minutes et utilisables une seule fois. On ouvre le lien, ou on tape le code sur la page. La session dure 30 jours.
- On peut aussi taper `/login` dans le bot.
- Créer une recherche dans l'interface. Le bot envoie alors sur Telegram le résumé des annonces déjà en ligne.
- En cas d'erreur au démarrage, les logs l'indiquent clairement (`[main] Configuration invalide : …` ou une erreur de connexion à la base).

## Ancienne app

L'ancien frontend (`sourcing.cardvaults.app`) et l'ancien backend tournent sur la branche `main` et ne sont pas concernés. Ne pas les supprimer sans l'accord du propriétaire.
