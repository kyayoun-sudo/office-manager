# Simulation — étape 3 : journal des échanges et des corrections (2026-11-21)

Suite de `2026-11-18-simulation-cabinet-design.md` (§9, point 3). Validé par Paul le 2026-11-21 (conception en conversation).

## But
Garder, pour chaque simulation, ce que les personnes ont demandé aux agents, ce que les agents ont répondu, et ce que les personnes ont corrigé.
C'est la matière de l'étape 4 (leçons génériques validées par un associé) ; l'étape 3 ne fait AUCUNE extraction ni transfert.

## Décisions de Paul
- Contenu : consignes, réponses des agents, corrections. PAS le raisonnement de l'IA (laissé à l'étape 4).
- Lecteurs : propriétaire de la simulation ; propriétaires / associés du cabinet parent (sans entrer dans la simulation) ; tout participant voit ses propres entrées.

## Conception
- Table `office_simulation_journal` (`db/simulation-journal.sql`, dans `INSTALL_TOUT.sql`) : `org_id` (la simulation), `at`, `actor_id`, `actor_email`, `agent`, `mission_id`, `kind` (`consigne` | `reponse` | `correction`), `body` (≤ 4 000 caractères), `ref` (type d'événement d'audit ou id d'exécution). RLS sans politique (service_role). Jamais modifiée par le code ; effacée par `office_purge_firm` (colonne `org_id`).
- `lib/simulation-journal.js` : `recordJournal` n'écrit QUE si le cabinet est une simulation lue sans erreur (`primeOrgKind`) ; ne lève jamais ; un cabinet réel n'écrit rien. `readJournal` applique les droits ci-dessus, filtres agent / mission / type, pagination par `before`.
- Capture : chat `/api/agent` (consigne puis réponse) ; corrections via `audit()` (`lib/audit-log.js`) pour une liste fermée de types + tout événement `rejected`.
- Route `simulation`, GET `?journal=<org_id>` ; `listSimulations` rend aussi les simulations d'un propriétaire / associé du parent non membres (`member: false`, sans bouton « Entrer »).
- Écran : bouton « Journal » par simulation (`assets/simulation.js`), liste chronologique en lecture seule, textes posés par `textContent`.

## Limites
- Le texte peut contenir des données de client : il reste dans la simulation, jamais envoyé à l'extérieur, effacé avec elle.
- Non essayé avec un vrai serveur, une vraie IA ni un navigateur.
