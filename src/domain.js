import { z } from 'zod';
import { createHash } from 'node:crypto';

export const levels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const severity = z.enum(levels);
export const alertSchema = z.object({
  eventId: z.string().min(1).max(150),
  ticketId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  revision: z.number().int().positive(),
  title: z.string().min(1).max(250),
  asset: z.string().min(1).max(150),
  system: z.enum(['Oracle', 'Web', 'Linux', 'Palo Alto', 'F5', 'Other']),
  occurredAt: z.iso.datetime({ offset: true }),
  sourceSeverity: severity,
  criticalAsset: z.boolean().default(false),
  path: z.string().max(1000).default(''),
  diff: z.string().max(30000).default(''),
  evidenceComplete: z.boolean().default(false),
  actor: z.string().max(150).default(''),
  maintenance: z.object({
    reference: z.string().min(1).max(150),
    asset: z.string().max(150),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    scopeMatched: z.boolean(),
    verified: z.boolean()
  }).nullable().default(null)
}).strict();

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function redact(text) {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]');
}

export function sanitizeAlert(input) {
  const a = alertSchema.parse(input);
  return { ...a, title: redact(a.title), diff: redact(a.diff), actor: redact(a.actor), path: redact(a.path) };
}

export const ruleCatalog = [
  { id: 'R-01', title: 'หลักฐานการเปลี่ยนแปลงไม่ครบ', description: 'ข้อมูล diff หรือบริบทไม่ครบ → รอ ANWC ตรวจสอบ ไม่จัดเป็น Low' },
  { id: 'R-02', title: 'ไฟล์และค่าความปลอดภัยสำคัญ', description: 'การเปลี่ยน executable, บัญชีสิทธิ์สูง หรือ security control → เสนออย่างน้อย High' },
  { id: 'R-03', title: 'Maintenance ที่ตรวจสอบแล้ว', description: 'ต้องตรงกับ asset, เวลา และขอบเขต พร้อมเอกสารอ้างอิง' },
  { id: 'R-04', title: 'ระดับจากต้นทาง', description: 'ไม่ลดระดับจาก Tripwire อัตโนมัติ ให้ ANWC ตัดสินใจ' },
  { id: 'R-05', title: 'มนุษย์ยืนยันก่อนดำเนินการ', description: 'Low จบที่ ANWC; Medium ขึ้นไปตอบและส่งต่อ NHSO รวม SYSTEM' }
];

export function analyzeRules(a) {
  const missing = [];
  if (!a.diff.trim()) missing.push('รายละเอียด before/after หรือ diff');
  if (!a.evidenceComplete) missing.push('หลักฐานและบริบทที่ครบถ้วน');
  const m = a.maintenance;
  const validMaintenance = !!(m?.verified && m.scopeMatched && m.asset === a.asset &&
    Date.parse(m.startsAt) <= Date.parse(a.occurredAt) && Date.parse(a.occurredAt) <= Date.parse(m.endsAt));
  const sensitive = /(?:^|\/)(?:bin|sbin)(?:\/|$)|\.php$|sshd_config|sudoers|\/etc\/passwd|\/etc\/shadow/i.test(a.path) ||
    /audit_trail|security policy|admin account|authentication profile|permitrootlogin/i.test(a.diff);
  const runtime = /cpu_count|cpu_min_count|parallel_servers_target|job_queue_processes|session count|runtime counter|metadata/i.test(a.diff);
  let recommendedSeverity = a.sourceSeverity;
  const matchedRuleIds = ['R-04', 'R-05'];
  const reasons = [];
  if (sensitive) {
    recommendedSeverity = levels[Math.max(2, levels.indexOf(recommendedSeverity))];
    matchedRuleIds.push('R-02');
    reasons.push('พบการเปลี่ยนไฟล์หรือค่าที่เกี่ยวข้องกับความปลอดภัย ต้องตรวจผลกระทบ');
  }
  if (validMaintenance) {
    matchedRuleIds.push('R-03');
    reasons.push(`มี maintenance ที่ยืนยันแล้วและตรงกับ asset เวลา และขอบเขต (${m.reference})`);
  } else {
    missing.push('หลักฐานอนุมัติการเปลี่ยนแปลงที่ตรงกับเหตุการณ์');
    reasons.push('ยังไม่พบ maintenance ที่ยืนยันได้ครบทุกเงื่อนไข');
    if (recommendedSeverity === 'LOW') recommendedSeverity = 'MEDIUM';
  }
  if (missing.length && !a.diff.trim()) {
    matchedRuleIds.push('R-01');
    recommendedSeverity = levels.indexOf(recommendedSeverity) >= 2 ? recommendedSeverity : null;
  } else if (!a.evidenceComplete) {
    matchedRuleIds.push('R-01');
    if (recommendedSeverity === 'LOW') recommendedSeverity = null;
  }
  const changeSource = a.actor ? 'USER' : validMaintenance && runtime ? 'SYSTEM' : 'SUSPICIOUS';
  const summary = reasons.join(' • ');
  return {
    recommendedSeverity, changeSource, authorization: validMaintenance ? 'APPROVED' : 'UNKNOWN',
    assessmentStatus: missing.length ? 'NEEDS_MORE_EVIDENCE' : 'READY_FOR_REVIEW',
    summary, evidenceRefs: a.diff ? ['alert.diff'] : [], missingEvidence: missing, matchedRuleIds,
    replyDraft: `เรียนทีม NHSO\n\nตรวจพบการเปลี่ยนแปลงบน ${a.asset} ในเคส ${a.ticketId}\n${summary}\n\nระดับที่เสนอ: ${recommendedSeverity || 'ยังประเมินไม่ได้'} (รอ ANWC ยืนยัน)\nกรุณาตรวจสอบรายการเปลี่ยนแปลงและแจ้งผลการดำเนินการกลับในเคสนี้`,
    incidentDraft: ['HIGH', 'CRITICAL'].includes(recommendedSeverity) ?
      `DRAFT — pending ANWC verification\nTicket: ${a.ticketId}\nAsset: ${a.asset}\nDetected: ${a.occurredAt}\nProposed severity: ${recommendedSeverity}\nChange: ${a.path}\nImpact and root cause: not confirmed.\nEvidence: alert.diff\nNext step: ANWC verification and NHSO investigation.` : null,
    engine: 'rules', ruleVersion: '1.0.0', promptVersion: '1.0.0', model: null
  };
}

export const modelSchema = z.object({
  recommendedSeverity: severity.nullable(),
  summary: z.string().min(1).max(3000),
  evidenceRefs: z.array(z.literal('alert.diff')).max(1),
  replyDraft: z.string().min(1).max(5000),
  missingEvidence: z.array(z.string().max(300)).max(20)
}).strict();

export function mergeModel(a, base, candidate) {
  const result = modelSchema.parse(candidate);
  if (result.evidenceRefs.length && !a.diff) throw new Error('Unsupported evidence');
  const proposed = result.recommendedSeverity;
  // A model can raise a known recommendation, never lower a policy floor or clear missing evidence.
  const final = base.recommendedSeverity === null ? null :
    levels[Math.max(levels.indexOf(base.recommendedSeverity), levels.indexOf(proposed))];
  return { ...base, recommendedSeverity: final, summary: result.summary,
    incidentDraft: base.incidentDraft || (['HIGH', 'CRITICAL'].includes(final) ? `DRAFT — pending ANWC verification\nTicket: ${a.ticketId}\nProposed severity: ${final}\nImpact and root cause: not confirmed.\nNext step: ANWC verification and NHSO investigation.` : null),
    replyDraft: result.replyDraft, missingEvidence: [...new Set([...base.missingEvidence, ...result.missingEvidence])],
    assessmentStatus: base.missingEvidence.length || result.missingEvidence.length ? 'NEEDS_MORE_EVIDENCE' : base.assessmentStatus,
    engine: 'rules + llm' };
}

export const decisionSchema = z.object({
  revision: z.number().int().positive(),
  severity, reason: z.string().trim().min(10).max(3000)
}).strict();

export const demoAlerts = [
  { eventId: 'demo-1', ticketId: 'DEMO-1042', revision: 1, title: 'Unexpected change in authentication configuration', asset: 'web-prod-01', system: 'Linux', sourceSeverity: 'HIGH', path: '/etc/ssh/sshd_config', diff: '- PermitRootLogin no\n+ PermitRootLogin yes', evidenceComplete: true, criticalAsset: true },
  { eventId: 'demo-2', ticketId: 'DEMO-1041', revision: 1, title: 'Oracle scheduled resource adjustment', asset: 'oracle-rac-02', system: 'Oracle', sourceSeverity: 'LOW', path: 'GV$PARAMETER', diff: '- cpu_count: 8\n+ cpu_count: 12', evidenceComplete: true, maintenance: { reference: 'CHG-DEMO-081', asset: 'oracle-rac-02', startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', scopeMatched: true, verified: true } },
  { eventId: 'demo-3', ticketId: 'DEMO-1040', revision: 1, title: 'Web application component modified', asset: 'portal-web-03', system: 'Web', sourceSeverity: 'MEDIUM', path: '/var/www/components/index.php', diff: '- checksum: a3c8\n+ checksum: 90bf', evidenceComplete: true },
  { eventId: 'demo-4', ticketId: 'DEMO-1039', revision: 1, title: 'Firewall configuration requires more evidence', asset: 'fw-edge-01', system: 'Palo Alto', sourceSeverity: 'MEDIUM', path: 'running-config', diff: '', evidenceComplete: false },
  { eventId: 'demo-5', ticketId: 'DEMO-1038', revision: 1, title: 'Runtime resource change on database', asset: 'oracle-prod-01', system: 'Oracle', sourceSeverity: 'MEDIUM', path: 'GV$PARAMETER', diff: '- job_queue_processes: 100\n+ job_queue_processes: 200', evidenceComplete: true, maintenance: { reference: 'CHG-DEMO-082', asset: 'oracle-prod-01', startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', scopeMatched: true, verified: true } },
  { eventId: 'demo-6', ticketId: 'DEMO-1037', revision: 1, title: 'Privileged account change on critical asset', asset: 'core-auth-01', system: 'Linux', sourceSeverity: 'CRITICAL', path: '/etc/passwd', diff: '- service:x:1001:1001\n+ service:x:0:0', evidenceComplete: true, criticalAsset: true }
].map((a, i) => alertSchema.parse({ ...a, occurredAt: new Date(Date.now() - (i + 1) * 420000).toISOString() }));
