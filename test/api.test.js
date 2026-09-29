import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { demoAlerts } from '../src/domain.js';

async function setup(t, overrides = {}) {
  const store = new Store(':memory:');
  const config = { APP_MODE: 'demo', APP_ORIGIN: 'http://localhost:3000', ...overrides };
  const { app, tick } = createApp(config, store);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.close(); store.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (path, data, headers = {}) => fetch(url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Prasittichoke': '1', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { request, store, tick };
}
test('demo intake → analysis → human decision works; duplicate approval conflicts', async t => {
  const { request, tick } = await setup(t);
  assert.equal((await request('/api/demo/alerts', demoAlerts[1])).status, 202); await tick();
  const c = await (await request(`/api/cases/${demoAlerts[1].ticketId}`)).json();
  assert.equal(c.state, 'AWAITING_ANWC');
  const d = { revision: 1, severity: 'LOW', reason: 'ตรวจสอบ maintenance ที่อนุมัติแล้ว' };
  assert.equal((await request(`/api/cases/${c.id}/decision`, d)).status, 200);
  assert.equal((await request(`/api/cases/${c.id}/decision`, d)).status, 409);
});
test('cross-origin writes and malformed input are rejected', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/demo/seed', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/demo/alerts', {})).status, 400);
  assert.equal((await request('/api/ingest', demoAlerts[0])).status, 401);
});
test('live authentication, secret-free config, integration token and demo isolation', async t => {
  const password = 'this-is-a-long-test-password'; const token = 'integration-test-token-32-characters';
  const { request } = await setup(t, { APP_MODE: 'live', ADMIN_PASSWORD: password, INGEST_TOKEN: token });
  assert.equal((await request('/api/cases')).status, 401);
  const login = await request('/api/login', { password });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie };
  const config = await (await request('/api/config', undefined, headers)).text();
  assert.ok(!config.includes(password)); assert.ok(!config.includes(token));
  assert.equal((await request('/api/demo/seed', {}, headers)).status, 403);
  assert.equal((await request('/api/cases/x/decision', {}, headers)).status, 403);
  assert.equal((await request('/api/ingest', demoAlerts[0], { Authorization: `Bearer ${token}` })).status, 202);
});
test('security headers are set and live startup requires secrets', async t => {
  const { request } = await setup(t); const response = await request('/healthz');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.throws(() => createApp({ APP_MODE: 'live' }), /ADMIN_PASSWORD/);
});
test('separate databases are required for demo and live', () => {
  const s = new Store(':memory:'); createApp({ APP_MODE: 'demo' }, s);
  assert.throws(() => createApp({ APP_MODE: 'live', ADMIN_PASSWORD: 'long-enough-password', INGEST_TOKEN: 'x'.repeat(32) }, s), /separate DATABASE_PATH/);
  s.close();
});
