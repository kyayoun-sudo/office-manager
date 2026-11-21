# Simulation — étape 4 : leçons validées vers la mémoire du cabinet parent (2026-11-21)

Suite de `2026-11-18-simulation-cabinet-design.md` (§9, point 4) et de `2026-11-21-simulation-journal-design.md`. Validé par Paul le 2026-11-21.

## Décisions de Paul
- L'IA rédige des brouillons à partir du journal, une personne (le propriétaire de la simulation) les corrige, puis les envoie.
- Destination : l'agent concerné, dans le laboratoire Shadow du cabinet PARENT ; un associé valide par l'écran existant d'Entraînement.

## Conception (aucun nouveau SQL, aucun nouveau fichier `api/`)
- `lib/simulation-lessons.js`, actions `lessons-draft` et `lessons-send` de la route `simulation`. Propriétaire de la simulation seulement (`ownedSimulation`).
- `lessons-draft` : lit les 150 dernières entrées du journal, appelle l'IA DANS le contexte de la simulation (plafond d'IA de la simulation), rend au plus 8 brouillons (agent, catégorie, situation, leçon, règle, numéros d'entrées). Rien n'est stocké.
- `lessons-send` : revérifie chaque leçon (≤ 10 par envoi) puis l'écrit dans le laboratoire du parent par `mergeLesson` : `under_review`, `needs_owner`, type `hypothesis`, confiance basse, source `simulation:<id>`, preuves = identifiants d'entrées du journal (jamais leur texte). Plafond : 20 leçons en attente par simulation. Reçu : écrites / fusionnées / refusées avec la raison. Audit `SIMULATION_LESSONS_SENT` dans le parent.
- Contrôle « générique » (partiel, par le code) : refus si adresse e-mail, adresse web, nombre de 5 chiffres ou plus (ou montant avec séparateurs), nom de la simulation, nom ou adresse d'un membre, ou zone protégée (`touchesProtected`).
- Une leçon n'est appliquée par aucun agent tant qu'un associé ne l'a pas validée (`activeLessons`).

## Limites
- Un nom de client écrit en clair n'est pas détecté par le code : la relecture du propriétaire et la validation de l'associé sont le garde-fou.
- L'IA reçoit le texte du journal de la simulation (même exposition que le chat des agents).
- Rien n'est transmis à EYNOWA Lab (étape 5). Non essayé avec une vraie IA ni un vrai laboratoire.
