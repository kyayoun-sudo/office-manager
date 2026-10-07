-- Déclencheur des passages automatiques (Orpailleur 08:00/12:00/20:00, Grand Contrôleur,
-- Sika) : toutes les 15 minutes, Supabase appelle l'application, qui lance les agents
-- dont l'heure est venue (un seul passage par créneau, même si l'appel se répète).
--
-- Pourquoi ici : l'offre Vercel Hobby ne permet pas des tâches planifiées plusieurs
-- fois par jour. Supabase (pg_cron + pg_net) le permet.
--
-- AVANT D'EXÉCUTER, remplacez :
--   https://VOTRE-APPLICATION.vercel.app  -> l'adresse de PRODUCTION de l'application
--                                            (un aperçu protégé par Vercel refuserait l'appel)
--   VOTRE_SECRET_PLANIFICATEUR            -> la valeur de OFFICE_MANAGER_SCHEDULER_SECRET
--                                            (ou, à défaut, de ORPAILLEUR_JOB_SECRET) dans Vercel
--
-- Le planificateur ne fait rien tant que le propriétaire n'a pas activé les passages
-- dans Paramètres → Horaires des agents.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remplace une éventuelle version précédente de la tâche.
select cron.unschedule(jobid) from cron.job where jobname = 'office-manager-agents';

select cron.schedule(
  'office-manager-agents',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://VOTRE-APPLICATION.vercel.app/api/app?route=scheduler-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', 'VOTRE_SECRET_PLANIFICATEUR'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pour arrêter : select cron.unschedule('office-manager-agents');
