import { consultEynowaLab } from './eynowa-lab-client.js';

function base(input = {}) {
  return {
    query: input.query,
    task: input.task || '',
    frameworks: Array.isArray(input.frameworks) ? input.frameworks : [],
    country: input.country || 'CI',
    professionalId: input.professionalId || input.professional_id || 'default',
    client: input.client || '',
  };
}

export function consultLabForFirmManager(input = {}) {
  return consultEynowaLab({
    application: 'firm_manager',
    ...base(input),
    domains: input.domains,
  });
}

export function consultLabForMissionController(input = {}) {
  return consultEynowaLab({
    application: 'mission_controller',
    ...base(input),
    task: [input.task, 'Support mission execution, planning, risk and professional methodology only. Mission Controller retains workflow authority.'].filter(Boolean).join(' | '),
    domains: input.domains || ['audit'],
  });
}

export function consultLabForEnhancedAuditor(input = {}) {
  return consultEynowaLab({
    application: 'enhanced_auditor',
    ...base(input),
    task: [input.task, 'Support full-population anomaly analysis and audit reasoning. Enhanced Auditor retains evidence-testing responsibility.'].filter(Boolean).join(' | '),
    domains: input.domains || ['accounting', 'audit'],
  });
}

export function consultLabForAccountingAI(input = {}) {
  return consultEynowaLab({
    application: 'accounting_ai',
    ...base(input),
    task: [input.task, 'Support accounting analysis and framework reasoning. Accounting AI retains workflow and posting authority.'].filter(Boolean).join(' | '),
    domains: input.domains || ['accounting'],
  });
}

export function consultLabForPostingApp(input = {}) {
  return consultEynowaLab({
    application: 'posting_app',
    ...base(input),
    task: [input.task, 'Support professional accounting interpretation only. Posting remains permission-gated and is never executed by EYNOWA Lab.'].filter(Boolean).join(' | '),
    domains: input.domains || ['accounting'],
  });
}

export function consultLabForAdvisoryApp(input = {}) {
  return consultEynowaLab({
    application: 'advisory_app',
    ...base(input),
    task: [input.task, 'Support advisory analysis only. The calling application and human professional retain recommendation and action authority.'].filter(Boolean).join(' | '),
    domains: input.domains || ['advisory'],
  });
}
