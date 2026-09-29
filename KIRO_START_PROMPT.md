# ข้อความเริ่มงานสำหรับ Kiro

เปิดโปรเจกต์ `C:\Users\ChayanonSukkhat\Documents\Side Projects\prasittichoke` และทำงานต่อจาก implementation ที่มีอยู่ โดยอ่าน `HANDOFF.md` ก่อน ตามด้วย `README.md`, `docs/integrations.md` และ `docs/deployment.md`

โปรเจกต์ชื่อ **ประสิทธิโชค (prasittichoke)** เป็น web app สำหรับคัดกรอง Tripwire FIM alerts ร่วมกับ Zoho Desk และเตรียม deploy บน Linux VPS ผ่าน Docker/GitHub Actions

ก่อนเริ่ม ให้ตรวจ git status และ checkout ให้ถูกต้อง: repository remote คือ `https://github.com/sabaszx/prasittichotte.git` แต่ working directory หลักชื่อ `prasittichoke` ภายในมี nested checkout ชื่อ `prasittichotte/` ซึ่งห้ามนำมาใช้แทน root โดยอัตโนมัติ ห้ามลบหรือ stage โฟลเดอร์ซ้อนดังกล่าว และรักษางานที่ผู้ใช้แก้ไขไว้ทั้งหมด

อย่า scaffold ใหม่หรือเปลี่ยน stack โดยไม่จำเป็น โค้ดปัจจุบันใช้ Node.js 24 + Express + SQLite + static HTML/CSS/JavaScript มี dashboard ภาษาไทย, rules engine, optional LLM/integration adapters, demo workflow, audit, tests และ deployment assets แล้ว

เงื่อนไขหลักที่ต้องรักษา:

1. ANWC ตรวจ ยืนยัน ตอบ ปิด และส่งต่อเคสจริงผ่าน Zoho Desk App/Web
2. Low จบที่ ANWC; Medium/High/Critical ต้องตอบและส่งต่อ NHSO แม้ change source เป็น SYSTEM
3. LLM เสนอผลและร่างข้อความเท่านั้น ไม่มีอำนาจอนุมัติหรือทำ ticket actions
4. ข้อมูลไม่พอหรือ LLM ล้มเหลวต้องไม่ถูกจัดเป็น Low อัตโนมัติ
5. แยก severity ต้นทาง ข้อเสนอของระบบ และผลยืนยันของคน ตรวจ revision ก่อนยอมรับผล
6. Discord/Telegram เป็น optional notifications ที่ลิงก์กลับ Zoho ไม่รับคำสั่งอนุมัติผ่านแชต
7. รักษาความเรียบง่ายและความสามารถทดสอบ/deploy บน VPS เดียว

เริ่มด้วยการตรวจโค้ดและรัน baseline checks ตาม HANDOFF.md จากนั้นสร้าง/ปรับ requirements, design และ tasks ให้สะท้อนของที่มีจริงและงานที่เหลือ แล้วลงมือแก้ตามลำดับ P0 → P1 → P2 ไม่หยุดแค่เสนอแผน

ผลเดิม: backend 17 tests ผ่านและ browser scenario ผ่านบนเครื่องพัฒนา แต่ยังไม่มีหลักฐาน Docker build, remote CI success, การเชื่อม tenant จริง หรือ VPS deployment ให้ทดสอบก่อนอ้างว่าพร้อมใช้งานจริง

สำหรับ native Zoho/Tripwire mapping ต้องใช้ sanitized payload และ tenant configuration จริง อย่าสมมติ endpoint fields หรืออ้างว่า normalized ingestion API รองรับ raw webhook อยู่แล้ว ถ้าขาดข้อมูลให้ถามเฉพาะสิ่งจำเป็นและทำงานอื่นที่ไม่ขึ้นกับข้อมูลนั้นต่อ ห้ามขอ password/private key/token ในข้อความทั่วไป

เมื่อจบแต่ละช่วง ให้สรุปสิ่งที่เปลี่ยน ผลทดสอบจริง และงานที่ยังขาดอย่างชัดเจน แยก demo, configured และ verified-live ออกจากกัน

## งบเครดิตและการส่งงานกลับให้ Codex

ฉันมีโควตา 50 credits ให้ใช้ทำงานจนประมาณ 40 credits แล้วเริ่มปิดงานและส่งกลับ Codex โดยตั้งเป้าจบทุกอย่างก่อนใช้ถึง 45 credits รวมเวลาทดสอบและเขียน handoff เผื่อไว้ 5–10 credits ไม่ใช่ใช้จนหมด 50

- ตรวจยอดใช้แล้ว/คงเหลือเมื่อเริ่มงานและทุกจบงานย่อย ใช้ยอดสะสมของโควตานี้ รวมที่ใช้ไปก่อนเริ่มโปรเจกต์ด้วย หากมีโควตาหรือแพ็กเครดิตอื่น ให้ยึดงบ 50 ที่ฉันจัดสรรและจด baseline ให้ชัดเจน
- อ้างอิงเฉพาะ meter/tool ที่มีจริงหรือจำนวนที่ฉันแจ้ง บันทึกเวลาและขอบเขตของยอด ห้ามเดาเครดิตจาก tokens จำนวน prompt หรือจำนวนงาน และห้ามอ้างว่าบังคับเพดานได้แน่นอนหากยอดอัปเดตล่าช้า
- ถ้าอ่านยอดเองไม่ได้ ให้บอกข้อจำกัด ทำงานย่อยขนาดเล็กหนึ่งช่วง อัปเดต handoff แล้วขอให้ฉันแจ้งยอดคงเหลือก่อนเริ่มช่วงถัดไป หากยังไม่ทราบยอดให้ส่ง handoff แล้วหยุด ไม่ทำงานต่อแบบไม่จำกัด
- เมื่อใช้ประมาณ 35 credits / เหลือ 15 ให้ทำเฉพาะงานสั้นที่ปิดและทดสอบได้ ไม่เริ่ม migration หรือ feature ใหญ่
- เมื่อใช้ถึง 40 credits / เหลือ 10 ให้หยุดเริ่ม feature ใหม่ เก็บงานย่อยที่ค้างให้อยู่ในสภาพปลอดภัย ทดสอบเฉพาะส่วนจำเป็น และสรุปส่งต่อ
- เมื่อใช้ถึง 45 credits / เหลือ 5 ให้บันทึกสถานะทันทีแล้วหยุด ไม่เริ่ม test suite หรือคำสั่งยาวเพิ่มเติม สามารถส่งกลับก่อนถึงเกณฑ์ได้หากงานถัดไปใหญ่เกินงบหรือขาดข้อมูลจำเป็น
- ทำงานทีละงานย่อย ใช้ tests ที่เกี่ยวข้องก่อน ไม่ re-scan ทั้ง repository ซ้ำ ไม่สร้าง subagents หรือ agent hooks เพิ่มเพื่อทำงานนี้ และไม่รันทดสอบชุดเดิมซ้ำโดยไม่มีเหตุผล

สร้าง `HANDOFF_TO_CODEX.md` ที่ root ตั้งแต่ checkpoint แรก แล้วอัปเดตทุกครั้งที่จบงานย่อย อย่ารอจนเครดิตใกล้หมด

เนื้อหา handoff ต้องมี:

1. วันที่ เวลา project path, remote, branch, HEAD และคำสั่งเริ่มงาน
2. เป้าหมายและเงื่อนไขธุรกิจที่ต้องรักษา
3. งานที่ทำเสร็จ พร้อมไฟล์ที่เปลี่ยนและเหตุผล
4. งานที่ทำบางส่วน สิ่งที่ยังไม่ทำ blockers และข้อบกพร่องที่ทราบ แยกชัดเจน
5. คำสั่งทดสอบ ผลจริง และส่วนที่ยังไม่ได้ทดสอบ ห้ามสรุปผลผ่านที่ยังไม่เคยรัน
6. สถานะ Zoho/LLM/Discord/Telegram/CI/VPS แยก demo, configured, verified-live
7. สถานะ Git: commit ล่าสุด ไฟล์แก้ไข/untracked ที่เกี่ยวกับงาน และสิ่งที่เป็นงานผู้ใช้ซึ่งห้ามแตะ
8. server/process/port ที่ยังรันอยู่ วิธีเริ่มและหยุดอย่างถูกต้อง โดยไม่มี secret
9. next steps เรียงลำดับพร้อมไฟล์/คำสั่งที่ Codex เริ่มทำได้ทันที
10. credit baseline และยอดล่าสุดพร้อมเวลา ระบุ unknown หากไม่มีหลักฐาน
11. prompt สั้นสำหรับให้ Codex อ่าน handoff และทำงานต่อ

เมื่อส่งกลับ ให้สรุปสั้น ๆ พร้อมชื่อไฟล์ `HANDOFF_TO_CODEX.md` และ prompt สำหรับ Codex หากยังมี dirty files ให้ระบุไว้ อย่า reset/clean/discard หรือ stage ทุกไฟล์เพื่อให้สถานะดูเรียบร้อย การบันทึก handoff สำคัญกว่าการฝืนทำ feature ให้เสร็จตอนเครดิตใกล้หมด

ข้อมูลอ้างอิงการดูเครดิต: https://kiro.dev/pricing/ — dashboard แสดง usage/remaining และยอดอาจอัปเดตเป็นช่วงเวลา ดังนั้นขอบเขต 40–45 เป็นจุดหยุดทำงานเชิงปฏิบัติ ไม่ใช่ spending cap ที่ prompt รับประกันได้
