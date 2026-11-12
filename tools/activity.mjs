// activity.mjs —— 识海·活动事件流（记忆管家的心脏）
//   emitActivity(phase, detail) 一次调用，三处落点：
//     activity-now.json   # ← 改成你的路径   当前状态（飞书秒查通道直读）
//     activity.jsonl     # ← 改成你的路径      只增时间线（环形：超 256KB 截尾 400 条）
//     live.json          # ← 改成你的面板数据目录     面板 5 秒轮询的实时包（now + 最近30条）
// 设计：纯同步 fs、无外部依赖；写失败静默（不干扰业务）。
import fs from 'node:fs';
import path from 'node:path';

const LIFE_DIR = process.env.SHIHAI_LIFE_DIR || '.';
const NOW_FILE = path.join(LIFE_DIR, 'activity-now.json');
const JSONL_FILE = path.join(LIFE_DIR, 'activity.jsonl');
const PANEL_DATA = process.env.SHIHAI_PANEL_DATA || './data';
const LIVE_FILE = path.join(PANEL_DATA, 'live.json');
const MAX_JSONL_BYTES = 262144;
const MAX_RECENT = 30;

function safeWrite(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* 静默：心跳失败不影响业务 */ }
}

function readRecent() {
  try {
    const lines = fs.readFileSync(JSONL_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < MAX_RECENT; i--) {
      try { out.push(JSON.parse(lines[i])); } catch {}
    }
    return out;
  } catch { return []; }
}

/**
 * 记录一条活动。
 * @param {string} phase  阶段名（如 写正文/推草稿/B站淘片/夜巡/待机/聊天）
 * @param {string} detail 具体一句话
 */
export function emitActivity(phase, detail) {
  const ev = { t: Date.now(), phase: String(phase || '').slice(0, 24), d: String(detail || '').slice(0, 90) };

  safeWrite(NOW_FILE, JSON.stringify({ phase: ev.phase, detail: ev.d, ts: ev.t }));

  // JSONL 环形截尾（超 256KB 保留最近 400 行）
  try {
    fs.mkdirSync(LIFE_DIR, { recursive: true });
    fs.appendFileSync(JSONL_FILE, JSON.stringify(ev) + '\n', 'utf8');
    const st = fs.statSync(JSONL_FILE);
    if (st.size > MAX_JSONL_BYTES) {
      const lines = fs.readFileSync(JSONL_FILE, 'utf8').trim().split('\n').slice(-400);
      fs.writeFileSync(JSONL_FILE, lines.join('\n') + '\n', 'utf8');
    }
  } catch {}

  // 面板实时包（原子写，供 5 秒轮询；只含 activity 数据，无任何密钥）
  const recent = readRecent();
  safeWrite(LIVE_FILE, JSON.stringify({ now: { phase: ev.phase, detail: ev.d, ts: ev.t }, recent }));
}
