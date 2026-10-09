# Office Manager AI — à lire avant toute modification

Projet de Paul KOMENAN (cabinet TATY & Associés). Ce fichier est la mémoire de projet de Claude :
il est lu au début de chaque session. La pensée générale du produit est dans `docs/architecture/` et
**ne doit jamais être modifiée par du code** : on consolide l'existant, on ne reconstruit pas.

- `docs/architecture/01_SPECIFICATION_PRODUIT.md` — vision, agents, rôles, workflow de bout en bout.
- `docs/architecture/02_ARCHITECTURE_TECHNIQUE.md` — plans de données, connecteurs, événements, mémoire, sécurité.
- `docs/architecture/03_ORPAILLEUR_METIER.md` — l'Orpailleur décrit par lui-même (production ChatGPT).

## Les principes qui ne bougent pas

1. **Evidence before assumption.** Un nom de fichier ou de dossier n'est pas une preuve : on lit le contenu.
2. **L'humain garde le jugement professionnel.** L'IA propose ; acceptation client, indépendance,
   matérialité, conclusions, sign-off, opinion, émission du rapport, staffing et RH restent humains.
   Une recommandation de l'IA n'est jamais une approbation (« AI does not equal authority »).
3. **Une seule vérité opérationnelle.** Pas de mémoires ni de registres parallèles et contradictoires.
4. **Pas de travail invisible.** Toute action importante est tracée (audit log) : pourquoi, qui, quand, sur quelle preuve.
5. **Reference first — content on demand.** Les documents, emails, CV restent chez le cabinet (Drive, Gmail).
   Office Manager garde identifiants, liens, statuts, relations, événements, versions/hash, décisions,
   petites mémoires. Le contenu est lu au moment où l'IA en a besoin, puis le buffer est jeté.
6. **On ne rescane pas tout.** On travaille sur les changements depuis le dernier passage (curseur / heure).
7. **Idempotence.** Rien n'est créé deux fois (missions, dossiers, PBC, emails). Doublon possible →
   `POSSIBLE DUPLICATE — REVIEW REQUIRED`, jamais une création silencieuse.
8. **« Je ne peux pas encore le prouver »** plutôt que transformer une incertitude en fait. Un statut
   `SENT` / « vérifié » / « terminé » n'existe que si l'action a réellement réussi et a été contrôlée.
9. **Rien n'est supprimé ni écrasé** : pas de suppression de fichiers métier, deux versions gardées si même nom.
10. **Aucun agent n'élève ses propres droits** ; aucun secret dans le frontend ni dans les tables métier.

## Comment les briques s'emboîtent (et où elles sont dans le code)

```
Supabase cron (office-manager-unified-scheduler, */5)
  → Edge Function office-manager-scheduler-bridge (secret x-scheduler-secret)
  → Vercel  /api/app?route=scheduler-tick  → lib/agent-passes.js tick()
  → passages dus seulement (clé org+agent+créneau, une seule fois) → agents du tenant DEFAULT_ORG_ID
```

| Plan / brique | Rôle | Code actuel |
|---|---|---|
| Customer data plane | Drive, Gmail, Excel, PDF, scans : là où vivent les preuves | Drive du cabinet (`00_TATY_AI_MANAGER`, `01_CLIENTS_ET_MISSIONS`…) |
| Document connector | lire, lister les changements, déplacer, renommer | `lib/drive-adapter.js`, `lib/google-drive.js`, `lib/tidy-drive.js` |
| Mail connector | fils, envoi réel, Message ID | `lib/agent-mail.js` (client = brouillon validé dans « À valider ») |
| Control plane (petite mémoire) | statuts, liens, décisions, audit | Supabase `office_*` (`db/*.sql`), `lib/audit-log.js` |
| Workflow authority | l'IA propose, l'humain valide, puis exécution | `office_action_queue` + `lib/action-decisions.js` + `lib/action-executor.js` (« À valider ») |
| Firm Manager (Firm Intelligence) | portefeuille, personnes, capacité, KPI, staffing proposé | `agents/index.js`, `lib/people-*.js`, `lib/capabilities.js`, `lib/firm-members.js`, `lib/cockpit.js` |
| Mission Controller (Mission Intelligence) | cycle de vie d'une mission, PBC, échéances, gates | `lib/mission-*.js`, `lib/engagement-prep.js` |
| Enhanced Auditor (Audit Intelligence) | risques, WP, preuves, revue — ne signe jamais | `lib/enhanced-auditor.js`, `lib/auditor-plus.js` |
| Orpailleur (Document Intelligence) | Detect → Read → Understand → Attach → Name → File → Verify → Remember | `lib/tidy-plan.js` (le cerveau), `lib/orpailleur-ask.js`, `lib/orpailleur-journal.js`, `lib/mapping-scan.js` |
| Sika | honoraires, factures, encaissements (annoncé ≠ vérifié) | passages `sika` dans `lib/agent-passes.js` |
| Shadow | labo d'apprentissage, leçons validées par un humain | `lib/shadow.js` (propriétaire seulement) |

**Mémoires** — petite mémoire structurée dans Office Manager, grande mémoire documentaire chez le cabinet :
- Orpailleur : mémoire complète `OFFICE_MANAGER_TIDY_STATE.json` dans `00_TATY_AI_MANAGER/MEMORY`
  (heure du dernier passage, vu, étape de chaque fichier, questions/réponses, passages), journal unique
  `ORPAILLEUR_JOURNAL.xlsx` réécrit à chaque passage, et une seule ligne dans Supabase
  (`office_agent_checkpoints`) en secours. Mise à jour en place, jamais un nouveau fichier par passage.
- Autres agents : `MEMORY/AGENTS` (`lib/agent-memory.js`), mémoire client/mission `MEMORY/CLIENTS`.

**Ancien cerveau à ne pas remettre au centre** : `supabase/functions/orpailleur-durable-worker` et `index.ts`
(ancien tenant `cd95cc4f…`, ancien Drive). Un scanner peut alimenter le moteur, jamais décider à sa place.
Depuis le 2026-10-09, un passage sans Drive du cabinet échoue honnêtement (`FIRM_DRIVE_NOT_LOADED`) au lieu de
relancer l'ancien moteur ; celui-ci n'est réactivable qu'explicitement (`ORPAILLEUR_LEGACY_PASS=true`).
Le pont `taty-google-bridge` garde un tenant par défaut ancien si `DEFAULT_ORG_ID` manque côté Supabase : à vérifier
dans les secrets de la fonction avant tout redéploiement (non modifié dans le dépôt, le déployé peut différer).

## Écarts connus avec l'architecture cible (à faire en étendant, pas en réécrivant)

- Pas encore de vrai event bus : les échanges passent par la file d'actions, l'audit log et les passages.
- Changements Drive par date (`changedSince`), pas encore par curseur `changes.list` + webhook.
- Pas encore de « PBC Service » unique ni de statut PBC à population attendue (PARTIAL 1/5).
- Pas encore d'événement `DOCUMENT_CLASSIFIED` de l'Orpailleur vers le Mission Controller.
- Archive pass / manifest / freeze non implémentés.
- MCP / passerelle ChatGPT (« Mon IA ») : reporté, à faire via un Tool Gateway avec permissions.

## Règles de travail

- Branche de travail : `feature/white-label-desktop`. Ne pas toucher `main`, `amelioration`,
  `fix/map-register-bridge-write` (environnement de test isolé) sans accord.
- « EXTEND, DO NOT REBUILD » : ajouter sans casser ce qui est fait ; montrer le plan pour les gros changements.
- Production : la promotion est faite par Paul. Ne jamais définir `OFFICE_MANAGER_TEST_RUN` en production.
- Ne jamais taper un mot de passe, lire ou déchiffrer un secret. Pas de contournement d'un blocage de sécurité.
- Le document « gestion des personnes » de TATY n'est jamais commité.
- Vercel Hobby : 12 fonctions max dans `api/` — toute nouvelle route passe par `api/app.js`.
- Fichiers en CRLF (agents/index.js, lib/orchestrator.js, lib/supabase.js, lib/mission-dossier.js,
  tests/architecture.test.js, index.html) : éditer en conservant les fins de ligne.
- `npm test` doit passer avant chaque commit.
