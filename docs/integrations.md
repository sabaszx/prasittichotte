# Integration contract และการเชื่อม Zoho

## Trust boundary

```
Tripwire → Zoho Desk → authenticated adapter → /api/ingest
                                     ← private note from worker
ANWC reply/close/assign in Zoho → adapter → /api/integrations/zoho/:id/status
```

API นี้ไม่อ้างว่ารับ native webhook ของ Zoho ได้ทันที ต้องเลือก event/filter และ map payload จาก tenant จริงก่อนใช้งาน อาจใช้ custom function ของ Zoho หรือ service adapter ขององค์กร ห้ามนำ token ไปไว้ใน client-side code หรือ URL

Adapter ต้องตรวจ authenticity ตามช่องทางต้นทางจริง, ดึง ticket/diff ที่เชื่อถือได้, map tenant fields, ignore updates/comments ที่ระบบนี้เขียนเอง และไม่ตั้ง maintenance.verified จากข้อความอิสระใน alert

## เปิด live mode

ใช้ `.env.example` เป็นแบบตั้งค่า ตั้ง APP_MODE=live, ADMIN_PASSWORD อย่างน้อย 16 ตัวอักษร, INGEST_TOKEN สุ่มอย่างน้อย 32 ตัวอักษร, APP_ORIGIN เป็น URL จริง และ COOKIE_SECURE=true เมื่อใช้ HTTPS ใช้ database/volume ใหม่แยกจาก demo

## POST /api/ingest

Header: `Authorization: Bearer <INGEST_TOKEN>` และ `Content-Type: application/json`

```json
{
  "eventId": "tripwire-event-123-revision-1",
  "ticketId": "123456789012345678",
  "revision": 1,
  "title": "SSH configuration changed",
  "asset": "web-prod-01",
  "system": "Linux",
  "occurredAt": "2026-09-29T09:00:00+07:00",
  "sourceSeverity": "HIGH",
  "criticalAsset": true,
  "path": "/etc/ssh/sshd_config",
  "diff": "- PermitRootLogin no\n+ PermitRootLogin yes",
  "evidenceComplete": true,
  "actor": "",
  "maintenance": null
}
```

- ticketId ต้องเป็น internal Zoho ticket ID สำหรับ API ไม่ใช่ display ticket number
- eventId ต้องคงที่เมื่อ retry; eventId เดิมแต่ payload เปลี่ยนตอบ 409
- revision เป็นเลขเพิ่มต่อ ticket และเพิ่มเฉพาะเมื่อหลักฐานสำหรับวิเคราะห์เปลี่ยน ห้ามเพิ่มจาก note/notification ของระบบเอง
- revision เก่าหรือเท่าปัจจุบันจาก event ใหม่ตอบ 409; adapter ต้องแยก stale event จาก conflict จริง
- ระบบรับ JSON ไม่เกิน 128 KiB, diff ไม่เกิน 30,000 ตัวอักษร; ห้ามตัดแล้วตั้ง evidenceComplete=true
- system: Oracle, Web, Linux, Palo Alto, F5, Other
- sourceSeverity: LOW, MEDIUM, HIGH, CRITICAL; mapping จาก priority ของ Zoho ต้องกำหนดเอง ไม่ถือว่าสองค่านี้เหมือนกัน
- criticalAsset ถูกเก็บเป็นบริบท แต่ยังไม่มี asset-specific matrix อัตโนมัติใน baseline
- คืน 202 เมื่อเข้าคิว, 200 เมื่อ duplicate, 400 schema error, 401 token ผิด, 409 revision conflict

Maintenance ถ้ามีต้องส่ง reference, asset, startsAt, endsAt, scopeMatched และ verified โดย adapter ตรวจเอกสาร change จริงก่อน ระบบตรวจ asset/time/scope ซ้ำใน rules engine

## การเขียน private note

ตั้ง ZOHO_ORG_ID, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN และ datacenter URLs ให้ตรง tenant ขอ OAuth scope ต่ำสุดที่จำเป็นสำหรับ ticket comments ตามเอกสาร Zoho แล้วเปิด ZOHO_WRITE_ENABLED=true

worker refresh token แล้ว POST `/tickets/{ticketId}/comments` ด้วย `isPublic: false` ไม่ส่ง email reply และไม่ปิดหรือ assign ticket

ใส่ ZOHO_TICKET_URL_PREFIX เป็น prefix จริงของลิงก์ ticket ใน tenant ระบบจะต่อ internal ticket ID ที่ encode แล้ว ทดสอบลิงก์บนทั้งเว็บและแอปก่อน UAT

## Status sync จาก Zoho

POST `/api/integrations/zoho/{internal-ticket-id}/status` ด้วย bearer token เช่นเดียวกับ ingestion

```json
{
  "revision": 1,
  "sequence": 2,
  "severity": "MEDIUM",
  "state": "AWAITING_NHSO",
  "actor": "zoho-agent-id-123",
  "reason": "ANWC ตรวจสอบแล้ว ต้องติดตามการแก้ไขกับ NHSO",
  "replyReference": "zoho-thread-id-456",
  "handoffReference": "zoho-assignment-event-789"
}
```

- sequence เพิ่มต่อ revision เพื่อกัน event สลับลำดับ; event ซ้ำ/เก่าถูก ignore
- LOW รับ state=CLOSED เท่านั้น
- MEDIUM ขึ้นไปต้องมี replyReference และ handoffReference ที่ adapter ตรวจจาก Zoho จริงก่อนส่ง; API เก็บ reference แต่ยังไม่ fetch กลับไปตรวจเอง
- NHSO รับเคส: ส่ง state=IN_PROGRESS_NHSO พร้อม sequence ใหม่
- NHSO แก้ไขเสร็จ: ส่ง state=CLOSED พร้อม resolutionReference, replyReference, handoffReference
- ต้องมี analysis ของ revision นั้นก่อน sync; หาก 409 เนื่องจากยังคัดกรองไม่เสร็จ ให้ adapter retry แบบ bounded
- ข้อมูลใหม่ทำให้ decision เดิมหมดอายุ และเคสกลับเข้า queue; status revision เก่าถูกปฏิเสธ
- รุ่นนี้ยังไม่รองรับ reopen ภายใน revision เดิมอย่างสมบูรณ์ ให้ส่ง revision ใหม่พร้อมหลักฐานใหม่

## LLM

รับ HTTPS endpoint ที่ implement chat-completions contract: POST messages/model/response_format และตอบ choices[0].message.content เป็น JSON ตั้ง LLM_ENABLED=true หลังอนุมัติผู้ให้บริการและชนิดข้อมูลแล้ว

ไม่ lock กับ provider ใด แต่ API compatibility ต้องทดสอบกับ endpoint ที่เลือก รุ่นนี้ไม่รองรับ API รูปแบบอื่นอัตโนมัติ

ข้อมูล alert ถูกลด secret ที่พบบ่อยก่อนบันทึกและส่งต่อ แต่ hostname, file path, content ที่ไม่ใช่รูปแบบ secret อาจยังอยู่ ให้ redaction/allowlist จาก adapter ชั้นองค์กรด้วย

LLM ทำหน้าที่สรุปและร่างเท่านั้น ไม่มีเครื่องมือหรือสิทธิ์ตัดสินใจ ระบบตรวจ schema และ severity floor หาก timeout/JSON ผิด ให้ ANWC ตรวจและไม่เสนอ Low อัตโนมัติ

## Discord / Telegram

ตั้ง DISCORD_WEBHOOK_URL หรือ TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID แล้วเปิด NOTIFICATIONS_ENABLED=true ใน live mode ข้อความมีเฉพาะ ticket ID, proposed severity และลิงก์ Zoho ไม่มี raw diff/hostname/ข้อความจากโมเดล ไม่มีปุ่มตอบหรืออนุมัติ

Discord ปิด allowed_mentions; Telegram ใช้ plain text ไม่ใช้ parse_mode

## Retry และผลการส่งที่ไม่แน่นอน

งานแต่ละช่องทาง unique ต่อ case/revision/kind; การส่งซ้ำจาก webhook ไม่สร้างงานเพิ่ม HTTP 429 retry สูงสุดสามครั้งแบบ exponential delay ส่วน timeout, network error และ 5xx อาจมี side effect สำเร็จไปแล้ว จึงเข้า `uncertain` ให้ตรวจปลายทาง ไม่ส่งซ้ำเอง

หลัง process crash งาน external ที่กำลังส่งจะเป็น uncertain ส่วน analysis กลับเข้าคิว ผล uncertain ต้องให้ผู้ดูแล reconcile หลังตรวจปลายทาง (ยังไม่มี UI สำหรับ resolution); อย่าเปลี่ยนเป็น pending โดยไม่ตรวจ สถานะนี้ไม่ขัดขวางเจ้าหน้าที่ทำงานใน Zoho

## UAT ที่ต้องทำกับ tenant จริง

1. รับ alert จริงที่ปิดบังข้อมูลแล้วและตรวจ mapping รวม diff/truncation/timezone
2. webhook replay, event สลับลำดับ, agent ส่ง reply, bot เขียน note ไม่เกิด loop
3. private note ไม่ปรากฏเป็น public reply และไม่มี notification ที่ผิดผู้รับ
4. ANWC อ่าน/ตอบ/ปิด/assign ผ่านทั้ง Zoho App และ Web ได้ตามสิทธิ์
5. Medium SYSTEM ต้องตอบและส่งต่อ NHSO; NHSO acknowledgment และ resolution sync กลับถูกต้อง
6. LLM unavailable, Zoho OAuth expired, rate limit และ partial channel failure ไม่ทำให้เคสปิดเอง
7. ทดสอบ false-Low rate กับชุดข้อมูลที่ SOC label แล้วก่อนเปิด pilot
