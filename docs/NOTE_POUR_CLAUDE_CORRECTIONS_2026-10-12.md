# Message pour Claude après la revue Codex du 12 octobre 2026

Paul a demandé de corriger les dix défauts de la revue sans reconstruire Office Manager ni changer ses parcours métier. Les corrections sont préparées sur deux branches distinctes :

- `fix/review-guardrails-white-label` cible `feature/white-label-desktop` : les dix corrections et leurs tests.
- `fix/review-guardrails-amelioration` cible `amelioration` : seulement les contrôles d'accès communs déjà applicables à cette branche. Les nouveaux modules d'audit et de secrétariat ne sont pas importés dans l'ancienne branche.

Les branches de construction, `main`, la base et les connexions du cabinet ne sont pas modifiées par cette préparation. Aucune fusion ni aucun déploiement de production ne fait partie de cette intervention.

## Corrections communes

1. Recherche, consultation d'une mission et lecture des actions exigent une session personnelle active. Le jeton pilote partagé reste utilisé par les appels internes existants ; il ne suffit plus à ouvrir ces données depuis un écran humain.
2. Les restrictions de Paramètres Droits sont contrôlées au serveur sur les routes couvertes, ainsi que dans les décisions de veille. Les familles de rôles existantes restent la règle par défaut. Un droit personnalisé ne donne pas automatiquement une nouvelle qualification de signature.
3. La vue mission et les recherches limitées à « mes missions » vérifient le staffing. Les documents sans rattachement prouvé à une mission autorisée sont exclus des recherches limitées. Les associés conservent leur accès global à la vue mission.

## Corrections propres à white label

- Manager et superviseur doivent appartenir à la mission pour modifier une procédure ; le préparateur nommé dans le programme et les associés gardent leur parcours. Lire un programme ou une revue ne dépend plus du seul grade global.
- Les procédures soumises ou revues refusent les modifications de contenu. Sur un travail renvoyé au préparateur, une correction révoque les anciennes signatures et rend l'écriture Excel obsolète. Si le fichier Excel change après une revue complète, ouvrir la revue la révoque et renvoie le travail au préparateur.
- Signer exige le Working Paper et une écriture du contenu actuel vérifiée par relecture, sans conflits. L'empreinte du contenu métier est conservée dans le JSON `wp_sync` existant ; aucun nouveau champ SQL.
- Le mode exhaustif sélectionne toutes les lignes de la population lue, y compris au-delà de 500. La limite générale du lecteur de population reste 20 000 lignes ; elle n'est pas élargie ici.
- Une nouvelle version de programme reçoit un fichier distinct suffixé par la version. Une association existante à un ancien fichier est vérifiée via `AUDIT_META` avant réutilisation ; l'ancien fichier reste intact.
- L'écriture Excel agrandit la table avant la conclusion, sans écraser les lignes de conclusion et de signature ni les cellules remplies par un humain. Les adresses des écritures antérieures sont décalées avec le pied de tableau.
- Modèles et CV vérifient l'autorisation du cabinet avant tout appel IA. Sans autorisation, préparation manuelle et PDF restent disponibles ; aucun contexte ne part au fournisseur.
- Une déclaration d'envoi sans preuve ne crée pas de dépôt vérifié, de date officielle de dépôt ni d'événement de réussite. Le secrétariat peut compléter la déclaration avec sa preuve dans le même écran.

## Vérifications et compatibilité

Les tests existants des parcours autorisés sont conservés. Les fixtures qui simulaient une signature d'un classeur vide ou un appel IA sans autorisation ont été mises en conformité. Des tests reproduisent les refus et les parcours de correction, la sélection de 501 lignes, l'agrandissement du tableau Excel, la séparation des versions, l'absence d'appel IA et le passage de déclaration à envoi avec preuve.

Résultats locaux : 538 tests passent sur white label et 473 sur amelioration.

Avant fusion, vérifier la recette réelle avec les sessions du cabinet : recherche limitée aux missions affectées, écriture puis revue d'une procédure, ajout de preuve dans le secrétariat. Aucun appel Drive/Gmail/IA réel n'a été fait pendant les tests locaux.

À conserver : une seule mémoire opérationnelle, aucun fichier métier supprimé, IA qui propose et humain qui décide. Les contrôles ajoutés n'achèvent pas la migration de toutes les anciennes routes ni des outils d'agents vers les permissions de la spécification. Ne pas considérer cette PR comme la réalisation complète de tous les rôles ISQM et gates métier.
