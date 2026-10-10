OFFICE MANAGER AI

Architecture technique, connexions, mémoire et circulation des données

⸻

1. PRINCIPE D’ARCHITECTURE

Office Manager AI ne doit pas devenir un gigantesque entrepôt qui copie les Drive, les emails, les Excel, les CV et les dossiers d’audit de tous ses clients dans une base centrale.

Le principe architectural doit être :

The data stays with the firm.
Office Manager stores the intelligence required to orchestrate it.

Autrement dit :

Les documents restent chez le cabinet.

Les emails restent dans sa messagerie.

Les Working Papers restent dans son environnement documentaire.

Office Manager conserve principalement :

* les identifiants ;
* les liens ;
* les statuts ;
* les relations ;
* les événements ;
* les permissions ;
* les hashes/versions ;
* les décisions ;
* les petites mémoires opérationnelles.

Lorsque l’IA a besoin du contenu d’un document, elle le récupère à ce moment-là, dans la limite des permissions de l’utilisateur.

C’est une architecture :

REFERENCE FIRST — CONTENT ON DEMAND

et non :

COPY EVERYTHING INTO AI DATABASE

⸻

2. LES TROIS PLANS DU SYSTÈME

L’architecture comporte trois grandes couches.

A. CUSTOMER DATA PLANE

C’est chez le client.

Il contient :

* Google Drive / SharePoint / OneDrive ;
* Gmail / Outlook ;
* Excel ;
* Word ;
* PDF ;
* scans ;
* photos ;
* PBC ;
* Working Papers ;
* CV ;
* KYC ;
* dossiers d’indépendance ;
* rapports.

C’est là que vivent les preuves.

⸻

B. OFFICE MANAGER CONTROL PLANE

C’est la petite mémoire opérationnelle de l’application.

Elle contient principalement :

* Mission ID ;
* Client ID ;
* Staff ID ;
* Engagement stage ;
* Cycle status ;
* PBC status ;
* WP status ;
* Review points ;
* sign-offs ;
* deadlines ;
* assignments ;
* events ;
* document IDs ;
* URLs ;
* versions ;
* hashes ;
* permissions ;
* KPI agrégés.

Elle ne doit pas nécessairement conserver le contenu des documents.

⸻

C. INTELLIGENCE PLANE

C’est la couche IA.

Elle contient :

* Firm Manager ;
* Mission Controller ;
* Enhanced Auditor ;
* Orpailleur ;
* Sika ;
* Shadow ;
* orchestration ;
* prompts ;
* règles ;
* outils ;
* modèles IA.

Cette couche vient chercher uniquement ce dont elle a besoin.

⸻

3. LA RÈGLE ZERO-COPY

Par défaut :

Un Working Paper Excel

reste dans le Drive du client.

Dans Office Manager, on conserve seulement par exemple :

* WP_ID
* Drive_File_ID
* URL
* Engagement_ID
* Cycle_ID
* Preparer_ID
* Reviewer_ID
* Status
* Revision_ID
* Hash

⸻

Une lettre de mission

reste dans le Drive.

Office Manager conserve :

* document ID ;
* URL ;
* version ;
* status ;
* Partner approver ;
* Gmail Message ID.

⸻

Un email

reste dans Gmail.

Office Manager conserve :

* Thread ID ;
* Message ID ;
* Engagement ID ;
* direction ;
* date ;
* status ;
* éventuellement un très court résumé.

⸻

Une déclaration d’indépendance

reste idéalement dans un espace sécurisé appartenant au cabinet.

Office Manager peut seulement conserver :

Staff_ID 0042
Engagement ENG-2027-003
Clearance = COMPLETE
Date = 12/01/2027
Document = Drive ID XYZ

Il n’a pas nécessairement besoin de conserver toutes les réponses personnelles dans sa base.

⸻

4. LA CONNEXION AU DRIVE

Lors de l’installation, le cabinet connecte son espace documentaire.

Par exemple :

Connect Google Drive

ou :

Connect SharePoint

Puis il choisit la racine autorisée :

Audit Firm / Engagements

Office Manager n’a pas besoin de scanner l’ensemble du Drive personnel du Partner.

Il travaille dans les espaces autorisés.

Si le fournisseur ne permet pas techniquement de limiter le jeton OAuth exactement à un dossier, Office Manager applique malgré tout une allowlist interne :

Root allowed folder = X

Tout accès hors de cette racine est refusé par l’application.

⸻

5. NE PAS RESCANNER LE DRIVE EN PERMANENCE

C’est très important pour les coûts.

Office Manager ne doit pas faire :

Scan de 60 000 fichiers toutes les heures.

Il faut fonctionner principalement par changements.

Google Drive permet à une application de recevoir des notifications lorsqu’une ressource observée change. (Google for Developers)

Donc :

Auditeur modifie REV-04.xlsx
        ↓
Drive détecte le changement
        ↓
Webhook Office Manager
        ↓
FILE_CHANGED
        ↓
Office Manager identifie REV-04
        ↓
Enhanced Auditor peut être déclenché

L’agent ne relit donc que :

ce qui a changé.

⸻

6. LE CURSOR DE CHANGEMENT

Chaque connexion documentaire conserve une petite information :

last_change_cursor

Exemple :

Drive tenant ABC
last_change_cursor = 851727

Au passage suivant :

Office Manager demande :

Donne-moi uniquement ce qui s’est passé depuis 851727.

Cela réduit considérablement :

* réseau ;
* appels API ;
* tokens IA ;
* temps de calcul ;
* mémoire.

⸻

7. FALLBACK

Les notifications externes peuvent occasionnellement être ratées.

Donc on garde aussi un contrôle périodique léger :

vérifier les changements depuis le dernier cursor.

On ne rescane pas tout le Drive.

⸻

8. LE CONNECTOR LAYER

Les agents ne doivent pas connaître directement Google Drive, Microsoft ou Dropbox.

Ils utilisent une interface abstraite.

Par exemple :

DocumentConnector.search()
DocumentConnector.read()
DocumentConnector.listChanges()
DocumentConnector.create()
DocumentConnector.rename()
DocumentConnector.move()
DocumentConnector.getVersion()
DocumentConnector.getLink()

Ainsi, aujourd’hui :

Google Drive

demain :

SharePoint

sans réécrire Firm Manager ou Mission Controller.

⸻

9. MÊME PRINCIPE POUR L’EMAIL

On crée :

MailConnector.readThread()
MailConnector.getAttachment()
MailConnector.send()
MailConnector.createDraft()
MailConnector.search()

Firm Manager ne sait pas nécessairement si derrière se trouve :

* Gmail ;
* Outlook ;
* autre solution.

⸻

10. MÊME PRINCIPE POUR LE CALENDRIER

CalendarConnector.checkAvailability()
CalendarConnector.proposeMeeting()
CalendarConnector.createEvent()
CalendarConnector.updateEvent()

Cela permet à Mission Controller de proposer :

Kick-off mardi 10h

sans être dépendant de Google Calendar.

⸻

11. L’EVENT BUS : LE SYSTÈME NERVEUX

Les agents ne doivent pas s’appeler entre eux avec des conversations libres.

Ils doivent principalement échanger des événements structurés.

Exemple :

EVENT
type = PBC_DOCUMENT_RECEIVED
tenant = FIRM_023
engagement = ENG_2027_014
pbc = CASH_004
document = FILE_77182
source = GMAIL
occurred_at = ...

Le système regarde ensuite :

Qui doit réagir ?

Mission Controller.

⸻

12. FORMAT MINIMAL D’UN ÉVÉNEMENT

Un événement peut contenir :

event_id
tenant_id
engagement_id
actor_id
agent_id
event_type
object_type
object_id
source_reference
timestamp
idempotency_key
small_payload

Le small_payload doit rester petit.

Pas besoin d’y coller 80 pages d’un PDF.

⸻

13. EXEMPLES D’ÉVÉNEMENTS

TDR_UPLOADED
TEAM_PROPOSED
INDEPENDENCE_COMPLETED
ENGAGEMENT_APPROVED
ENGAGEMENT_LETTER_SENT
MISSION_CREATED
PRELIMINARY_DOCUMENT_RECEIVED
KICKOFF_COMPLETED
RISK_ASSESSMENT_VALIDATED
WORK_PROGRAMME_VALIDATED
PBC_REQUEST_SENT
PBC_DOCUMENT_RECEIVED
WP_CHANGED
WP_SUBMITTED
REVIEW_POINT_CREATED
WP_SIGNED_OFF
CYCLE_SIGNED_OFF
MISSION_READY_FOR_PARTNER_REVIEW
REPORT_ISSUED
MISSION_READY_FOR_ARCHIVE
MISSION_ARCHIVED

⸻

14. IDEMPOTENCY

Chaque événement important possède un identifiant unique.

Ainsi, si Google envoie deux fois :

FILE_CHANGED

l’application ne doit pas effectuer deux fois la même opération.

Elle reconnaît :

event déjà traité.

C’est essentiel pour empêcher :

* missions dupliquées ;
* PBC doublés ;
* dossiers recréés ;
* emails envoyés deux fois.

⸻

15. LE WORKFLOW ENGINE

Il faut séparer :

Agent Intelligence

et

Workflow Authority

Exemple :

Enhanced Auditor peut dire :

Revenue paraît terminé.

Mais Enhanced Auditor ne doit pas directement passer :

Revenue = COMPLETE.

Il produit :

RECOMMEND_READY_FOR_MANAGER_REVIEW

Mission Controller vérifie les règles.

Puis ouvre :

Manager Review

Le Manager signe.

Ensuite seulement :

REVENUE_MANAGER_SIGNED_OFF

Cette séparation empêche l’IA de s’auto-valider.

⸻

16. LES GATES

Exemple :

FIELDWORK
    ↓
Tous WP requis soumis ?
    ↓
Oui
    ↓
Enhanced Auditor review
    ↓
Manager review
    ↓
Review points fermés ?
    ↓
Oui
    ↓
Manager cycle sign-off
    ↓
NEXT GATE

Le workflow engine sait quelles conditions sont obligatoires.

⸻

17. MÉMOIRE LÉGÈRE DES AGENTS

Les agents ne doivent pas conserver d’énormes conversations comme mémoire.

Chaque agent possède une petite mémoire structurée.

⸻

18. MÉMOIRE FIRM MANAGER

Exemple :

active_engagements
staff_capacity
critical_alerts
pending_staffing_decisions
upcoming_deadlines
training_gaps
firm_kpi_snapshot
last_processed_event

Pas besoin de copier les CV complets.

Pour analyser un CV :

Firm Manager ouvre le CV à la demande.

⸻

19. MÉMOIRE MISSION CONTROLLER

Pour chaque mission :

engagement_id
current_stage
next_gate
team
deadlines
cycles
open_pbc
open_review_points
signoff_status
next_actions
last_pass_at
last_email_cursor
last_drive_cursor

Le document détaillé reste ailleurs.

⸻

20. MÉMOIRE ENHANCED AUDITOR

engagement_id
risk_ids
active_cycles
wp_status
open_findings
last_reviewed_document_version
uncovered_risks
open_technical_questions

Il ne conserve pas une copie permanente de tous les Working Papers.

⸻

21. MÉMOIRE ORPAILLEUR

last_drive_cursor
unclassified_documents
document_index_cursor
known_mappings
archive_status
last_pass

⸻

22. MÉMOIRE SIKA

engagement
fee
invoice_status
payment_status
due_date
follow_up_status

⸻

23. MÉMOIRE SHADOW

Shadow conserve :

* Lesson ID ;
* erreur type ;
* test ID ;
* score avant ;
* score après ;
* version agent.

Il n’a pas besoin de recopier les dossiers clients.

⸻

24. MÉMOIRE PORTABLE DANS LE DRIVE DU CLIENT

Pour rendre Office Manager portable et réellement contrôlé par le client, chaque mission peut également disposer d’une petite zone système.

Par exemple :

ENGAGEMENT XYZ
│
├── Audit files
├── Working Papers
├── Evidence
│
└── _OFFICE_MANAGER
      ├── PBC_CHECKLIST.xlsx
      ├── WORK_PROGRAMME.xlsx
      ├── MISSION_STATE.json
      ├── DECISION_LOG.jsonl
      └── ARCHIVE_MANIFEST.xlsx

Cette zone appartient au client.

Ainsi, si le client change de fournisseur logiciel :

ses données métier restent chez lui.

⸻

25. CE QUI EST DANS LA BASE ET CE QUI N’Y EST PAS

Database

Conserver :

ENG-001
stage = FIELDWORK
manager = STAFF-12
revenue_status = MANAGER_REVIEW
pbc_cash04 = PARTIAL
drive_file = 1abXYZ
revision = 23

Drive

Conserver :

* Excel ;
* pièces ;
* photos ;
* contrats ;
* Risk Assessment ;
* PBC Checklist ;
* rapport.

⸻

26. LA PBC CHECKLIST COMME MÉMOIRE DURABLE

La PBC Checklist reste un document appartenant au client.

Office Manager possède en parallèle une vue normalisée nécessaire à l’interface.

Exemple Drive :

PBC_CHECKLIST.xlsx

Exemple application :

PBC-CASH-04
expected = 5
received = 1
status = PARTIAL

Ce n’est pas deux PBC différents.

C’est la même information représentée sous deux formes.

⸻

27. SYNCHRONISATION PBC

Toute modification passe par un service unique :

PBC Service

Par exemple :

Mission Controller dit :

Update CASH-004 → 2/5.

Le PBC Service :

1. écrit l’événement ;
2. actualise l’état opérationnel ;
3. actualise le PBC Checklist ;
4. vérifie que l’écriture a réussi ;
5. incrémente la révision.

Si l’Excel ne peut pas être mis à jour :

PBC_STATE = 2/5
DRIVE_SYNC = PENDING

Il ne doit pas prétendre que tout est synchronisé.

⸻

28. RÉCEPTION PBC PAR EMAIL

C’est une des connexions les plus importantes.

Mission Controller envoie :

Request PBC CASH-004

L’email doit contenir des identifiants internes invisibles ou lisibles.

Exemple :

Engagement: ENG-2027-014
Request: REQ-0981
PBC: CASH-004

Le client n’a même pas besoin de comprendre ces IDs.

⸻

29. THREAD MAPPING

L’application conserve :

Gmail thread = THREAD-8872
Engagement = ENG-2027-014
PBC = CASH-004

Quand le client répond sur le même thread :

Mission Controller n’a pas besoin de demander à l’IA :

À quelle mission appartient cet email ?

Le thread le dit déjà.

L’IA intervient seulement si quelque chose est ambigu.

⸻

30. GMAIL PUSH

Gmail permet à une application backend d’être notifiée lorsqu’une boîte surveillée change, via son mécanisme watch et Pub/Sub. (Google for Developers)

Donc :

Client répond
    ↓
Gmail notification
    ↓
Mail Connector
    ↓
THREAD_CHANGED
    ↓
Mission Controller

Pas besoin de lire toutes les boîtes toutes les cinq minutes.

⸻

31. TRAITEMENT DES PIÈCES JOINTES

Lorsque Mission Controller détecte une pièce jointe :

1. elle est récupérée ;
2. elle est placée temporairement en mémoire ;
3. elle est analysée ;
4. son hash est calculé ;
5. elle est enregistrée directement dans le Drive du cabinet ;
6. le buffer temporaire est supprimé ;
7. Office Manager conserve le Drive ID.

Le serveur Office Manager ne doit pas devenir l’archive permanente du fichier.

⸻

32. EXEMPLE BANQUE

Email :

Veuillez trouver le relevé SGCI.

Mission Controller connaît :

ENG-2027-014
PBC CASH-004
Expected population = 5

Il ouvre la pièce.

Il identifie :

SGCI December 2026.

Il enregistre :

SGCI = RECEIVED
BICICI = MISSING
NSIA = MISSING
ECOBANK = MISSING
BOA = MISSING

PBC :

PARTIAL 1/5

Puis il demande éventuellement confirmation à l’auditeur.

⸻

33. RÉCEPTION PAR L’AUDITEUR

Deuxième scénario.

Auditeur prend une photo.

Dans l’application :

Add Evidence

Il choisit :

Mission ABC
Cycle Inventory

ou il laisse le système déterminer.

La photo est envoyée directement vers le repository du cabinet.

Office Manager récupère seulement :

File ID.

⸻

34. ORPAILLEUR PREND LA MAIN

Event :

NEW_DOCUMENT
source = AUDITOR_UPLOAD

Orpailleur :

1. ouvre ;
2. comprend ;
3. identifie ;
4. renomme ;
5. rattache ;
6. range ;
7. retourne :

DOCUMENT_CLASSIFIED
pbc = INV-007
confidence = 96%

Mission Controller reçoit l’événement et actualise son PBC.

⸻

35. SI ORPAILLEUR N’EST PAS SÛR

Il ne doit pas inventer.

Exemple :

Possible:
PBC INV-07 = 54%
PBC PPE-03 = 41%

Résultat :

NEEDS HUMAN CLASSIFICATION

Un auditeur choisit.

La correction devient ensuite une leçon pour Shadow.

⸻

36. WORKING PAPER FLOW

Auditeur modifie :

REV-04.xlsx

Drive envoie :

FILE_CHANGED

Office Manager regarde :

File ID = REV-04

Puis :

WP_CHANGED

Enhanced Auditor peut lire seulement :

* nouvelle version du WP ;
* pièces associées ;
* Risk ID ;
* programme associé.

Pas toute la mission.

⸻

37. DIFFERENTIAL REVIEW

Si la version précédente était V6 et la nouvelle V7 :

Enhanced Auditor peut comparer :

V6 → V7

et concentrer son analyse sur ce qui a changé.

Cela réduit énormément les appels IA.

⸻

38. SIGN-OFF

Manager ouvre REV-04 dans l’interface.

Office Manager lui montre le document réel.

Il clique :

SIGN OFF

Le backend récupère immédiatement :

Drive file ID
Drive revision/version
Hash
Reviewer ID
Timestamp
Role

Puis crée :

SIGNOFF-004892

⸻

39. LE SIGN-OFF DANS LE DOCUMENT

Pour les templates Office Manager standards, une zone peut être prévue :

PREPARED BY
REVIEWED BY
REVIEW DATE
REVIEW STATUS

Office Manager écrit le sign-off dans cette zone lorsque le format et le connecteur le permettent sans endommager le document.

La preuve technique principale reste néanmoins :

le sign-off lié à la version exacte.

⸻

40. FICHIERS NON STANDARD

Pour un fichier qui ne permet pas une écriture sûre :

Office Manager ne modifie pas le document.

Il crée un sign-off attaché à :

File ID + revision + hash.

Dans l’interface, le sign-off apparaît visuellement sur le document.

⸻

41. MODIFICATION APRÈS SIGN-OFF

Drive notifie :

REV-04 changed.

Office Manager compare :

Signed revision = 7
Current revision = 8

Il produit :

DOCUMENT_CHANGED_AFTER_SIGNOFF

Puis :

RE_REVIEW_REQUIRED

selon la politique configurée.

⸻

42. RECHERCHE DOCUMENTAIRE SANS COPIER LE DRIVE

La recherche possède deux niveaux.

Niveau 1 — Index léger

Office Manager recherche dans :

* nom ;
* mission ;
* client ;
* période ;
* cycle ;
* type ;
* auteur ;
* PBC ;
* WP ;
* tags ;
* court résumé éventuellement.

Très rapide.

⸻

43. NIVEAU 2 — RECHERCHE PROFONDE

Si l’utilisateur demande :

Retrouve-moi le contrat qui contient la clause de réhabilitation minière.

Office Manager :

1. recherche les candidats ;
2. ouvre seulement les documents pertinents ;
3. analyse leur contenu ;
4. retourne les résultats avec leurs liens.

Il n’est pas nécessaire de conserver en permanence l’intégralité textuelle des documents dans la base.

⸻

44. VECTOR DATABASE : OPTIONNELLE

Une base vectorielle globale contenant tous les documents de tous les clients ne devrait pas être obligatoire.

Si une recherche sémantique avancée est proposée, deux modes peuvent exister :

Privacy Mode

Pas de stockage permanent d’embeddings.

Lecture à la demande.

Advanced Search Mode

Embeddings conservés dans un espace isolé propre au tenant.

Les embeddings doivent eux-mêmes être considérés comme données potentiellement sensibles.

⸻

45. MINIMISATION DES DONNÉES PERSONNELLES

Office Manager n’a pas besoin de connaître toute la vie d’un collaborateur.

Dans la base centrale, on peut avoir :

STAFF-027
Role = Senior
Grade = S2
Revenue Skill = 4.1
Mining Experience = Medium
Capacity = 40%

Le CV complet reste dans le repository RH du cabinet.

⸻

46. INFORMATIONS À NE PAS DUPLIQUER SANS NÉCESSITÉ

Par défaut, ne pas copier dans la base opérationnelle :

* adresse personnelle ;
* date de naissance ;
* données médicales ;
* situation familiale ;
* identifiants gouvernementaux ;
* informations bancaires personnelles ;
* réponses détaillées d’indépendance ;
* CV complet.

⸻

47. KYC

Même logique.

Office Manager peut conserver :

KYC = COMPLETE
reviewer = PARTNER-02
date = ...
document_id = ...

Le dossier KYC détaillé reste dans l’espace documentaire protégé.

⸻

48. MANAGEMENT CARD

La Management Card doit être minimale.

Conserver uniquement les éléments utiles au management :

* besoin de structure ;
* préférence feedback ;
* autonomie observée ;
* environnement de travail favorable.

Pas de diagnostic psychologique.

Pas de données médicales.

Pas d’informations privées inutiles.

⸻

49. KPI

Les KPI utilisent :

events + résultats de travail

et non :

copie des fichiers.

Exemple :

WP_SUBMITTED
REVIEW_POINT_MINOR
REVIEW_POINT_CLEARED
WP_SIGNED_OFF
DEADLINE_MET

À partir de là, Firm Manager calcule :

First Pass Quality = 87%.

⸻

50. TRACE DU KPI

Chaque KPI doit être explicable.

Utilisateur clique :

Documentation Quality 82%

Office Manager affiche :

24 WP analysés
3 review points majeurs
8 review points mineurs

Puis il peut ouvrir les WP concernés.

⸻

51. TENANT ISOLATION

Chaque cabinet possède :

tenant_id

Toutes les données opérationnelles sont associées à ce tenant.

Les politiques de base de données doivent empêcher un utilisateur du cabinet A de lire le cabinet B.

Avec Supabase/Postgres, Row Level Security permet précisément d’appliquer des règles d’autorisation au niveau des lignes. (Supabase)

⸻

52. TROIS NIVEAUX DE DÉPLOIEMENT POSSIBLES

Standard SaaS

Infrastructure partagée.

Données séparées par tenant.

Documents toujours chez le client.

⸻

Private Tenant

Base ou projet dédié à un cabinet.

Pour les cabinets plus sensibles.

⸻

Enterprise Private

Infrastructure dédiée ou self-hosted selon les besoins contractuels.

⸻

53. LES SECRETS

Les tokens Google, Microsoft et les clés ne doivent jamais être stockés dans les tables métier en clair.

Ils vont dans un coffre de secrets.

Supabase fournit par exemple Vault pour stocker de manière chiffrée des secrets utilisés par les fonctions et processus backend. (Supabase)

⸻

54. AUCUNE CLÉ DANS LE FRONTEND

Le navigateur ne doit jamais recevoir :

* clé API OpenAI secrète ;
* service role database ;
* secret Gmail ;
* clé de chiffrement.

Le navigateur appelle :

Office Manager Backend

qui applique les droits.

⸻

55. PERMISSIONS AVANT CHAQUE TOOL CALL

Même si l’IA demande :

Lis le fichier XYZ.

Le backend vérifie :

Who is asking?
Which tenant?
Which engagement?
Which role?
Does this role have access?

Ensuite seulement :

DocumentConnector.read(XYZ)

⸻

56. LES AGENTS N’ONT PAS TOUS LES MÊMES OUTILS

Firm Manager

Peut consulter :

* people ;
* capacity ;
* portfolio ;
* KPI ;
* pre-engagement.

⸻

Mission Controller

Peut consulter/modifier :

* engagement state ;
* PBC ;
* deadlines ;
* review workflow ;
* mission communication.

⸻

Enhanced Auditor

Peut lire :

* risks ;
* programme ;
* WP ;
* evidence.

Mais ne doit pas avoir besoin d’une fonction :

delete engagement.

⸻

Orpailleur

Peut :

* lire ;
* classifier ;
* renommer ;
* déplacer dans la zone autorisée.

Il ne doit pas pouvoir :

décider l’opinion d’audit.

⸻

57. CHATGPT CONNECTÉ À OFFICE MANAGER

ChatGPT ne doit jamais se connecter directement :

Supabase password → ChatGPT

ou :

Google Drive token → ChatGPT.

On crée :

Office Manager Tool Gateway

⸻

58. OFFICE MANAGER TOOL GATEWAY

Exemples d’outils :

search_documents()
get_engagement_status()
get_open_review_points()
get_my_reviews()
get_staff_capacity()
get_pbc_status()
propose_team()
open_document()

ChatGPT appelle :

Office Manager Gateway

Le gateway applique :

* identité ;
* tenant ;
* rôle ;
* permission ;
* audit trail.

Puis Office Manager interroge les systèmes internes.

⸻

59. MCP / CHATGPT APP

Office Manager peut exposer ce Tool Gateway via MCP.

Les Apps ChatGPT utilisent actuellement l’Apps SDK, basé sur MCP, pour connecter ChatGPT à des outils et données externes. (OpenAI Help Center)

Architecture :

ChatGPT
   ↓
Office Manager App / MCP
   ↓
Office Manager Gateway
   ↓
Permission Engine
   ↓
Workflow / Agents / Connectors
   ↓
Customer Drive / Mail / Database

⸻

60. DONC CHATGPT NE VOIT PAS TOUT

Utilisateur demande :

Montre-moi les missions à risque.

ChatGPT appelle :

get_at_risk_engagements()

Office Manager retourne seulement :

ENG-24
ENG-31
ENG-42

avec leurs raisons autorisées.

ChatGPT n’a pas besoin d’aspirer 400 Go de Drive.

⸻

61. L’IA INTÉGRÉE DANS OFFICE MANAGER

Même principe.

Le chatbot intégré n’a pas de passe-droit.

Il appelle exactement les mêmes tools.

Ainsi :

ChatGPT externe

et

AI interne Office Manager

respectent la même sécurité.

⸻

62. CONTEXTE IA MINIMUM

Avant d’appeler un modèle IA, un Context Builder construit uniquement le contexte nécessaire.

Exemple :

Question :

Analyse REV-04.

Context Builder prend :

* REV-04 ;
* Risk R07 ;
* procédure associée ;
* trois pièces utilisées.

Il ne prend pas :

* les 3 000 documents de la mission ;
* les CV de tous les employés ;
* les autres clients.

⸻

63. TEMPORARY AI BUFFER

Le contenu envoyé pour analyse peut passer par une zone temporaire.

Après traitement :

* résultat utile conservé ;
* références conservées ;
* buffer supprimé selon la politique de rétention.

Ainsi Office Manager ne crée pas involontairement une nouvelle archive parallèle.

⸻

64. LES RÉSULTATS IA

Un résultat IA important doit être enregistré sous forme compacte :

finding_id
agent
engagement
risk
document_ref
finding_type
severity
short_explanation
confidence
status

Pas nécessairement toute la conversation ayant conduit à cette conclusion.

⸻

65. AUDIT TRAIL

En revanche, les décisions importantes restent tracées :

Enhanced Auditor suggested R07
Manager accepted
Date
Supporting documents

Cela donne l’auditabilité sans conserver chaque token de la conversation.

⸻

66. ARCHIVAGE

L’archivage est déclenché par :

Mission Controller

lorsqu’il produit :

MISSION_READY_FOR_ARCHIVE

Orpailleur reçoit cet événement.

⸻

67. ARCHIVE PASS

Orpailleur vérifie :

* tous les WP ;
* PBC ;
* sign-offs ;
* report ;
* communications ;
* final versions ;
* unknown files ;
* temporary files ;
* unclassified evidence.

⸻

68. ARCHIVE MANIFEST

Il produit dans le Drive du client :

ARCHIVE_MANIFEST.xlsx

avec :

File ID
Name
Version
Hash
Category
Location
Last Modification
Owner

⸻

69. ARCHIVE FREEZE

Si le repository permet de modifier les droits :

le dossier peut devenir en lecture seule selon la politique choisie.

Sinon Office Manager applique au minimum :

Application-level archive lock

et surveille le repository.

⸻

70. MODIFICATION POST-ARCHIVE

Si un fichier change :

POST_ARCHIVE_CHANGE_DETECTED

Le système crée immédiatement :

* alerte ;
* auteur ;
* date ;
* document ;
* ancienne version ;
* nouvelle version.

Le dossier ne peut pas changer silencieusement.

⸻

71. RETENTION

La durée d’archivage n’est pas codée universellement.

Chaque cabinet configure sa politique :

Audit files retention = X years
KYC retention = Y
HR = Z

Office Manager applique ensuite cette politique.

⸻

72. PORTABILITÉ

Un objectif fondamental doit être :

Le cabinet peut quitter Office Manager sans perdre ses dossiers.

Il garde :

* Drive ;
* PBC ;
* Working Papers ;
* Risk Assessment ;
* programmes ;
* archive manifest ;
* rapports ;
* documents.

La base Office Manager contient surtout la couche d’orchestration.

⸻

73. EXEMPLE COMPLET : DE L’EMAIL AU PBC

Mission Controller envoie PBC email
        ↓
Gmail thread enregistré
        ↓
Client répond
        ↓
Gmail push
        ↓
Mail Connector
        ↓
Message rattaché à ENG-001
        ↓
Attachment extrait temporairement
        ↓
Document lu
        ↓
Drive destination calculée
        ↓
Document sauvegardé
        ↓
Drive ID enregistré
        ↓
PBC Service
        ↓
PBC CHECKLIST actualisé
        ↓
PARTIAL 1/5
        ↓
Mission Controller demande confirmation auditeur
        ↓
Auditeur confirme population
        ↓
Next action = demander 4 relevés

⸻

74. EXEMPLE COMPLET : WORKING PAPER

Auditeur travaille dans Excel
        ↓
Drive version change
        ↓
FILE_CHANGED
        ↓
WP_CHANGED
        ↓
Enhanced Auditor reçoit uniquement V7
        ↓
Analyse V6 → V7
        ↓
Finding créé
        ↓
Auditeur corrige
        ↓
SUBMIT_FOR_REVIEW
        ↓
Mission Controller ouvre Manager Review
        ↓
Manager ouvre document
        ↓
SIGN OFF
        ↓
Revision + hash enregistrés

⸻

75. EXEMPLE COMPLET : KPI

WP submitted
     ↓
Manager review
     ↓
2 minor review points
     ↓
Review points cleared
     ↓
WP signed-off
     ↓
Performance Events
     ↓
Firm Manager aggregation
     ↓
Documentation Quality KPI

Le système n’a pas eu besoin de copier tout le WP dans la table KPI.

⸻

76. EXEMPLE COMPLET : ARCHIVE

Report Issued
       ↓
Mission Controller Closing
       ↓
All required gates satisfied
       ↓
MISSION_READY_FOR_ARCHIVE
       ↓
Orpailleur Archive Pass
       ↓
Issues?
   ↙       ↘
Yes         No
↓             ↓
Human        Manifest
Review        ↓
              Archive Lock
              ↓
             ARCHIVED

⸻

77. ARCHITECTURE LOGIQUE FINALE

                 USERS
                   │
           OFFICE MANAGER UI
                   │
              API GATEWAY
                   │
        ┌──────────┴───────────┐
        │                      │
 PERMISSION ENGINE       WORKFLOW ENGINE
        │                      │
        └──────────┬───────────┘
                   │
              EVENT BUS
                   │
      ┌────────────┼─────────────┐
      │            │             │
 Firm Manager   Mission       Enhanced
                Controller    Auditor
      │            │             │
      ├──────── Orpailleur ──────┤
      │            │             │
      └──── Sika / Shadow ───────┘
                   │
              TOOL GATEWAY
                   │
       ┌───────────┼───────────┐
       │           │           │
 Document      Mail         Calendar
 Connector    Connector     Connector
       │           │           │
     DRIVE       EMAIL      CALENDAR
       │
       │
 CUSTOMER-OWNED DATA

La base de données est à côté de ce système comme petite mémoire de contrôle, pas comme remplaçante du Drive.

⸻

78. LE MODÈLE DE DONNÉES EN UNE PHRASE

Office Manager doit stocker principalement :

Qui + quoi + où + état + version + relation + prochaine action

et non :

une copie complète de tout ce que possède le cabinet.

⸻

79. LE MODÈLE DE SÉCURITÉ EN UNE PHRASE

Chaque utilisateur et chaque agent voit uniquement les objets nécessaires à son rôle et à la mission concernée.

⸻

80. LE MODÈLE IA EN UNE PHRASE

L’IA récupère le minimum de preuves nécessaires au moment où elle doit raisonner, produit un résultat structuré, puis laisse les documents dans l’environnement du client.

⸻

81. LE MODÈLE MÉMOIRE EN UNE PHRASE

Petite mémoire structurée dans Office Manager, grande mémoire documentaire chez le client.

⸻

82. LE MODÈLE COMMERCIAL

Cette architecture permet de vendre Office Manager comme une plateforme qui ne demande pas au cabinet :

« Donnez-nous toutes vos données et migrez chez nous. »

Mais plutôt :

« Gardez vos données là où elles sont. Office Manager vient les organiser, les comprendre et orchestrer le travail au-dessus. »

C’est un argument commercial très important.

⸻

83. RÉSULTAT FINAL

Le cabinet conserve :

ses fichiers ;

ses emails ;

ses preuves ;

ses dossiers ;

son historique documentaire.

Office Manager apporte :

l’intelligence ;

le workflow ;

les agents ;

la recherche ;

les alertes ;

les sign-offs ;

les KPI ;

les revues ;

le staffing ;

l’audit trail ;

la coordination.

Ainsi le logiciel peut devenir très puissant sans devenir propriétaire de toute la donnée du cabinet.