-- Function of a person on ONE mission (Paul, 2026-10-19, point 2: « superviseur sur une mission, manager sur une autre »).
-- ADDITIVE ONLY. mission_role stays the free label shown on screen (written at creation, sometimes by the person
-- themselves): it never gives a right. mission_function is a closed list, written ONLY by lib/mission-function.js
-- setMissionFunction (a partner of the firm, or the mission's manager; never one's own), with who and when.
-- Reviews and the work programme read mission_function, never the label. Without this file: grades only, as before.
alter table public.office_mission_assignments add column if not exists mission_function text
  check (mission_function is null or mission_function in ('partner', 'manager', 'supervisor', 'senior', 'auditor', 'quality_reviewer', 'specialist', 'secretary', 'finance'));
alter table public.office_mission_assignments add column if not exists mission_function_set_by text
  check (mission_function_set_by is null or length(mission_function_set_by) <= 200);
alter table public.office_mission_assignments add column if not exists mission_function_set_at timestamptz;
