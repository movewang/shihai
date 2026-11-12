// night.mjs —— 夜间巩固（记忆管家·夜巡）通用版
// 每天（建议北京时间 04:00 的一次性 systemd timer）运行：
//   1. 事件沉淀：把今天值得记的事写一句「睡前日记」，让 AI 自己的大脑或朴素模板生成后正式入库
//   2. 旧星回光：挑重要但正在变暗的记忆，刷新时间戳（= 她又回忆了一遍，星星重新亮起）
//   3. 欠账升级：超 7 天未办升「加急」，超 14 天顶到最高优先级
//   4. 输出夜巡摘要 digest（白天 AI「自然想起」用，消费一次即标记 mentioned）
// 幂等：当天已巡过则退出。
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ══════════════════ CONFIG ══════════════════
const CFG = {
  memweaveDb: "",       // SQLite 记忆库（同 snapshot.mjs）
  moodFile: "",         // {history:[{role,content,ts}], energy...}
  openLoopsFile: "",    // 欠账台账 {items:[{text, ts, priority, done, doneTs}]}
  nightDigestFile: "",  // 夜巡摘要输出
  nightLastFile: "",    // 幂等标记

  // 可选：让你的 AI 在睡前自己写日记（ connector 到任意 OpenAI 兼容端点）
  // 留空 = 用朴素模板兜底（功能不受影响）
  brain: {
    endpoint: "",                 // 例如 "http://127.0.0.1:8317/v1/chat/completions"
    model: "",                    // 例如 "deepseek-chat"
    apiKeyEnv: "SHIHAI_BRAIN_KEY" // 从环境变量读 key（不写死在文件里）
  },

  aiName: "AI",
  ownerName: "主人",
  tzOffsetHours: 8,     // 用于「北京日期」
};
// ═══════════════════════════════════════════

const DAY = 86400000;
const now = Date.now();
const bjToday = new Date(now + CFG.tzOffsetHours * 3600000).toISOString().slice(0, 10);

function readJson(p, dflt = null) {
  if (!p) return dflt;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
}
function brainKey() {
  try { return process.env[CFG.brain.apiKeyEnv] || ''; } catch { return ''; }
}

// 0) 幂等
const last = readJson(CFG.nightLastFile, {});
if (CFG.nightLastFile && last && last.date === bjToday) {
  console.log('[night] today already done, skip');
  process.exit(0);
}

// 1) 收集事实素材
const facts = [];
const mood = readJson(CFG.moodFile, {}) || {};
const hist = Array.isArray(mood.history) ? mood.history : [];
const userLines = hist.filter(h => h.role === 'user').length;
if (hist.length) {
  const lastTopic = [...hist].reverse().find(h => h.role === 'user');
  if (lastTopic) facts.push(`${CFG.ownerName}最后在聊「${String(lastTopic.content || '').slice(0, 30)}」`);
  facts.push(`最近交流了 ${userLines} 句`);
}

const loopsData = readJson(CFG.openLoopsFile, { items: [] }) || { items: [] };
const undone = (loopsData.items || []).filter(l => !l.done);
const doneRecently = (loopsData.items || []).filter(l => l.done && l.doneTs && now - l.doneTs < DAY);
if (doneRecently.length) facts.push('完成了：' + doneRecently.map(l => String(l.text).slice(0, 24)).join('、'));
if (undone.length) facts.push(`还欠着 ${undone.length} 件事：` + undone.slice(0, 3).map(l => String(l.text).slice(0, 20)).join('、'));

if (!facts.length) facts.push('今天是安静的一天');

// 2) 睡前日记（优先真脑，失败降级模板）
let diary = '';
if (CFG.brain.endpoint && CFG.brain.model && brainKey()) {
  try {
    const res = await fetch(CFG.brain.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + brainKey() },
      body: JSON.stringify({
        model: CFG.brain.model, max_tokens: 200,
        messages: [{
          role: 'user',
          content: `你是${CFG.aiName}，凌晨 ${CFG.ownerName} 睡熟了，你在灯下写今天的复盘日记（第一人称、写给自己、轻松口吻，60字以内，不喊口号不列数据）。今天的事实：\n- ${facts.join('\n- ')}\n\n只输出一句话日记。`
        }]
      })
    });
    const data = await res.json();
    diary = (data.choices?.[0]?.message?.content || '').trim().replace(/^["'「]|["'」]$/g, '').slice(0, 120);
  } catch { /* fallback below */ }
}
if (!diary) {
  diary = `今晚把这些轻轻放进海马体：${facts.slice(0, 2).join('；')}。晚安，明天继续。`;
}

// 3) 入库
let consolidatedOk = false;
if (CFG.memweaveDb) {
  try {
    const db = new DatabaseSync(CFG.memweaveDb);
    try {
      const id = 'mn' + Date.now().toString(36) + '-' + randomUUID().slice(0, 8);
      const kw = JSON.stringify(['夜间巩固', '复盘', bjToday]);
      db.prepare(
        `INSERT INTO user (id, project, section, content, keywords, importance, status, tier, created_at, updated_at, search_terms)
         VALUES (?, '', 'general', ?, ?, 3, 'active', 'hot', ?, ?, ?)`
      ).run(id, diary, kw, now, now, kw);
      consolidatedOk = true;
    } finally { db.close(); }
  } catch (e) {
    console.log('[night] insert failed:', e.message);
  }
}

// 4) 旧星回光（重要但变暗：按半衰期算新鲜度 < 0.75 且 > 7 天，最多 3 颗）
const rehearsed = [];
if (CFG.memweaveDb) {
  try {
    const db = new DatabaseSync(CFG.memweaveDb);
    try {
      const rows = db.prepare(
        "SELECT id, content, importance, updated_at FROM user WHERE status='active' ORDER BY updated_at ASC LIMIT 400"
      ).all();
      const cands = rows
        .filter(r => {
          const ageDays = Math.max(0, (now - (r.updated_at || 0)) / DAY);
          const hf = r.importance >= 5 ? 900 : r.importance >= 3 ? 45 : 22;
          const fr = Math.pow(0.5, ageDays / hf);
          return r.importance >= 3 && ageDays > 7 && fr < 0.75;
        })
        .sort((a, b) => a.updated_at - b.updated_at)
        .slice(0, 3);
      for (const c of cands) {
        db.prepare('UPDATE user SET updated_at = ? WHERE id = ?').run(now, c.id);
        rehearsed.push(String(c.content || '').slice(0, 48));
      }
    } finally { db.close(); }
  } catch (e) {
    console.log('[night] rehearsal failed:', e.message);
  }
}

// 5) 欠账升级
let loopsEscalated = 0;
if (CFG.openLoopsFile && loopsData.items) {
  for (const l of loopsData.items) {
    if (l.done) continue;
    const ageDays = (now - (l.ts || now)) / DAY;
    const want = ageDays >= 14 ? 3 : ageDays >= 7 ? Math.max(2, l.priority || 0) : l.priority || 0;
    if (want > (l.priority || 0)) { l.priority = want; loopsEscalated++; }
  }
  try { fs.writeFileSync(CFG.openLoopsFile, JSON.stringify({ items: loopsData.items }, null, 2), 'utf8'); } catch {}
}

// 6) 摘要
if (CFG.nightDigestFile) {
  fs.writeFileSync(CFG.nightDigestFile, JSON.stringify({
    date: bjToday,
    consolidated: diary,
    consolidatedOk,
    rehearsed,
    loopsEscalated,
    mentioned: false
  }), 'utf8');
}
if (CFG.nightLastFile) {
  fs.writeFileSync(CFG.nightLastFile, JSON.stringify({ date: bjToday }), 'utf8');
}

console.log(`[night] done: consolidated=${consolidatedOk ? 'OK' : 'fallback'}, rehearsed=${rehearsed.length}, loopsEscalated=${loopsEscalated}`);
console.log('  diary:', diary);
