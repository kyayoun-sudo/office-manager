const ACCOUNTING_TOPICS = Object.freeze([
  { id: 'framework_and_scope', keywords: ['audcif','syscohada','champ d application','droit comptable','information financiere','information financière','referentiel','référentiel'] },
  { id: 'accounting_plan', keywords: ['plan comptable','numero de compte','numéro de compte','classe de compte','imputation','quel compte','compte comptable'] },
  { id: 'purchases_and_expenses', keywords: ['achat','achats','charge','charges','facture fournisseur','fournisseur','depense','dépense','bon de commande','commande fournisseur','bon de reception','bon de réception','reception fournisseur','réception fournisseur','three way match','3 way match','purchase order','invoice matching'] },
  { id: 'sales_and_revenue', keywords: ['vente','ventes','produit','produits','facture client','factures clients','client','chiffre d affaires','chiffre d’affaires','revenu','revenue','bon de livraison','bons de livraison','livraison client','preuve de livraison','prestation client','prestation facturee','prestation facturée','avoir client','avoirs clients','retour client','retours clients','annulation facture client','facture avant livraison','facture apres livraison','facture après livraison','vente non facturee','vente non facturée','revenue recognition','reconnaissance du revenu','reconnaissance des produits','sequence facture','séquence facture','facturation client'] },
  { id: 'property_plant_equipment', keywords: ['immobilisation','immobilisations','machine','materiel','matériel','equipement','équipement','amortissement','depreciation','dépréciation','cession d actif','cession d’actif'] },
  { id: 'inventories', keywords: ['stock','stocks','inventaire','en cours','en-cours','marchandise','matiere premiere','matière première','obsolescence'] },
  { id: 'receivables', keywords: ['creance','créance','creances','créances','client douteux','clients douteux','impaye','impayé','impayes','impayés','recouvrement','balance agee','balance âgée','aging','anciennete client','ancienneté client','encaissement posterieur','encaissement postérieur','encaissements posterieurs','encaissements postérieurs','solde client crediteur','solde client créditeur','soldes clients crediteurs','soldes clients créditeurs','balance auxiliaire clients','auxiliaire clients','rapprochement clients','circularisation clients','confirmation client','confirmations clients','litige client','limite de credit','limite de crédit'] },
  { id: 'payables', keywords: ['dette fournisseur','dettes fournisseurs','fnp','facture non parvenue','factures non parvenues','charge a payer','charge à payer','charges a payer','charges à payer','fournisseur','gr ir','gr/ir','goods received not invoiced','reception non facturee','réception non facturée','paiement posterieur','paiement postérieur','releve fournisseur','relevé fournisseur','solde fournisseur debiteur','solde fournisseur débiteur'] },
  { id: 'cash_and_banking', keywords: ['banque','banques','bancaire','bancaires','caisse','caisses','tresorerie','trésorerie','rapprochement bancaire','rapprochements bancaires','releve bancaire','relevé bancaire','releves bancaires','relevés bancaires','bank reconciliation','cheque en circulation','chèque en circulation','cheques en circulation','chèques en circulation','virement en transit','virements en transit','remise en transit','remises en transit','frais bancaires','interets bancaires','intérêts bancaires','commission bancaire','commissions bancaires','compte bancaire','comptes bancaires','compte dormant','compte ferme','compte fermé','confirmation bancaire','confirmations bancaires','circularisation banque','circularisation bancaire','comptage caisse','inventaire caisse','ecart de caisse','écart de caisse','decouvert bancaire','découvert bancaire','depots bloques','dépôts bloqués','fonds bloques','fonds bloqués','compte sequestre','compte séquestre','paiement inhabituel','mouvement bancaire inhabituel'] },
  { id: 'payroll_and_employee_costs', keywords: ['salaire','salaires','personnel','paie','charges sociales','cotisations sociales','employe','employé'] },
  { id: 'taxes_and_levies', keywords: ['tva','impot','impôt','taxe','taxes','fiscalite','fiscalité','retenue a la source','retenue à la source'] },
  { id: 'provisions_and_contingencies', keywords: ['provision','provisions','provision pour litige','provision litige','passif eventuel','passif éventuel','passifs eventuels','passifs éventuels','contingent liability','contingent liabilities','eventualite','éventualité','eventualites','éventualités','litige','litiges','contentieux','proces','procès','reclamation','réclamation','reclamations','réclamations','avocat','avocats','conseil juridique','honoraires juridiques','estimation comptable','estimations comptables','estimation','estimations','incertitude','fourchette estimation','fourchette d estimation','risque probable','obligation incertaine','obligations incertaines','engagement hors bilan','engagements hors bilan','charge a payer','charge à payer','charges a payer','charges à payer'] },
  { id: 'borrowings_and_financing', keywords: ['emprunt','emprunts','pret','prêt','interet','intérêt','dette financiere','dette financière','financement'] },
  { id: 'equity', keywords: ['capital','capitaux propres','reserve','réserve','reserves','réserves','report a nouveau','report à nouveau','dividende'] },
  { id: 'foreign_currency', keywords: ['devise','devises','change','ecart de change','écart de change','reevaluation','réévaluation','monnaie etrangere','monnaie étrangère','compte bancaire en devise','compte en devise','solde bancaire en devise'] },
  { id: 'period_end_close', keywords: ['cloture','clôture','cut off','cut-off','cutoff','regularisation','régularisation','fin d exercice','fin d’exercice','inventaire de cloture','inventaire de clôture','facture apres cloture','facture après clôture','paiement apres cloture','paiement après clôture','avoir apres cloture','avoir après clôture','avoirs apres cloture','avoirs après clôture','retour apres cloture','retour après clôture','livraison avant cloture','livraison avant clôture','livraison apres cloture','livraison après clôture','facture avant livraison','vente fin exercice','vente fin d exercice','vente fin d’exercice','virement interbancaire','virements interbancaires','virement en transit','virements en transit','cheque en circulation','chèque en circulation','remise en transit','bank transfer cutoff','provision de cloture','provision de clôture','charge a payer de cloture','charge à payer de clôture','evenement posterieur','événement postérieur','evenements posterieurs','événements postérieurs'] },
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
    .replace(/[^a-z0-9\s/-]/g, ' ')
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
  if (domains.includes('accounting')) topics.push(...detectAccountingTopics(request));
  return [...new Set(topics)];
}

export const ACCOUNTING_TOPIC_IDS = Object.freeze(ACCOUNTING_TOPICS.map((topic) => topic.id));
