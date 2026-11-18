import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const page = readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../assets/mobile-chat.js', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../assets/mobile.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/mobile.css', import.meta.url), 'utf8');

test('mobile instant messaging is integrated as a separate client view', () => {
  assert.match(page, /src="\/assets\/mobile-chat\.js"/);
  for (const id of [
    'mobile-new-chat', 'mobile-chats', 'mobile-chat-thread-view', 'mobile-chat-messages',
    'mobile-chat-text', 'mobile-chat-form', 'mobile-chat-send', 'mobile-chat-back',
    'mobile-chat-archive', 'mobile-chat-status',
  ]) assert.ok(page.includes('id="' + id + '"'), id);
  assert.ok(mobile.includes('window.FirmMobileChat.init(OM)'));
  assert.ok(mobile.includes('window.FirmMobileChat.refresh(force)'));
  assert.ok(css.includes('.mobile-chat-bubble'));
});

test('mobile chat script parses and only calls the existing internal chat API', () => {
  assert.doesNotThrow(() => new Script(chat));
  assert.ok(chat.includes('/api/app?route=chat'));
  assert.ok(chat.includes("method: 'POST'"));
  assert.ok(chat.includes('JSON.stringify(body)'));
  assert.ok(chat.includes("document.hidden"));
  assert.ok(chat.includes('state.sending'));
  assert.ok(chat.includes('!navigator.onLine'));
  assert.ok(chat.includes('4000'));
  assert.ok(chat.includes("state.archive ? '&archive=1' : ''"));
});

test('mobile messages do not leak data into persistent browser stores', () => {
  assert.doesNotMatch(chat, /innerHTML\s*=/);
  assert.doesNotMatch(chat, /localStorage\s*[.\[]/);
  assert.doesNotMatch(chat, /sessionStorage\s*[.\[]/);
  assert.doesNotMatch(chat, /eval\(/);
  assert.doesNotMatch(chat, /https?:\/\//);
  assert.match(chat, /textContent/);
});
