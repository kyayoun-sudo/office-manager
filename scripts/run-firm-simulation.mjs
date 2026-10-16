import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createFirm,startFirm,advance,viewFirm} from '../lib/firm-simulation.js';
const out=path.resolve(process.argv[2]||'/tmp/firm-simulation-results');
await mkdir(out,{recursive:true});
const c=createFirm({seed:3});startFirm(c);advance(c,{limit:500});const v=viewFirm(c);
await writeFile(path.join(out,'cabinet-15-reference.json'),JSON.stringify(v,null,2));
const report=`# Cabinet virtuel : résultats de référence\n\nSIMULATION DÉTERMINISTE — aucun appel de modèle, aucun score IA.\n\n- Personnes : ${v.summary.staff}\n- Mois : ${v.summary.months_elapsed}\n- Missions/opportunités : ${v.summary.missions}\n- Missions clôturées en simulation : ${v.summary.closed}\n- Acceptations refusées : ${v.summary.refused}\n- Propositions perdues : ${v.summary.lost}\n- Événements traités : ${v.results.reference_events}\n- Productions structurées : ${v.summary.proposals}\n- Appels IA : ${v.budget.calls}\n- Leçons proposées : ${v.lessons.length}\n\nCes résultats vérifient le moteur isolé et sa reprise. Ils ne mesurent pas les performances des modèles ni les services de production. Les productions sont des objets JSON, pas des classeurs Excel réels. Les faux humains suivent des règles ; ils ne sont pas encore des agents conversationnels autonomes.\n`;
await writeFile(path.join(out,'RESULTATS.md'),report);console.log(report);
