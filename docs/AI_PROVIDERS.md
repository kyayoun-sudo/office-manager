# Fournisseurs IA des agents — 21 octobre 2026

Les agents existants utilisent la configuration centrale de `lib/ai-providers.js`, via `firstAvailable`, `runAI` et le moteur opérationnel Agents SDK. Leurs outils, permissions et responsabilités restent ceux de l'application. Ce raccordement ne crée pas de spécialiste dans le Specialist Registry et n'exige aucune migration SQL.

| Fournisseur | Clé serveur | Modèle configurable | Modèle par défaut |
|---|---|---|---|
| Mistral | MISTRAL_API_KEY | MISTRAL_MODEL | mistral-small-latest |
| Hugging Face | HUGGINGFACE_API_KEY (alias HF_TOKEN) | HUGGINGFACE_MODEL (alias HF_MODEL) | openai/gpt-oss-120b |
| Groq | GROQ_API_KEY | GROQ_MODEL | llama-3.3-70b-versatile |

OpenAI, Claude, Gemini et OpenRouter conservent leurs connexions existantes. Les nouveaux transports utilisent les endpoints officiels fixes Chat Completions, sans URL arbitraire dans une variable.

## Répartition et limites

`MISTRAL_SHARE`, `HUGGINGFACE_SHARE`, `GROQ_SHARE` (alias historique exact `Groq_SHARE`) et `OPENROUTER_SHARE` définissent des parts disjointes de première sélection, parmi les requêtes compatibles. Les nouveaux fournisseurs ont 0 % par défaut sans variable SHARE mais peuvent servir de repli. OpenRouter garde son défaut historique de 45 %. Les parts sont bornées entre 0 et 100 ; si la somme des parts disponibles dépasse 100, elles sont normalisées. Une clé absente ne prend aucune part. Le reste suit le fournisseur principal habituel. Ce ne sont pas des quotas de facturation.

Les appels texte ont un repli vers les fournisseurs configurés. Un choix explicite ne change pas silencieusement de fournisseur. La revue indépendante Claude pour les travaux à risque élevé reste en place.

Dans le moteur opérationnel, un fournisseur et son modèle sont fixés pour la durée d'une exécution et ses consultations internes. Les outils continuent à être exécutés et leurs arguments validés côté serveur. La dialectique OpenAI de schéma strict n'est pas imposée aux endpoints compatibles ; cela ne supprime pas les contrôles applicatifs. Les traces SDK vers OpenAI sont désactivées pour ces fournisseurs tiers. Une exécution opérationnelle échouée n'est pas rejouée automatiquement avec ses outils, afin d'éviter des actions en double.

Ces modèles par défaut sont traités comme des modèles de conversation et d'outils. Les appels `firstAvailable` avec PDF, image ou recherche web native les excluent ; un appel explicite incompatible est refusé au lieu d'ignorer les pièces. Le texte déjà extrait d'un document peut être analysé. Les réponses textuelles tronquées des nouveaux endpoints sont refusées, et aucune source web n'est inventée.

## Configuration constatée dans Vercel

Vérification des noms, cibles et valeurs de répartition seulement, sans lecture des clés secrètes : Mistral et Hugging Face sont en Preview et Production ; Groq est uniquement en Production. Répartition configurée : OpenRouter 10 %, Mistral 15 %, Hugging Face 15 %, Groq 10 %. Les variables de modèle des trois nouveaux fournisseurs étaient absentes ; les valeurs par défaut ci-dessus s'appliquent.

Pour utiliser Groq sur le lien de Preview, ajouter sa clé à Preview depuis Vercel. Les changements de variables nécessitent un nouveau déploiement pour être reçus par l'application. Aucune clé n'est copiée d'un environnement vers l'autre par ce changement.

La présence d'une variable prouve la configuration, pas la validité d'une clé, le crédit disponible ou l'accessibilité réelle d'un modèle. Les tests automatisés utilisent des réponses simulées, dont un parcours SDK complet outil → résultat → réponse pour chacun des trois fournisseurs. Une recette réelle reste nécessaire sur le déploiement avec ses secrets serveur.

Références officielles consultées : [Mistral Chat](https://docs.mistral.ai/api), [Groq Llama 3.3](https://console.groq.com/docs/model/llama-3.3-70b-versatile), [Hugging Face Chat Completion](https://huggingface.co/docs/inference-providers/tasks/chat-completion).

## Correction du 21 octobre — laboratoire et GL
Groq est maintenant aussi configure en Preview. EYNOWA_LAB_URL et EYNOWA_LAB_API_KEY raccordent le laboratoire authentifie via /ai/local-chat. EYNOWA_LAB_SHARE pilote sa part de conversation texte ; les outils operationnels restent sur les fournisseurs qui prennent en charge leur contrat. Le laboratoire ne recoit ni outils arbitraires ni PDF sur ce chemin. diagnostic-ia.html teste un message fictif avec les secrets serveur, pour les administrateurs seulement.
Les GL .xls deja recus sont lus sans execution de macros, sans modifier les sources. Les classeurs .xlsx de destination gardent leurs formules et les confirmations humaines.
