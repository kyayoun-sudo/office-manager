import { rest } from './supabase.js';
import { runAI } from './ai.js';
import { sandboxColleagues } from './test-mode.js';

// Agent mail identity (name, sending address, aliases) and internal tone.
// Configured only by the owner / managing partners (see lib/owner-auth.js).
// Colleagues: Nouchi and a playful tone if the owner chooses it.
// Clients and anyone outside the firm's domains: always a formal tone.
// Nothing here sends an e-mail: drafts only, until a mailbox is connected.

export const TONES = Object.freeze(['nouchi_fun', 'relaxed_fun', 'professional']);
export const FREQUENCIES = Object.freeze(['off', 'weekly', 'few_per_week', 'daily']);
export const DEFAULT_PERSONA = Object.freeze({
  agent_display_name: 'Office Manager',
  sender_email: null,
  reply_to: null,
  aliases: [],
  internal_domains: [],
  internal_tone: 'nouchi_fun',
  humor_level: 2,
  internal_frequency: 'few_per_week',
  signature: null
});

const EMAIL = /^[^@\s"',;:()<>[\]\\]+@[^@\s"',;:()<>[\]\\]+\.[^@\s"',;:()<>[\]\\]+$/;
// Public mailbox providers can never be a firm's domain (everyone there would be a "colleague").
const PUBLIC_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|aol|proton|protonmail|gmx|yandex|mail|zoho|orange|free|laposte|sfr|wanadoo)\.[a-z.]+$/;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const bad = code => Object.assign(new Error(code), { statusCode: 400 });

function cleanEmail(value, code) {
  if (value == null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (v.length > 254 || !EMAIL.test(v)) throw bad(code);
  return v;
}

function cleanList(value, max, check, code) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  const items = [...new Set(raw.map(x => String(x).trim().toLowerCase()).filter(Boolean))];
  if (items.length > max) throw bad(code);
  for (const x of items) if (!check(x)) throw bad(code);
  return items;
}

export function domainOf(email) {
  return String(email || '').trim().toLowerCase().split('@')[1] || '';
}

export function validatePersona(input = {}) {
  const name = String(input.agent_display_name ?? DEFAULT_PERSONA.agent_display_name).trim();
  if (name.length < 1 || name.length > 80) throw bad('INVALID_AGENT_NAME');
  const tone = String(input.internal_tone ?? DEFAULT_PERSONA.internal_tone);
  if (!TONES.includes(tone)) throw bad('INVALID_TONE');
  const frequency = String(input.internal_frequency ?? DEFAULT_PERSONA.internal_frequency);
  if (!FREQUENCIES.includes(frequency)) throw bad('INVALID_FREQUENCY');
  const humor = Number(input.humor_level ?? DEFAULT_PERSONA.humor_level);
  if (!Number.isInteger(humor) || humor < 0 || humor > 3) throw bad('INVALID_HUMOR_LEVEL');
  const signature = input.signature == null || input.signature === '' ? null : String(input.signature).trim().slice(0, 500);

  const sender = cleanEmail(input.sender_email, 'INVALID_SENDER_EMAIL');
  const replyTo = cleanEmail(input.reply_to, 'INVALID_REPLY_TO');
  const aliases = cleanList(input.aliases, 10, x => x.length <= 254 && EMAIL.test(x), 'INVALID_ALIASES');
  let domains = cleanList(input.internal_domains, 10, x => DOMAIN.test(x), 'INVALID_INTERNAL_DOMAINS');
  // The agent's own domain is internal by default.
  if (!domains.length && sender) domains = [domainOf(sender)];
  // Aliases must belong to the firm: same domains as the agent.
  for (const a of aliases) if (domains.length && !domains.includes(domainOf(a))) throw bad('ALIAS_OUTSIDE_FIRM_DOMAINS');
  if (sender && domains.length && !domains.includes(domainOf(sender))) throw bad('SENDER_OUTSIDE_FIRM_DOMAINS');
  if (domains.some(d => PUBLIC_MAIL.test(d))) throw bad('PUBLIC_DOMAIN_NOT_ALLOWED');
  // Replies to the agent's internal messages must stay inside the firm.
  if (replyTo && domains.length && !domains.includes(domainOf(replyTo))) throw bad('REPLY_TO_OUTSIDE_FIRM_DOMAINS');

  return {
    agent_display_name: name, sender_email: sender, reply_to: replyTo, aliases,
    internal_domains: domains, internal_tone: tone, humor_level: humor,
    internal_frequency: frequency, signature
  };
}

export function presentPersona(row) {
  const p = { ...DEFAULT_PERSONA, ...(row || {}) };
  return {
    agent_display_name: p.agent_display_name, sender_email: p.sender_email, reply_to: p.reply_to,
    aliases: p.aliases || [], internal_domains: p.internal_domains || [],
    internal_tone: p.internal_tone, humor_level: p.humor_level,
    internal_frequency: p.internal_frequency, signature: p.signature,
    configured: Boolean(row), sending_connected: false
  };
}

const COLUMNS = 'agent_display_name,sender_email,reply_to,aliases,internal_domains,internal_tone,humor_level,internal_frequency,signature';

export async function getPersona(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_agent_persona?org_id=eq.' + encodeURIComponent(orgId) + '&select=' + COLUMNS + '&limit=1');
  return presentPersona(rows?.[0] || null);
}

export async function savePersona(orgId, input, updatedBy = null, fetchRows = rest) {
  const clean = validatePersona(input);
  const row = { org_id: orgId, ...clean, updated_by: updatedBy ? String(updatedBy).slice(0, 120) : null, updated_at: new Date().toISOString() };
  const saved = await fetchRows('office_agent_persona?on_conflict=org_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row])
  });
  return presentPersona(saved?.[0] || row);
}

// A recipient is a colleague only if their domain is one of the firm's domains.
export function isInternal(email, persona) {
  const d = domainOf(email);
  return Boolean(d) && (persona.internal_domains || []).includes(d);
}

// Clients and unknown recipients always get the formal tone, whatever the setting.
export function toneFor(email, persona) {
  return isInternal(email, persona) ? persona.internal_tone : 'formal';
}

export function internalStyleGuide(persona) {
  const humor = ['aucune blague', 'une petite touche d’humour', 'de l’humour léger et régulier', 'beaucoup d’humour, comme un collègue blagueur'][persona.humor_level ?? 2];
  const base = [
    'Tu es ' + persona.agent_display_name + ', l’assistant du cabinet, et tu écris à tes collègues comme un collègue sympa.',
    'Les informations de travail (missions, dates, pièces, personnes, actions demandées) doivent rester exactes, complètes et faciles à comprendre. N’invente rien.',
    'Humour bienveillant uniquement : ' + humor + '. Jamais de moquerie visant une personne, son physique, son origine, sa religion, sa santé, son salaire ou ses performances.',
    'Si le sujet est sérieux (retard grave, problème avec un client, santé, deuil, question RH, sanction), pas de blague : ton chaleureux et professionnel.',
    'Ne mets dans le message aucune donnée confidentielle de client au-delà de ce qui est nécessaire à la tâche.'
  ];
  if (persona.internal_tone === 'nouchi_fun') {
    base.push(
      'Écris en français ivoirien avec du nouchi, naturellement, comme on parle entre collègues à Abidjan : des expressions courantes et bien comprises (par exemple « On dit quoi la team ? », « Ya fohi », « On est ensemble », « C’est comment ? », « Ça va aller », « y’a pas drap », « enjaillement »).',
      'Dose le nouchi : il donne le ton, mais chaque consigne de travail reste claire en français. Pas de caricature, pas d’expression vulgaire ou insultante.'
    );
  } else if (persona.internal_tone === 'relaxed_fun') {
    base.push('Écris en français courant, détendu et chaleureux, sans argot.');
  } else {
    base.push('Écris en français professionnel et cordial ; l’humour reste très discret.');
  }
  base.push('Réponds exactement sous la forme : première ligne « Objet : … », puis une ligne vide, puis le message.' +
    (persona.signature ? ' Termine par cette signature : ' + persona.signature : ' Signe « ' + persona.agent_display_name + ' ».'));
  return base.join('\n');
}

export function parseDraft(text) {
  const t = String(text || '').trim();
  const m = t.match(/^\s*Objet\s*:\s*(.+)\n+([\s\S]*)$/i);
  return m ? { subject: m[1].trim().slice(0, 200), body: m[2].trim() } : { subject: 'Message du cabinet', body: t };
}

// Drafts an internal message. Refuses any recipient outside the firm's domains.
export async function draftInternalMessage(orgId, input = {}, deps = {}) {
  const loadPersona = deps.getPersona || (id => getPersona(id));
  const ai = deps.runAI || runAI;
  const topic = String(input.topic || '').trim();
  if (topic.length < 3 || topic.length > 2000) throw bad('TOPIC_REQUIRED');
  const persona = await loadPersona(orgId);
  if (!persona.internal_domains.length) throw Object.assign(new Error('INTERNAL_DOMAINS_NOT_CONFIGURED'), { statusCode: 409 });
  const to = cleanList(input.recipients, 30, x => EMAIL.test(x), 'INVALID_RECIPIENTS');
  const outside = to.filter(e => !isInternal(e, persona) && !sandboxColleagues().includes(e));
  if (outside.length) throw Object.assign(new Error('RECIPIENT_OUTSIDE_FIRM'), { statusCode: 400, outside });
  const result = await ai({
    agentKey: 'grand-controleur',
    provider: 'openai',
    instructions: internalStyleGuide(persona),
    input: 'Message interne à rédiger pour : ' + (to.join(', ') || 'toute l’équipe') + '\nSujet : ' + topic
  });
  const draft = parseDraft(result.text);
  return {
    ...draft,
    to,
    from: persona.sender_email ? persona.agent_display_name + ' <' + persona.sender_email + '>' : null,
    tone: persona.internal_tone,
    sent: false,
    note: 'Brouillon : pour l’envoyer aux collègues, demandez-le dans « À valider » (envoi après validation, jamais aux clients).'
  };
}
