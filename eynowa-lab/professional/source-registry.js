export const PROFESSIONAL_SOURCES = Object.freeze([
  { sourceId: 'IFRS_ACCOUNTING_NAVIGATOR', domain: 'accounting', authority: 'IFRS Foundation', frameworks: ['IFRS', 'IAS', 'IFRIC', 'SIC', 'Conceptual Framework', 'IFRS for SMEs'], jurisdiction: 'International', sourceUrl: 'https://www.ifrs.org/issued-standards/list-of-standards/', licenceStatus: 'LICENSE_REQUIRED_FOR_PRODUCT_INTEGRATION', authorityRole: 'normative' },
  { sourceId: 'IFRS_ACCOUNTING_TAXONOMY', domain: 'accounting', authority: 'IFRS Foundation', frameworks: ['IFRS Accounting Taxonomy'], jurisdiction: 'International', sourceUrl: 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', licenceStatus: 'VERIFY_BEFORE_INGESTION', authorityRole: 'structured_reference' },
  { sourceId: 'OHADA_AUDCIF_SYSCOHADA', domain: 'accounting', authority: 'OHADA', frameworks: ['AUDCIF', 'SYSCOHADA'], jurisdiction: 'OHADA', sourceUrl: 'https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif/', licenceStatus: 'VERIFY_BEFORE_INGESTION', authorityRole: 'normative' },
  { sourceId: 'OHADA_SYCEBNL', domain: 'accounting', authority: 'OHADA', frameworks: ['SYCEBNL'], jurisdiction: 'OHADA', sourceUrl: 'https://www.ohada.org/acte-uniforme-relatif-au-systeme-comptable-des-entites-a-but-non-lucratif/', licenceStatus: 'VERIFY_BEFORE_INGESTION', authorityRole: 'normative' },
  { sourceId: 'EYNOWA_ACCOUNTING_METHOD', domain: 'accounting', authority: 'EYNOWA', frameworks: ['EYNOWA Accounting Methodology', 'SYSCOHADA methodology', 'AUDCIF methodology', 'SYCEBNL methodology', 'IFRS methodology', 'IAS methodology'], jurisdiction: 'Internal methodology', sourceUrl: 'https://github.com/kyayoun-sudo/office-manager/tree/feat/eynowa-lab-professional-brains/eynowa-lab/professional/packs', licenceStatus: 'EYNOWA_OWNED', authorityRole: 'methodology_non_normative' },
  { sourceId: 'IAASB_2026_HANDBOOK', domain: 'audit', authority: 'IAASB', frameworks: ['ISA', 'ISQM', 'IAPN', 'ISA for LCE', 'ISSA 5000', 'ISAE', 'ISRE', 'ISRS'], jurisdiction: 'International', sourceUrl: 'https://www.iaasb.org/publications/2026-handbook-international-quality-management-auditing-review-sustainability-and-other-assurance', licenceStatus: 'PERMISSION_REQUIRED_FOR_REPRODUCTION_OR_AI_INGESTION', authorityRole: 'normative' },
  { sourceId: 'IESBA_2026_CODE', domain: 'audit', authority: 'IESBA', frameworks: ['IESBA Code', 'International Independence Standards'], jurisdiction: 'International', sourceUrl: 'https://www.ethicsboard.org/publications/2026-handbook-international-code-ethics-professional-accountants', licenceStatus: 'PERMISSION_REQUIRED_FOR_REPRODUCTION_OR_AI_INGESTION', authorityRole: 'normative' },
  { sourceId: 'OHADA_ISA_IMPLEMENTATION_TOOLS', domain: 'audit', authority: 'CNC-OHADA / OHADA', frameworks: ['ISA', 'Audit methodology', 'Quality assurance'], jurisdiction: 'OHADA', sourceUrl: 'https://www.ohada.org/outils-pratiques-de-mise-en-oeuvre-des-normes-isa/', licenceStatus: 'VERIFY_BEFORE_INGESTION', authorityRole: 'implementation_guidance' },
  { sourceId: 'EYNOWA_AUDIT_METHOD', domain: 'audit', authority: 'EYNOWA', frameworks: ['EYNOWA Audit Methodology', 'ISA methodology', 'ISQM methodology', 'IESBA methodology', 'ISA for LCE methodology', 'ISSA methodology', 'Audit methodology'], jurisdiction: 'Internal methodology', sourceUrl: 'https://github.com/kyayoun-sudo/office-manager/tree/feat/eynowa-lab-professional-brains/eynowa-lab/professional/packs', licenceStatus: 'EYNOWA_OWNED', authorityRole: 'methodology_non_normative' },
  { sourceId: 'IFRS_SUSTAINABILITY_NAVIGATOR', domain: 'advisory', authority: 'IFRS Foundation / ISSB', frameworks: ['IFRS S1', 'IFRS S2', 'SASB'], jurisdiction: 'International', sourceUrl: 'https://www.ifrs.org/issued-standards/ifrs-sustainability-standards-navigator/', licenceStatus: 'LICENSE_REQUIRED_FOR_PRODUCT_INTEGRATION', authorityRole: 'normative' },
  { sourceId: 'IVSC_IVS', domain: 'advisory', authority: 'IVSC', frameworks: ['IVS', 'Valuation'], jurisdiction: 'International', sourceUrl: 'https://ivsc.org/standards/', licenceStatus: 'VERIFY_BEFORE_INGESTION', authorityRole: 'normative' },
  { sourceId: 'EYNOWA_ADVISORY_METHOD', domain: 'advisory', authority: 'EYNOWA', frameworks: ['EYNOWA Advisory Methodology', 'Valuation methodology', 'Due diligence methodology', 'Financial analysis methodology', 'Budgeting methodology', 'Internal control advisory', 'IFRS S1 methodology', 'IFRS S2 methodology', 'ESG methodology'], jurisdiction: 'Internal methodology', sourceUrl: 'https://github.com/kyayoun-sudo/office-manager/tree/feat/eynowa-lab-professional-brains/eynowa-lab/professional/packs', licenceStatus: 'EYNOWA_OWNED', authorityRole: 'methodology_non_normative' },
]);

export function sourcesFor({ domain, framework } = {}) {
  const wantedDomain = String(domain || '').trim().toLowerCase();
  const wantedFramework = String(framework || '').trim().toLowerCase();
  return PROFESSIONAL_SOURCES.filter((source) => {
    if (wantedDomain && source.domain !== wantedDomain) return false;
    if (!wantedFramework) return true;
    return source.frameworks.some((item) => item.toLowerCase().includes(wantedFramework));
  });
}

export function registeredSourceIds({ domain, framework } = {}) {
  return sourcesFor({ domain, framework }).map((source) => source.sourceId);
}
