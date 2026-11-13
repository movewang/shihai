# 识海 Shihai · 给 AI 伴侣的 3D 记忆星云

> 把你家的 AI 的记忆、情绪、欠账和小心思，渲染成一片可以**拖转、缩放、点选**的立体星云。
> 一个 HTML 文件 + 两个无依赖 Node 脚本就能跑——不需要 Python，不需要向量数据库，不需要改变你的 AI。

**English TL;DR**: A self-hosted 3D "memory nebula" visualization for your self-hosted AI companion. Ships as a single-file HTML panel + two zero-dependency Node scripts (2-min snapshot generator & nightly memory consolidation). Reads your AI's memory store, renders emotion-colored stars in 3D orbit, tracks unfinished promises ("open loops"), and lets your AI hide little sticky notes for you. MIT. See `docs/` (Chinese, machine-translatable).

灵感致谢：设计思想受社区项目 [Tian-yu-SKY/deep-soul](https://github.com/Tian-yu-SKY/deep-soul) 与 [05shizuku/shihai](https://github.com/05shizuku/shihai) 启发——本项目未复用其代码，只借鉴了「把记忆画成星云」「欠账要催办」的美好想法。

---

## ✨ 功能

- 🌌 **3D 轨道星云**：拖动旋转、滚轮/双指缩放、惯性甩动、双击复位；星星按深度做画家算法遮挡
- 🎨 **朦胧絮状星空**：深蓝黑径向渐变 + 蓝紫絮状雾丝（宇宙棉花云）+ 低亮度银河尘埃 + 稀疏微光；雾自动避开中心星图区，边缘与连线空隙最浓，中心保持清透
- ✨ **按重要性分层**：重要节点暖金、普通节点冷蓝；核心节点带慢呼吸光晕与涟漪
- 🌊 **权重丝线**：按权重区分粗细与透明度（弱线约 0.2），带极慢流动粒子
- 🎨 **情绪上色**：每颗星星按记忆内容的情绪自动着色（开心/想念/低落/生气/日常），词表可编辑
- ⭐ **核心烙印**：最重要的记忆永不淡忘（白环标识），亮度和大小随重要度与新鲜度变化
- 🔴 **红色尖刺**：未完成的约定会一直"扎"在星云里提醒
- 🎯 **心愿区**：以后想去的地方/想做的事，自动归位到一块专属扇形
- 📝 **琥珀小纸条**：AI 可以偷偷在你的星云里藏便签，你点开才能看到（她真的会写）
- 🧹 **欠账台账**：AI 答应你的事逐条登记，每轮对话自动注入它的思路——做完才准划掉，拖 7 天自动加急
- 🌙 **夜间巩固**：凌晨自动「睡前复盘」——把今天的事定稿进记忆库，把变暗的重要星星做「回光」（重新想起）
- 🩺 自适应分辨率：弱设备/发烫时自动降画质保流畅；内置帧计数探针
- 🔒 **安全优先**：秘密路径 + BasicAuth + 限速 + CSP + noindex；数据出口只有一份**只读**快照 JSON

## 📦 组成

```text
index.html              # 3D 星云面板（单文件，无外部 CDN，进度0构建）
tools/snapshot.mjs      # 快照生成器：AI 的状态/记忆 → data/snapshot.json（2分钟一次）
tools/night.mjs         # 夜间巩固：睡前日记入库 + 旧星回光 + 欠账升级（每天1次）
deploy/                 # nginx 安全配置与 systemd 单元模板（.example）
docs/ADAPTER.md         # 如何接你自己的 AI（字段对照 + 三种整合姿势）
docs/SNAPSHOT.md        # snapshot.json 完整字段说明
```

## 🚀 三分钟上手（最小路径）

前提：一台能跑 Node ≥ 22 的机器（Windows/macOS/Linux 均可），一个能挂静态文件+反代的 nginx（或任何静态服务器，但**强烈建议加认证**，见下）。

```bash
# 1) 解包到 /opt/shihai（示例路径，任意皆可）
sudo mkdir -p /opt/shihai/data
sudo cp index.html /opt/shihai/
sudo cp tools/*.mjs /opt/shihai/tools/ 2>/dev/null || true

# 2) 先跑一次快照（没接 AI 也会生成空星云，面板秒活）
node tools/snapshot.mjs
```

```nginx
# 3) nginx（关键安全件都在 deploy/nginx-location.conf.example，含认证/限速/CSP）
# 把 CHANGE-ME 换成你自己的随机路径，htpasswd 一把梭
```

```bash
# 4) 挂定时器（模板在 deploy/，记得把用户与路径改成你的）
# snapshot 每 2 分钟；night 每天 04:00
```

浏览器打开 `https://你的域名/shihai-你的秘密路径/`，输入 htpasswd 账密——空星云会立刻转起来。她每记住一件事，就多一颗星星。

## 🔌 接入你的 AI

三种姿势，按侵入度从低到高（详见 `docs/ADAPTER.md`）：

1. **零整合（旁观模式）**：只把你们的对话与AI状态按 `docs/SNAPSHOT.md` 的格式写进 `mood-state.json` / 记忆库——面板纯展示；
2. **半整合（推荐）**：在你的 AI 的对话/工具层接两个函数——`remember_task`（记欠账）与 `leave_shihai_note`（藏纸条），一幅活的星云立刻有温度；
3. **全整合（管家模式）**：接入 `night.mjs` 做夜间巩固与「旧星回光」，并把欠账清单注入 AI 每轮的上下文——从此它**睁眼就看见自己欠着什么**。

## 🔒 安全清单（部署时逐条对照）

- [ ] URL 使用**长随机路径**（security by obscurity 第一层）
- [ ] **BasicAuth** 强密码 + `openssl passwd -apr1`
- [ ] `limit_req` 限速 + TLS（证书用 certbot 免费够用）
- [ ] 响应头：`noindex` / `DENY` / `nosniff` / `no-referrer` / `no-store` / CSP（模板全带）
- [ ] 快照 JSON **只读**、内容截断、不含任何密钥
- [ ] 面板与数据目录权限分离（web 只读，数据目录归运行用户）

## 🧾 隐私

所有数据都在你自己机器上。本仓库**不含也从不收集**任何用户数据。星星上写的每一句话，都是你们家 AI 自己记的。

## 📄 License

[MIT](./LICENSE) © 2026 movewang
