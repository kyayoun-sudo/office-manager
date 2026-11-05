// NEURONES 4 and 5 — the audit chain of a mission, read from its documents (2026-11-05).
// Born from the study of completed missions (NEURONES 2024, PAGFIC, FOSUN, GEOMATOS — real files stay with the firm):
// the logic is the same in every firm and every working file — entity → mandate → materiality → risk → procedure →
// population → sample → evidence → finding → misstatement / limitation → conclusion → synthesis → opinion.
// Neurone 4 = links of that chain that can be checked by CODE on the content (never a file name):
//   C9  (R10) materiality missing or without an amount,
//   C10 (R06) test items dated outside the period audited,
//   C11 (R07) confirmation without reply and without an alternative procedure,
//   C12 (R01) a test sheet that concludes « no exception » while its own lines show exceptions.
// Neurone 5 = the opinion the file supports (ISA 705 / 706 / 570), PROPOSED with its reasoning and what is missing.
// Principles: nothing is corrected or blocked; every finding quotes its passage; the opinion is never decided here —
// « decision: Associé ». An uncertainty stays an uncertainty (« je ne peux pas encore le prouver »).
// Pure functions: the documents are already read ({ id, name, text, sheets?, roles }).

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
const yearsOf = mission => new Set([mission?.period_label, mission?.name, mission?.period_end].flatMap(x => (String(x || '').match(/20\d\d/g) || []).map(Number)));
// Every text of a document: its text and, for a workbook, all its rows (the text of a workbook only holds its first rows).
const fullText = d => [d.text || '', ...(d.sheets || []).map(sh => rowsOf(sh).map(r => r.map(cellText).filter(Boolean).join(' ')).join('\n'))].join('\n');
function amounts(text) {
  const out = [], s = String(text || '');
  for (const m of s.matchAll(/(-|−)?\s?\b(\d{1,3}(?:[   .]\d{3}){1,4}|\d{5,13})(?![\d,]*\s*%)\b/g)) {
    const v = Number(m[2].replace(/[   .]/g, '')); if (Number.isFinite(v)) out.push((m[1] ? -1 : 1) * v);
  }
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(milliards?|mds?|millions?)\b/gi)) {
    const v = Number(m[1].replace(',', '.')) * (/^m(illiard|d)/i.test(m[2]) ? 1e9 : 1e6); if (Number.isFinite(v)) out.push(v);
  }
  return out;
}
const isTestSheet = rows => rows.slice(0, 25).some(r => r.some(c => /objectif/i.test(cellText(c))));
const ref = d => ({ id: d.id, name: d.name });

// ---------- C9 (R10) — materiality ----------
const MATERIALITY = /(seuil de signification|seuil de planification|seuil des anomalies|materialite|niveau de signification|caractere significatif global|performance materiality|seuil de remontee)/;
export function materialityOf(docs, mission) {
  const given = Number(mission?.materiality?.overall ?? mission?.materiality);
  if (Number.isFinite(given) && given > 0) return { amount: given, source: 'programme de travail', quote: null };
  let cited = null;
  for (const d of docs) {
    const t = fullText(d), f = fold(t);
    for (const m of f.matchAll(new RegExp(MATERIALITY.source, 'g'))) {
      // The amount written just after the words (same line or the next cells), never a percentage or a year.
      const after = t.slice(m.index, m.index + 220);
      const v = amounts(after.slice(m[0].length)).find(x => x >= 1000 && !(x >= 1990 && x <= 2100));
      if (v) return { amount: v, source: d.name, quote: cut(clean(after), 200), doc: ref(d) };
      cited = cited || { amount: null, source: d.name, quote: cut(clean(after), 200), doc: ref(d) };
    }
  }
  return cited;
}
export function checkMateriality(docs, mission) {
  const worked = docs.some(d => d.roles?.has('note') || d.roles?.has('rapport') || d.roles?.has('fiche') || (d.sheets || []).some(sh => isTestSheet(rowsOf(sh))));
  if (!worked) return [];
  const m = materialityOf(docs, mission);
  if (m?.amount) return [];
  if (m) return [{ check: 'C9', severity: 'moyenne', title: 'La matérialité est citée sans montant', quotes: [{ doc: m.source, text: m.quote }], documents: [m.doc],
    suggestion: 'Écrire le seuil de signification (et le seuil de planification) en montant : sans lui, aucun écart ne peut être jugé significatif ou non.' }];
  return [{ check: 'C9', severity: 'haute', title: 'Aucune matérialité trouvée dans les documents de la mission',
    suggestion: 'Le manager fixe le seuil de signification avant les tests (ISA 320). Sans lui, la conclusion des cycles et l’opinion ne peuvent pas être proposées.' }];
}

// ---------- C10 (R06) — items dated outside the period ----------
const OLD_ON_PURPOSE = /(anciennete|anterieur|report|a nouveau|ouverture|n-1|precedent|exercices? precedents?|balance agee|creances? anciennes?|immobilis)/;
function datesInRow(row) {
  const out = [];
  for (const c of row) {
    if (c instanceof Date && !Number.isNaN(c.getTime())) { out.push({ y: c.getUTCFullYear(), m: c.getUTCMonth() + 1 }); continue; }
    const s = cellText(c), iso = s.match(/^(20\d\d)-(\d\d)-(\d\d)/), fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](20\d\d)$/);
    if (iso) out.push({ y: Number(iso[1]), m: Number(iso[2]) }); else if (fr) out.push({ y: Number(fr[3]), m: Number(fr[2]) });
  }
  return out;
}
export function checkDatesOutsidePeriod(docs, mission) {
  const years = yearsOf(mission); if (!years.size) return [];
  const last = Math.max(...years), out = [];
  for (const d of docs.filter(x => x.sheets?.length)) {
    const bad = [];
    for (const sh of d.sheets.slice(0, 60)) {
      const rows = rowsOf(sh); if (!isTestSheet(rows)) continue;
      const head = fold(rows.slice(0, 12).map(r => r.map(cellText).join(' ')).join(' '));
      if (OLD_ON_PURPOSE.test(head)) continue; // a test of old balances, opening balances or fixed assets looks back on purpose
      const cutoff = /(cut|separation des exercices|posterieur|subsequent)/.test(head);
      let n = 0, dated = 0;
      for (const r of rows.slice(3)) for (const x of datesInRow(r)) {
        dated++;
        const inside = years.has(x.y) || (x.y === last + 1 && (cutoff || x.m <= 3));
        if (!inside) n++;
      }
      if (n) bad.push({ sheet: sh.name, n, dated });
    }
    if (bad.length) out.push({ check: 'C10', severity: 'moyenne', title: `${bad.reduce((a, b) => a + b.n, 0)} élément(s) testé(s) daté(s) hors de l’exercice ${[...years].sort().join('-')}`,
      detail: bad.slice(0, 15).map(b => `${b.sheet} : ${b.n} sur ${b.dated} dates`).join(' ; '), documents: [ref(d)],
      suggestion: 'Vérifier que ces éléments appartiennent bien à l’exercice audité (séparation des exercices) ou qu’ils viennent d’un autre dossier.' });
  }
  return out;
}

// ---------- C11 (R07) — confirmation without reply and without alternative procedure ----------
const CONFIRM_WORD = /(confirmations?|circularisation|lettres? de confirmation|demandes? de confirmation)/;
const NO_REPLY = /(sans reponse|pas (eu )?de reponse|aucune reponse|non (recue?s?|retournee?s?|repondue?s?)|n'(a|ont) pas (ete )?(repondu|retourne|recue?s?)|pas (ete )?(retournee?s?|recue?s?)|en attente de reponse|toujours pas recu)/;
const ALTERNATIVE = /(procedures? (alternatives?|de substitution|subsidiaires?)|alternatives? (a|aux) (la|les) confirmation|reglements? (subsequents?|posterieurs?)|encaissements? posterieurs?|paiements? posterieurs?|controle des (reglements|encaissements) posterieurs|pieces? justificatives? (des|du) solde)/;
export function checkConfirmations(docs) {
  const out = [];
  for (const d of docs) {
    const t = fullText(d), f = fold(t);
    if (!CONFIRM_WORD.test(f)) continue;
    const silent = sentences(t).filter(s => { const x = fold(s); return CONFIRM_WORD.test(x) && NO_REPLY.test(x) && !/^(\d+[\s.)-]*)?(envoyer|relancer|obtenir|demander|preparer)\b/.test(x); });
    if (!silent.length || ALTERNATIVE.test(f)) continue;
    out.push({ check: 'C11', severity: 'haute', title: `Confirmation sans réponse et sans procédure alternative dans « ${d.name} »`,
      quotes: silent.slice(0, 3).map(s => ({ doc: d.name, text: cut(s, 260) })), documents: [ref(d)],
      suggestion: 'Une confirmation sans réponse n’est pas une preuve : faire la procédure alternative (règlements postérieurs, pièces du solde) ou traiter le point comme une limitation (ISA 505).' });
  }
  return out;
}

// ---------- C12 (R01) — conclusion contrary to the sheet's own findings ----------
const EXCEPTION_CELL = /^(exception|ecart|non conforme|ko|anomalie|non justifie|a regulariser|erreur)\b/;
const CLEAN_CONCLUSION = /(aucune? (exception|anomalie|ecart|erreur|observation)|sans (exception|anomalie|reserve|observation)|n'appelle (pas|aucun) (de )?(commentaire|observation)|\bras\b|satisfaisante?s?|sont (justifiee?s?|conformes?|correctement)|correctement (justifie|comptabilise|enregistre)|nous n'avons (pas )?releve aucun)/;
export function conclusionOfRows(rows) {
  const at = rows.findIndex(r => r.some(c => /^conclusions?\b/i.test(cellText(c))));
  if (at < 0) return null;
  const own = rows[at].map(cellText).filter(c => c && !/^conclusions?\s*:?\s*$/i.test(c)).join(' ').replace(/^conclusions?\s*:?\s*/i, '');
  const next = rows.slice(at + 1, at + 4).map(r => r.map(cellText).filter(Boolean).join(' ')).filter(Boolean).join(' ');
  const text = clean(own.length >= 12 ? own : own + ' ' + next);
  return text.length >= 8 ? { text, row: at } : null;
}
export function checkConclusionAgainstLines(docs) {
  const out = [];
  for (const d of docs.filter(x => x.sheets?.length)) for (const sh of d.sheets.slice(0, 60)) {
    const rows = rowsOf(sh); if (!isTestSheet(rows)) continue;
    const concl = conclusionOfRows(rows); if (!concl) continue;
    const fc = fold(concl.text);
    // « aucune exception relevée » is clean; a conclusion that itself names an exception, a gap or an anomaly is honest.
    const named = fc.replace(/(aucune?|sans|pas d[e'])\s*(exception|ecart|anomalie|erreur)s?\s*(relevee?s?|constatee?s?|identifiee?s?)?/g, '');
    if (!CLEAN_CONCLUSION.test(fc) || /(exception|ecart|anomalie|erreur)/.test(named)) continue;
    const exc = [];
    rows.slice(0, concl.row).forEach((r, i) => { if (r.some(c => EXCEPTION_CELL.test(fold(cellText(c))))) exc.push({ i, line: r.map(cellText).filter(Boolean).join(' | ') }); });
    if (!exc.length) continue;
    out.push({ check: 'C12', severity: 'haute', title: `« ${sh.name} » conclut sans exception alors que ${exc.length} ligne(s) du test montrent une exception`,
      quotes: [{ doc: `${d.name} › ${sh.name}`, text: cut(concl.text, 260) }, ...exc.slice(0, 3).map(x => ({ doc: `${d.name} › ${sh.name} (ligne ${x.i + 1})`, text: cut(x.line, 220) }))],
      documents: [ref(d)], suggestion: 'La conclusion doit reprendre les exceptions : expliquées (et pourquoi elles ne sont pas des anomalies), projetées, ou reportées à la synthèse.' });
  }
  return out;
}

export const CHAIN_CHECKS = Object.freeze({
  C9: 'Matérialité fixée et chiffrée',
  C10: 'Éléments testés dans l’exercice audité',
  C11: 'Confirmation sans réponse et sans procédure alternative',
  C12: 'Conclusion contraire aux exceptions du test'
});
export function chainChecks(docs, mission) {
  return [...checkMateriality(docs, mission), ...checkDatesOutsidePeriod(docs, mission), ...checkConfirmations(docs), ...checkConclusionAgainstLines(docs)];
}

// ---------- NEURONE 5 — the opinion the file supports ----------
const LIMITATION = /(pas (ete )?(obtenue?s?|communiquee?s?|fournie?s?|transmise?s?|mise?s? a (notre )?disposition)|non (communiquee?s?|fournie?s?|transmise?s?|obtenue?s?|disponibles?)|absence (de|d')\s*(piece|justificatif|pv|proces|document|inventaire|contrat|convention|confirmation)|aucune? (piece|justificatif|pv|document|confirmation)|n'avons pas (pu|ete en mesure|obtenu)|impossib|pas (pu|ete en mesure)|non justifiee?s?|n'est pas justifiee?|ne sont pas justifiee?s|pas justifiee?s?|sans (piece|justificatif)|confirmation sans reponse)/;
const DISAGREEMENT = /(non comptabilise|pas (ete )?comptabilise|non provisionn|pas (ete )?provisionn|sous-?evalu|sur-?evalu|surevalu|sousevalu|erron|mal (calcul|determin|classe)|incorrect|sous-?declar|non conforme|ecart|inferieure? a|superieure? a|non (enregistre|constate)|omis)/;
const GOING_CONCERN = /(continuite d'exploitation|continuite de l'exploitation|going concern|moitie du capital)[^.]{0,200}(incertitude|doute|menace|compromi|inferieur|negati|dissolution)|(incertitude|doute|menace)[^.]{0,120}continuite d'exploitation/;
const NO_POINT = /(aucun point|neant|rien a signaler|pas de point)/;
function notePoints(docs) {
  const out = [];
  for (const note of docs.filter(d => d.roles?.has('note'))) {
    const s = fold(note.text), start = s.search(/points susceptibles d'avoir un effet sur l'opinion|points bloquants|points affectant l'opinion|points? (en suspens|non leves?)|ajustements? (proposes|non corriges)|anomalies non corrigees/);
    if (start < 0) continue;
    for (const x of sentences(note.text.slice(start, start + 15000))) {
      const f = fold(x);
      if (NO_POINT.test(f) || /^(\d+[\s.)-]*)?(verifier|obtenir|s'assurer|demander|relancer|envoyer)\b/.test(f)) continue;
      const lim = LIMITATION.test(f), dis = DISAGREEMENT.test(f);
      if (!lim && !dis) continue;
      const amount = amounts(x).filter(v => Math.abs(v) >= 1000 && !(v >= 1990 && v <= 2100)).sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? null;
      out.push({ type: lim && !dis ? 'limitation' : !lim && dis ? 'desaccord' : 'limitation_ou_desaccord', text: cut(x, 300), amount, doc: note.name });
    }
  }
  return out;
}
function reportOpinion(docs, mission) {
  const years = yearsOf(mission);
  for (const rep of docs.filter(d => d.roles?.has('rapport'))) {
    const s = fold(rep.text), at = s.indexOf('a notre avis'); if (at < 0 && !/impossibilite d'exprimer|refus de certifier/.test(s)) continue;
    const c = {}; for (const y of String(rep.text).slice(0, 20000).match(/20\d\d/g) || []) c[y] = (c[y] || 0) + 1;
    const y = Number(Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]); if (years.size && y && !years.has(y)) continue;
    const w = at >= 0 ? s.slice(Math.max(0, at - 1500), at + 1500) : s;
    const kind = /impossibilite d'exprimer|ne sommes pas en mesure d'exprimer|refus de certifier/.test(w) ? 'impossibilite'
      : /opinion defavorable|ne (donnent|presentent) pas une image fidele|ne sont pas reguliers/.test(w) ? 'defavorable'
      : /(sous reserve|a l'exception|excepte|opinion avec reserve)/.test(w) ? 'avec_reserve'
      : /(reguliers et sinceres|image fidele)/.test(w) ? 'sans_reserve' : null;
    if (kind) return { kind, doc: rep.name, quote: cut((sentences(rep.text).find(x => /a notre avis|impossibilite|refus/.test(fold(x))) || ''), 300) };
  }
  return null;
}
const LABEL = { sans_reserve: 'opinion sans réserve', avec_reserve: 'opinion avec réserve(s)', defavorable: 'opinion défavorable', impossibilite: 'impossibilité d’exprimer une opinion' };
export function opinionReading(docs, findings = [], mission = {}) {
  const read = docs.map(d => ({ ...d, roles: d.roles || new Set() }));
  const materiality = materialityOf(read, mission);
  const points = notePoints(read);
  // Links of the chain the checks found broken also weigh: an unanswered confirmation is a limitation; equity below half the
  // capital or a reassessment never mentioned is a disagreement with what the statements show.
  for (const f of findings) {
    if (f.check === 'C11') points.push({ type: 'limitation', text: f.title, amount: null, doc: f.quotes?.[0]?.doc || null, from_check: f.check });
    if (f.check === 'C4') points.push({ type: 'desaccord', text: f.title + (f.detail ? ' — ' + f.detail : ''), amount: null, doc: f.documents?.[0]?.name || null, from_check: f.check });
  }
  const goingConcern = findings.some(f => f.check === 'C5') || read.some(d => (d.roles.has('note') || d.roles.has('fiche') || d.roles.has('rapport')) && GOING_CONCERN.test(fold(d.text)));
  const inFile = reportOpinion(read, mission);
  const missing = [], why = [];
  const lim = points.filter(p => p.type !== 'desaccord'), dis = points.filter(p => p.type !== 'limitation');
  const m = materiality?.amount || null;
  if (!m) missing.push('le seuil de signification (montant) : sans lui, le caractère significatif des points ne peut pas être jugé');
  if (!read.some(d => d.roles.has('note'))) missing.push('la note de synthèse (les points pouvant affecter l’opinion)');
  const significant = p => p.amount == null ? null : Math.abs(p.amount) >= m;
  if (m) why.push(`Seuil de signification lu : ${m.toLocaleString('fr-FR')} (${materiality.source}).`);
  let proposed = null, logic;
  if (!points.length) {
    logic = m ? 'assurance' : 'impossible_sans_materialite';
    if (!missing.length) { proposed = 'sans_reserve'; why.push('Aucun point pouvant affecter l’opinion n’est relevé dans la synthèse ni par les contrôles de la chaîne.'); }
  } else if (!m && points.some(p => p.amount != null)) {
    logic = 'impossible_sans_materialite';
    why.push(`${points.length} point(s) relevé(s), mais leur caractère significatif ne peut pas être jugé sans matérialité.`);
  } else {
    const sigLim = lim.filter(p => significant(p) !== false), sigDis = dis.filter(p => significant(p) !== false);
    if (!sigLim.length && !sigDis.length) { logic = 'assurance'; proposed = 'sans_reserve'; why.push('Les points relevés sont tous chiffrés sous le seuil de signification.'); }
    else {
      logic = sigLim.length ? 'limitation' : 'anomalie';
      proposed = 'avec_reserve';
      if (sigDis.length) why.push(`${sigDis.length} désaccord(s) sur les comptes (anomalies non corrigées) : réserve pour désaccord (ISA 705 §7a) ; opinion défavorable si l’associé les juge généralisés (§8).`);
      if (sigLim.length) why.push(`${sigLim.length} limitation(s) : éléments probants non obtenus : réserve pour limitation (ISA 705 §7b) ; impossibilité d’exprimer une opinion si l’associé les juge généralisées (§9).`);
      const unknown = points.filter(p => p.amount == null).length;
      if (unknown) missing.push(`le montant de ${unknown} point(s) non chiffré(s) dans la synthèse`);
    }
  }
  if (goingConcern) why.push('Doute sur la continuité d’exploitation (ou capitaux propres sous la moitié du capital) : section « Incertitude significative liée à la continuité d’exploitation » si l’information des états financiers est adéquate, sinon réserve ou opinion défavorable (ISA 570).');
  const coherent = !inFile || !proposed ? null : (inFile.kind === 'sans_reserve') === (proposed === 'sans_reserve');
  if (coherent === false) why.push(`Le rapport du dossier donne une ${LABEL[inFile.kind]}, ce que les points du dossier ne soutiennent pas : à revoir par l’associé.`);
  return {
    in_file: inFile ? { kind: inFile.kind, label: LABEL[inFile.kind], doc: inFile.doc, quote: inFile.quote } : null,
    proposable: Boolean(proposed) && !missing.some(x => /seuil|note de synthese/.test(fold(x))),
    proposed: proposed ? { kind: proposed, label: LABEL[proposed], going_concern_section: goingConcern } : null,
    conclusion_logic: logic,
    materiality: m ? { amount: m, source: materiality.source } : null,
    points: points.slice(0, 20).map(p => ({ ...p, significant: m ? significant(p) : null })),
    reasoning: why, missing, coherent_with_file: coherent,
    decision: 'Associé', standards: ['ISA 705', 'ISA 706', 'ISA 570']
  };
}
