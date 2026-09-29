import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRules, demoAlerts, mergeModel, sanitizeAlert } from '../src/domain.js';
import { Store, Conflict } from '../src/store.js';
import { analyze } from '../src/integrations.js';

test('verified Oracle maintenance can propose Low, never auto-close', () => {
  const r = analyzeRules(demoAlerts[1]);
  assert.equal(r.changeSource, 'SYSTEM'); assert.equal(r.recommendedSeverity, 'LOW');
});
test('Medium SYSTEM stays Medium and requires escalation', () => {
  const store = new Store(':memory:'); const a = demoAlerts[4];
  store.ingest(a); store.analysis(a.ticketId, 1, analyzeRules(a));
  assert.equal(store.get(a.ticketId).analysis.changeSource, 'SYSTEM');
  assert.equal(store.decide(a.ticketId, { revision: 1, severity: 'MEDIUM', reason: 'Verified medium impact' }, 'test').state, 'AWAITING_NHSO');
  store.close();
});
test('time or runtime pattern alone does not imply benign', () => {
  const r = analyzeRules({ ...demoAlerts[1], maintenance: null });
  assert.equal(r.changeSource, 'SUSPICIOUS'); assert.equal(r.recommendedSeverity, 'MEDIUM');
});
test('maintenance on another asset or outside window is not approved', () => {
  for (const patch of [{ asset: 'wrong' }, { endsAt: '2020-01-01T00:00:00Z' }, { scopeMatched: false }, { verified: false }]) {
    const r = analyzeRules({ ...demoAlerts[1], maintenance: { ...demoAlerts[1].maintenance, ...patch } });
    assert.equal(r.authorization, 'UNKNOWN'); assert.notEqual(r.recommendedSeverity, 'LOW');
  }
});
test('sensitive files set High floor; incomplete evidence never becomes Low', () => {
  assert.equal(analyzeRules(demoAlerts[2]).recommendedSeverity, 'HIGH');
  assert.equal(analyzeRules(demoAlerts[3]).recommendedSeverity, null);
  assert.notEqual(analyzeRules({ ...demoAlerts[1], evidenceComplete: false }).recommendedSeverity, 'LOW');
});
test('LLM cannot lower floor, add authority fields, or cite absent evidence', () => {
  const a = demoAlerts[0]; const base = analyzeRules(a);
  const m = { recommendedSeverity: 'LOW', summary: 'review', replyDraft: 'draft', evidenceRefs: ['alert.diff'], missingEvidence: [] };
  assert.equal(mergeModel(a, base, m).recommendedSeverity, 'HIGH');
  assert.throws(() => mergeModel(a, base, { ...m, finalSeverity: 'LOW' }));
  assert.throws(() => mergeModel({ ...a, diff: '' }, base, m));
});
test('model failure falls back to human review and cannot propose Low', async () => {
  const result = await analyze(demoAlerts[1], { APP_MODE: 'live', LLM_ENABLED: 'true' });
  assert.equal(result.assessmentStatus, 'NEEDS_MORE_EVIDENCE'); assert.equal(result.recommendedSeverity, null);
});
test('redacts secrets without corrupting JSON or evidence text', () => {
  const a = sanitizeAlert({ ...demoAlerts[0], diff: 'password=supersecret\nmail: person@example.com\nnormal=value' });
  assert.ok(!a.diff.includes('supersecret')); assert.ok(!a.diff.includes('person@example.com')); assert.ok(a.diff.includes('normal=value'));
});
test('deduplicates replay and rejects changed payload with same event ID', () => {
  const s = new Store(':memory:'); const a = demoAlerts[0];
  assert.equal(s.ingest(a).duplicate, false); assert.equal(s.ingest(a).duplicate, true);
  assert.throws(() => s.ingest({ ...a, diff: 'other' }), Conflict); assert.equal(s.jobs().length, 1); s.close();
});
test('new revision invalidates decision; old analysis and stale approval cannot win', () => {
  const s = new Store(':memory:'); const a = demoAlerts[1];
  s.ingest(a); s.analysis(a.ticketId, 1, analyzeRules(a));
  s.decide(a.ticketId, { revision: 1, severity: 'LOW', reason: 'Approved maintenance' }, 'test');
  s.ingest({ ...a, eventId: 'update', revision: 2 });
  assert.equal(s.get(a.ticketId).decision, null);
  assert.equal(s.analysis(a.ticketId, 1, analyzeRules(a)), false);
  assert.throws(() => s.decide(a.ticketId, { revision: 1, severity: 'LOW', reason: 'stale' }, 'test'), Conflict);
  assert.throws(() => s.ingest({ ...a, eventId: 'out-of-order' }), Conflict); s.close();
});
test('Zoho sync requires reply and handoff evidence and rejects stale status sequence', () => {
  const s = new Store(':memory:'); const a = demoAlerts[4]; s.ingest(a); s.analysis(a.ticketId, 1, analyzeRules(a));
  const status = { revision: 1, sequence: 1, severity: 'MEDIUM', state: 'AWAITING_NHSO', actor: 'anwc', reason: 'investigation required' };
  assert.throws(() => s.syncZoho(a.ticketId, status), Conflict);
  const valid = { ...status, replyReference: 'reply-1', handoffReference: 'assignment-1' };
  s.syncZoho(a.ticketId, valid); assert.equal(s.syncZoho(a.ticketId, valid).duplicate, true);
  assert.throws(() => s.syncZoho(a.ticketId, { ...valid, sequence: 2, state: 'CLOSED' }), Conflict); s.close();
});
test('delivery is deduplicated and uncertain results are not blindly retried', () => {
  const s = new Store(':memory:'); s.enqueue('x', 1, 'discord'); s.enqueue('x', 1, 'discord');
  assert.equal(s.jobs().length, 1); const j = s.claim(); s.finish(j, 'uncertain');
  assert.equal(s.claim(), null); assert.throws(() => s.retry(j.id), Conflict); s.close();
});
