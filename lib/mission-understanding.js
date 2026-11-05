// NEURONE 6 — the comprehension sheet of a mission (2026-11-05).
// What a completed (or ongoing) mission SAYS, link by link of the audit chain, in the firm-independent format
// docs/neurones/FORMAT_COMPREHENSION_MISSION.schema.json (version "1"): entity and mandate, materiality, risks,
// procedures with their findings and conclusions, misstatements, limitations, cycle conclusions, synthesis, opinion,
// broken links (R01–R15) and the map of where each notion was found — or not.
// Built from the documents already read by Shadow's quality pass, by CODE: every element points to the document that
// says it; what the code cannot read is left null / « inconnu », never invented. The proposed opinion comes from
// neurone 5 (lib/audit-chain.js) and the decision stays with the partner. No AI call, nothing written in the Drive.
import { materialityOf, conclusionOfRows } from './audit-chain.js';

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'");
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => String(s ?? '').slice(0, n);
const cellText = v => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') return clean(v.text ?? v.result ?? (Array.isArray(v.richText) ? v.richText.map(x => x.text).join('') : ''));
  return clean(v);
};
const rowsOf = sh => (sh.rows || []).map(r => (Array.isArray(r) ? r : r.v || []));
const sentences = text => String(text || '').split(/\n+|\t+|\s\|\s|(?<=[.;!?])\s+(?=[A-ZÀ-ÖØ-Ý0-9«"(])/).map(clean).filter(s => s.length >= 12 && s.length <= 700);
const loc = (fichier, endroit = null, extrait = null) => ({ fichier: cut(fichier, 200), endroit: endroit ? cut(endroit, 120) : null, extrait: extrait ? cut(extrait, 240) : null });

// The cycle of a test, from its own words (sheet name, objective, document name) — a closed list, « autre » otherwise.
const CYCLES = [
  // A project test (code PRJ, eligibility, funder) is the project cycle even when it speaks of expenses.
  ['projet_bailleur', /\bprj\b|eligibilit|bailleur|ptba|non-objection|convention de financement/],
  ['tresorerie', /tresorerie|banque|caisse|releve|rapprochement bancaire|\bcash\b|\btre\b/],
  ['ventes_clients', /ventes?|clients?|chiffre d'affaires|\brev\b|\bcli\b|recettes/],
  ['achats_fournisseurs', /achats?|fournisseurs?|depenses?|\bach\b|\bpur\b/],
  ['personnel', /personnel|paie|salaires?|\bpay\b|charges sociales|its\b|cnps/],
  ['immobilisations', /immobilis|amortissement|dotations? aux amort|\bfa\b|\bppe\b/],
  ['stocks', /stocks?|inventaire|\binv\b/],
  ['impots', /impots?|fiscal|tva|\bbic\b|\btax\b|patente/],
  ['capitaux_propres_fonds', /capitaux propres|capital social|fonds propres|fonds affectes|reserves|\beq\b/],
  ['emprunts', /emprunts?|dettes financieres|credit-bail|\bloan\b/],
  ['provisions', /provisions?|passifs? eventuels?|litiges?/],
  ['parties_liees', /parties liees|conventions reglementees|\brel\b/],
  ['projet_bailleur', /projet|bailleur|\bprj\b|eligibilit|ptba|non-objection|convention de financement/],
  ['autres_creances_dettes', /autres creances|autres dettes|debiteurs divers|crediteurs divers|\both\b/],
  ['cloture', /evenements? posterieurs?|continuite|cloture|etats financiers|\bcomp\b/]
];
export function cycleOf(...words) {
  const t = fold(words.filter(Boolean).join(' '));
  return CYCLES.find(([, re]) => re.test(t))?.[0] || 'autre';
}
const NATURES = [
  ['confirmation', /confirmation|circularisation/], ['inventaire', /inventaire|comptage/], ['cut_off', /cut.?off|separation des exercices/],
  ['rapprochement', /rapproch/], ['recalcul', /recalcul|recalculer|reconstituer/], ['walkthrough', /walkthrough|de bout en bout|cheminement/],
  ['analytique', /analytique|variation|evolution|ratio/], ['entretien', /entretien|interview|questionnaire/],
  ['test_controle', /controle interne|test de controle|separation des taches|autorisation/], ['lecture_documents', /lire|lecture|prendre connaissance|statuts|pv d'ag|convention/]
];
const natureOf = t => NATURES.find(([, re]) => re.test(fold(t)))?.[0] || 'test_detail';
const ASSERTIONS = [
  ['existence', /existence|realite|reel/], ['exhaustivite', /exhaustiv/], ['exactitude', /exactitude|exact|correctement calcul/],
  ['evaluation', /evaluation|valeur|depreciation/], ['droits_obligations', /droits?|propriete|obligations?/], ['separation_exercices', /separation des exercices|cut.?off|rattach/],
  ['classement', /classement|imputation/], ['presentation', /presentation|information|annexe/], ['conformite', /conformite|conforme aux? (accord|convention|procedures)/],
  ['regularite', /regularite|eligib/]
];
const assertionsOf = t => ASSERTIONS.filter(([, re]) => re.test(fold(t))).map(([k]) => k);

const EXCEPTION_CELL = /^(exception|ecart|non conforme|ko|anomalie|non justifie|a regulariser|erreur)\b/;
function testSheets(docs) {
  const out = [];
  for (const d of docs.filter(x => x.sheets?.length)) for (const sh of d.sheets.slice(0, 80)) {
    const rows = rowsOf(sh); const head = rows.slice(0, 25).map(r => r.map(cellText).filter(Boolean).join(' '));
    const at = head.findIndex(h => /objectif/i.test(h)); if (at < 0) continue;
    const objective = clean(head.slice(at, at + 3).join(' ').replace(/^objectifs?\s*:?\s*/i, '')) || sh.name;
    const concl = conclusionOfRows(rows);
    const exceptions = rows.slice(0, concl ? concl.row : rows.length).map((r, i) => ({ i, cells: r.map(cellText) })).filter(x => x.cells.some(c => EXCEPTION_CELL.test(fold(c))));
    const lines = rows.slice(at + 2, concl ? concl.row : rows.length).filter(r => r.some(c => typeof c === 'number' || /\d/.test(cellText(c)))).length;
    out.push({ doc: d, sheet: sh.name, objective, conclusion: concl?.text || null, exceptions, lines });
  }
  return out;
}
// The narrative component sheets (« Travaux à effectuer | Réf. | Commentaires et observations »): one procedure per sheet.
function componentSheets(docs) {
  return docs.filter(d => d.roles?.has('fiche') && !d.sheets?.length).map(d => {
    const s = sentences(d.text);
    const objective = clean((String(d.text).match(/objectifs?\s*:?\s*([^\n]{8,300})/i) || [])[1] || d.name);
    const conclusion = s.find(x => /^conclusions?\b/i.test(x)) || null;
    const issues = s.filter(x => /(n'a pas|n'ont pas|non (justifi|comptabilis|communiqu|obtenu)|ecart|absence|aucune? (piece|justificatif)|inferieur|anomalie)/.test(fold(x)) && !/^(\d+[\s.)-]*)?(verifier|obtenir|s'assurer|rapprocher|demander|reconstituer)\b/.test(fold(x)));
    return { doc: d, objective, conclusion, issues };
  });
}

const RULE_OF = {
  C1: 'R08_identite_client_incoherente', C2: 'R04_synthese_differente_du_travail', C3: 'R14_rapport_incoherent_avec_la_synthese',
  C4: 'R13_anomalie_absente_de_la_synthese', C5: 'R13_anomalie_absente_de_la_synthese', C6: 'R02_preuve_hors_mission',
  C7: 'R03_travail_recopie_annee_precedente', C8: 'R08_identite_client_incoherente', C9: 'R10_materialite_absente',
  C10: 'R06_date_hors_periode', C11: 'R07_confirmation_sans_reponse_sans_alternative', C12: 'R01_conclusion_contraire_aux_constats'
};
const CONSEQUENCE = {
  R01_conclusion_contraire_aux_constats: 'La conclusion du test ne peut pas être reprise telle quelle : les exceptions doivent être expliquées ou reportées.',
  R02_preuve_hors_mission: 'Le chiffre ou la pièce ne prouve rien pour cette mission tant que sa source n’est pas retrouvée.',
  R03_travail_recopie_annee_precedente: 'Le travail de l’exercice n’est pas démontré : il faut le refaire ou prouver qu’il a été refait.',
  R04_synthese_differente_du_travail: 'La synthèse ou le travail est faux sur ce point : le manager tranche avant l’opinion.',
  R06_date_hors_periode: 'Les éléments hors période ne couvrent pas l’assertion sur l’exercice audité.',
  R07_confirmation_sans_reponse_sans_alternative: 'Limitation tant que la procédure alternative n’est pas faite.',
  R08_identite_client_incoherente: 'Le travail peut venir d’un autre dossier : il n’appuie pas la conclusion.',
  R10_materialite_absente: 'Aucune conclusion ni opinion ne peut être proposée.',
  R13_anomalie_absente_de_la_synthese: 'L’opinion est préparée sans cette anomalie : la synthèse doit la reprendre.',
  R14_rapport_incoherent_avec_la_synthese: 'Le rapport ne reflète pas le dossier : l’associé décide avant émission.'
};

function entityType(docs, mission, mandate) {
  const t = fold(docs.filter(d => d.roles?.has('tdr') || d.roles?.has('note') || d.roles?.has('rapport')).map(d => String(d.text).slice(0, 6000)).join(' ') + ' ' + (mission?.name || ''));
  if (/association|\bong\b|fondation|entite a but non lucratif/.test(t)) return 'association_ong';
  // A statutory audit (commissariat aux comptes) is the audit of a company, whatever « projet » words its files contain.
  if (mandate !== 'commissariat_aux_comptes' && /projet|bailleur|banque mondiale|banque africaine|\bfad\b|\bida\b|union europeenne|\bafd\b/.test(t) && docs.some(d => d.roles?.has('tdr'))) return 'projet_bailleur';
  if (/etablissement public|ministere|collectivite/.test(t)) return 'entite_publique';
  return 'societe';
}
function mandateType(docs) {
  const t = fold(docs.filter(d => d.roles?.has('tdr') || d.roles?.has('rapport') || d.roles?.has('note')).map(d => String(d.text).slice(0, 8000)).join(' '));
  if (/commissaire aux comptes|commissariat aux comptes/.test(t)) return 'commissariat_aux_comptes';
  // A funded project's terms of reference often ADD a procurement review: the mandate stays the audit of the project.
  if (docs.some(d => d.roles?.has('tdr')) && /projet|bailleur/.test(t) && /etats financiers/.test(t)) return 'audit_projet_bailleur';
  if (/audit des acquisitions|passation des marches/.test(t)) return 'audit_acquisitions';
  if (/due diligence/.test(t)) return 'due_diligence';
  if (/procedures convenues/.test(t)) return 'procedures_convenues';
  if (/examen limite/.test(t)) return 'examen_limite';
  if (/audit contractuel/.test(t)) return 'audit_contractuel';
  if (docs.some(d => d.roles?.has('tdr')) && /projet|bailleur/.test(t)) return 'audit_projet_bailleur';
  return 'autre';
}
function referentialOf(docs) {
  // The framework the file names most often (a template of another framework mentioned once does not decide).
  const t = fold(docs.map(d => String(d.text).slice(0, 20000)).join(' '));
  const n = re => (t.match(re) || []).length;
  const counts = [['SYCEBNL', n(/sycebnl/g)], ['IFRS', n(/\bifrs\b/g)], ['SYSCOHADA révisé', n(/syscohada|plan comptable ohada|acte uniforme relatif au droit comptable/g)]].sort((a, b) => b[1] - a[1]);
  return counts[0][1] ? counts[0][0] : null;
}
// What the mandate requires: the TDR's own sentences that say what the auditor must do (each needs a procedure).
function requirements(docs) {
  const out = [];
  for (const d of docs.filter(x => x.roles?.has('tdr'))) for (const s of sentences(d.text)) {
    if (!/(l'auditeur (devra|doit)|il (devra|est demande)|devra (verifier|s'assurer|examiner|emettre|exprimer)|l'audit (devra|comprendra|portera)|le rapport (devra|comprendra))/.test(fold(s))) continue;
    out.push({ id: 'E' + String(out.length + 1).padStart(2, '0'), texte: cut(s, 400), source: d.name });
    if (out.length >= 25) break;
  }
  return out;
}
function risks(docs) {
  const out = [], seen = new Set();
  // Only the firm's own work (synthesis note, component sheets): a standard « responsibilities of the auditor » annex speaks of
  // risks in general, not of this mission's risks.
  for (const d of docs.filter(x => x.roles?.has('note') || x.roles?.has('fiche'))) for (const s of sentences(d.text)) {
    const f = fold(s);
    if (!/(risque (significatif|eleve|important|de fraude|majeur|inherent)|risques? identifies?)/.test(f) || seen.has(f)) continue;
    seen.add(f);
    out.push({ id: 'R' + String(out.length + 1).padStart(2, '0'), description: cut(s, 400), cycle: cycleOf(s), assertions: assertionsOf(s),
      niveau: /significatif/.test(f) ? 'significatif' : /eleve|important|majeur/.test(f) ? 'eleve' : null, fraude: /fraude/.test(f), explicite: true, localisation: loc(d.name, null, s) });
    if (out.length >= 30) return out;
  }
  return out;
}

export function understandMission({ mission = {}, docs = [], findings = [], opinion = null }) {
  const read = docs.map(d => ({ ...d, roles: d.roles || new Set() }));
  const mandate = mandateType(read);
  const kind = entityType(read, mission, mandate);
  const m = materialityOf(read, mission);
  const years = [...new Set([mission.period_label, mission.name].flatMap(x => (String(x || '').match(/20\d\d/g) || []).map(Number)))].sort();
  const brokenSheets = new Set(findings.filter(f => f.check === 'C12').flatMap(f => (f.quotes || []).slice(0, 1).map(q => q.doc)));

  // Procedures: every test sheet of the workbooks, then every narrative component sheet.
  const procedures = [];
  for (const t of testSheets(read)) {
    const id = cut(t.sheet, 40), cycle = cycleOf(t.sheet, t.objective, t.doc.name);
    const constats = t.exceptions.length
      ? t.exceptions.slice(0, 10).map(x => ({ resultat: 'exception', description: cut(x.cells.filter(Boolean).join(' | '), 300), montant: null, preuves: [], suite: null }))
      : t.conclusion ? [{ resultat: 'conforme', description: cut(t.conclusion, 300), montant: null, preuves: [], suite: 'aucune' }] : [];
    procedures.push({ id, cycle, intitule: cut(t.objective, 300), nature: natureOf(t.sheet + ' ' + t.objective), risques: [], assertions: assertionsOf(t.objective),
      population: null, echantillon: t.lines ? { methode: 'inconnu', taille: t.lines } : null, preuves: [],
      statut: t.conclusion ? 'faite' : t.lines ? 'partielle' : 'non_faite', constats, conclusion_dossier: t.conclusion ? cut(t.conclusion, 400) : null,
      localisation: loc(t.doc.name, t.sheet, t.conclusion), _sheet: `${t.doc.name} › ${t.sheet}` });
  }
  for (const c of componentSheets(read)) {
    const cycle = cycleOf(c.doc.name, c.objective);
    procedures.push({ id: cut(c.doc.name.replace(/\.[a-z0-9]+$/i, ''), 40), cycle, intitule: cut(c.objective, 300), nature: natureOf(c.objective), risques: [], assertions: assertionsOf(c.objective),
      population: null, echantillon: null, preuves: [], statut: c.conclusion || c.issues.length ? 'faite' : 'partielle',
      constats: c.issues.slice(0, 10).map(s => ({ resultat: /non (communiqu|obtenu|fourni)|absence|aucune? (piece|justificatif)|pas (ete )?(communiqu|obtenu)/.test(fold(s)) ? 'limitation' : 'exception', description: cut(s, 300), montant: null, preuves: [], suite: null })),
      conclusion_dossier: c.conclusion ? cut(c.conclusion, 400) : null, localisation: loc(c.doc.name, null, c.conclusion), _sheet: c.doc.name });
  }

  // Misstatements and limitations: the synthesis points read by neurone 5, typed and quantified.
  const pts = opinion?.points || [];
  const anomalies = pts.filter(p => p.type !== 'limitation').map((p, i) => ({ id: 'A' + String(i + 1).padStart(2, '0'), procedure: p.from_check || 'synthese', description: cut(p.text, 400),
    montant: p.amount ?? null, nature: 'certaine', sens: 'inconnu', ecriture: null, corrigee: 'inconnu', dans_synthese: p.from_check ? 'non' : 'oui' }));
  const limitations = pts.filter(p => p.type === 'limitation').map((p, i) => ({ id: 'L' + String(i + 1).padStart(2, '0'), procedure: p.from_check || 'synthese', description: cut(p.text, 400),
    montant: p.amount ?? null, procedure_alternative: p.from_check === 'C11' ? 'possible_non_faite' : 'inconnu', dans_synthese: p.from_check ? 'non' : 'oui' }));

  // Cycle conclusions: what the file concludes per cycle, and what the chain allows.
  const byCycle = new Map();
  for (const p of procedures) byCycle.set(p.cycle, [...(byCycle.get(p.cycle) || []), p]);
  const conclusions = [...byCycle].map(([cycle, ps]) => {
    const said = ps.map(p => p.conclusion_dossier).filter(Boolean);
    const exc = ps.some(p => p.constats.some(c => c.resultat === 'exception')), lim = ps.some(p => p.constats.some(c => c.resultat === 'limitation'));
    const logic = !m?.amount ? 'impossible_sans_materialite' : ps.some(p => p.statut !== 'faite') ? 'incomplet' : lim ? 'limitation' : exc ? 'anomalie' : 'assurance';
    const contrary = ps.some(p => brokenSheets.has(p._sheet));
    return { cycle, conclusion_dossier: said.length ? cut(said.join(' / '), 500) : null, conclusion_logique: logic, coherente: !contrary,
      raison: contrary ? 'Une feuille du cycle conclut sans exception alors que ses lignes en montrent (R01).' : logic === 'impossible_sans_materialite' ? 'Pas de seuil de signification : le caractère significatif ne peut pas être jugé.' : undefined };
  }).map(c => (c.raison === undefined ? (delete c.raison, c) : c));

  const sum = list => { const v = list.map(x => x.montant).filter(n => typeof n === 'number'); return v.length ? v.reduce((a, b) => a + Math.abs(b), 0) : null; };
  const totalA = sum(anomalies), totalL = sum(limitations);
  const above = !m?.amount ? 'inconnu' : [totalA, totalL].some(t => t != null && t >= m.amount) ? 'oui' : (totalA != null || totalL != null) ? 'non' : 'inconnu';
  const note = read.find(d => d.roles.has('note'));
  const synthese = { anomalies_non_corrigees_total: totalA, limitations_total: totalL, au_dessus_materialite: above, generalise: 'a_juger',
    points_qualitatifs: findings.filter(f => ['C4', 'C5'].includes(f.check)).map(f => cut(f.title, 300)),
    observations: [], controle_interne: [] };

  const op = opinion || {};
  const proposee = !op.proposed ? 'aucune' : op.proposed.kind === 'sans_reserve' ? 'sans_reserve'
    : op.conclusion_logic === 'limitation' ? 'avec_reserve_limitation' : 'avec_reserve_desaccord';
  const opinionOut = { dans_dossier: op.in_file?.kind || 'absente', proposable: Boolean(op.proposable), proposee, raisonnement: op.reasoning || [], manque: op.missing || [], decision: 'Associé' };

  const maillons = [];
  const seen = new Set();
  for (const f of findings) {
    const regle = RULE_OF[f.check] || 'R15_autre', key = regle + '|' + f.title; if (seen.has(key)) continue; seen.add(key);
    maillons.push({ regle, description: cut(f.title + (f.detail ? ' — ' + f.detail : ''), 500), consequence: CONSEQUENCE[regle] || cut(f.suggestion || 'À examiner par le manager.', 300),
      localisation: f.documents?.[0] ? loc(f.documents[0].name, null, f.quotes?.[0]?.text || null) : null });
  }
  const rep = read.find(d => d.roles.has('rapport')), tdr = read.find(d => d.roles.has('tdr'));
  const mat = m ? { globale: m.amount ?? null, travail: null, negligeable: null, base: null, localisation: loc(m.source || 'programme de travail', null, m.quote) } : null;
  const carte = [
    ['mandat', Boolean(tdr || rep), tdr?.name || rep?.name], ['materialite', Boolean(m?.amount), m?.source],
    ['risque', false, null], ['procedure', procedures.length > 0, procedures[0]?.localisation?.fichier],
    ['population', procedures.some(p => p.echantillon), procedures.find(p => p.echantillon)?.localisation?.fichier], ['echantillon', procedures.some(p => p.echantillon), procedures.find(p => p.echantillon)?.localisation?.fichier],
    ['preuve', read.some(d => !d.roles.has('note') && !d.roles.has('rapport') && !d.roles.has('fiche')), null],
    ['constat', procedures.some(p => p.constats.length), null], ['anomalie', anomalies.length > 0, anomalies.length ? 'synthèse' : null],
    ['limitation', limitations.length > 0, limitations.length ? 'synthèse' : null], ['conclusion', procedures.some(p => p.conclusion_dossier), null],
    ['synthese', Boolean(note), note?.name], ['opinion', Boolean(op.in_file), op.in_file?.doc]
  ].map(([notion, trouvee, ou]) => ({ notion, trouvee, ou: ou ? cut(ou, 200) : null }));
  const r = risks(read);
  carte[2] = { notion: 'risque', trouvee: r.length > 0, ou: r[0]?.localisation?.fichier || null };

  return {
    version: '1',
    mission: {
      entite: { designation: cut(mission.client_name || mission.name || 'inconnue', 200), type: kind, activite: null, pays: null, sources_financement: [] },
      referentiel: referentialOf(read),
      mandat: { type: mandate, exigences: requirements(read) },
      periode: { debut: years.length ? `${years[0]}-01-01` : null, fin: years.length ? `${years.at(-1)}-12-31` : null },
      materialite: mat
    },
    risques: r,
    procedures: procedures.map(({ _sheet, ...p }) => p),
    anomalies, limitations, conclusions_cycle: conclusions, synthese, opinion: opinionOut, maillons_casses: maillons, carte
  };
}
