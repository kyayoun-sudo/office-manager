export const PROFESSIONAL_SOURCES = Object.freeze([
  {
    sourceId: 'IFRS_ACCOUNTING_NAVIGATOR',
    domain: 'accounting',
    authority: 'IFRS Foundation',
    frameworks: ['IFRS', 'IAS', 'IFRIC', 'SIC', 'Conceptual Framework', 'IFRS for SMEs'],
    jurisdiction: 'International',
    sourceUrl: 'https://www.ifrs.org/issued-standards/list-of-standards/',
    licenceRequiredForProductIntegration: true,
  },
  {
    sourceId: 'IFRS_ACCOUNTING_TAXONOMY',
    domain: 'accounting',
    authority: 'IFRS Foundation',
    frameworks: ['IFRS Accounting Taxonomy'],
    jurisdiction: 'International',
    sourceUrl: 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/',
    licenceRequiredForProductIntegration: true,
  },
  {
    sourceId: 'OHADA_AUDCIF_SYSCOHADA',
    domain: 'accounting',
    authority: 'OHADA',
    frameworks: ['AUDCIF', 'SYSCOHADA'],
    jurisdiction: 'OHADA',
    sourceUrl: 'https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif/',
    licenceRequiredForProductIntegration: false,
  },
  {
    sourceId: 'OHADA_SYCEBNL',
    domain: 'accounting',
    authority: 'OHADA',
    frameworks: ['SYCEBNL'],
    jurisdiction: 'OHADA',
    sourceUrl: 'https://www.ohada.org/acte-uniforme-relatif-au-systeme-comptable-des-entites-a-but-non-lucratif/',
    licenceRequiredForProductIntegration: false,
  },
  {
    sourceId: 'IAASB_2026_HANDBOOK',
    domain: 'audit',
    authority: 'IAASB',
    frameworks: ['ISA', 'ISQM', 'IAPN', 'ISA for LCE', 'ISSA 5000', 'ISAE', 'ISRE', 'ISRS'],
    jurisdiction: 'International',
    sourceUrl: 'https://www.iaasb.org/publications/2026-handbook-international-quality-management-auditing-review-sustainability-and-other-assurance',
    licenceRequiredForProductIntegration: true,
  },
  {
    sourceId: 'IESBA_2026_CODE',
    domain: 'audit',
    authority: 'IESBA',
    frameworks: ['IESBA Code', 'International Independence Standards'],
    jurisdiction: 'International',
    sourceUrl: 'https://www.ethicsboard.org/publications/2026-handbook-international-code-ethics-professional-accountants',
    licenceRequiredForProductIntegration: true,
  },
  {
    sourceId: 'IFRS_SUSTAINABILITY_NAVIGATOR',
    domain: 'advisory',
    authority: 'IFRS Foundation / ISSB',
    frameworks: ['IFRS S1', 'IFRS S2', 'SASB'],
    jurisdiction: 'International',
    sourceUrl: 'https://www.ifrs.org/issued-standards/ifrs-sustainability-standards-navigator/',
    licenceRequiredForProductIntegration: true,
  },
  {
    sourceId: 'IVSC_IVS',
    domain: 'advisory',
    authority: 'IVSC',
    frameworks: ['IVS'],
    jurisdiction: 'International',
    sourceUrl: 'https://ivsc.org/standards/',
    licenceRequiredForProductIntegration: true,
  },
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
