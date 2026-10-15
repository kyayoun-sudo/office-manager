# Dossier unique : AMI, offre, KYC, documents et mission

## Parcours

- AMI : préparation de la manifestation d'intérêt → envoi prouvé → attente de présélection → présélection documentée → réception de la demande de proposition/TDR → préparation de l'offre → envoi prouvé → résultat.
- Demande de proposition directe : préparation de l'offre → envoi prouvé → résultat.
- TDR seul ou anciens dossiers sans type certain : confirmation humaine du parcours. Aucun ancien dossier n'est classé arbitrairement en AMI.
- Attribution : contrat/lettre de mission à préparer, accord écrit du client à vérifier séparément, puis contrôles de démarrage existants. Une attribution n'est ni une signature ni une acceptation KYC.

L'avancement commercial est enregistré dans `commercial` sur l'opportunité existante. Il ne remplace ni les statuts métier antérieurs, ni le classeur, ni les décisions du management. Une non-sélection conserve le dossier et masque ses demandes actives.

## Travail en parallèle

L'équipe, la préparation du KYC, les déclarations personnelles et les documents avancent dans le même dossier. L'action « Préparer le KYC en parallèle » ouvre une préparation, sans enregistrer de décision de poursuite, d'acceptation ou de démarrage.

La vue d'ensemble montre les tâches, les informations préparées, les confirmations encore demandées et les propositions de risque. Le classeur complet reste accessible et modifiable selon les droits existants.

Les résultats des traitements IA longs (KYC, proposition d'équipe, analyse d'une nouvelle DDP) sont fusionnés dans leur partie du dossier : une décision ou une réponse humaine enregistrée pendant la recherche reste présente.

## Documents et secrétariat

La prochaine action est calculée depuis le dossier. Une MI n'est proposée que pour le parcours correspondant ; une DDP conduit à l'offre ; une attribution conduit à la lettre/au contrat. Un CV envoyé ne fait pas disparaître l'offre à préparer. Une déclaration d'envoi sans preuve ne fait pas avancer le parcours.

Depuis la mission liée, le secrétariat peut ouvrir cette prochaine action, le dossier d'origine et la préparation de la lettre de mission. Une mission sans lien certain conserve son interface actuelle ; aucune association n'est devinée.

Les liens préremplissent dossier, mission éventuelle et type de modèle. Les CV de tous les membres internes peuvent être préparés successivement ; les spécialistes externes gardent leur parcours existant de dépôt. Les erreurs individuelles sont affichées sans arrêter les autres CV.

Les modèles Word déjà présents peuvent être enregistrés par référence après confirmation de leur emplacement, sans nouvelle copie du modèle. Un changement de version impose une nouvelle confirmation. Les documents produits et les validations suivent le circuit existant.

## Cotation financière

Après validation de l'équipe, Mission Controller prépare la cotation en arrière-plan. Un bouton du dossier permet aussi de la lancer/reprendre. Le modèle est recherché dans l'index documentaire partagé sous le besoin `quotation_workbook` (recherche « cotation », puis « devis »).

- Le fichier attendu est le classeur `.xlsx` du cabinet avec ses tarifs et formules, pas un nouveau moteur de prix.
- Une copie identifiable est créée dans le dossier de l'opportunité, puis réutilisée.
- Seules les cellules d'entrée reconnues et encore vides sont proposées au remplissage ; toute écriture exige une source.
- Les jours, taux, frais, remises et taxes non établis restent à renseigner par le responsable.
- Les tarifs déjà renseignés, formules, réponses humaines et modèle d'origine sont conservés.
- Une modification concurrente du fichier fait refuser l'écriture ; il faut relancer la préparation.
- Si le modèle est absent/ambigu, son emplacement est demandé. Si ses entrées ne sont pas identifiables, aucune formule n'est modifiée : il faut préciser les entrées du modèle.
- « Préparé » signifie à relire ; aucun devis n'est approuvé ou envoyé automatiquement. Excel/Sheets recalcule les formules à l'ouverture.

## Emplacements nécessaires aux agents

Tous les agents et le coordinateur reçoivent le protocole commun : mémoire confirmée → recherche dans les documents/Drive → analyse du contenu → demande humaine si le choix reste incertain.

Les demandes non résolues sont conservées dans l'index documentaire existant. Un besoin commun crée une seule demande listant les agents concernés. La confirmation d'un fichier ou de son indisponibilité résout la demande. Une version modifiée nécessite une nouvelle confirmation. Les demandes du cabinet apparaissent au secrétariat et aux responsables ; les demandes de mission conservent leur lien de configuration et leur périmètre.

## Déclarations et accord client

Un membre peut sauvegarder son brouillon personnel et reprendre/corriger ses réponses avant certification. Le brouillon ne remplit pas le classeur et n'est exposé qu'au déclarant. Une déclaration certifiée demeure distincte du brouillon.

Un associé vérifie l'accord écrit du client, son signataire et sa version. Le contrôle ne démarre pas la mission. Pour les dossiers utilisant le nouveau parcours, le démarrage vérifie aussi l'attribution, la présence de cet accord et la stabilité du fichier examiné. Les contrôles d'acceptation existants restent en place.

## Conservation et intégration

Aucune migration SQL, aucun remplacement de classeur, aucune suppression de fichier métier. Les identifiants, liens, réponses, équipes, décisions et signatures existants restent utilisés. Aucun changement de mot de passe, OAuth, domaine ou configuration Vercel. La branche doit être revue avant fusion ; une nouvelle prévisualisation n'a pas automatiquement une adresse de retour autorisée par Google.

## Vérification

Les tests couvrent les deux entrées, les transitions prouvées, les droits, la conservation pendant les recherches parallèles, les brouillons, les demandes de fichiers partagées, l'enregistrement de modèles par référence et la protection des tarifs/formules du classeur de cotation.

Les écrans Opportunité → Secrétariat ont été contrôlés dans le navigateur avec des données fictives et sans erreur JavaScript. Les appels de production Drive, IA, courrier et signatures ne sont pas exécutés par cette recette locale ; la qualité du remplissage réel doit être examinée sur un dossier pilote autorisé après intégration.
