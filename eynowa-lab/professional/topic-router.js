const ACCOUNTING_TOPICS = Object.freeze([
  { id: 'framework_and_scope', keywords: ['audcif','syscohada','champ d application','droit comptable','information financiere','information financière','referentiel','référentiel'] },
  { id: 'accounting_plan', keywords: ['plan comptable','numero de compte','numéro de compte','classe de compte','imputation','quel compte','compte comptable'] },
  { id: 'purchases_and_expenses', keywords: ['achat','achats','charge','charges','facture fournisseur','fournisseur','depense','dépense'] },
  { id: 'sales_and_revenue', keywords: ['vente','ventes','produit','produits','facture client','client','chiffre d affaires','chiffre d’affaires','revenu'] },
  { id: 'property_plant_equipment', keywords: ['immobilisation','immobilisations','machine','materiel','matériel','equipement','équipement','amortissement','depreciation','dépréciation','cession d actif','cession d’actif'] },
  { id: 'inventories', keywords: ['stock','stocks','inventaire','en cours','en-cours','marchandise','matiere premiere','matière première','obsolescence'] },
  { id: 'receivables', keywords: ['creance','créance','creances','créances','client douteux','impaye','impayé','recouvrement'] },
  { id: 'payables', keywords: ['dette fournisseur','dettes fournisseurs','fnp','facture non parvenue','charge a payer','charge à payer','fournisseur'] },
  { id: 'cash_and_banking', keywords: ['banque','bancaire','caisse','tresorerie','trésorerie','rapprochement bancaire','releve bancaire','relevé bancaire'] },
  { id: 'payroll_and_employee_costs', keywords: ['salaire','salaires','personnel','paie','charges sociales','cotisations sociales','employe','employé'] },
  { id: 'taxes_and_levies', keywords: ['tva','impot','impôt','taxe','taxes','fiscalite','fiscalité','retenue a la source','retenue à la source'] },
  { id: 'provisions_and_contingencies', keywords: ['provision','provisions','litige','risque probable','passif eventuel','passif éventuel','contingent'] },
  { id: 'borrowings_and_financing', keywords: ['emprunt','emprunts','pret','prêt','interet','intérêt','dette financiere','dette financière','financement'] },
  { id: 'equity', keywords: ['capital','capitaux propres','reserve','réserve','reserves','réserves','report a nouveau','report à nouveau','dividende'] },
  { id: 'foreign_currency', keywords: ['devise','devises','change','ecart de change','écart de change','reevaluation','réévaluation','monnaie etrangere','monnaie étrangère'] },
  { id: 'period_end_close', keywords: ['cloture','clôture','cut off','cut-off','regularisation','régularisation','fin d exercice','fin d’exercice','inventaire de cloture','inventaire de clôture'] },
  { id: 'financial_statements', keywords: ['etats financiers','états financiers','bilan','compte de resultat','compte de résultat','tableau de flux','notes annexes','annexe'] },
  { id: 'consolidated_and_combined_accounts', keywords: ['consolidation','consolide','consolidé','comptes combines','comptes combinés','groupe','filiale'] },
  { id: 'not_for_profit_specifics', keywords: ['sycebnl','ong','association','fondation','don','dons','subvention','subventions','cotisation','cotisations','fonds dedies','fonds dédiés','donateur','donateurs'] },
]);

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectAccountingTopics({ query = '', task = '', frameworks = [] } = {}) {
  const haystack = normalise(`${task} ${query}`);
  const frameworkSet = new Set((Array.isArray(frameworks) ? frameworks : []).map((x) => normalise(x)));
  const scores = [];

  for (const topic of ACCOUNTING_TOPICS) {
    let score = 0;
    for (const keyword of topic.keywords) {
      const needle = normalise(keyword);
      if (needle && haystack.includes(needle)) score += needle.includes(' ') ? 3 : 2;
    }
    if (topic.id === 'not_for_profit_specifics' && frameworkSet.has('sycebnl')) score += 5;
    if (topic.id === 'framework_and_scope' && (frameworkSet.has('audcif') || frameworkSet.has('syscohada'))) score += 1;
    if (score > 0) scores.push({ id: topic.id, score });
  }

  scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scores.slice(0, 4).map((row) => row.id);
}

export function detectTopicsForRequest(request = {}) {
  const topics = [];
  const domains = Array.isArray(request.domains) ? request.domains : [];
  if (domains.includes('accounting')) {
    topics.push(...detectAccountingTopics(request));
  }
  return [...new Set(topics)];
}

export const ACCOUNTING_TOPIC_IDS = Object.freeze(ACCOUNTING_TOPICS.map((topic) => topic.id));
