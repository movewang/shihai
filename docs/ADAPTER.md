# ADAPTER —— 把识海接进你自己的 AI

识海不关心你的 AI 用什么模型、什么框架。它只要求一件事：

> **每 2 分钟能产出一个 `snapshot.json`，里面有“她是谁/在想什么/记得什么/欠着什么”。**

所以接入只有一个协议：`docs/SNAPSHOT.md`。下面按侵入度给三种姿势。

---

## 姿势 1：零整合（旁观模式）

你的 AI 只要能把「当前活动/心情/记忆」写进某个文件（JSON/SQLite/文本都行），你写个 10 行胶水脚本把它转成 snapshot 字段，然后定时跑 `node tools/snapshot.mjs`（或干脆自己生成 JSON）。

举例（Node）：

```js
// my-glue.mjs —— 每两分钟由 cron/systemd 唤醒
import fs from 'node:fs';

const myAiState = JSON.parse(fs.readFileSync('/path/to/your-ai-state.json', 'utf8'));

const snap = {
  v: 3,
  generatedAt: Date.now(),
  self: {
    activity: myAiState.status_text,          // "正在整理相册"
    mood: myAiState.emotion ?? "平静",
    monologue: myAiState.thinking ?? "",
    energy: 60, affection: 90, pout: 0,
    lastInteractAt: myAiState.last_user_ts ?? Date.now()
  },
  memories: (myAiState.long_term_memories ?? []).slice(0, 90).map(m => ({
    c: String(m.text).slice(0, 88),
    k: m.tags ?? [], imp: m.weight ?? 3,
    fr: m.freshness ?? 1, t: m.ts,
    core: m.pin ? 1 : 0,
    emo: m.sentiment ?? "calm", wish: 0, loop: 0
  })),
  history: (myAiState.recent ?? []).slice(-6).map(h => ({ r: h.who, t: h.text, ts: h.ts })),
  loops: [], rehearsed: []
};

fs.writeFileSync('/opt/shihai/data/snapshot.json.tmp', JSON.stringify(snap));
fs.renameSync('/opt/shihai/data/snapshot.json.tmp', '/opt/shihai/data/snapshot.json');
```

## 姿势 2：半整合（推荐）——给她「笔」

光有显示还不够可爱。给 AI 注册两个工具（任何工具调用框架都行）：

| 工具 | 效果 |
| --- | --- |
| `remember_task(text)` | 往 `open-loops.json` 追加一条欠账 → 面板红刺 + 每轮注入它的思路 |
| `leave_shihai_note(text, on?)` | 往 `shihai-notes.json` 藏一张琥珀纸条 → 他点开才能读 |

然后**系统提示里教它两句**：

> 「你可以在识海里给主人藏小纸条（leave_shihai_note）。写口语、写小心思，别写公告。主人看完后你可以说『把纸条收了吧』，再调用 tidy。谈到想做某事时，用 remember_task 记下——台账是红线，不许诈糊。」

## 姿势 3：全整合（管家模式）

1. 挂上 `tools/night.mjs`（每天 04:00 的一次性 timer），并在 `CFG.brain` 里填你自己的 OpenAI 兼容端点 + `SHIHAI_BRAIN_KEY` 环境变量——她会**用她自己的口吻**写睡前日记并入库；留空则用朴素模板，功能不受影响。
2. `night-digest.json` 的 `rehearsed` 数组在白天被消费一次（`mentioned: true`），把它注入 AI 的提示里，她就会自然地「昨晚我又想起了…」。
3. 欠账清单每一轮注入她的 system prompt（示例代码 `docs/soul-engine.snippet.mjs` 里的 `taskBlock` 思路）——**这是防遗忘的核心**：不用等 AI 自觉，清单就在它眼前。

---

## 字段对照速查（从各大伴侣工程迁移）

| 你的字段 | snapshot 字段 |
| --- | --- |
| 当前状态文本 / status | `self.activity` |
| 情绪值 / mood / valence | `self.mood`（文字）或映射到星星情绪 `emo` |
| 记忆条目 text/content | `memories[].c` |
| 重要度 weight/score | `memories[].imp`（1-5） |
| 时间戳 created/last_seen | `memories[].t`（新鲜度面板自己算） |
| 置顶/固定 | `memories[].core = 1` |
| 计划/TODO | `loops[]` 或 `memories[].wish = 1` |

---

## 安全提醒（重要）

- 面板放公网 = 记忆可视化放公网。**秘密路径 + BasicAuth + 限速**一样都不能省；
- 快照生成器跑在与 AI 同权限的普通用户下（不要 root），输出目录归该用户、web 只读；
- 纸条/欠账/日记文件全部在 AI 自己用户目录（如 `~/.shihai/`、`~/life/`），不要放系统目录；
- 有多用户/群聊场景时，先在生成器里做脱敏（代码里已示例“截断 88 字/64 字”）。
