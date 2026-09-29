import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fingerprint } from './domain.js';

export class Conflict extends Error {}
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, alert TEXT NOT NULL,
        analysis TEXT, state TEXT NOT NULL, decision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS zoho_status (case_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, sequence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, case_id TEXT, action TEXT NOT NULL,
        actor TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, revision INTEGER NOT NULL,
        kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(case_id, revision, kind));
      PRAGMA user_version=1;`);
    // A crashed external write may have succeeded. Do not blindly repeat it.
    this.db.exec("UPDATE jobs SET state=CASE WHEN kind='analyze' THEN 'pending' ELSE 'uncertain' END WHERE state='running'");
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  audit(id, action, actor, detail = '') {
    this.db.prepare('INSERT INTO audit(case_id,action,actor,detail,created_at) VALUES(?,?,?,?,?)')
      .run(id, action, actor, detail, new Date().toISOString());
  }
  enqueue(id, revision, kind) {
    this.db.prepare('INSERT OR IGNORE INTO jobs(id,case_id,revision,kind) VALUES(?,?,?,?)').run(randomUUID(), id, revision, kind);
  }
  ingest(a, actor = 'ingest') {
    return this.transaction(() => {
      const hash = fingerprint(a);
      const event = this.db.prepare('SELECT hash FROM events WHERE id=?').get(a.eventId);
      if (event) {
        if (event.hash !== hash) throw new Conflict('Event ID ถูกใช้กับข้อมูลอื่นแล้ว');
        return { duplicate: true, id: a.ticketId };
      }
      const previous = this.get(a.ticketId);
      if (previous && a.revision <= previous.revision) throw new Conflict('Revision ต้องใหม่กว่าข้อมูลปัจจุบัน');
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO cases VALUES(?,?,?,NULL,'QUEUED',NULL,?,?)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,alert=excluded.alert,analysis=NULL,
        state='QUEUED',decision=NULL,updated_at=excluded.updated_at`)
        .run(a.ticketId, a.revision, JSON.stringify(a), now, now);
      this.db.prepare('INSERT INTO events VALUES(?,?)').run(a.eventId, hash);
      this.db.prepare("UPDATE jobs SET state='cancelled' WHERE case_id=? AND revision<? AND state IN ('pending','failed')").run(a.ticketId, a.revision);
      this.enqueue(a.ticketId, a.revision, 'analyze');
      this.audit(a.ticketId, previous ? 'ALERT_UPDATED' : 'ALERT_RECEIVED', actor, `revision ${a.revision}; hash ${hash}`);
      return { duplicate: false, id: a.ticketId };
    });
  }
  decode(row) {
    return row ? { ...row, alert: JSON.parse(row.alert), analysis: row.analysis ? JSON.parse(row.analysis) : null,
      decision: row.decision ? JSON.parse(row.decision) : null } : null;
  }
  get(id) { return this.decode(this.db.prepare('SELECT * FROM cases WHERE id=?').get(id)); }
  list() { return this.db.prepare('SELECT * FROM cases ORDER BY updated_at DESC LIMIT 500').all().map(r => this.decode(r)); }
  audits(id) {
    return id ? this.db.prepare('SELECT * FROM audit WHERE case_id=? ORDER BY id DESC LIMIT 100').all(id)
      : this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all();
  }
  jobs() { return this.db.prepare('SELECT * FROM jobs ORDER BY rowid DESC LIMIT 200').all(); }
  analysis(id, revision, result, channels = []) {
    return this.transaction(() => {
      const current = this.get(id);
      if (!current || current.revision !== revision || current.decision) return false;
      this.db.prepare("UPDATE cases SET analysis=?,state='AWAITING_ANWC',updated_at=? WHERE id=?")
        .run(JSON.stringify(result), new Date().toISOString(), id);
      this.audit(id, 'TRIAGE_COMPLETED', 'triage-service', `${result.engine}; ${result.recommendedSeverity || 'UNASSESSED'}; rules ${result.ruleVersion}`);
      for (const kind of channels) this.enqueue(id, revision, kind);
      return true;
    });
  }
  decide(id, input, actor) {
    return this.transaction(() => {
      const c = this.get(id);
      if (!c || c.revision !== input.revision) throw new Conflict('ข้อมูลเปลี่ยนแล้ว กรุณาเปิดเคสใหม่');
      if (c.state !== 'AWAITING_ANWC') throw new Conflict('เคสนี้ไม่ได้อยู่ระหว่างรอตรวจสอบ');
      const state = input.severity === 'LOW' ? 'CLOSED' : 'AWAITING_NHSO';
      this.db.prepare('UPDATE cases SET decision=?,state=?,updated_at=? WHERE id=?')
        .run(JSON.stringify({ ...input, actor }), state, new Date().toISOString(), id);
      this.audit(id, state === 'CLOSED' ? 'DEMO_CLOSED' : 'DEMO_HANDOFF', actor, `${input.severity}: ${input.reason}`);
      return this.get(id);
    });
  }
  syncZoho(id, input) {
    return this.transaction(() => {
      const c = this.get(id);
      if (!c || c.revision !== input.revision) throw new Conflict('Revision ไม่ตรงกับข้อมูลปัจจุบัน');
      if (!c.analysis) throw new Conflict('ยังวิเคราะห์ไม่เสร็จ ให้ adapter ส่งสถานะซ้ำหลังประมวลผล');
      const previous = this.db.prepare('SELECT * FROM zoho_status WHERE case_id=?').get(id);
      if (previous && previous.revision === input.revision && previous.sequence >= input.sequence) return { duplicate: true };
      if (input.severity === 'LOW' && input.state !== 'CLOSED') throw new Conflict('Low ต้องจบที่ ANWC');
      if (input.severity !== 'LOW' && (!input.replyReference || !input.handoffReference)) throw new Conflict('ต้องมีหลักฐานตอบเคสและส่งต่อ NHSO');
      if (input.severity !== 'LOW' && input.state === 'CLOSED' && !input.resolutionReference) throw new Conflict('ต้องมีผลการแก้ไขจาก NHSO ก่อนปิดเคส');
      this.db.prepare('UPDATE cases SET decision=?,state=?,updated_at=? WHERE id=?').run(JSON.stringify(input), input.state, new Date().toISOString(), id);
      this.db.prepare('INSERT INTO zoho_status VALUES(?,?,?) ON CONFLICT(case_id) DO UPDATE SET revision=excluded.revision,sequence=excluded.sequence').run(id, input.revision, input.sequence);
      this.audit(id, 'ZOHO_STATUS_SYNCED', input.actor, `${input.state}; ${input.severity}; ${input.reason}`);
      return { duplicate: false };
    });
  }
  claim() {
    return this.transaction(() => {
      const job = this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND next_at<=? ORDER BY rowid LIMIT 1").get(Date.now());
      if (!job) return null;
      this.db.prepare("UPDATE jobs SET state='running',attempts=attempts+1 WHERE id=?").run(job.id);
      return { ...job, attempts: job.attempts + 1 };
    });
  }
  finish(job, state = 'done', error = null) {
    this.db.prepare('UPDATE jobs SET state=?,error=?,next_at=? WHERE id=?')
      .run(state, error, Date.now() + 2 ** job.attempts * 5000, job.id);
  }
  retry(id) {
    const j = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!j || !['failed'].includes(j.state)) throw new Conflict('งานนี้ retry ไม่ได้ หรือยังไม่ทราบผลการส่ง ต้องตรวจปลายทางก่อน');
    if (this.get(j.case_id)?.revision !== j.revision) throw new Conflict('งานนี้เป็นข้อมูลเวอร์ชันเก่า');
    this.db.prepare("UPDATE jobs SET state='pending',attempts=0,next_at=0,error=NULL WHERE id=?").run(id);
    this.audit(j.case_id, 'JOB_RETRIED', 'operator', j.kind);
  }
  close() { this.db.close(); }
}
