# Continuité des Working Files

Une nouvelle version du programme conserve les références des Working Files enregistrées côté serveur. La préparation réutilise la copie du modèle déjà rattachée au cycle, même si elle a été renommée ou déplacée. Les cycles temporairement retirés gardent leur référence. Une erreur de lecture, une suppression ou une couverture SOP devenue incomplète ne déclenchent plus une copie de remplacement.

Si une ancienne version a perdu son rattachement, les références des programmes de la même mission sont recherchées. Une référence unique peut être reprise ; plusieurs références sont signalées pour identification, sans suppression ni fusion automatique. Les fichiers génériques antérieurs sans provenance de modèle ne sont pas assimilés automatiquement à une copie du modèle du cabinet.

Pour les extractions PDF, la provenance est inscrite dans la feuille SOURCE et la mémoire de mission : cabinet, mission, PDF et empreinte du contenu. Un PDF identique redéposé sous un autre ID ou nom réutilise l'extraction. La recherche ne dépend pas du nom de l'extraction et reste limitée à 200 candidats dans le dossier des pièces et aux références connues de la mission. Plusieurs résultats ou une provenance ancienne incertaine provoquent un arrêt explicite, jamais un suffixe supplémentaire.

Une nouvelle lecture d'un PDF modifié, ou une réextraction demandée, met à jour le même fichier généré si son empreinte enregistrée correspond toujours aux octets actuels. Toute modification humaine bloque ce remplacement ; aucun contenu humain n'est effacé. L'écriture utilise la version lue puis vérifie les octets relus. Une extraction retrouvée après perte de mémoire peut être réutilisée, mais n'est pas déclarée réinscriptible sans empreinte de sortie fiable.

Les créations sont sérialisées par mission/opération avec les RPC de verrouillage déjà utilisés par le projet (`db/inspection-reader-leases.sql`). Pas de nouvelle table ni migration. Un verrou indisponible bloque la création plutôt que d'autoriser deux copies.

Les nouveaux Working Files ont un nom court, stable entre versions du programme, avec l'extension du modèle conservée. Les nouveaux noms sont compatibles Windows. Le chemin des créations est vérifié ; un dossier trop profond ou inaccessible bloque la création. Les fichiers existants ne sont pas renommés automatiquement et le parcours de raccourcissement des chemins reste disponible.

## Vérifications

- 60 tests ciblés passent : copies de modèles, versions de programme, reprises, doublons, nommage, extractions PDF, protection des modifications humaines, imports et annulations. Un test exécute import → annulation → nouvel import et relit le même classeur avec ses formules conservées.
- La suite complète exécutée sous Windows sandbox a donné 1042 réussites, 11 échecs et 2 tests ignorés sur 1055. Les 11 mêmes échecs ont été reproduits sur la copie d'origine `141e7a8` : opérations de renommage disque refusées (`EPERM`) et connexions locales refusées (`EACCES`). Ils ne sont pas déclarés corrigés.
- Les opérations réelles sur les fichiers d'une mission et la production n'ont pas été exécutées pendant ces tests. Les quatre copies déjà signalées par l'utilisateur restent à comparer avant de choisir une référence ou de consolider leur contenu.
