# Plan des deux gros chantiers — 30 octobre 2026

Règle du projet : « montrer le plan pour les gros changements ». Rien de ce qui suit n'est codé. Chaque étape = une branche
courte, des tests, `npm test` + CI verts, puis commit sur `feature/white-label-desktop`.

## Chantier B5 — « L'IA donne les ordres, le code exécute et vérifie », pour tous les agents

**État mesuré (30/10)** : le socle existe (`lib/agent-brain.js` `think()` : liste FERMÉE d'actions, `check` / `run` / `verify`,
`approval` = attend une personne ; `lib/agent-kernel.js` : boucle observer → penser → agir → vérifier). Seul le remplissage des
working files (Enhanced Auditor, `lib/fill-orders.js`) s'en sert vraiment. Les noyaux des autres agents enveloppent encore
leur ancien moteur (`work()`), où des choix sont faits par le code (mots-clés, positions) au lieu de l'IA.

**Ordre proposé** (celui de `CLAUDE.md`, du plus fréquent au plus rare) :

| # | Agent | Décision aujourd'hui prise par le code | Actions fermées proposées | Vérification par le code |
|---|---|---|---|---|
| 1 | Mission Controller | rattacher une pièce reçue à une demande PBC (`assignPiece` : suggestion de l'IA, une personne rattache) ; contacts du client | `attach_piece(request_id, file_id)` *approval* ; `propose_contact(email, role)` *approval* ; `note_missing(document)` | la pièce est dans `PIECES_RECUES` de la mission ; la demande est ouverte ; l'adresse vient d'un vrai message reçu |
| 2 | Orpailleur | la liste PBC reconnue (`lib/pbc-lists.js` : signature + mots d'en-tête) | `declare_pbc_list(file_id, header_row, columns)` *approval* | les colonnes nommées existent à cette ligne ; le fichier est bien dans le Drive choisi |
| 3 | Firm Manager | cases du classeur d'acceptation remplies depuis le TDR (`lib/acceptance-workbook.js`) | `fill_cell(sheet, cell, value, source_quote)` ; `ask(question)` | la case est vide et n'est pas une case de décision ; la citation est retrouvée mot pour mot dans le TDR |
| 4 | Sika | rapprochement facture ↔ encaissement | `match_payment(invoice, credit_line)` *approval* | montant et date retrouvés dans le relevé |

Chaque étape : l'ancien chemin reste le secours quand l'IA ne répond pas (comme aujourd'hui), jamais une décision du code à sa
place ; tests « IA répond / IA en panne / IA propose une action hors liste / IA cite un passage absent ».
**Ce qui reste non prouvé après coup** : la qualité des ordres de la vraie IA (à mesurer comme `docs/MESURER_LE_REMPLISSAGE.md`).

## Chantier B6 — Working files de n'importe quel cabinet

**État** : la carte du working file (`lib/workfile-map.js`) comprend tout modèle (feuilles, tableaux, rôle de chaque colonne,
cases d'identité) ; le remplissage des feuilles de données s'en sert. Restent attachés à la forme du fichier de base :

| # | Travail | Pourquoi | Comment |
|---|---|---|---|
| 1 | Carte gardée par version du modèle + validée par un Manager | aujourd'hui recalculée à chaque ouverture, jamais confirmée | `OFFICE_MANAGER_WORKFILE_MAPS.json` (clé `map.key` + version Drive), bouton « La carte est juste » ; une carte validée passe avant la carte calculée |
| 2 | ✅ FAIT le 30/10 — `writeWorkpaper` lit la carte | il écrit aux positions du fichier de base : la colonne « N° » peut être écrasée, la conclusion est cherchée sous le tableau | n'écrire que dans les colonnes que `mayWrite(map, …)` autorise ; conclusion = case d'identité « Conclusion » de la carte, sinon question |
| 3 | ✅ DÉJÀ FAIT (préparation de l'agent filtrée par `mayWrite`, `sop-document-work.js`) — `writableCell` respecte les jugements | les colonnes de jugement (✓ L/M/N de PRJ-05) sont écrites avant confirmation | refuser les colonnes `judgment` tant que la personne n'a pas confirmé |
| 4 | Tirage d'échantillon du fichier | `drawSample` tire un second échantillon même si le modèle a déjà le sien | lire le tirage du fichier quand la carte trouve une feuille d'échantillon ; tirer seulement sinon |
| 5 | Pièce rattachée à la ligne du test | la pièce d'un élément testé n'est liée qu'au test entier | `attach_piece(test, row, file_id)`, lien écrit dans la colonne « référence pièce » si la carte en a une |
| 6 | Agrandir un tableau sans casser les formules des autres feuilles | ExcelJS ne met pas à jour les formules des autres feuilles | réécriture contrôlée des références + recontrôle des totaux avant / après (déjà en partie dans `lib/workfile-extend.js`) |

Essai indispensable : un working file d'**un autre cabinet** (pas NL-T01), réel ou fidèle, avec la vraie IA.

## Ce qui n'est pas un chantier de code (décisions déjà prises le 30/10)

- **Invitations par e-mail** : gardé tel quel. Un cabinet qui vient de se créer n'a pas encore relié son Gmail ; « Envoyer par
  e-mail » ouvre la messagerie de la personne qui invite (le lien reste à usage unique, 7 jours). Envoi par la boîte du cabinet
  possible plus tard, une fois Gmail relié, en passant par « À valider ».
- **Retirer le code d'accès du navigateur** : à faire avec un essai de connexion sur l'aperçu (6 pages s'en servent pour savoir
  si l'on est connecté). Le serveur ne l'exige déjà plus quand une session est présente.
