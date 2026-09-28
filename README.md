# Better Wiki Master

Un userscript pour améliorer la collection et les notifications sur **[WikiMasters](https://www.wiki-masters.com/)** : prix directement sur les cartes, filtres de notifications et mise aux enchères sans perdre sa page.

**Projet indépendant, sans affiliation avec WikiMasters.** Le logiciel est fourni en l'état, sous [licence MIT](LICENSE), avec exclusion de garantie et limitation de responsabilité dans les limites de la loi. Lire la [notice d'usage et de responsabilité](NOTICE.md) avant installation.

> **Autorisation du service :** le [règlement de WikiMasters](https://www.wiki-masters.com/rules) interdit l'automatisation et l'interception du trafic pour obtenir un avantage. La licence du code ne donne pas l'autorisation d'utiliser ces fonctions sur le jeu. Demandez l'accord de l'éditeur avant usage ; un délai entre les requêtes ne garantit ni conformité ni absence de sanction.

**[Installer le script](https://raw.githubusercontent.com/maxime-lalo/better-wiki-master/main/wiki-masters-market.user.js)** · [Voir le code](wiki-masters-market.user.js) · [Signaler un problème](https://github.com/maxime-lalo/better-wiki-master/issues)

Installer d'abord le gestionnaire adapté à son appareil, puis ouvrir le lien ci-dessus **dans le même navigateur**.

| Appareil | Navigateur et gestionnaire | Guide |
| --- | --- | --- |
| PC, Mac, Linux | Chrome, Edge ou Firefox + Tampermonkey | [Installation sur PC](#installation-sur-pc) |
| Android | Firefox + Tampermonkey | [Installation sur Android](#installation-sur-android) |
| iPhone, iPad | Safari + Userscripts | [Installation sur iOS](#installation-sur-ios) |

Les améliorations s'appliquent au site ouvert dans ce navigateur. Elles ne s'installent pas dans l'application native WikiMasters. Dans le gestionnaire, le script garde le nom **« WikiMasters — Prix de la collection »**, pour permettre la mise à jour des installations existantes.

## Fonctionnalités

- **Prix sur les cartes** : prix moyen, dernière vente et nombre de ventes, selon la rareté effective et les données du formulaire de mise aux enchères.
- **Cache sans expiration** : les données déjà récupérées sont réutilisées. Le bouton **↻** actualise une carte ; sa date de consultation reste visible.
- **Bandeau permanent** : reste visible sur la collection et pendant le défilement, avec l'état, le nom de la carte en cours, la prochaine carte, le compte à rebours et le nombre de cartes de la page en cache.
- **Chargement progressif** : prix manquants des cartes visibles à l'écran, une seule requête à la fois entre tous les onglets. Le délai réglable commence **après réception et traitement complets de la réponse précédente**, pas au départ de la requête.
- **Pages suivantes en option** : la case **Passer automatiquement à la page suivante** active le clic sur le bouton natif **Suivant** après traitement des cartes visibles. Les filtres sont conservés et le parcours s'arrête à la dernière page.
- **Pauses API** : arrêt sur les erreurs prévues, prise en compte de `Retry-After` et bouton de reprise manuelle. Le cache reste consultable pendant l'arrêt.
- **Notifications filtrables** : choix d'un type, compteurs et mémorisation du filtre. Le filtre porte sur les notifications déjà chargées, sans requête supplémentaire.
- **Mise aux enchères sur place** : après succès, fermeture du formulaire et du détail, retrait du seul exemplaire concerné, conservation des filtres et de la page, sans rechargement global de la collection.
- **Confirmation visible** : toast « Nom de la carte a bien été mise aux enchères pour 1 234 wikibidous », refermable ou masqué après huit secondes. Le montant est la mise de départ.

Le script ne choisit ni le montant ni la durée et ne clique pas sur la confirmation de vente. Une erreur laisse le formulaire ouvert. Les compteurs globaux de collection et d'étiquettes attendent le prochain chargement normal ; une page de 50 cartes passe à 49 après une mise en vente.

## Installation sur PC

Pour Windows, macOS ou Linux avec Chrome, Edge ou Firefox :

1. Installer **[Tampermonkey depuis son site officiel](https://www.tampermonkey.net/)** en choisissant son navigateur.
2. Sur Chrome/Edge, ouvrir les détails de Tampermonkey dans `chrome://extensions` ou `edge://extensions`. Activer **Autoriser les scripts utilisateur / Allow User Scripts** si cette option est proposée. Si Tampermonkey réclame le **mode développeur**, l'activer dans cette page. Voir la [procédure officielle](https://www.tampermonkey.net/faq.php?q=Q209).
3. Ouvrir le lien **[Installer le script](https://raw.githubusercontent.com/maxime-lalo/better-wiki-master/main/wiki-masters-market.user.js)**. Tampermonkey affiche le code et un bouton **Installer** : confirmer.
4. Ouvrir la [collection WikiMasters](https://www.wiki-masters.com/collection), se connecter puis recharger la page.
5. Vérifier que le script est activé dans le menu Tampermonkey. Des encarts **Moy. / Dern. / ventes** doivent apparaître sous les cartes.

**Si le navigateur affiche seulement le code :** ouvrir Tampermonkey → **Tableau de bord** → **Créer un nouveau script**, remplacer tout le contenu par le code du lien d'installation, enregistrer avec `Ctrl+S` ou `Cmd+S`, puis recharger WikiMasters.

## Installation sur Android

Le parcours documenté utilise **Firefox pour Android** et son extension Tampermonkey.

1. Installer ou mettre à jour [Firefox pour Android](https://www.firefox.com/browsers/mobile/android/).
2. Dans Firefox, ouvrir la [fiche officielle Tampermonkey pour Android](https://addons.mozilla.org/fr/android/addon/tampermonkey/) et choisir **Ajouter à Firefox**. On peut aussi passer par le menu **⋮ → Extensions** et rechercher Tampermonkey. [Aide Mozilla](https://support.mozilla.org/fr/kb/trouver-installer-modules-firefox-android).
3. Toujours dans Firefox, ouvrir **[Installer le script](https://raw.githubusercontent.com/maxime-lalo/better-wiki-master/main/wiki-masters-market.user.js)** et confirmer dans Tampermonkey.
4. Ouvrir [WikiMasters](https://www.wiki-masters.com/collection) dans Firefox, se connecter puis recharger la collection.
5. Si nécessaire, ouvrir **⋮ → Extensions → Tampermonkey** pour vérifier que le script est actif.

Si le lien s'ouvre dans une autre application, le copier et le coller dans Firefox. Si seul le texte du script apparaît, utiliser la création manuelle décrite pour PC depuis le tableau de bord Tampermonkey.

## Installation sur iOS

Sur iPhone et iPad, utiliser **Safari** avec **Userscripts**.

1. Installer [Userscripts depuis l'App Store](https://apps.apple.com/app/userscripts/id1463298887).
2. Ouvrir l'app Userscripts une fois et vérifier son dossier de scripts. Les versions récentes en proposent un ; sinon, choisir un dossier dans Fichiers.
3. Activer Userscripts dans **Réglages → Apps → Safari → Extensions** — ou **Réglages → Safari → Extensions** selon iOS. [Guide Apple](https://support.apple.com/fr-fr/guide/iphone/iphab0432bf6/ios).
4. Dans Safari, ouvrir **[Installer le script](https://raw.githubusercontent.com/maxime-lalo/better-wiki-master/main/wiki-masters-market.user.js)**. L'affichage du code est normal.
5. Ouvrir le menu de page de Safari (**aA** ou l'icône de menu/extensions selon la version), puis **Userscripts**, et valider l'installation proposée. Autoriser l'accès à la page de téléchargement si demandé.
6. Ouvrir [la collection](https://www.wiki-masters.com/collection), autoriser Userscripts sur **www.wiki-masters.com**, vérifier que le script est actif puis recharger.

**Autre méthode :** enregistrer le fichier `.user.js` dans le dossier choisi par Userscripts via Fichiers. Conserver l'extension `.user.js`, sans ajouter `.txt`. Voir le [guide officiel Userscripts](https://github.com/quoid/userscripts#usage).

Le script déclare `@inject-into page` pour accéder au contexte du site. Utiliser un iOS/Safari à jour ; le rendu mobile a été vérifié à 390 px, mais l'installation sur un véritable iPhone/iPad n'a pas encore été validée.

## Mises à jour

Les métadonnées du script indiquent ce dépôt comme source des mises à jour. Utiliser la recherche de mises à jour du gestionnaire, ou rouvrir le **[lien d'installation](https://raw.githubusercontent.com/maxime-lalo/better-wiki-master/main/wiki-masters-market.user.js)** et confirmer le remplacement. Recharger ensuite WikiMasters.

Pour une ancienne installation collée manuellement, remplacer son contenu une première fois avec la version de ce dépôt. Éviter d'activer deux copies en parallèle. Le cache existant est conservé sur le même navigateur et le même site.

## Cache, appels et dépannage

Le cache est local au navigateur et à l'appareil. Effacer les données du site le supprime. Les statistiques ne sont pas des prix en temps réel : consulter la date et utiliser **↻** si une actualisation est autorisée et nécessaire.

| Symptôme | À vérifier |
| --- | --- |
| Aucun encart | Script et extension actifs, accès à `www.wiki-masters.com`, page rechargée et bon navigateur. Sur Chrome/Edge, vérifier l'autorisation des scripts utilisateur. |
| Seulement du code à l'installation | Utiliser la création manuelle dans Tampermonkey ; sur iOS, ouvrir Userscripts depuis le menu Safari sur la page du fichier. |
| Prix en pause | Lire le message. Un `Retry-After` actif ne peut pas être raccourci. Le bouton **Reprendre le chargement** ne vaut pas autorisation du service et ne doit pas servir à contourner un refus explicite. |
| « Web Locks indisponible » | Mettre à jour le navigateur. Le chargement de prix est désactivé sans ce mécanisme de coordination. |
| Prix anciens ou manquants | Cache sans expiration, absence de ventes, accès refusé ou données indisponibles pour le compte. Le comportement non Pro n'a pas été validé. |
| Redirection revenue après une mise en vente | Le site a peut-être changé. Le script garde le flux natif si son adaptation ne reconnaît plus la structure du formulaire. |

### Contrôler la synchronisation

Le bandeau de collection propose un interrupteur **Synchronisation des prix** et un curseur **Délai après chaque réponse**, de **1 à 30 secondes**, par pas de 0,5 seconde ; le réglage initial est d'une seconde.

Exemple : avec un délai de 3 secondes et une réponse de la carte A qui prend 2 secondes, la carte B pourra partir au plus tôt 5 secondes après le départ de A. Le corps JSON doit être entièrement reçu avant que l'attente commence. Si le délai change pendant l'attente, le temps déjà écoulé depuis la dernière réponse est conservé.

Désactiver la synchronisation empêche les prochains appels du script, y compris les actualisations ↻. Une requête déjà en cours termine et alimente le cache ; les consultations natives du site continuent normalement. Réactiver reprend les prix manquants visibles en respectant le délai restant et les pauses serveur. Cela ne lève pas un arrêt `automation_limit` : le bouton de reprise existant reste distinct.

La case **Passer automatiquement à la page suivante** est décochée par défaut. Une fois activée, le script traite **uniquement les cartes visibles dans la fenêtre**, une par une, puis clique sur **Suivant** quand leurs prix sont en cache. Il attend la réponse et l'affichage de la nouvelle page avant de recommencer. Il part de la page actuelle, conserve les filtres et s'arrête à la dernière page ; il ne revient pas au début. Il ne fait pas défiler la grille pour chercher les cartes hors écran : **celles-ci restent volontairement non chargées**. Le défilement habituel déclenché par le bouton natif reste celui du site.

Le délai choisi s'applique aussi avant le clic sur **Suivant** et après le chargement de la page, même lorsque ses prix sont déjà en cache. Une fenêtre de carte ouverte suspend le passage automatique. Décocher l'option arrête les prochains changements de page ; l'interrupteur général arrête aussi les prochains chargements de prix. Une navigation en cours peut se terminer. Un échec de navigation arrête le parcours et affiche le bouton **Reprendre le chargement**, toujours soumis aux pauses serveur.

**Le traitement continue quand l'onglet Collection reste ouvert en arrière-plan**, y compris les clics sur **Suivant** si l'option est cochée. La sélection reste limitée aux cartes dans la zone affichée de cet onglet, sans charger celles hors écran. Le cache, le délai minimal après chaque réponse, le verrou entre onglets et les pauses serveur restent actifs. Fermer l'onglet ou naviguer vers une autre page dans cet onglet arrête le traitement : garder la collection ouverte et utiliser un autre onglet pour naviguer ailleurs.

Le script ne peut pas garantir une cadence exacte en arrière-plan : les navigateurs peuvent retarder les timers, voire suspendre l'onglet. Le délai choisi est un **minimum**, sans rattrapage par rafale au retour. Voir la [documentation Chrome sur les timers d'arrière-plan](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) et les [politiques de visibilité des navigateurs](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#policies_in_place_to_aid_background_page_performance).

L'interrupteur, le délai et la case de pagination sont conservés entre visites et partagés entre les onglets du même navigateur. Le bandeau indique aussi la carte ou la page chargée dans un autre onglet. Après mise à jour, recharger les anciens onglets pour qu'ils utilisent tous cette coordination. Les états **À jour**, **Désactivée**, **En cours**, **En attente** et **En pause** restent affichés même quand aucun appel n'est lancé.

## Confidentialité et limites

Pas de compte supplémentaire, de télémétrie ni de serveur du projet recevant la collection. Les données du jeu restent dans le navigateur et les requêtes utilisent la session WikiMasters existante. GitHub sert les fichiers d'installation et de mise à jour.

Le script dépend de l'interface et de détails internes de React qui peuvent changer. Les règles du service et les contrôles de son API restent applicables. Lire [NOTICE.md](NOTICE.md) pour les risques, les responsabilités, les modifications par des tiers et la portée de la licence.

## Développement et vérifications

Node.js 22 ou plus récent :

```sh
npm ci
npx playwright install chromium
npm test
```

Les cinq suites utilisent des pages isolées et des réponses réseau simulées. Elles couvrent les prix, les notifications, les enchères, les réglages de synchronisation et la pagination. Les contrôles vérifient notamment les réponses lentes dont le corps arrive après les en-têtes, le délai entre deux onglets, les réglages persistants, l'arrêt pendant une requête, les pauses serveur et le parcours des seules cartes visibles sans double clic sur **Suivant**. La visibilité et les retards de timers sont simulés pour vérifier le traitement en arrière-plan ; ils ne reproduisent pas toutes les politiques d'économie d'énergie des navigateurs. Aucun compte WikiMasters n'est nécessaire et aucune enchère réelle n'est créée.

Une vérification séparée sur l'interface réelle avec soumission simulée a également contrôlé la conservation de la page, des filtres et des autres cartes. Les extensions elles-mêmes et les installations physiques Android/iOS restent à valider ; un écran de 390 px n'est pas un test sur téléphone.

## Licence

[MIT](LICENSE). Copyright © 2026 maxime-lalo. La [notice en français](NOTICE.md) explique les garanties, les responsabilités et les règles applicables au service tiers ; elle ne remplace pas la licence et ne garantit pas une immunité juridique.
