// Test run "TATY TEST" (2026-10-07): 5 different audit missions over 3 months,
// accelerated: 1 week of mission = 1 real day (the 13 weeks last ~13 days).
// Fictitious clients, named "(TEST)"; the CFO of each client is played by Paul.

export const WEEKS = 13;
export const ROLES = ['associe', 'manager', 'chef_mission', 'assistant1', 'assistant2'];
export const ROLE_LABELS = {
  associe: 'Associé signataire', manager: 'Manager', chef_mission: 'Chef de mission (senior)',
  assistant1: 'Assistant 1', assistant2: 'Assistant 2', cfo: 'CFO du client'
};
// Fictitious team names (the e-mails are Paul's mailboxes, given in the page).
export const PEOPLE = {
  associe: 'Awa Koné (TEST)', manager: 'Serge Bamba (TEST)', chef_mission: 'Aya Traoré (TEST)',
  assistant1: 'Koffi N’Guessan (TEST)', assistant2: 'Mariam Diallo (TEST)'
};

const pbc = (ref, document, cycle, week, who) => ({ ref, document, cycle, week, who });

export const MISSIONS = [
  { code: 'TEST-CAC-ILS-2025', client: 'Ivoire Logistique SA (TEST)', type: 'Commissariat aux comptes', area: '01_AUDIT', exercise: '2025',
    close: '31/12/2025', start: 0, end: 12, roles: ['associe', 'manager', 'chef_mission', 'assistant1'],
    cycles: ['Trésorerie', 'Ventes-clients', 'Achats-fournisseurs', 'Immobilisations', 'Paie'],
    pbc: [pbc('PBC-00-01', 'Balance générale définitive 2025', 'Transverse', 1, 'chef_mission'), pbc('PBC-03-02', 'Relevés bancaires décembre 2025 et janvier 2026 (tous comptes)', 'Trésorerie', 2, 'assistant1'),
      pbc('PBC-03-03', 'États de rapprochement bancaire au 31/12/2025 visés', 'Trésorerie', 2, 'assistant1'), pbc('PBC-04-01', 'Balance âgée clients au 31/12/2025', 'Ventes-clients', 3, 'chef_mission'),
      pbc('PBC-07-01', 'Tableau des immobilisations et amortissements 2025', 'Immobilisations', 4, 'assistant1'), pbc('PBC-08-01', 'Journal de paie annuel 2025', 'Paie', 4, 'assistant1')] },
  { code: 'TEST-AUC-SAV-2025', client: 'Savane Agro SARL (TEST)', type: 'Audit contractuel des comptes', area: '01_AUDIT', exercise: '2025',
    close: '31/12/2025', start: 1, end: 8, roles: ['associe', 'manager', 'chef_mission', 'assistant2'],
    cycles: ['Stocks', 'Ventes-clients', 'Trésorerie'],
    pbc: [pbc('PBC-00-01', 'Balance générale définitive 2025', 'Transverse', 2, 'chef_mission'), pbc('PBC-06-01', 'Inventaire physique des stocks au 31/12/2025', 'Stocks', 3, 'assistant2'),
      pbc('PBC-04-02', 'Grand livre auxiliaire clients 2025', 'Ventes-clients', 3, 'assistant2'), pbc('PBC-03-02', 'Relevés bancaires décembre 2025', 'Trésorerie', 4, 'assistant2')] },
  { code: 'TEST-RVL-LAG-2026', client: 'Lagune Distribution SA (TEST)', type: 'Revue limitée des comptes semestriels', area: '01_AUDIT', exercise: 'S1 2026',
    close: '30/06/2026', start: 3, end: 7, roles: ['manager', 'chef_mission', 'assistant1'],
    cycles: ['Revue analytique', 'Trésorerie', 'Capitaux propres'],
    pbc: [pbc('PBC-00-02', 'Balance générale au 30/06/2026', 'Transverse', 3, 'chef_mission'), pbc('PBC-03-03', 'Rapprochements bancaires au 30/06/2026', 'Trésorerie', 4, 'assistant1'),
      pbc('PBC-11-01', 'Procès-verbal d’AG d’approbation des comptes 2025', 'Capitaux propres', 4, 'chef_mission')] },
  { code: 'TEST-DD-KOR-2026', client: 'Kora Industries (TEST)', type: 'Due diligence financière d’acquisition', area: '05_CONSEIL_AUTRES_MISSIONS', exercise: '2023-2025',
    close: '31/12/2025', start: 5, end: 10, roles: ['associe', 'manager', 'assistant2'],
    cycles: ['Qualité des résultats', 'Dette nette', 'BFR'],
    pbc: [pbc('PBC-DD-01', 'États financiers 2023, 2024, 2025', 'Qualité des résultats', 5, 'manager'), pbc('PBC-DD-02', 'Détail de la dette financière et des engagements hors bilan', 'Dette nette', 6, 'assistant2'),
      pbc('PBC-DD-03', 'Balances âgées clients et fournisseurs mensuelles 2025', 'BFR', 6, 'assistant2'), pbc('PBC-DD-04', 'Contrats clients significatifs (top 10)', 'Qualité des résultats', 7, 'manager')] },
  { code: 'TEST-AIN-BAN-2026', client: 'Bandama Énergie (TEST)', type: 'Audit interne du cycle achats', area: '03_CONTROLE_INTERNE', exercise: '2026',
    close: '30/09/2026', start: 8, end: 12, roles: ['manager', 'chef_mission', 'assistant1', 'assistant2'],
    cycles: ['Achats', 'Fournisseurs', 'Séparation des tâches'],
    pbc: [pbc('PBC-AI-01', 'Procédure achats en vigueur et organigramme', 'Achats', 8, 'chef_mission'), pbc('PBC-AI-02', 'Extraction des commandes et factures fournisseurs 2026', 'Achats', 9, 'assistant1'),
      pbc('PBC-AI-03', 'Fichier maître fournisseurs avec historique des modifications', 'Fournisseurs', 9, 'assistant2'), pbc('PBC-AI-04', 'Matrice des habilitations ERP', 'Séparation des tâches', 10, 'assistant1')] }
];

// 1 week of mission = 1 real day from the test start.
export function weekDate(startIso, week) {
  const d = new Date(startIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + week);
  return d.toISOString().slice(0, 10);
}
const fr = iso => iso.split('-').reverse().join('/');

export function letterText(m, emails, start) {
  return [
    'LETTRE DE MISSION — ' + m.type.toUpperCase() + ' (MISSION DE TEST — DONNÉES FICTIVES)', '',
    'Client : ' + m.client, 'Référence mission : ' + m.code, 'Exercice : ' + m.exercise + ' — date de clôture : ' + m.close, '',
    'Objet : ' + m.type + '. Cycles couverts : ' + m.cycles.join(', ') + '.',
    'Période d’intervention : du ' + fr(weekDate(start, m.start)) + ' au ' + fr(weekDate(start, m.end)) +
      ' (test accéléré : 1 semaine de mission = 1 jour).', '',
    'Interlocuteur côté client : Directeur administratif et financier (CFO), ' + emails.cfo + '.',
    'Associé signataire : ' + PEOPLE.associe + '.', '',
    'Statut : SIGNÉE par les deux parties (test).'
  ].join('\n');
}

export function programmeText(m, emails, start) {
  const team = m.roles.map(r => '- ' + ROLE_LABELS[r] + ' : ' + PEOPLE[r] + ' — ' + emails[r]).join('\n');
  const phases = [['Planification et prise de connaissance', m.start, m.start + 1], ['Demande PBC et relances', m.start + 1, m.end - 3],
    ['Travaux sur les cycles', m.start + 2, m.end - 2], ['Revue et finalisation', m.end - 2, m.end - 1], ['Rapport et clôture', m.end - 1, m.end]];
  return [
    'PROGRAMME DE TRAVAIL GÉNÉRAL — VERSION VALIDÉE (MISSION DE TEST — DONNÉES FICTIVES)', '',
    'Client : ' + m.client + ' | Mission : ' + m.type + ' | Référence : ' + m.code + ' | Exercice : ' + m.exercise, '',
    'ÉQUIPE', team, '',
    'CALENDRIER (1 semaine de mission = 1 jour réel)',
    ...phases.map(([label, a, b]) => '- ' + label + ' : semaine ' + (a + 1) + ' à ' + (Math.max(a, b) + 1) + ' (' + fr(weekDate(start, a)) + ' → ' + fr(weekDate(start, Math.max(a, b))) + ')'), '',
    'CYCLES SÉLECTIONNÉS : ' + m.cycles.join(', '), '',
    'DOCUMENTS À OBTENIR DU CLIENT (PBC) — responsable du suivi et date limite',
    ...m.pbc.map(p => '- ' + p.ref + ' | ' + p.document + ' | cycle ' + p.cycle + ' | responsable : ' + PEOPLE[p.who] + ' (' + emails[p.who] + ') | à recevoir le ' + fr(weekDate(start, p.week))), '',
    'Demandes au client : adressées au CFO (' + emails.cfo + '). Toute demande ou relance au client est proposée en brouillon par l’agent et validée par le manager avant envoi.', '',
    'Validé par : ' + PEOPLE.manager + ' et ' + PEOPLE.associe + ' — version VALIDÉE.'
  ].join('\n');
}

export function clientSheetText(m, emails) {
  return ['FICHE CLIENT (TEST — DONNÉES FICTIVES)', '', 'Société : ' + m.client, 'CFO / Directeur financier : ' + emails.cfo,
    'Référence mission : ' + m.code, 'Remarque : société fictive créée pour le test d’Office Manager.'].join('\n');
}

// Checks the mailboxes given in the page against the sandbox lists set in Vercel.
export function checkEmails(emails, sandbox) {
  const missing = [...ROLES, 'cfo'].filter(r => !emails?.[r]);
  if (missing.length) return { ok: false, error: 'MAILBOX_MISSING', missing };
  if (!sandbox) return { ok: false, error: 'MAIL_SANDBOX_NOT_ACTIVE' };
  const notColleague = ROLES.filter(r => !sandbox.colleagues.includes(String(emails[r]).toLowerCase()));
  const notClient = sandbox.clients.includes(String(emails.cfo).toLowerCase()) ? [] : ['cfo'];
  if (notColleague.length || notClient.length) return { ok: false, error: 'MAILBOX_NOT_IN_SANDBOX', roles: [...notColleague, ...notClient] };
  return { ok: true };
}
