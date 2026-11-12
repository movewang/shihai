// snapshot.mjs —— 识海快照生成器（通用版 v3）
// 周期运行（建议 2 分钟）：读取「你的 AI」的记忆/状态文件，产出面板所需 snapshot.json（原子替换）。
// 安全原则：只读生活数据；输出内容截断；写满自动滚动的环形语义由调用方决定；无任何可执行入口。
//
// 零依赖：Node >= 22（用到内置 node:sqlite）。
// 使用：编辑下方 CFG 里的文件路径后：
//   node snapshot.mjs
// 想让它对接你自己的 AI：只需要保证 CFG 指向的 JSON/SQLite 里有 docs/SNAPSHOT.md 描述的字段。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// ══════════════════ CONFIG（按你的环境改这里）══════════════════
const CFG = {
  // 你的 AI 的记忆/状态文件（没有的项留空串，对应功能自动跳过）
  memweaveDb: "",    // SQLite 记忆库，表 user(content, keywords, importance, status, updated_at...)；留空=跳过
  moodFile: "",      // JSON: {currentActivity, moodLabel, innerMonologue, energy, affection, pout, lastInteractAt, history[]}
  hormoneFile: "",   // JSON: 可选，{lastFeeling} 之类
  notesFile: "",     // JSON 数组：AI 藏的小纸条 [{text, on?, ts}]
  outDir: "./data",  // 面板读取目录（面板 fetch 'data/snapshot.json'）

  // 「核心烙印」识别（这些内容的星星永不淡忘，画白环）
  coreNames: [],     // 例如 ["某人的名字", "某个称呼"]

  // 情绪词典（按内容给星星涂色，可自行增删）
  emo: {
    anger: /生气|吵架|讨厌|烦死|火大/,
    heavy: /难过|伤心|委屈|哭|冤|低落|失落|对不起/,
    miss:  /想念|想你|等你|好久不见|思念|舍不得|突然想/,
    joy:   /开心|哈哈|好棒|喜欢|惊喜|好玩|快乐|笑死|被夸|甜|幸福|撒糖|贴贴/,
  },

  // 心愿星（以后想去的地方/想做的事 → 亮进心愿区）
  wishRe: /(想去|要去|打算去|计划[去着]|以后(想|要|打算)|说走就走|下次去|旅行|远方|徒步|骑行|露营|环湖|自驾)/,
  // 未完成约定（红刺：该做没做的事）
  loopRe: /(答应|说好|欠你|补偿|还没给|还没做|还没删|还没改|回头|下次一定)/,

  activityFallback: "在待机中安静待着",
};
// ═══════════════════════════════════════════════════════════════

const DAY = 86400000;
const now = Date.now();

function readJson(p, dflt = null) {
  if (!p) return dflt;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
}

// 新鲜度：指数衰减；重要度高的半衰期更长
function freshness(updatedAt, importance) {
  const ageDays = Math.max(0, (now - (updatedAt || 0)) / DAY);
  const halfLife = importance >= 5 ? 900 : importance >= 3 ? 45 : 22;
  return Math.max(0.04, Math.pow(0.5, ageDays / halfLife));
}

function isCore(c) {
  return (CFG.coreNames || []).some(k => c.includes(k));
}

function emoOf(c) {
  if (CFG.emo.anger.test(c)) return 'anger';
  if (CFG.emo.heavy.test(c)) return 'heavy';
  if (CFG.emo.miss.test(c)) return 'miss';
  if (CFG.emo.joy.test(c)) return 'joy';
  return 'calm';
}

function main() {
  let memories = [];

  // —— 记忆库（SQLite）——
  if (CFG.memweaveDb) {
    try {
      const db = new DatabaseSync(CFG.memweaveDb, { readOnly: true });
      const rows = db.prepare(
        "SELECT content, keywords, importance, updated_at FROM user WHERE status='active' ORDER BY updated_at DESC LIMIT 400"
      ).all();
      db.close();

      const seen = new Set();
      for (const r of rows) {
        const c = String(r.content || '').trim();
        if (!c || seen.has(c)) continue;
        seen.add(c);
        const imp = Number(r.importance) || 0;
        const fr = Number(freshness(Number(r.updated_at) || 0, imp).toFixed(3));
        let kws = [];
        try {
          const raw = JSON.parse(r.keywords || '[]');
          if (Array.isArray(raw)) kws = raw.map(String).slice(0, 3);
        } catch { kws = String(r.keywords || '').split(/[,，;；\\s]+/).filter(Boolean).slice(0, 3); }

        memories.push({
          c: c.slice(0, 88),
          k: kws,
          imp,
          fr,
          t: Number(r.updated_at) || 0,
          core: imp >= 5 || isCore(c) ? 1 : 0,
          emo: emoOf(c),
          wish: CFG.wishRe.test(c) ? 1 : 0,
          loop: !CFG.wishRe.test(c) && CFG.loopRe.test(c) && fr > 0.25 ? 1 : 0
        });
      }
      memories.sort((a, b) => (b.imp * 1.2 + b.fr) - (a.imp * 1.2 + a.fr));
      memories = memories.slice(0, 90);
    } catch (e) {
      console.log('[snapshot] memweave error:', e.message);
    }
  }

  // —— 身心状态 ——
  const mood = readJson(CFG.moodFile, {}) || {};
  const hormone = readJson(CFG.hormoneFile, {}) || {};

  const hist = Array.isArray(mood.history) ? mood.history.slice(-6).map(h => ({
    r: h.role === 'user' ? 'owner' : 'ai',
    t: String(h.content || '').slice(0, 64),
    ts: h.ts
  })) : [];

  // —— 欠账台账 pending + 夜巡回光 ——
  const loopsRaw = readJson(CFG.openLoopsFile, { items: [] }) || { items: [] };
  const undoneLoops = (Array.isArray(loopsRaw.items) ? loopsRaw.items : [])
    .filter(l => !l.done)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.ts || 0) - (b.ts || 0))
    .slice(0, 8)
    .map(l => ({
      t: String(l.text || '').slice(0, 70),
      days: Math.max(0, Math.floor((now - (l.ts || now)) / DAY)),
      esc: (l.priority || 0) >= 2 ? 1 : 0
    }));

  let rehearsed = [];
  if (CFG.nightDigestFile) {
    try {
      const dg = JSON.parse(fs.readFileSync(CFG.nightDigestFile, 'utf8'));
      const bjToday = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
      if (dg && dg.date === bjToday) rehearsed = (dg.rehearsed || []).map(c => String(c).slice(0, 40));
    } catch {}
  }

  // —— 小纸条：贴上匹配记忆，贴不上的单独成星 ——
  let noteStars = [];
  let notes = readJson(CFG.notesFile, []);
  if (!Array.isArray(notes)) notes = [];
  notes = notes.slice(-12);
  for (const nt of notes) {
    const text = String(nt.text || '').slice(0, 160);
    if (!text) continue;
    const on = String(nt.on || '');
    let attached = false;
    if (on) {
      const hit = memories.find(m => m.c.includes(on) || m.k.some(k => on.includes(k)));
      if (hit) { hit.noteText = text; hit.ts_note = nt.ts || now; attached = true; }
    }
    if (!attached) {
      noteStars.push({
        c: '[note] ' + text.slice(0, 40),
        k: ['note'],
        imp: 4, fr: 1, t: nt.ts || now,
        core: 0, emo: 'note', wish: 0, loop: 0,
        noteText: text
      });
    }
  }

  const snap = {
    v: 3,
    generatedAt: now,
    self: {
      activity: String(mood.currentActivity || CFG.activityFallback),
      mood: String(mood.moodLabel || ''),
      monologue: String(mood.innerMonologue || '').slice(0, 80),
      energy: Number(mood.energy) || 0,
      pout: Number(mood.pout) || 0,
      affection: Number(mood.affection) || 0,
      lastInteractAt: Number(mood.lastInteractAt) || 0
    },
    hormone: { label: String(hormone.lastFeeling || hormone.feeling || '') },
    memories: memories.concat(noteStars),
    history: hist,
    loops: undoneLoops,
    rehearsed
  };

  fs.mkdirSync(CFG.outDir, { recursive: true });
  const tmp = path.join(CFG.outDir, 'snapshot.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(snap), 'utf8');
  fs.renameSync(tmp, path.join(CFG.outDir, 'snapshot.json'));
  console.log('[snapshot] written:', path.join(CFG.outDir, 'snapshot.json'));
}

main();
