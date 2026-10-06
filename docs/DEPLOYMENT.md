# Déploiement préparé, sans souscription

Publication convenue : charger le contenu décompressé du paquet de fichiers modifiés sur la branche `fix/map-register-bridge-write` avec **Add file → Upload files**, en gardant les dossiers. Le paquet inclut les modifications locales d'hier, non présentes sur la branche distante vérifiée au commit `5fc31ecd`. Ne pas déposer le ZIP lui-même, ne pas aplatir les dossiers et ne pas fusionner dans `main`.

Validation de cette reprise : 107 tests Node réussis et script SQL vérifié localement avec données fictives. Les versions des dépendances correspondent à celles installées lors du travail d'hier et sont maintenant verrouillées.

## Ordre

1. Examiner le diff et les tests. Sauvegarder les définitions des deux fonctions SQL actuelles avec les outils internes, sans export de profils.
2. Appliquer `db/people-intelligence.sql` dans le projet Supabase existant. C'est un script de livraison transactionnel et réexécutable, pas une copie de l'historique de migrations. Ne pas réappliquer les migrations RH originales : elles contiennent les données privées. Pour gérer une nouvelle migration avec le CLI, créer le fichier avec `supabase migration new` puis y reprendre le script examiné.
3. Vérifier les droits des deux tables et du RPC, les contraintes et le déclencheur; essayer une mission fictive dans une transaction annulée. Le script ne rétrotraite pas les missions ni les anciennes recommandations. Les nouvelles missions et changements de nom/code bénéficieront du nouveau déclencheur.
4. Déployer ensuite l'application Vercel existante. Aucun nouveau projet, abonnement, branche Supabase payante, service ou fournisseur n'est nécessaire. Conserver les variables serveur existantes et les secrets. Le patch n'ajoute aucun appel IA ou Google.
5. Tester `/api/health`, le rejet d'un token invalide, puis `/api/people` avec une mission autorisée. Consulter Orpailleur en mode status uniquement. Ne pas lancer de scan, déplacement ou scheduler pour la vérification.

Le dépôt ne dispose pas d'une configuration Vercel locale liée ni des secrets de runtime. La recette déployée et l'absence de régression en production restent à confirmer. Ne pas fusionner automatiquement : la branche principale peut déclencher un déploiement.

## Exigences techniques

Renseigner `required_skills` dans `office_mission_people_requirements` dans l'administration Supabase autorisée. Un tableau vide produit une vérification technique UNKNOWN. La disponibilité demeure à confirmer avec le planning et la capacité réelle avant validation humaine.

## Retour arrière

Revenir au précédent déploiement Vercel, puis restaurer les définitions SQL sauvegardées si nécessaire. Ne supprimer aucune table ni donnée RH. Le script est additif et ne remplace ni cron ni Edge Functions. Les actions approuvées sont conservées.

## Point de sécurité préexistant

`office_business_packs`, `office_mission_lifecycle_events` et `office_template_registry` ont RLS désactivée et accordent SELECT à `anon` et `authenticated`. Cela expose leur contenu via la Data API. Définir les politiques appropriées avant activation de RLS; ne pas lancer aveuglément une modification qui couperait les usages actuels. Voir https://supabase.com/docs/guides/database/postgres/row-level-security.

SQL à examiner après définition des politiques :

```sql
alter table public.office_business_packs enable row level security;
alter table public.office_mission_lifecycle_events enable row level security;
alter table public.office_template_registry enable row level security;
```

Ce changement n'est pas exécuté ni inclus dans le script People Intelligence.
