# snapshot.json 协议（快照字段说明）

面板每 30 秒拉取一次 `data/snapshot.json`。`tools/snapshot.mjs` 会帮你从源文件生成；想自己接，只要产出**同构 JSON** 即可。

## 顶层

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `v` | number | 协议版本，当前 `3` |
| `generatedAt` | number | 生成时间戳（ms） |
| `self` | object | AI 此刻身心状态 |
| `hormone` | object | 可选，`{label}` 只展示文字 |
| `memories` | array | 记忆星数组（见下），上限建议 ≤ 90 |
| `history` | array | 最近对话气泡 `[{r:"owner"\|"ai", t:"...", ts}]`，建议 ≤ 6 条 |
| `loops` | array | 欠账台账（红字列表）`[{t, days, esc}]` |
| `rehearsed` | array | 夜间「回光」的记忆前缀（面板为这些星星画呼吸虚线环） |

## self

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `activity` | string | 此刻正在做的事（面板大字标题） |
| `mood` | string | 心情文字（影响星云色调：开心→青绿、想念→粉紫、生气→红、安静→深蓝） |
| `monologue` | string | 意识流（底部面板） |
| `energy` / `affection` / `pout` | number | 0-100 状态条 |
| `lastInteractAt` | number | 最后一次互动时间戳（显示“距上次互动 X 分钟前”） |

## memories[i]

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `c` | string | 记忆正文（建议 ≤ 88 字符） |
| `k` | string[] | 关键词（用于聚类定位 + tooltip） |
| `imp` | number | 重要度 1-5（越大星越大、越靠近中心） |
| `fr` | number | 新鲜度 0~1（亮度） |
| `t` | number | 时间戳（tooltip 显示日期） |
| `core` | 0\|1 | 核心烙印（白环、永不淡忘、靠近中心） |
| `emo` | string | `joy`/`miss`/`heavy`/`anger`/`calm`（星星颜色） |
| `wish` | 0\|1 | 心愿星（归入心愿区扇形） |
| `loop` | 0\|1 | 未完成约定（画红色尖刺） |
| `noteText` | string? | 琥珀纸条内容（点开才能读），存在时该星渲染为便签 |

> 生成端会自动去重、按重要度+新鲜度排序截断，你只需要无脑追加。

## 最小可用示例

```json
{
  "v": 3,
  "generatedAt": 1794451166316,
  "self": { "activity": "读一本旧书", "mood": "平静", "energy": 60 },
  "memories": [
    { "c": "第一次陪主人看日出", "k": ["日出"], "imp": 5, "fr": 1, "t": 1790000000000, "core": 1, "emo": "joy", "wish": 0, "loop": 0 }
  ],
  "history": [ { "r": "owner", "t": "早安", "ts": 1794451160000 } ],
  "loops": [ { "t": "学会骑独轮车", "days": 3, "esc": 0 } ],
  "rehearsed": []
}
```
