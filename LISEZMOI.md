# Urne du Bureau : plateforme de vote en ligne

Élection du président d'un bureau, accessible à n'importe qui avec un lien et un code de vote personnel.
Aucun compte à créer, aucune dépendance à installer (Node 18+ uniquement).

## Principe
1. L'organisateur ouvre `https://votre-site/#admin`, se connecte, saisit les candidats, génère un code par électeur.
2. Il envoie à chacun son code (WhatsApp, SMS, e-mail, papier).
3. Les électeurs ouvrent `https://votre-site/`, saisissent leur code, cochent un candidat et déposent leur bulletin.
4. L'organisateur clôture : les résultats et le procès-verbal s'affichent pour tous.

## Secret du vote
- Chaque code ne sert qu'une fois ; les codes sont stockés hachés (illisibles, même pour l'organisateur).
- Le bulletin est enregistré sans code, sans nom et sans date, à une position aléatoire de la liste : on ne peut pas relier un vote à un votant.
- Les résultats ne sont visibles qu'après la clôture.

## Lancer en local (test)
    ADMIN_PASSWORD="un-mot-de-passe-solide" node server.js
puis ouvrir http://localhost:3000 (électeurs) et http://localhost:3000/#admin (organisateur).

## Mettre en ligne (exemple : Render.com, gratuit pour un essai)
1. Déposez ce dossier dans un dépôt GitHub.
2. Sur render.com : New > Web Service > choisissez le dépôt.
   - Runtime : Node, Build Command : (vide), Start Command : `node server.js`
   - Variable d'environnement : `ADMIN_PASSWORD` = votre mot de passe (8 caractères minimum)
3. Important : l'offre gratuite efface les fichiers à chaque redémarrage. Pour un vrai scrutin,
   ajoutez un disque persistant (monté sur `/data`) et la variable `DATA_DIR=/data`,
   ou utilisez un hébergeur avec volume (Railway, Fly.io, un petit VPS avec le Dockerfile fourni).
4. Le site doit être en HTTPS (automatique chez ces hébergeurs).

Docker : `docker build -t urne . && docker run -p 3000:3000 -v urne-data:/data -e ADMIN_PASSWORD=... urne`

## Conseils
- Faites un scrutin d'essai avant le vrai (« Préparer un nouveau tour » remet tout à zéro, codes conservés).
- Sauvegardez le fichier `data/scrutin.json` après la clôture.
- Un second tour en cas d'égalité : bouton « Préparer un nouveau tour ».
