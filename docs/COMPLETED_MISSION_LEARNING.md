# Apprendre de cinq missions terminées

Demandé par Paul le 27 octobre 2026. Ce parcours complète les connexions et l’entraînement existants ; il ne remplace ni l’entraînement personnel (`apprentissage.html`), ni le cabinet virtuel.

## Parcours

Après la connexion du Drive, le propriétaire ou un associé voit une invitation sur l’accueil, dans Mise en service et dans Entraînement. La page `missions-terminees.html` permet de choisir cinq dossiers du Drive du cabinet. On peut commencer avec une mission et compléter ensuite. Le dépôt des pièces s’effectue dans le Drive connecté ; cette page n’ajoute pas un second système de téléversement.

La personne atteste que la mission est terminée. Un dossier déjà lié à une mission clôturée/archivée est réutilisé. Sinon un identifiant déterministe cabinet+dossier permet d’inscrire une mission clôturée, sans démarrer d’engagement actif ni copier/modifier les pièces. Une mission en cours ou annulée n’est pas acceptée comme exemple terminé. L’ascendance du dossier doit rejoindre le Drive choisi ; une référence extérieure est refusée. Les autorisations de traitement IA existantes doivent être accordées.

Un passage parcourt un dossier, effectue une lecture demandée, ou consulte l’IA. L’IA dispose du catalogue paginé de toutes les pièces découvertes, sans exclusion de nom/extension, puis demande pages, feuilles, cellules et plages par le lecteur commun. La navigation poursuit vingt passages au maximum, avec reprise explicite. Au moins une lecture réussie de chaque pièce est nécessaire avant la proposition finale ; cela ne signifie pas que toutes les pages ont été lues. Un document illisible, une archive non prise en charge ou une couverture insuffisante restent à résoudre, jamais des pièces « apprises ».

Les leçons proposées comportent agent, méthode, coordonnées, version et courte citation retrouvée dans une fenêtre réellement lue. Les sources sont contrôlées à chaque reprise et avant validation. Une modification impose de recommencer. Les fenêtres de texte temporaires sont retirées de l’état après l’analyse. La personne revoit la synthèse, les questions et les preuves avant de valider. Le classement et les écritures dans les working files ne sont pas exécutés par cet exercice.

## Deux niveaux de mémoire locale

- **Centrale par agent dans le cabinet** : le registre existant de Shadow conserve les méthodes par agent. Elles restent propres à la mission par défaut. Une validation explicite permet de les appliquer au cabinet. Des leçons de missions différentes ne fusionnent plus par proximité de texte. Les passages SDK, le transport IA avec `agentKey` et la vue partagée `missionBrief` consultent les méthodes locales validées. Une erreur de lecture de mémoire reste exposée dans ce contexte.
- **Une mémoire partagée par mission** : la compréhension et les références aux documents sont enregistrées par `recordMissionDocuments` et `noteMission`, dans les registres canoniques et leurs vues existantes. Aucun nouveau registre documentaire parallèle n’est ajouté. Les agents retrouvent les informations utiles suivant leurs droits.

Le champ `completed_learning` du laboratoire existant contient les points de reprise de l’exercice, la synthèse à revoir et les reçus de contribution ; il n’est pas une troisième mémoire métier. Les écritures du laboratoire et de cet exercice partagent le verrou de registre. La récupération de copies préserve les points de reprise de même cabinet. Les protections de Shadow restent applicables aux leçons proposées.

## Contribution à EYNOWA Lab

L’apprentissage local ne transmet rien au centre. Après validation locale, la personne rédige et revoit un texte générique, confirme l’absence de données confidentielles puis voit exactement le texte préparé avant transmission distincte. Des contrôles supplémentaires refusent les liens, adresses e-mail et longues valeurs numériques ; ils ne constituent pas une anonymisation garantie. La revue humaine du contenu reste nécessaire.

Le serveur construit une enveloppe limitée : identifiant aléatoire stable et empreinte du texte, texte approuvé, collection `firm_manager_candidate_lessons` et métadonnées de schéma/statut candidat/finalité de revue centrale. Aucune pièce, citation source, identité du cabinet, identifiant de mission, nom d’approbateur ou coordonnées documentaires n’est ajouté à cette enveloppe.

Le connecteur existant `labSemanticMemoryStore` appelle le stockage sémantique du gateway Lab. La confirmation `stored:true` avec le bon identifiant est obligatoire. Les échecs restent visibles et réessayables avec le même identifiant ; une réponse absente n’est jamais un envoi réussi. Le stockage est une proposition pour revue centrale, ni une validation automatique, ni un fine-tuning du modèle.

**Limite de connexion connue :** le gateway direct existant permet ce stockage lorsqu’il est configuré. Le broker Cloudflare actuel n’expose que le chat, et le connecteur mémoire refuse de réactiver son ancien accès direct quand ce broker est configuré. Dans ce cas la page annonce que la connexion de mémoire centrale reste à configurer ; les leçons locales fonctionnent et une transmission tentée reste en échec visible. Ce changement n’installe pas un consommateur `semantic-store` dans un broker externe absent du dépôt.

## Vérification

Tests simulés : idempotence d’import, objectif de cinq dossiers, refus d’un dossier extérieur, mission en cours et autorisation manquante, pièces mal nommées, absence de finalisation sur une pièce non lue, preuves inventées, version modifiée, reprise périmée, promotion mission/cabinet, outils mémoire canoniques, erreurs de lecture, consommation des méthodes par agent, récupération des points de reprise, enveloppe de partage sans métadonnées client et reçu Lab obligatoire. Aucun dossier client réel ni service Lab réel n’a été appelé pour ces tests.

Limites : cinq exemples ne prouvent pas la généralité d’une méthode. Le parcours se limite aux dossiers explicitement présentés, 5 000 documents et 2 000 sous-dossiers par exemple. L’IA doit poursuivre les lectures pour les longues pièces ; le reçu initial reste marqué partiel. Les formats non lisibles doivent être rendus accessibles. Les droits, formules, décisions professionnelles et signatures des parcours de production restent inchangés. La validation réelle sur un cabinet connecté reste à faire.
