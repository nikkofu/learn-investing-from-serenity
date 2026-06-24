# 路线图与交接文档 / Roadmap & Handoff

> 本文档面向**未来新开 session 的交接**。读完应能独立接手本项目的开发、发版与后续路线。
> 最后更新：随 v0.30.0（2026-06-24）。当前版本 **v0.30.0**，分支 `main`。

---

## 0. 一句话定位

把一个「A 股个股分析 / 可证伪 AI 打分」工具，对标 TradingView 补齐**专业图表 + 回测工程能力**，并在此之上构建**专业量化套利捕捉工具**——但严格约束在 **A 股主板个股、纯多头可执行**范围内，诚实标注边界，不夸大可投资性。

仓库：https://github.com/nikkofu/learn-investing-from-serenity

---

## 1. 关键约束（务必先读，决定了能做什么 / 不能做什么）

### 1.1 股票池约束（硬约束）
- **只做 A 股主板个股**。默认剔除：科创板（688/689）、北交所（8/4/920）、ST/*ST/退/PT（按名称）、B 股（900/200）。创业板（300/301）默认保留。
- 该过滤已收敛为全站统一、可配置、落盘持久化的模块 `src/lib/universe.ts`（见 §3），**不要再 hardcode 过滤规则**，所有构池入口都走它。
- 用户可在 `/settings`「股票池纯净化」里逐项开关。

### 1.2 品种约束（决定套利路线图裁剪）
- **不碰高门槛 / 不可落地品种**：ETF、期货、基金（LOF/分级/QDII）、两融（融资融券）。用户明确排除。
- **关键推论**：A 股主板普通股**没有融券** ⇒「做多 A 腿 + 做空 B 腿」的对冲套利**无法实盘落地**。因此套利雷达**不能卖「多空对冲」**，必须重构为**单边可执行的「相对强弱择时」信号**（v0.29.0 已完成这次重构）。
- 所有套利/信号产物都要**诚实标注**：这是相对强弱择时、含市场 β、非市场中性、非无风险套利、非投资建议。

### 1.3 复权口径约束
- 前复权（qfq）= 贴现价看操作；后复权（hfq）= 长周期真实回测（解决五粮液类 53→1672 失真）。两套口径全程统一（图表/筹码/交易标记/回测/投影），由 `?fq=` / body `fq` 透传。**AI 基本面打分仍走前复权**（与绝对价位无关）。

---

## 2. 开发与发版工作流（交接必读）

### 2.1 运行环境与「桥接」机制
- 真实代码跑在用户的 **Mac** 上：`/Users/REDACTED/Documents/WORK/ai/learn-investing-from-serenity`。
- Devin 这侧通过 **ngrok 隧道 + 桥接脚本**远程读写/执行：
  - 固定隧道域名：`https://REDACTED.ngrok.invalid`，默认指向本机 **REDACTED_PORT** 端口的 bridge（提供 `/api/ping`、`/api/exec`）。
  - 桥接客户端：`/home/REDACTED/br.py`。常用：
    - `python3 br.py exec "<shell>"` —— 在 Mac 仓库目录执行命令。
    - `python3 br.py push <本地文件> <仓库相对路径>` —— 把 Devin 侧文件推到 Mac。
    - `python3 br.py pull <仓库相对路径> <本地文件>` —— 反向拉取。
  - **ngrok 是免费版**：只允许 1 个隧道域名。要可视化验证 UI 时，需用户临时把域名指向 3000（`ngrok http --url=REDACTED.ngrok.invalid 3000`），录完再切回 REDACTED_PORT。默认 Devin **无法直接在自己浏览器打开本地 UI**，验收主要靠 tsc/build + 数据级直跑 + 用户肉眼确认。

### 2.2 改代码的方式
- 在 Devin 侧 `/home/REDACTED/work/` 维护一份镜像，编辑后用 `br.py push` 同步到 Mac，再在 Mac 上跑 tsc/eslint/build。
- 数据级校验：写一次性 `_xxxcheck.mts` 脚本（如 `_calcheck.mts`），用 `npx tsx` 在 Mac 直跑真实数据源验证，**验证完删除、不提交**。

### 2.3 质量门禁（每版必须全绿）
1. `npx tsc --noEmit` —— 0 error。
2. `npm run eslint` —— 改动文件 0 error（历史遗留 warning 不计；已知历史遗留 error 在 `src/app/mining/page.tsx:165`，非本次引入则不阻塞）。
3. `npm run build` —— 通过，新路由已注册。
4. **数据级 spot-check** —— 用真实行情逐条核验核心计算（如白酒配对逐笔收益与手算一致）。

### 2.4 发版规范（自动发版授权）
- **用户已授权（v0.16.0 起）**：每个版本完成即**自动 commit + tag + 推 main**，无需逐次确认。
- 步骤：
  1. 升 `package.json` version；在 `CHANGELOG.md` 顶部追加条目；更新 `README.md`「🆕 最新版亮点」。
  2. commit message 格式：`feat: <中文描述>`（或 `chore(release)` 等）。
  3. **中文 commit/tag 消息必须用消息文件**：写 `.commitmsg` / `.tagmsg`（push 上去），`git commit -F .commitmsg`、`git tag -a vX.Y.Z -F .tagmsg`，**不要内联中文到 shell**（会被转义成 `\uXXXX`）。提交后删除这两个文件。
  4. `git add <精确路径>`（**绝不 `git add .`**）。`data/hot_rank.json` 等运行时产物不提交。一次性 `_*check.mts` 不提交。
  5. `git push origin main && git push origin vX.Y.Z`。
- **PTY 显示假象**：Devin 侧终端渲染 CJK 时可能「掉字」，这是显示假象。需要确认真实字节时用 `git log -1 --format=%s | od -c` 核验。
- 提交前检查 shallow clone：`git rev-parse --is-shallow-repository`，为 `true` 则 `git fetch --unshallow`。

---

## 3. 架构与关键文件地图

### 3.1 量化 / 数据核心（`src/lib/`）
- `universe.ts` —— **股票池纯净化**（全站统一过滤）。`UniverseConfig` / `isExcluded` / `filterUniverse` / `getUniverseConfig` / `setUniverseConfig`，落盘 `.data/universe-config.json`。
- `pairTrading.ts` —— **统计套利引擎**。Engle-Granger 协整 + z-score。关键导出：
  - `backtestPair` —— 市场中性配对回测（样本内/外）。
  - `currentArbSignal` —— 最新一根 z 偏离捕捉（实时机会）。`ArbSignal` 含 `buyCode`（逢低布局）/`deRiskCode`（减仓规避）。
  - `scanArbRadar` —— 全两两协整扫描 + 开口筛选 + 排序。
  - `calibratePair` / `calibrateRadar` —— **v0.30 信号回测校准**（全历史单边事后回测）。类型：`SignalEvent` / `PairCalibration` / `RadarCalibrationResult` / `RadarCalibrationAgg`。
- `costs.ts` —— A 股交易成本模型（佣金 25bp + 印花税 5bp(卖) + 过户费 1bp·双边 + 滑点 5bp，往返 ≈ 0.202%）。`roundTripCostPct()`。
- `indicators.ts` —— MACD/RSI/KDJ/BOLL + **多指标共振**（≥2 指标同向打标，含放量量价确认，score 上限 5）。
- `quant.ts` —— ATR/ADX/筹码分布/walk-forward 等量化基元。
- `performance.ts` —— 回测绩效报表（Sharpe/Sortino/Calmar/PF/最大回撤/连亏/持仓天数/权益·回撤曲线）。
- `drawings.ts` —— LLM 画图基元（水平线/趋势线/区间/标注 + 坐标 sanitize）。
- `candleAgg.ts` —— 分钟 K 聚合（5/15/30/60m）。
- `miningScan.ts` —— 智能挖掘构池（`boardSegments()` / `resolveUniverse()`，已统一走 `universe.ts`）。
- `sources/` —— 行情数据源（东财 push2his / 百度 等多源兜底、failover、`fq` 透传、批量 K 线）。

### 3.2 API 路由（`src/app/api/`）
- `arb/radar` —— 套利雷达扫描。
- `arb/interpret` —— 套利机会 LLM 解读（单边均值回归择时口径）。
- `arb/calibrate` —— **v0.30 信号回测校准**（POST 扫描 + GET 默认参数）。
- `settings/universe` —— 股票池纯净化配置读写。
- `market/chart-data` / `market/kline` / `market/backtest` —— 图表/K线/回测，`fq` 透传。
- `chart/draw` —— LLM 画图。
- `analyze` —— 个股 AI 分析（生成器/批判者/裁判 + Brier 校准；量化层走所选 fq，AI 打分走 qfq）。

### 3.3 页面 / 组件（`src/app/`、`src/components/`）
- `chart/page.tsx` —— 图表主页。顶栏：周期（含 5/15/30/60m 分时）、前/后复权、图表引擎（**默认 Pro 画布** / 经典 SVG）。
- `LightweightChart.tsx` —— **Pro 画布**（lightweight-charts@5.2.0）：K线/量/MA/BOLL/买卖标记/十字光标/对数·%轴/MACD·RSI·KDJ 多窗格/逐根回放/共振标注/AI 画图。已隐藏 TradingView 角标。
- `QuantChart.tsx` —— 经典 SVG 视图（筹码分布/价格投影/VRVP 等独有自绘叠加仍在此）。
- `BacktestReport.tsx` —— 绩效报表 UI。
- `arb/page.tsx` —— 套利雷达页（板块预设 + 单边红绿标签 + AI 解读 + **v0.30 信号回测校准面板**）。
- `StockLink.tsx` —— 全站个股双链组件（名称→/analyze，「图」→/chart）。已接入 arb/scanner/sectors/map/backtest 等。
- `settings/page.tsx` —— 设置页（LLM provider/key、缓存、行情起始、**股票池纯净化**开关）。
- `Nav.tsx` —— 导航（含「套利雷达」入口）。

---

## 4. 已完成路线图（v0.15 → v0.30）

### 4.1 复权统一
- **v0.15.0** 前复权/后复权统一切换（图表/筹码/交易标记/回测同口径），根治五粮液类长周期失真。

### 4.2 P0 — 对标 TradingView 图表/回测工程基础
- **v0.16.0** 纵轴 线性 / 对数 / 百分比 三态切换。
- **v0.17.0** 可插拔副图框架 + MACD/RSI/KDJ/BOLL（BOLL 主图叠加）。
- **v0.18.0** 标准化回测绩效报表（Sharpe/Sortino/Calmar/PF/最大回撤/连亏/持仓天数 + 权益·回撤曲线）。
- **v0.19.0** 引入 **lightweight-charts** Pro 画布视图（canvas，与经典 SVG 并存一键切换）。

### 4.3 P1 — 专业交互（A→B→C→E→D 顺序）
- **v0.20.0** (A) 回测交易成本模型（A 股口径，往返 ≈0.202%）。
- **v0.21.0** (B) 策略参数化表单 + 实时重跑回测。
- **v0.22.0** (C) 逐根回放 / Bar Replay（严防未来函数）。
- **v0.23.0** (E) 多周期分时（5/15/30/60m，东财 push2his 按需拉取，不落日线库）。
- **v0.24.0** (D) LLM 交互式画图（按钮 + 对话自动画线/标注，坐标 sanitize）。

### 4.4 默认值 / 共振增强
- **v0.25.0** 默认 Pro 画布 + 副图默认全开（分窗格）+ 多指标共振标注 + 隐藏 TradingView 角标。
- **v0.26.0** 共振纳入**成交量量价确认**（放量上涨/下跌，score 上限 4→5）。

### 4.5 套利捕捉工具
- **v0.27.0** (Phase 1) **统计套利雷达 StatArb Radar**：协整引擎从研究工具升级为实时机会捕捉（开口筛选 + 排序 + 预计回归天数 + sparkline）。
- **v0.28.0** (Phase 2 起步) 全站个股链接 `StockLink` + 套利 LLM 解读层 `/api/arb/interpret`。
- **v0.29.0** **主板纯净版 + 单边可执行化**：股票池纯净化（`universe.ts` + `/settings` 可配置 + `/mining`·`/arb` 统一）；配对信号重构为单边相对强弱择时（`buyCode`/`deRiskCode`）；LLM 解读改写。
- **v0.30.0** **信号回测校准面板**：`calibratePair`/`calibrateRadar` + `/api/arb/calibrate` + `/arb` 校准面板（6 汇总卡 + 逐对表 + 逐笔明细），验证 z 阈历史可信度（回归率/平均回归天数/单边净收益/胜率/最大逆向 z）。

---

## 5. 后续路线图（裁剪后 · 均在 A 股主板纯多头可执行范围内）

> 约束收紧后，ETF/期货/基金/两融相关 Phase（原 P3 ETF 折溢价、P4 可转债、P5 分级 LOF、P7 AH、P8 期现、P2-余 对冲引擎）**已全部移出**——它们依赖融券或高门槛品种，不可落地。保留的都是单边可执行 / 研究增强项。

### 5.1 已规划的下个版本序列
- **v0.31 横截面动量 / 行业轮动**：主板个股动量打分 + 行业轮动信号 + **纯多头**组合回测（不做空）。
- **v0.32 自定义股票池 + 收藏 + 持久化**：用户自建配对池 / 保存筛选 / 收藏机会（复用 `.data/` 落盘机制）。
- **v0.33 盘中盯盘告警**：盘中轮询股票池，价差开口 / 逼近回归止损时站内提醒（站内/邮件/webhook 视条件）。
- **v0.34 信号 → 策略沉淀**：把验证过的配对 / 参数沉淀为可分享策略，接入现有「策略市场」。

### 5.2 候选增强（未排期，可插队）
- 动态筹码热力 / 过拟合可视化（walk-forward 衰减曲线、参数高原热图）—— 把「过拟合防护 + 校准」做成显性卖点。
- 配对交易纸面交易 / 持仓跟踪（开平记录、实时盈亏、回归达成率）。
- 多标的横向对比 / 布局持久化。
- 基本面面板增强。

### 5.3 明确不做（除非约束放开）
- 任何依赖**融券**的多空对冲套利。
- ETF 折溢价、期货基差、可转债、分级/LOF/QDII、AH 溢价等高门槛 / 跨品种套利。

---

## 6. 诚实边界（产品文案统一口径，必须保留）
- 套利雷达 / 校准产物均为**统计信号**，是**相对强弱择时**、**含市场 β（非市场中性）**、**非无风险对冲套利**。
- 协整为**样本内**性质，会破裂；历史回归率/胜率/收益**不代表未来**。
- 单边持有自担方向与 β 风险。**所有产物标注「非投资建议 (NFA)」**。

---

## 7. 新 session 接手 checklist
1. 读本文档 §1（约束）+ §2（工作流）。确认 ngrok 隧道指向 REDACTED_PORT、`python3 /home/REDACTED/br.py exec "pwd"` 能连通 Mac 仓库。
2. `git rev-parse --is-shallow-repository`，必要时 `--unshallow`；确认 `git status` 干净、HEAD=origin/main、最新 tag 与 `package.json` version 一致（当前 v0.30.0）。
3. 接新需求前先确认是否触碰 §1/§5.3 的约束；触碰则先与用户对齐再动手。
4. 按 §2.4 自动发版（已获授权），中文消息走消息文件，门禁全绿后推 main + tag。
