import { rest } from './supabase.js';

// White-label branding: firm name, primary colour and logo per organisation.
// Additive module: does not change any existing table, agent or tool.

export const DEFAULT_BRANDING = Object.freeze({
  firm_name: 'Office Manager',
  primary_color: '#0E5A52',
  secondary_color: null,
  logo_data_url: null
});

const HEX = /^#[0-9A-Fa-f]{6}$/;
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_LOGO_CHARS = 400000;

function badRequest(code) {
  return Object.assign(new Error(code), { statusCode: 400 });
}

// WCAG relative luminance and contrast ratio.
function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// Text colour to place on the brand colour (buttons, logo tile).
export function textOn(hex) {
  return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, '#17201D') ? '#FFFFFF' : '#17201D';
}

export function initialOf(name) {
  const first = String(name || '').trim().charAt(0);
  return first ? first.toLocaleUpperCase('fr') : 'C';
}

export function validateBranding(input = {}) {
  const firm = String(input.firm_name ?? '').trim();
  if (firm.length < 1 || firm.length > 120) throw badRequest('INVALID_FIRM_NAME');
  const primary = String(input.primary_color ?? DEFAULT_BRANDING.primary_color).trim();
  if (!HEX.test(primary)) throw badRequest('INVALID_PRIMARY_COLOR');
  const secondaryRaw = input.secondary_color;
  const secondary = secondaryRaw == null || secondaryRaw === '' ? null : String(secondaryRaw).trim();
  if (secondary !== null && !HEX.test(secondary)) throw badRequest('INVALID_SECONDARY_COLOR');
  const logoRaw = input.logo_data_url;
  const logo = logoRaw == null || logoRaw === '' ? null : String(logoRaw);
  if (logo !== null && (!LOGO.test(logo) || logo.length > MAX_LOGO_CHARS)) throw badRequest('INVALID_LOGO');
  // Readability: white or dark text must reach 4.5:1 on the primary colour.
  const best = Math.max(contrastRatio(primary, '#FFFFFF'), contrastRatio(primary, '#17201D'));
  return {
    firm_name: firm,
    primary_color: primary.toUpperCase(),
    secondary_color: secondary ? secondary.toUpperCase() : null,
    logo_data_url: logo,
    readable: best >= 4.5
  };
}

// Public view used by every screen: never exposes who updated it.
export function presentBranding(row) {
  const b = { ...DEFAULT_BRANDING, ...(row || {}) };
  return {
    firm_name: b.firm_name,
    primary_color: b.primary_color,
    secondary_color: b.secondary_color,
    logo_data_url: b.logo_data_url,
    text_on_primary: textOn(b.primary_color),
    initial: initialOf(b.firm_name),
    configured: Boolean(row)
  };
}

export async function getBranding(orgId) {
  const rows = await rest('office_org_branding?org_id=eq.' + encodeURIComponent(orgId) +
    '&select=firm_name,primary_color,secondary_color,logo_data_url&limit=1');
  return presentBranding(rows?.[0] || null);
}

export async function saveBranding(orgId, input, updatedBy = null) {
  const clean = validateBranding(input);
  const { readable, ...fields } = clean;
  const row = {
    org_id: orgId,
    ...fields,
    updated_by: updatedBy ? String(updatedBy).slice(0, 120) : null,
    updated_at: new Date().toISOString()
  };
  const saved = await rest('office_org_branding?on_conflict=org_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row])
  });
  return { ...presentBranding(saved?.[0] || row), readable };
}
