import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateBranding, presentBranding, contrastRatio, textOn, initialOf, saveBranding, getBranding, DEFAULT_BRANDING
} from '../lib/branding.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('branding: valid input is normalised', () => {
  const b = validateBranding({ firm_name: '  TATY & Associés ', primary_color: '#0e5a52', logo_data_url: PNG });
  assert.equal(b.firm_name, 'TATY & Associés');
  assert.equal(b.primary_color, '#0E5A52');
  assert.equal(b.secondary_color, null);
  assert.equal(b.logo_data_url, PNG);
  assert.equal(b.readable, true);
});

test('branding: invalid name, colours and logos are refused', () => {
  assert.throws(() => validateBranding({ firm_name: '' }), /INVALID_FIRM_NAME/);
  assert.throws(() => validateBranding({ firm_name: 'x'.repeat(121) }), /INVALID_FIRM_NAME/);
  assert.throws(() => validateBranding({ firm_name: 'A', primary_color: 'red' }), /INVALID_PRIMARY_COLOR/);
  assert.throws(() => validateBranding({ firm_name: 'A', secondary_color: '#12' }), /INVALID_SECONDARY_COLOR/);
  // SVG is refused on purpose (could carry scripts).
  assert.throws(() => validateBranding({ firm_name: 'A', logo_data_url: 'data:image/svg+xml;base64,PHN2Zz4=' }), /INVALID_LOGO/);
  assert.throws(() => validateBranding({ firm_name: 'A', logo_data_url: 'https://example.com/logo.png' }), /INVALID_LOGO/);
  assert.throws(() => validateBranding({ firm_name: 'A', logo_data_url: 'data:image/png;base64,' + 'A'.repeat(400000) }), /INVALID_LOGO/);
  assert.equal(validateBranding({ firm_name: 'A', primary_color: '#FFFF00' }).readable, true);
});

test('branding: contrast and text colour follow WCAG', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF')), 21);
  assert.equal(textOn('#0E5A52'), '#FFFFFF');
  assert.equal(textOn('#F5E663'), '#17201D');
});

test('branding: initial and defaults', () => {
  assert.equal(initialOf('étude Kouassi'), 'É');
  assert.equal(initialOf('   '), 'C');
  const d = presentBranding(null);
  assert.equal(d.firm_name, DEFAULT_BRANDING.firm_name);
  assert.equal(d.configured, false);
  assert.equal(presentBranding({ firm_name: 'TATY', primary_color: '#1F3A68' }).initial, 'T');
});

test('branding: save and read go only to the new table, scoped to the organisation', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const body = options.body ? JSON.parse(options.body)[0] : { firm_name: 'TATY', primary_color: '#0E5A52' };
    return new Response(JSON.stringify([body]), { status: 200 });
  };
  try {
    const saved = await saveBranding('org-1', { firm_name: 'TATY', primary_color: '#1f3a68' }, 'Paul');
    assert.equal(saved.primary_color, '#1F3A68');
    assert.equal(saved.text_on_primary, '#FFFFFF');
    assert.equal(saved.updated_by, undefined, 'author is not exposed');
    await getBranding('org-1');
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/rest\/v1\/office_org_branding\?on_conflict=org_id$/);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(JSON.parse(calls[0].options.body)[0].org_id, 'org-1');
    assert.match(calls[1].url, /\/rest\/v1\/office_org_branding\?org_id=eq\.org-1&/);
    assert.ok(calls.every(c => c.url.includes('office_org_branding')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('branding: new pages build the DOM without innerHTML and reuse the pilot token key', () => {
  for (const file of ['../parametres.html', '../recherche.html', '../assets/brand-theme.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), file + ' must not inject HTML');
  }
  const theme = readFileSync(new URL('../assets/brand-theme.js', import.meta.url), 'utf8');
  assert.match(theme, /officeManagerToken/);
});
