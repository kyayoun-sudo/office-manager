const ACCOUNTING_TOPICS = Object.freeze([
  { id: 'framework_and_scope', keywords: ['audcif','syscohada','ifrs','ias','conceptual framework','champ d application','referentiel','référentiel'] },
  { id: 'accounting_plan', keywords: ['plan comptable','numero de compte','numéro de compte','classe de compte','imputation','quel compte','compte comptable'] },
  { id: 'purchases_and_expenses', keywords: ['achat','achats','charge','charges','facture fournisseur','fournisseur','depense','dépense','bon de commande','bon de reception','three way match','3 way match'] },
  { id: 'sales_and_revenue', keywords: ['vente','ventes','produit','produits','facture client','chiffre d affaires','revenu','revenue','bon de livraison','avoir client','retour client','revenue recognition','reconnaissance du revenu'] },
  { id: 'property_plant_equipment', keywords: ['immobilisation','immobilisations','machine','materiel','matériel','equipement','équipement','amortissement','depreciation','dépréciation','impairment','cession d actif'] },
  { id: 'inventories', keywords: ['stock','stocks','inventaire','en cours','en-cours','marchandise','matiere premiere','matière première','obsolescence'] },
  { id: 'receivables', keywords: ['creance','créance','creances','créances','client douteux','impaye','impayé','recouvrement','balance agee','balance âgée','aging','encaissement posterieur','encaissement postérieur','solde client crediteur','circularisation clients'] },
  { id: 'payables', keywords: ['dette fournisseur','dettes fournisseurs','fnp','facture non parvenue','charge a payer','charge à payer','gr ir','gr/ir','reception non facturee','réception non facturée','releve fournisseur','relevé fournisseur'] },
  { id: 'cash_and_banking', keywords: ['banque','bancaire','caisse','tresorerie','trésorerie','rapprochement bancaire','releve bancaire','relevé bancaire','bank reconciliation','cheque en circulation','chèque en circulation','virement en transit','frais bancaires','compte dormant','confirmation bancaire','comptage caisse','ecart de caisse','découvert bancaire'] },
  { id: 'payroll_and_employee_costs', keywords: ['salaire','salaires','personnel','paie','payroll','charges sociales','cotisations sociales','employe','employé','prime','conges payes','indemnité','employee benefits'] },
  { id: 'taxes_and_levies', keywords: ['tva','impot','impôt','taxe','taxes','fiscalite','fiscalité','retenue a la source','declaration fiscale','impot differe','impôt différé','income tax'] },
  { id: 'provisions_and_contingencies', keywords: ['provision','provisions','passif eventuel','passif éventuel','contingent liability','litige','contentieux','proces','procès','avocat','estimation comptable','incertitude','fourchette estimation'] },
  { id: 'borrowings_and_financing', keywords: ['emprunt','emprunts','pret','prêt','interet','intérêt','dette financiere','financement','credit bancaire','ligne de credit','covenant','waiver','lease','location'] },
  { id: 'equity', keywords: ['capital','capitaux propres','reserve','réserve','report a nouveau','dividende','augmentation de capital','prime d emission'] },
  { id: 'foreign_currency', keywords: ['devise','devises','change','ecart de change','écart de change','reevaluation','réévaluation','monnaie etrangere','taux de change','functional currency','monnaie fonctionnelle'] },
  { id: 'period_end_close', keywords: ['cloture','clôture','cut off','cut-off','cutoff','regularisation','régularisation','fin d exercice','fin d’exercice','evenement posterieur','événement postérieur','checklist de cloture','ecriture manuelle','compte d attente','suspens'] },
  { id: 'financial_statements', keywords: ['etats financiers','états financiers','bilan','compte de resultat','tableau de flux','notes annexes','annexe','disclosure','disclosures','presentation'] },
  { id: 'consolidated_and_combined_accounts', keywords: ['consolidation','consolide','consolidé','comptes combines','groupe','filiale','intercompagnie','intercompany','elimination interco','business combination','regroupement d entreprises'] },
  { id: 'not_for_profit_specifics', keywords: ['sycebnl','ong','association','fondation','don','subvention','cotisation','fonds dedies','fonds affectes','donateur','bailleur','registre des donateurs','reporting bailleur'] },
]);

const AUDIT_TOPICS = Object.freeze([
  { id: 'acceptance_and_independence', keywords: ['acceptation mission','maintien mission','independance','indépendance','ethique','éthique','iesba','conflit d interet','conflit d’intérêt','services non audit','predécesseur','prédécesseur'] },
  { id: 'quality_management', keywords: ['isqm','gestion de la qualite','gestion de la qualité','quality management','revue qualite','revue qualité','monitoring','remediation','remédiation'] },
  { id: 'planning_and_materiality', keywords: ['planification audit','strategie audit','stratégie audit','materialite','matérialité','performance materiality','seuil audit','scope audit'] },
  { id: 'risk_assessment', keywords: ['risque audit','risques audit','risk assessment','registre des risques','risque inherent','risque inhérent','risque significatif','assertion','assertions'] },
  { id: 'fraud', keywords: ['fraude','fraud','management override','contournement direction','ecriture manuelle inhabituelle','écriture manuelle inhabituelle'] },
  { id: 'internal_control', keywords: ['controle interne','contrôle interne','walkthrough','test de controle','test de contrôle','design control','implementation control','itgc'] },
  { id: 'audit_evidence', keywords: ['element probant','élément probant','preuve audit','audit evidence','suffisance','fiabilite preuve','fiabilité preuve','working paper'] },
  { id: 'sampling', keywords: ['echantillon','échantillon','echantillonnage','échantillonnage','sampling','sample size'] },
  { id: 'confirmations', keywords: ['confirmation externe','circularisation','confirmation client','confirmation fournisseur','confirmation bancaire','isa 505'] },
  { id: 'estimates', keywords: ['estimation comptable','estimations comptables','isa 540','hypothese estimation','hypothèse estimation','biais de direction','model uncertainty'] },
  { id: 'related_parties', keywords: ['partie liee','partie liée','parties liees','parties liées','related party','related parties'] },
  { id: 'going_concern', keywords: ['continuite exploitation','continuité exploitation','going concern','cessation paiement','liquidite insuffisante','liquidité insuffisante'] },
  { id: 'subsequent_events', keywords: ['evenement posterieur','événement postérieur','evenements posterieurs','événements postérieurs','subsequent event'] },
  { id: 'reporting', keywords: ['opinion audit','rapport audit','audit report','opinion modifiee','opinion modifiée','reserve audit','réserve audit','kam','key audit matter','limitation scope'] },
  { id: 'sustainability_assurance', keywords: ['issa 5000','assurance durabilite','assurance durabilité','sustainability assurance','assurance esg'] },
]);

const ADVISORY_TOPICS = Object.freeze([
  { id: 'financial_analysis', keywords: ['analyse financiere','analyse financière','ratio','ratios','rentabilite','rentabilité','marge','marges','diagnostic financier'] },
  { id: 'budgeting_forecasting', keywords: ['budget','budgets','rolling forecast','forecast','prevision','prévision','scenario budget','analyse ecart budget','analyse écart budget'] },
  { id: 'working_capital', keywords: ['bfr','besoin en fonds de roulement','working capital','dso','dpo','dio','cash conversion'] },
  { id: 'internal_control_advisory', keywords: ['amelioration processus','amélioration processus','process improvement','controle interne conseil','contrôle interne conseil','optimisation processus'] },
  { id: 'due_diligence', keywords: ['due diligence','financial due diligence','quality of earnings','qoe','dette nette','net debt','normalized working capital','bfr normalise','bfr normalisé'] },
  { id: 'valuation', keywords: ['valorisation','valuation','ivs','dcf','discounted cash flow','comparables','multiple valorisation','fairness opinion'] },
  { id: 'transaction_support', keywords: ['transaction support','m&a','acquisition','cession','data room','purchase price','prix acquisition','synergie','synergies'] },
  { id: 'sustainability_esg', keywords: ['ifrs s1','ifrs s2','issb','esg','durabilite','durabilité','climat','climate','sustainability disclosure','sasb'] },
  { id: 'finance_transformation', keywords: ['transformation finance','finance transformation','r2r','p2p','o2c','erp finance','automatisation finance','operating model finance'] },
  { id: 'performance_management', keywords: ['kpi','kpis','performance management','tableau de bord','scorecard','indicateur performance'] },
  { id: 'scenario_analysis', keywords: ['scenario','scénario','sensibilite','sensibilité','stress test','upside','downside'] },
  { id: 'decision_support', keywords: ['note de decision','note de décision','decision memo','business case','recommandation direction','options strategiques','options stratégiques'] },
]);

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectFromTaxonomy(taxonomy, { query = '', task = '', frameworks = [] } = {}, bonuses = {}) {
  const haystack = normalise(`${task} ${query}`);
  const frameworkSet = new Set((Array.isArray(frameworks) ? frameworks : []).map((x) => normalise(x)));
  const scores = [];
  for (const topic of taxonomy) {
    let score = 0;
    for (const keyword of topic.keywords) {
      const needle = normalise(keyword);
      if (needle && haystack.includes(needle)) score += needle.includes(' ') ? 3 : 2;
    }
    if (typeof bonuses[topic.id] === 'function') score += Number(bonuses[topic.id](frameworkSet, haystack) || 0);
    if (score > 0) scores.push({ id: topic.id, score });
  }
  scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scores.slice(0, 4).map((row) => row.id);
}

export function detectAccountingTopics(input = {}) {
  return detectFromTaxonomy(ACCOUNTING_TOPICS, input, {
    not_for_profit_specifics: (frameworks) => frameworks.has('sycebnl') ? 5 : 0,
    framework_and_scope: (frameworks) => ['audcif','syscohada','ifrs','ias'].some((x) => frameworks.has(x)) ? 1 : 0,
  });
}

export function detectAuditTopics(input = {}) {
  return detectFromTaxonomy(AUDIT_TOPICS, input, {
    quality_management: (frameworks) => [...frameworks].some((x) => x.includes('isqm')) ? 5 : 0,
    acceptance_and_independence: (frameworks) => [...frameworks].some((x) => x.includes('iesba') || x.includes('independence')) ? 5 : 0,
    sustainability_assurance: (frameworks) => [...frameworks].some((x) => x.includes('issa')) ? 5 : 0,
  });
}

export function detectAdvisoryTopics(input = {}) {
  return detectFromTaxonomy(ADVISORY_TOPICS, input, {
    sustainability_esg: (frameworks) => [...frameworks].some((x) => x.includes('ifrs s1') || x.includes('ifrs s2') || x.includes('sasb')) ? 5 : 0,
    valuation: (frameworks) => [...frameworks].some((x) => x === 'ivs' || x.includes('valuation')) ? 5 : 0,
  });
}

export function detectTopicsForRequest(request = {}) {
  const topics = [];
  const domains = Array.isArray(request.domains) ? request.domains : [];
  if (domains.includes('accounting')) topics.push(...detectAccountingTopics(request));
  if (domains.includes('audit')) topics.push(...detectAuditTopics(request));
  if (domains.includes('advisory')) topics.push(...detectAdvisoryTopics(request));
  return [...new Set(topics)].slice(0, 10);
}

export const ACCOUNTING_TOPIC_IDS = Object.freeze(ACCOUNTING_TOPICS.map((topic) => topic.id));
export const AUDIT_TOPIC_IDS = Object.freeze(AUDIT_TOPICS.map((topic) => topic.id));
export const ADVISORY_TOPIC_IDS = Object.freeze(ADVISORY_TOPICS.map((topic) => topic.id));
