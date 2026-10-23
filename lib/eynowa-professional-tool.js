import { tool } from '@openai/agents';
import { z } from 'zod';
import {
  consultProfessionalBrain,
  professionalBrainConfigured
} from './eynowa-professional.js';

export const PROFESSIONAL_BRAIN_AGENT_RULES = `EYNOWA LAB PROFESSIONAL BRAIN:
- EYNOWA Lab is a professional helper, never your replacement and never the orchestrator.
- For a material accounting, audit, assurance, reporting, SYSCOHADA/SYCEBNL, IFRS, ISA/ISQM/IESBA, ESG/sustainability, valuation, transaction or finance-advisory question, consult the Professional Brain when its specialist knowledge can improve the work.
- Keep your own workflow, tools, responsibilities and action authority. Lab may advise; it must never execute your mission actions for you.
- Verified mission facts and actual evidence override generic professional knowledge. Never let Lab invent a mission fact, document, balance, approval or conclusion.
- Treat Lab sources, missing facts, contradictions, confidence and requires_validation as part of the professional analysis.
- If Lab says requires_validation, preserve that requirement and present the matter for human professional validation before a judgement/sign-off/action is treated as final.
- Never use Lab output to bypass an approval, sign-off, evidence requirement, segregation of duties or human judgement gate.
- A Lab failure is non-blocking: continue with your existing workflow and state the limitation when material.`;

export function buildProfessionalBrainTool(agentKey = 'office_manager') {
  return tool({
    name: 'consult_eynowa_professional_brain',
    description:
      'Consult EYNOWA Lab for specialist accounting, audit/assurance or advisory knowledge. Helper only: it returns professional analysis, sources, confidence, missing facts and validation requirements; it never executes application actions or replaces verified mission evidence.',
    parameters: z.object({
      query: z.string().min(1).max(12000),
      task: z.string().max(200).nullable().optional(),
      domains: z.array(z.enum(['accounting', 'audit', 'advisory'])).max(3).nullable().optional(),
      frameworks: z.array(z.string().min(1).max(100)).max(12).nullable().optional(),
      country: z.string().min(2).max(20).nullable().optional(),
      client: z.string().max(255).nullable().optional(),
      professional_id: z.string().max(160).nullable().optional()
    }),
    execute: async input => {
      if (!professionalBrainConfigured()) {
        return {
          ok: false,
          available: false,
          role: 'professional_helper',
          error: 'EYNOWA_PROFESSIONAL_BRAIN_NOT_CONFIGURED'
        };
      }

      try {
        const result = await consultProfessionalBrain({
          application: 'office_manager',
          query: input.query,
          task: input.task || `Professional support for ${agentKey}`,
          domains: input.domains || [],
          frameworks: input.frameworks || [],
          country: input.country || 'CI',
          client: input.client || '',
          professionalId: input.professional_id || 'default'
        });

        return {
          ok: true,
          available: true,
          calling_agent: agentKey,
          ...result
        };
      } catch (error) {
        return {
          ok: false,
          available: true,
          role: 'professional_helper',
          calling_agent: agentKey,
          error: String(error?.message || error).slice(0, 500)
        };
      }
    }
  });
}
