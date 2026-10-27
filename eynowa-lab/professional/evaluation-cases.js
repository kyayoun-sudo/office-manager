const accounting = [
  ['acc-framework','Quel référentiel IFRS ou SYSCOHADA appliquer à cette entité ?','framework_and_scope'],
  ['acc-plan','Quel compte comptable utiliser pour cette imputation ?','accounting_plan'],
  ['acc-purchases','Analyse le three way match entre commande réception et facture fournisseur.','purchases_and_expenses'],
  ['acc-sales','Facture client émise avant livraison : analyse la reconnaissance du revenu.','sales_and_revenue'],
  ['acc-ppe','Machine importante avec composants et amortissement : analyse les immobilisations.','property_plant_equipment'],
  ['acc-stock','Stocks anciens et obsolescence à la clôture : que contrôler ?','inventories'],
  ['acc-ar','Créances anciennes, balance âgée et encaissements postérieurs.','receivables'],
  ['acc-ap','GR/IR ancien, FNP et réceptions non facturées.','payables'],
  ['acc-cash','Rapprochement bancaire avec chèques en circulation et écart de caisse.','cash_and_banking'],
  ['acc-payroll','Journal de paie, primes et congés payés à rapprocher.','payroll_and_employee_costs'],
  ['acc-tax','TVA, retenue à la source et contrôle fiscal en cours.','taxes_and_levies'],
  ['acc-prov','Provision pour litige et passif éventuel très incertain.','provisions_and_contingencies'],
  ['acc-debt','Emprunt bancaire, intérêts, échéancier et covenant non respecté.','borrowings_and_financing'],
  ['acc-equity','Augmentation de capital, dividendes et affectation du résultat.','equity'],
  ['acc-fx','Compte bancaire en devise et écart de change à la clôture.','foreign_currency'],
  ['acc-close','Checklist de clôture, suspens et écritures manuelles tardives.','period_end_close'],
  ['acc-fs','Prépare le mapping balance vers états financiers et annexes.','financial_statements'],
  ['acc-conso','Filiales, intercompany et éliminations de consolidation.','consolidated_and_combined_accounts'],
  ['acc-nfp','ONG sous SYCEBNL avec dons, bailleurs et fonds affectés.','not_for_profit_specifics'],
];

const audit = [
  ['audit-accept','Acceptation de mission et indépendance IESBA avant audit.','acceptance_and_independence'],
  ['audit-isqm','ISQM : monitoring, revue qualité et remédiation du cabinet.','quality_management'],
  ['audit-plan','Planification, stratégie d audit et matérialité de performance.','planning_and_materiality'],
  ['audit-risk','Évalue les risques inhérents, assertions et risques significatifs.','risk_assessment'],
  ['audit-fraud','Risque de fraude sur les revenus et management override.','fraud'],
  ['audit-ic','Walkthrough du contrôle interne et tests de contrôles ITGC.','internal_control'],
  ['audit-evidence','Les éléments probants sont-ils suffisants et appropriés ?','audit_evidence'],
  ['audit-sampling','Détermine une stratégie d échantillonnage et sample size.','sampling'],
  ['audit-confirm','Circularisation clients fournisseurs et confirmation bancaire ISA 505.','confirmations'],
  ['audit-est','ISA 540 : estimation comptable, hypothèses et biais de direction.','estimates'],
  ['audit-rp','Transactions avec parties liées et related parties non déclarées.','related_parties'],
  ['audit-gc','Continuité d exploitation et problème de liquidité.','going_concern'],
  ['audit-se','Événements postérieurs à la date de clôture.','subsequent_events'],
  ['audit-report','Opinion modifiée, réserve et limitation de scope dans le rapport.','reporting'],
  ['audit-sus','ISSA 5000 et assurance sur les informations de durabilité.','sustainability_assurance'],
];

const advisory = [
  ['adv-analysis','Analyse financière des marges, rentabilité et ratios.','financial_analysis'],
  ['adv-budget','Rolling forecast, budget flexible et analyse des écarts.','budgeting_forecasting'],
  ['adv-wc','Optimise le BFR, DSO, DPO et cash conversion cycle.','working_capital'],
  ['adv-ic','Amélioration des processus et contrôle interne conseil.','internal_control_advisory'],
  ['adv-dd','Financial due diligence, quality of earnings et net debt.','due_diligence'],
  ['adv-val','Valorisation IVS par DCF et comparables.','valuation'],
  ['adv-tx','Acquisition, data room, purchase price et synergies.','transaction_support'],
  ['adv-esg','IFRS S1, IFRS S2, ESG et disclosures climat.','sustainability_esg'],
  ['adv-transform','Transformation finance R2R P2P O2C et ERP.','finance_transformation'],
  ['adv-kpi','KPI, tableau de bord et performance management.','performance_management'],
  ['adv-scenario','Scénario downside, stress test et analyse de sensibilité.','scenario_analysis'],
  ['adv-decision','Business case et note de décision pour la direction.','decision_support'],
];

function rows(domain, values) {
  return values.map(([id, query, topic]) => ({
    id,
    input: { application: 'firm_manager', domains: [domain], query },
    expected_domains: [domain],
    expected_topics: [topic],
  }));
}

export const EVALUATION_CASES = Object.freeze([
  ...rows('accounting', accounting),
  ...rows('audit', audit),
  ...rows('advisory', advisory),
  {
    id: 'cross-acquisition',
    input: {
      application: 'firm_manager',
      domains: ['accounting','audit','advisory'],
      frameworks: ['IFRS','ISA','IESBA Code','IVS'],
      query: 'Acquisition financée par dette : business combination IFRS, risques audit, indépendance, due diligence et valorisation.'
    },
    expected_domains: ['accounting','audit','advisory'],
    expected_topics: ['consolidated_and_combined_accounts','acceptance_and_independence','due_diligence','valuation']
  },
  {
    id: 'cross-revenue-fraud',
    input: { application: 'firm_manager', domains: ['accounting','audit'], query: 'Revenus facturés avant livraison avec risque de fraude : traitement comptable et procédures audit.' },
    expected_domains: ['accounting','audit'],
    expected_topics: ['sales_and_revenue','fraud']
  },
  {
    id: 'cross-provision-estimate',
    input: { application: 'firm_manager', domains: ['accounting','audit'], query: 'Provision pour litige très incertaine : estimation comptable et audit ISA 540.' },
    expected_domains: ['accounting','audit'],
    expected_topics: ['provisions_and_contingencies','estimates']
  },
  {
    id: 'cross-going-concern',
    input: { application: 'firm_manager', domains: ['accounting','audit','advisory'], query: 'Tension de trésorerie et covenant rompu : continuité d exploitation, audit et scénarios de financement.' },
    expected_domains: ['accounting','audit','advisory'],
    expected_topics: ['borrowings_and_financing','going_concern','scenario_analysis']
  },
  {
    id: 'cross-esg-assurance',
    input: { application: 'firm_manager', domains: ['audit','advisory'], frameworks: ['ISSA 5000','IFRS S1','IFRS S2'], query: 'Préparer les disclosures IFRS S1/S2 et l assurance ISSA 5000.' },
    expected_domains: ['audit','advisory'],
    expected_topics: ['sustainability_assurance','sustainability_esg']
  },
  {
    id: 'cross-close-reporting',
    input: { application: 'firm_manager', domains: ['accounting','audit'], query: 'Clôture avec écritures manuelles tardives, événements postérieurs et préparation du rapport audit.' },
    expected_domains: ['accounting','audit'],
    expected_topics: ['period_end_close','subsequent_events','reporting']
  },
  {
    id: 'cross-bank-confirm',
    input: { application: 'firm_manager', domains: ['accounting','audit'], query: 'Rapprochement bancaire avec virement en transit et confirmation bancaire ISA 505.' },
    expected_domains: ['accounting','audit'],
    expected_topics: ['cash_and_banking','confirmations']
  },
  {
    id: 'cross-working-capital',
    input: { application: 'firm_manager', domains: ['accounting','advisory'], query: 'Créances anciennes et DSO élevé : analyse des receivables et optimisation du BFR.' },
    expected_domains: ['accounting','advisory'],
    expected_topics: ['receivables','working_capital']
  }
]);
