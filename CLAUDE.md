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

## Conformité à l'architecture (état au 2026-10-09) — on avance brique par brique

| Section | État | Ce qui existe / ce qui manque |
|---|---|---|
| §1-3 Données chez le cabinet, référence d'abord | ✅ | Drive/Gmail restent la source ; base = ids, liens, statuts, décisions. |
| §5-7 Changements, curseur, fallback | 🟡 | Par date (`changedSince`), pas encore curseur `changes.list` ni webhook Drive. |
| §8-10 Connecteurs abstraits | 🟡 | `drive-adapter` + `agent-mail` ; certains modules appellent encore Google directement ; pas de connecteur agenda. |
| §11-14 Event bus + idempotence | 🟡 brique 1 posée | `office_events` + `lib/event-bus.js`. Événements actifs : `DOCUMENT_CLASSIFIED`, `NEEDS_HUMAN_CLASSIFICATION`, `POSSIBLE_DUPLICATE` (Orpailleur → Mission Controller, `lib/mission-events.js`). Les autres agents restent à brancher. |
| §15-16 Workflow engine, gates | ❌ | « À valider » sépare déjà proposition et autorité ; pas encore d'étapes/gates de mission. |
| §17-23 Petites mémoires d'agents | 🟡 | Existent (MEMORY/AGENTS, TIDY_STATE, checkpoint Supabase), champs pas encore alignés sur la spec. |
| §24 Zone `_OFFICE_MANAGER` par mission | 🟡 | Mémoire client/mission existe ; pas encore MISSION_STATE / DECISION_LOG / ARCHIVE_MANIFEST par mission. |
| §26-27 PBC Service unique | ❌ prochaine brique | Le Mission Controller reçoit les pièces avec `pbc_status` (RECEIVED_REVIEW_REQUIRED / PARTIAL / UNMATCHED) dans `OFFICE_MANAGER_MISSION_FILES.json` ; la checklist Excel n'est pas encore mise à jour (ni population attendue 1/5, ni `DRIVE_SYNC = PENDING`). |
| §28-32 Gmail push, thread mapping PBC | ❌ | Lecture des mails étiquetés par passage ; pas de watch Gmail ni de mapping fil → PBC. |
| §34-35 Orpailleur, incertitude | ✅ | Lecture réelle (PDF, scans), question ciblée, 00_A_REVOIR_AGENT, vérification Drive, doublons. |
| §38-41 Sign-off | 🟡 | Lié à la version (date de modification) et à l'ouverture du fichier ; pas de révision/hash ni détection auto de modification après signature. |
| §51 Isolement des cabinets | 🟡 | RLS activé sans policy (service_role seul) ; un déploiement = un cabinet (`DEFAULT_ORG_ID`). |
| §53-54 Secrets | ✅ | Jetons chiffrés AES-GCM ; rien dans le navigateur. |
| §55-56 Permissions par appel d'outil, outils par agent | ❌ | Interrupteur global « autoriser les agents » seulement. |
| §5 / §58 Rôles | ❌ | 4 rôles en base (owner, partner, manager, collaborator) ; manquent auditor, senior, supervisor, EQR, secrétaire ; pas de vue « mes missions ». |
| §66-70 Archivage | ❌ | `MISSION_READY_FOR_ARCHIVE` est routé vers l'Orpailleur dans le bus, mais l'archive pass n'existe pas. |
| §57-61 Tool Gateway / MCP ChatGPT | ❌ reporté | « Mon IA », plus tard. |

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
