import express from 'express';
import { z } from 'zod';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store, Conflict } from './store.js';
import { sanitizeAlert, severity, decisionSchema, demoAlerts, ruleCatalog } from './domain.js';
import { analyze, deliver, integrationStatus, ticketUrl, DeliveryError } from './integrations.js';

function equal(a, b) {
  return timingSafeEqual(createHash('sha256').update(a || '').digest(), createHash('sha256').update(b || '').digest());
}

export function createApp(config = process.env, database) {
  const mode = config.APP_MODE || 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('APP_MODE must be demo or live');
  config = { ...config, APP_MODE: mode };
  if (mode === 'live' && (config.ADMIN_PASSWORD?.length < 16 || !config.ADMIN_PASSWORD)) throw new Error('Live mode requires ADMIN_PASSWORD (16+ characters)');
  if (mode === 'live' && (!config.INGEST_TOKEN || config.INGEST_TOKEN.length < 32)) throw new Error('Live mode requires INGEST_TOKEN (32+ characters)');
  const store = database || new Store(config.DATABASE_PATH || './data/prasittichoke.db');
  store.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const storedMode = store.db.prepare("SELECT value FROM app_meta WHERE key='mode'").get();
  if (storedMode && storedMode.value !== mode) throw new Error('Use a separate DATABASE_PATH for demo and live mode');
  store.db.prepare("INSERT OR IGNORE INTO app_meta VALUES('mode',?)").run(mode);
  const app = express();
  app.disable('x-powered-by');
  const sessions = new Map();
  const loginAttempts = new Map();
  app.use((req, res, next) => {
    res.set({ 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/healthz', (req, res) => {
    store.db.prepare('SELECT 1').get(); res.json({ status: 'ok' });
  });
  const bearer = (req, res, next) => {
    if (mode !== 'live' || !equal(req.headers.authorization, `Bearer ${config.INGEST_TOKEN}`)) return res.status(401).json({ error: 'Unauthorized integration' });
    next();
  };
  app.post('/api/ingest', bearer, (req, res) => {
    const result = store.ingest(sanitizeAlert(req.body), 'zoho-adapter');
    res.status(result.duplicate ? 200 : 202).json(result);
  });
  const statusSchema = z.object({
    revision: z.number().int().positive(), sequence: z.number().int().positive(), severity,
    state: z.enum(['AWAITING_NHSO', 'IN_PROGRESS_NHSO', 'CLOSED']),
    actor: z.string().min(1).max(150), reason: z.string().min(10).max(3000),
    replyReference: z.string().max(200).optional(), handoffReference: z.string().max(200).optional(), resolutionReference: z.string().max(200).optional()
  }).strict();
  app.post('/api/integrations/zoho/:id/status', bearer, (req, res) => res.json(store.syncZoho(req.params.id, statusSchema.parse(req.body))));

  // Browser writes require same-origin plus a custom header; integrations use bearer auth above.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      const expected = config.APP_ORIGIN || 'http://localhost:3000';
      if (req.headers['x-prasittichoke'] !== '1' || (origin && origin !== expected)) return res.status(403).json({ error: 'Invalid request origin' });
    }
    next();
  });
  app.post('/api/login', (req, res) => {
    const now = Date.now();
    for (const [ip, record] of loginAttempts) if (record.until <= now) loginAttempts.delete(ip);
    const key = req.socket.remoteAddress;
    const record = loginAttempts.get(key) || { count: 0, until: now + 900000 };
    if (record.count >= 10) return res.status(429).json({ error: 'ลองใหม่ใน 15 นาที' });
    if (!config.ADMIN_PASSWORD || typeof req.body?.password !== 'string' || !equal(req.body.password, config.ADMIN_PASSWORD)) {
      record.count++; loginAttempts.set(key, record);
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }
    loginAttempts.delete(key);
    for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, now + 8 * 3600000);
    res.cookie('ps_session', token, { httpOnly: true, sameSite: 'strict', secure: config.COOKIE_SECURE === 'true', maxAge: 8 * 3600000, path: '/' });
    res.json({ ok: true });
  });
  const auth = (req, res, next) => {
    if (mode === 'demo' && !config.ADMIN_PASSWORD) return next();
    const token = req.headers.cookie?.match(/(?:^|;\s*)ps_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token || (sessions.get(token) || 0) <= Date.now()) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    next();
  };
  app.use('/api', auth);
  app.post('/api/logout', (req, res) => {
    const token = req.headers.cookie?.match(/ps_session=([a-f0-9]{64})/)?.[1];
    sessions.delete(token); res.clearCookie('ps_session', { path: '/' }); res.json({ ok: true });
  });
  app.get('/api/config', (req, res) => res.json({ name: 'ประสิทธิโชค', mode, authenticated: !!config.ADMIN_PASSWORD,
    integrations: integrationStatus(config), rules: ruleCatalog }));
  const decorate = c => ({ ...c, ticketUrl: mode === 'live' ? ticketUrl(config, c.id) : null });
  app.get('/api/cases', (req, res) => res.json(store.list().map(decorate)));
  app.get('/api/cases/:id', (req, res) => {
    const c = store.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'ไม่พบเคส' });
    res.json({ ...decorate(c), audit: store.audits(c.id), jobs: store.jobs().filter(j => j.case_id === c.id) });
  });
  app.get('/api/audit', (req, res) => res.json(store.audits()));
  app.get('/api/jobs', (req, res) => res.json(store.jobs()));
  app.post('/api/jobs/:id/retry', (req, res) => { store.retry(req.params.id); res.json({ ok: true }); });
  app.post('/api/demo/seed', (req, res) => {
    if (mode !== 'demo') return res.status(403).json({ error: 'ใช้ได้เฉพาะโหมดสาธิต' });
    for (const a of demoAlerts) if (!store.get(a.ticketId)) store.ingest(a, 'demo');
    res.json({ ok: true });
  });
  app.post('/api/demo/alerts', (req, res) => {
    if (mode !== 'demo') return res.status(403).json({ error: 'ใช้ได้เฉพาะโหมดสาธิต' });
    res.status(202).json(store.ingest(sanitizeAlert(req.body), 'demo'));
  });
  app.post('/api/cases/:id/decision', (req, res) => {
    if (mode !== 'demo') return res.status(403).json({ error: 'เคสจริงต้องยืนยันและตอบผ่าน Zoho Desk' });
    res.json(store.decide(req.params.id, decisionSchema.parse(req.body), 'ANWC (demo)'));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((error, req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'ข้อมูลไม่ตรงรูปแบบ', fields: error.issues.map(i => i.path.join('.')) });
    if (error instanceof Conflict) return res.status(409).json({ error: error.message });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'ข้อมูลใหญ่เกินกำหนด' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'JSON ไม่ถูกต้อง' });
    console.error('Request failed:', error.name);
    res.status(500).json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' });
  });
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const job = store.claim();
      if (!job) return;
      const c = store.get(job.case_id);
      if (!c || c.revision !== job.revision) { store.finish(job, 'cancelled'); return; }
      try {
        if (job.kind === 'analyze') {
          const result = await analyze(c.alert, config);
          const channels = integrationStatus(config).filter(i => i.enabled && i.configured && i.id !== 'llm').map(i => i.id);
          store.analysis(c.id, c.revision, result, channels);
        } else {
          await deliver(job.kind, c, config);
          store.audit(c.id, 'DELIVERED', 'worker', `${job.kind}; revision ${c.revision}`);
        }
        store.finish(job);
      } catch (error) {
        const uncertain = error instanceof DeliveryError && error.uncertain;
        const retry = !uncertain && job.attempts < 3 && (job.kind === 'analyze' || error.retryable);
        store.finish(job, uncertain ? 'uncertain' : retry ? 'pending' : 'failed', error instanceof DeliveryError ? error.message : 'ประมวลผลไม่สำเร็จ');
        store.audit(c.id, uncertain ? 'DELIVERY_UNCERTAIN' : 'JOB_FAILED', 'worker', job.kind);
      }
    } finally { busy = false; }
  }
  return { app, store, tick, isBusy: () => busy };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.env.APP_MODE || 'demo';
  const host = process.env.HOST || '127.0.0.1';
  if (mode === 'demo' && !process.env.ADMIN_PASSWORD && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Demo without password must bind to loopback');
  const { app, store, tick, isBusy } = createApp();
  const server = app.listen(Number(process.env.PORT || 3000), host, () => console.log(`Prasittichoke ready · http://${host}:${process.env.PORT || 3000} · ${mode}`));
  const timer = setInterval(() => tick().catch(e => console.error('Worker failed:', e.name)), 500);
  let closing = false;
  async function shutdown() {
    if (closing) return; closing = true; clearInterval(timer);
    server.close();
    while (isBusy()) await new Promise(r => setTimeout(r, 100));
    store.close(); process.exit(0);
  }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
