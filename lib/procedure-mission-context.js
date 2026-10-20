const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function missionQuestions(questions,mission){
  if(!mission?.period_label)return questions;
  return questions.filter(q=>{
    const s=fold(q);
    if(/contradic|incoher|diverg|alors que|different/.test(s))return true;
    return !/quel.{0,25}exercice.{0,15}audit|quelle.{0,25}periode.{0,15}(audit|depenses.{0,20}couvr)|periode d.audit/.test(s);
  });
}
export const MISSION_CONTEXT_RULE = 'La période auditée est celle de mission.period_label, déjà enregistrée à la création de la mission. Utilise-la explicitement. Ne redemande ni exercice ni période si elle est renseignée. Si mission.context_available=false, signale l’échec du chargement du contexte au lieu de demander de ressaisir la période. Les dates de planification ne sont pas la période auditée. Ne questionne cette période que si elle manque réellement ou si une contradiction précise avec une pièce est citée.';
