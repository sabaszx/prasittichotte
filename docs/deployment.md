# ติดตั้งบน Linux VPS

## รูปแบบ

VPS เดียว: Docker Compose รันแอปหนึ่ง instance พร้อม named volume สำหรับ SQLite สามารถใช้ Caddy เปิด HTTPS หรือใช้ reverse proxy เดิมขององค์กรได้ ไม่ต้องเปิดพอร์ต 3000 สู่ internet โดยตรง

ต้องมี Docker Engine + Compose plugin ที่รองรับ `up --wait`, SSH และ domain หากต้องการ HTTPS อัตโนมัติ เครื่องพัฒนาที่ใช้สร้างรุ่นนี้ไม่มี Docker จึงต้องให้ CI/VPS ตรวจ container build ก่อนใช้งานจริง

## เตรียมครั้งแรก

```bash
sudo mkdir -p /opt/prasittichoke
sudo chown "$USER":"$USER" /opt/prasittichoke
git clone https://github.com/sabaszx/prasittichotte.git /opt/prasittichoke
cd /opt/prasittichoke
cp .env.example .env
chmod 600 .env
```

แก้ `.env` บน VPS (ไม่ส่ง secret ใน chat หรือ commit):

```dotenv
APP_MODE=live
ADMIN_PASSWORD=<random-strong-password-at-least-16-characters>
INGEST_TOKEN=<random-token-at-least-32-characters>
APP_ORIGIN=https://soc.example.org
APP_DOMAIN=soc.example.org
COOKIE_SECURE=true
```

เปิดเฉพาะ integration ที่ผ่าน sandbox แล้ว ส่วนที่ยังไม่ตั้งค่าจะไม่ส่งออก สำหรับ demo บน Docker ให้ตั้ง ADMIN_PASSWORD ด้วย แม้เปิดที่ localhost เพราะ process ภายใน container bind ทุก interface

กรณีเคยใช้ demo volume แล้ว ต้องสร้าง Compose project ชื่อใหม่สำหรับ live เช่น `docker compose -p prasittichoke-live ...` และปรับคำสั่ง deploy ให้ใช้ชื่อเดียวกัน ไม่ลบฐานข้อมูลเก่าเพื่อสลับโหมด

DNS ต้องชี้เข้า VPS เปิด port 80/443 ให้ Caddy ยืนยัน domain หากมี reverse proxy เดิม ไม่ต้องใช้ compose.proxy.yaml

## เริ่มจาก source

```bash
docker compose -f compose.yaml -f deploy/compose.proxy.yaml up -d --build --wait
```

ตรวจ `docker compose ps`, health ที่ `http://127.0.0.1:3000/healthz` และ login ผ่าน domain จริง จากนั้นทดสอบรับ alert ใน sandbox

## CI และ image registry

Workflow **Test and publish** ทำ syntax checks, 17+ backend tests, browser workflow, dependency audit, Docker build และ container smoke test ก่อน publish image

Image tag เป็น commit SHA เต็ม ไม่ใช้ latest: `ghcr.io/sabaszx/prasittichotte:<40-character-sha>` image แรกอาจเป็น private; ถ้า VPS pull ไม่ได้ ให้ login GHCR บน VPS ด้วย credential ที่มี read:packages หรือปรับ visibility ตามนโยบายองค์กร ไม่ใส่ registry token ใน repo

## ตั้งค่า deployment workflow

GitHub → Settings → Environments → สร้าง `production` ตั้ง environment secrets:

| Secret | ค่า |
|---|---|
| DEPLOY_HOST | hostname/IP ของ VPS (SSH port 22 ในตัวอย่างนี้) |
| DEPLOY_USER | user ที่ใช้ Docker ได้ |
| DEPLOY_SSH_KEY | private key สำหรับ deployment |
| DEPLOY_KNOWN_HOSTS | host key ที่ตรวจ fingerprint กับ VPS แล้ว |

Environment variable `DEPLOY_PATH` ค่าเริ่มต้น `/opt/prasittichoke` ต้องเป็น absolute path ไม่มีช่องว่างตาม validation ใน script หากใช้ SSH port อื่นต้องปรับ workflow ให้ตรงกัน

Host key ต้อง verify ผ่านช่องทางที่เชื่อถือได้ก่อนบันทึก ไม่ปิด StrictHostKeyChecking

GitHub Actions → **Deploy to VPS** → Run workflow → กรอก SHA ของ image ที่ build ผ่าน สคริปต์จะ:

1. สำรอง SQLite ด้วย online backup API หากมี container เก่า
2. Pull image ที่ระบุ
3. Restart และรอ health check
4. ถ้าไม่ผ่าน พยายามกลับไป image เดิม

Workflow นี้ deploy image เท่านั้น ไม่อัปเดต `.env`, Compose หรือ Caddyfile บน VPS อัตโนมัติ เมื่อตั้งค่า infrastructure เปลี่ยน ให้อัปเดตไฟล์เหล่านี้จาก commit ที่ตรวจแล้วก่อน deploy เลือก SHA จาก CI ที่สำเร็จเสมอ

ยังไม่ได้ตั้ง GitHub secrets หรือ deploy VPS โดยโปรเจกต์นี้ เพราะยังไม่มี connection details ของเซิร์ฟเวอร์

## Backup / restore / rollback

```bash
docker compose exec -T app node scripts/backup.js
```

สำรองไปใน `/app/data/backups/` ใช้ SQLite online backup เพื่อให้ snapshot สอดคล้องแม้มี WAL คัดลอก backup ออกจาก VPS ไป storage ที่องค์กรกำหนดและทดสอบ restore เป็นระยะ ไม่ถือว่า backup ที่อยู่ volume เดียวกันป้องกัน disk loss ได้

Restore: หยุด service, เก็บสำเนา data volume ปัจจุบัน, restore snapshot ไปยัง database path ใน volume ว่างใหม่, ตรวจ owner ให้ node (uid 1000) อ่านเขียนได้ แล้ว start image ที่เข้ากันกับ schema ห้ามแทนที่ฐานข้อมูลที่ process กำลังใช้งาน

Schema รุ่นนี้ user_version=1 แบบ additive ยังไม่มี destructive migration การ rollback image ไม่ rollback schema อัตโนมัติ รุ่นถัดไปที่เปลี่ยน schema ต้องมี migration/restore plan ก่อน deploy

หาก runtime image เสียแต่ schema ไม่เปลี่ยน สามารถรัน `scripts/deploy.sh` ด้วย SHA รุ่นก่อนที่เคยผ่านได้

## การดูแล

- `docker compose logs --tail=100 app` ดู startup/worker errors โดยไม่พิมพ์ credentials
- หน้าการเชื่อมต่อดู failed/uncertain jobs; uncertain ต้องตรวจปลายทางก่อน retry
- ตรวจ disk usage ของ volume, audit/event table และ backups; ยังไม่มี retention scheduler
- healthz ตรวจ process และ database เท่านั้น ไม่ได้ยืนยันว่าปลายทาง Zoho/LLM/แชตพร้อมใช้งาน
- Live auth ปัจจุบันใช้ shared admin password; สำหรับหลายผู้ใช้ให้เพิ่ม SSO/RBAC หรือวางหลัง access gateway ขององค์กร
- Sessions อยู่ใน memory, restart จะ logout; deploy มี downtime สั้น ไม่ใช่ zero-downtime
- อย่า scale หลาย app replicas ด้วย SQLite/queue รุ่นนี้
- เปลี่ยนรหัสผ่าน/token ด้วย environment และ restart; ต้องเปลี่ยน token ฝั่ง adapter ให้ตรงกัน
- Node SQLite เป็น API ของ Node 24 ที่ควรทดสอบก่อนเปลี่ยน minor version; CI และ Docker pin runtime รุ่นเดียวกัน
