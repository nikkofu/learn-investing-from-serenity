# 路线图与交接文档 / Roadmap & Handoff

> 本文档面向**未来新开 session 的交接**。读完应能独立接手本项目的开发、发版与后续路线。
> 最后更新：随 v0.49.3（2026-06-25）。当前版本 **v0.49.3**，分支 `main`。

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

> 注：本项目的本地运行环境、隧道地址、端口、桥接脚本等私密信息**不入库**，由用户在新 session 启动时单独提供。以下只描述工作模式，不含任何主机/网络/磁盘细节。

### 2.1 运行环境与「桥接」机制
- 真实代码跑在**用户本机**的项目仓库目录中（路径由用户私下提供，不写入仓库）。
- 助手侧通过用户提供的**隧道 + 桥接脚本**远程读写/执行（隧道地址、端口、脚本路径均为私密信息，启动新 session 时由用户给出）。桥接客户端提供三类操作：在仓库目录执行命令、把助手侧文件推到本机、反向拉取。
- 隧道为单域名复用，要可视化验证 UI 时需用户临时把域名切到 dev server 端口，录完再切回桥接端口。默认助手**无法直接在自己浏览器打开本地 UI**，验收主要靠 tsc/build + 数据级直跑 + 用户肉眼确认。

### 2.2 改代码的方式
- 在助手侧维护一份仓库镜像，编辑后用桥接 push 同步到本机，再在本机跑 tsc/eslint/build。
- 数据级校验：写一次性 `_xxxcheck.mts` 脚本（如 `_calcheck.mts`），用 `npx tsx` 直跑真实数据源验证，**验证完删除、不提交**。

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

## 4. 已完成路线图（v0.15 → v0.34）

### 4.1 复权统一
- [x] **v0.15.0** 前复权/后复权统一切换（图表/筹码/交易标记/回测同口径），根治五粮液类长周期失真。

### 4.2 P0 — 对标 TradingView 图表/回测工程基础
- [x] **v0.16.0** 纵轴 线性 / 对数 / 百分比 三态切换。
- [x] **v0.17.0** 可插拔副图框架 + MACD/RSI/KDJ/BOLL（BOLL 主图叠加）。
- [x] **v0.18.0** 标准化回测绩效报表（Sharpe/Sortino/Calmar/PF/最大回撤/连亏/持仓天数 + 权益·回撤曲线）。
- [x] **v0.19.0** 引入 **lightweight-charts** Pro 画布视图（canvas，与经典 SVG 并存一键切换）。

### 4.3 P1 — 专业交互（A→B→C→E→D 顺序）
- [x] **v0.20.0** (A) 回测交易成本模型（A 股口径，往返 ≈0.202%）。
- [x] **v0.21.0** (B) 策略参数化表单 + 实时重跑回测。
- [x] **v0.22.0** (C) 逐根回放 / Bar Replay（严防未来函数）。
- [x] **v0.23.0** (E) 多周期分时（5/15/30/60m，东财 push2his 按需拉取，不落日线库）。
- [x] **v0.24.0** (D) LLM 交互式画图（按钮 + 对话自动画线/标注，坐标 sanitize）。

### 4.4 默认值 / 共振增强
- [x] **v0.25.0** 默认 Pro 画布 + 副图默认全开（分窗格）+ 多指标共振标注 + 隐藏 TradingView 角标。
- [x] **v0.26.0** 共振纳入**成交量量价确认**（放量上涨/下跌，score 上限 4→5）。

### 4.5 套利捕捉工具
- [x] **v0.27.0** (Phase 1) **统计套利雷达 StatArb Radar**：协整引擎从研究工具升级为实时机会捕捉（开口筛选 + 排序 + 预计回归天数 + sparkline）。
- [x] **v0.28.0** (Phase 2 起步) 全站个股链接 `StockLink` + 套利 LLM 解读层 `/api/arb/interpret`。
- [x] **v0.29.0** **主板纯净版 + 单边可执行化**：股票池纯净化（`universe.ts` + `/settings` 可配置 + `/mining`·`/arb` 统一）；配对信号重构为单边相对强弱择时（`buyCode`/`deRiskCode`）；LLM 解读改写。
- [x] **v0.30.0** **信号回测校准面板**：`calibratePair`/`calibrateRadar` + `/api/arb/calibrate` + `/arb` 校准面板（6 汇总卡 + 逐对表 + 逐笔明细），验证 z 阈历史可信度（回归率/平均回归天数/单边净收益/胜率/最大逆向 z）。

### 4.6 纯多头研究增强（§5.1 序列，已全部交付）
- [x] **v0.31.0** **横截面动量 / 行业轮动 · 纯多头**：`momentum.ts` 7 因子横截面打分 + `rankSectors` 行业轮动 + 纯多头组合回测（只买不卖空，扣 30bps）；`/momentum` 三 Tab + `POST /api/momentum/{rank,sectors,backtest}`。
  - [x] **v0.31.1** `/momentum` 个股链接「图」文字换图标 + 服务端从基础库（带缓存）补全个股名称。
  - [x] **v0.31.2** `StockLink` 图标改为干净的折线图（line-chart）样式。
- [x] **v0.32.0** **自定义股票池 + 收藏 + 持久化**：`watchlist.ts` → `.data/watchlist.json`（收藏 / 命名股票池 / 保存筛选参数集）；`/watchlist` 管理页 + `POST/GET/DELETE /api/watchlist/{favorites,pools,screens}`；与 scanner/momentum/arb 双向打通（`?codes=` 深链 + 一键存取）。
  - [x] **v0.32.1** 修掉 `mining/page.tsx` 既存 react-hooks lint error（`useEffect` 在声明前调用），全仓 lint 0 error。
- [x] **v0.33.0** **盘中盯盘告警**：`alerts.ts` + `alertEngine.ts` → `.data/alerts.json`；套利型（价差开口 / 逼近止损）+ 个股价格型规则；拉日 K + 实时行情拼盘中 live z，命中按 `cooldownMin` 冷却去重，投递站内告警箱 + 可选 webhook；`/alerts` 页（规则管理 + 告警箱 + 自动轮询）+ `POST/GET /api/alerts/{rules,events,check}`。
- [x] **v0.34.0** **信号 → 策略沉淀**：`savedStrategies.ts` → `.data/saved-strategies.json`；把校准过的配对 + 参数 + 战绩快照沉淀为可复检、可分享策略，`scorePairStrategy()` 加权打分 A/B/C/D，`revalidateSavedStrategy()` 重拉 K 刷新活战绩 + live 信号；`/arb` 校准表「沉淀为策略」按钮 + `/strategies`「我的沉淀策略」区（复检/导出/导入/删除）+ `GET/POST/DELETE /api/strategies/saved`。

### 4.7 v0.48 产品化改版（国际化审美 / IA / 设计系统，五阶段收官）
> 目标：在不改任何计算口径的前提下，把工具升级为「有信息架构、统一视觉语言、可达性达标」的专业投研台。完整设计文档见 [`docs/`](.)（`v0.48-redesign-overview` / `-information-architecture` / `-design-system` / `-homepage-redesign` / `-task-checklist`）。五阶段均独立可交付、可回滚，零 / 轻新依赖。
- [x] **v0.48.0** **设计系统地基（无可见破坏）**：`globals.css` 在现有 5 主题 × 明暗语义色上**只追加不重写**——间距（8pt）/ 圆角 / 阴影 / 字阶 / 层级 / 动效 token + 全局 `:focus-visible` 焦点环 + `.tnum` 等宽数字；自托管 Noto Sans SC（`next/font`，零外链）；新建 `src/components/ui/`（`PageHeader`/`Card`/`SectionTitle`/`Badge`/`Button`/`KPIStat`/`DataTable` 等），仅新增文件不影响现有页面。
- [x] **v0.48.1** **导航外壳重构（首个可见改版）**：顶栏 17 个扁平入口 → 5 大分组可折叠侧边栏（发现 / 分析 / 策略与回测 / 交易与监控 / 系统）+ 精简顶栏 + 面包屑 + 窄屏抽屉；单一数据源 `src/lib/navConfig.ts`；`/chart` 首次进入主导航；引入 `lucide-react@1.20.0`，退役旧 `Nav.tsx`。
- [x] **v0.48.2** **全局命令面板（⌘K）**：`Cmd/Ctrl+K` 或顶栏搜索框唤起；页面模糊跳转（中 / 英 / 拼音全拼 + 首字母）；6 位代码 → 个股分析 / K 线两动作（新开页）；最近访问（localStorage）+ 键盘可达；纯前端零新依赖。
- [x] **v0.48.3** **首页改版为仪表盘**：`/`（工作台）从静态介绍页升级为投研仪表盘——市场快照 / 我的自选 / 今日热门 / 最近告警 / 快捷入口 / 板块热力 mini（`src/components/home/*`，各模块独立 fetch + Skeleton + 失败降级），五因子 / 知识库下沉保留；响应式 3→2→1；纯前端零新依赖。
- [x] **v0.48.4** **全站页头统一 + 视觉收尾 + a11y（收官）**：全站 18 页手写页头收敛到统一 `PageHeader`（语义化 `<header>`），按 5 大导航分组分批落地；`/scanner`、`/sectors` 由旧 mono 终端式页头换为统一样式，动作按钮 / 子标签行 / 富文本副标题保留；首页 Hero 与 `/chart` 全屏终端有意豁免；键盘 `:focus-visible` 焦点环可见，暗 / 亮双模对比度抽检正常；零新依赖、不改业务逻辑。

### 4.8 v0.49 TradingView 热门策略发现同步（合规·元数据·参考）
> 目标：把「同步 / 复刻 TradingView 策略」按可落地、可合规的方式工程化。社区脚本「自动复刻全部」按字面不可行（版权 / 闭源 / 无可靠 Pine→TS 转译 / 数万脚本每日新增三道硬墙），故本阶段先落地**发现管线**：只抓**公开元数据**作外链参考，复刻仍走既有「逐个、具名、原作链接 + 差异说明、人工 + `/backtest/strategy` 回测双校验」路线（见 §7.5 / 7.x 复刻注册表）。
- [x] **v0.49.0** **TV 热门策略发现同步**（**已于 v0.49.2 下线**）：抓取解析库 `src/lib/tvScripts.ts`（解析列表页内嵌 JSON → `TvScriptRef`：名称/作者/链接/点赞/评论/访问级别/缩略图/标的/Pine 版本/时间戳/摘要）；接入 `sync.ts` 新增 `tvStrategies` 源（版本化 + 快照 + 防缩水校验），`/sync` 中心新增一行，读取接口 `GET /api/tv-scripts`；`/strategies` 新增「TradingView 热门策略（参考）」卡片区（缩略图 + 访问徽章 + 元信息 + 回链新开页 + 一键同步第一页热门）。只抓公开元信息、不抓源码、不绕付费墙、保留署名；落盘 `.data/tv-strategies.json`；零新依赖、不改任何计算口径。
- [x] **v0.49.2** **下线 TV 热门策略发现板块**：该发现板块只抓公开元数据作外链引用，社区策略无法在本项目内直接使用、价值有限，按用户要求整体移除（删 `tvScripts.ts` + `/api/tv-scripts` + `sync.ts` 的 `tvStrategies` 源 + `/strategies` 卡片区 + `/sync` 对应行）。**复刻库 `tvStrategies.ts`（GBB / Cardwell / KAMA）不受影响。** 零新依赖、不改任何既有计算口径；三关全绿。
- [x] **v0.49.1** **复刻首个具名开源策略：Kaufman MA Adaptive [MKB]**（`qgTc4zie`，作者 muratkbesiroglu）：走「逐个、具名、原作链接 + 差异说明、人工 + 回测双校验」路线。`src/lib/tvStrategies.ts` 新增 `kaufmanAMA()`/`rollingStdev()`/`computeKamaMomentum()`（KAMA 线 + 翻多翻空 + regime + ER 图层）+ `runTvKamaMomentumV1()`（翻多入场=上穿「KAMA+0.5×stdev(20)」上带、跌破 KAMA 离场、双边手续费、忠实原版不另加 ATR 止损）；登记进 `STRATEGIES[]`（id `tv-kama-momentum-v1`），自动接入 `/analyze`、`/backtest/strategy`、`/chart` 策略图层、UI 下拉。诚实口径：KAMA 首根用前一根收盘播种、stdev 总体口径对齐 Pine；实测小样本胜率 22.6% 未跑赢买入持有，证明引擎诚实标注不显著。顺带修 `recommendationBacktest.ts` `shortExitReason` 加 KAMA 离场标签分支（避免被误归类 ATR）。零新依赖、不改任何既有计算口径。
- [x] **v0.49.3** **UI 修复（非 TV 策略）**：修 `/map` 思维导图卡片「瓶颈点」徽章被挤成竖排 / 与脉冲点重叠的破版、BOM 占比标签折断；个股「· 图」文字入口换成蜡烛图 K 线图标（`ChartGlyph`，`/chart` 直达）；`CommandPalette` 列表改内缩圆角高亮 + 图标容器化。纯前端样式 / 标记，零新依赖、不改任何计算口径；三关全绿。
- [ ] **（后续）** 复刻工作台（半自动、强制人工 + 回测双校验）：针对清单里**开源可见**脚本，LLM 辅助逆向成 `TvStrategyMeta` 草稿 → 人工校验 + 回测证明引擎跑通后才登记，不自动上线。
- [ ] **（后续）** 增量发现「新出来的」脚本（定时 / cron，仅元数据）。

---

## 5. 后续路线图（裁剪后 · 均在 A 股主板纯多头可执行范围内）

> 约束收紧后，ETF/期货/基金/两融相关 Phase（原 P3 ETF 折溢价、P4 可转债、P5 分级 LOF、P7 AH、P8 期现、P2-余 对冲引擎）**已全部移出**——它们依赖融券或高门槛品种，不可落地。保留的都是单边可执行 / 研究增强项。

### 5.1 已规划的下个版本序列（✅ 全部交付，详见 §4.6）
- [x] **v0.31 横截面动量 / 行业轮动**：主板个股动量打分 + 行业轮动信号 + **纯多头**组合回测（不做空）。 → v0.31.0/.1/.2
- [x] **v0.32 自定义股票池 + 收藏 + 持久化**：用户自建配对池 / 保存筛选 / 收藏机会（复用 `.data/` 落盘机制）。 → v0.32.0/.1
- [x] **v0.33 盘中盯盘告警**：盘中轮询股票池，价差开口 / 逼近回归止损时站内提醒（站内/邮件/webhook 视条件）。 → v0.33.0
- [x] **v0.34 信号 → 策略沉淀**：把验证过的配对 / 参数沉淀为可分享策略，接入现有「策略市场」。 → v0.34.0

> **§5.1 复盘（v0.31→v0.34）**：四个版本都顺着「纯多头可执行 + 零新依赖 + 全复用 `.data/` JSON 落盘」走，形成闭环：**成信号（v0.31 动量、套利雷达）→ 存资产（v0.32 股票池/收藏）→ 盯变化（v0.33 告警）→ 沉淀可分享策略（v0.34）**。三类持久化（`watchlist.json` / `alerts.json` / `saved-strategies.json`）共享同一套 `mkdir -p` + 原子 `writeFile` 范式；UI 都复用 `StockLink` / `PoolControls` / 深链 `?codes=`。门禁全绿：每版 tsc 0 error、改动文件 eslint 0 error、build 过 + 新路由已注册。其中 v0.31.1/.2 是用户反馈（图标丑/名称未显示）、v0.32.1 是顺手修掉既存 lint error。

### 5.2 候选增强（未排期，可插队）
- [x] 过拟合可视化（walk-forward 衰减曲线、参数高原热图）—— 把「过拟合防护 + 校准」做成显性卖点。**（v0.35.0：`/arb` 校准表「体检」按钮 → 参数高原热图 + walk-forward 衰减曲线 + 0~100 稳健分/结论）**
- [x] 配对交易纸面交易 / 持仓跟踪（开平记录、实时盈亏、回归达成率）—— 可与 v0.34 沉淀策略打通（从策略一键建纸面仓）。**（v0.36.0：`/paper` 纸面交易页 + `/strategies` 沉淀策略「建纸面仓」一键开仓；持仓盯市复用 `latestPairZ`/实时价拼接算实时 z 与净盈亏，命中 exitZ 回归 / stopZ 止损 / maxHoldDays 超时自动平仓；汇总「回归达成率 / 胜率 / 已实现盈亏」。落盘 `.data/paper-trades.json`，成本走 `costs.ts` A 股模型，零新依赖）**
- [x] 多标的横向对比 / 布局持久化。**（v0.37.0：`/compare` 横向对比页——任意一组标的拉到同表，实时行情 + 横截面动量因子按**截面百分位**着色（绿优红劣）、可点表头排序、归一化价格走势叠加（公共交易日基点=100）；把「对比哪些标的 + 显示哪些列 + 列序 + 排序」沉淀为命名**对比视图**一键复原。落盘 `.data/compare-views.json`，与 `/momentum` 同口径 `scoreCrossSection`，零新依赖）**
- [x] 基本面面板增强。**（v0.38.0：`/analyze` 结果区新增 `FundamentalsPanel`（独立 fetch、不阻断流式推理链路）——把此前只在调试接口暴露的真实财报（营收/净利+同比、毛利率/净利率/ROE/资产负债率/EPS）显性化：财务摘要网格 + 估值行（PE/PB/PEG/TTM 股息率/市值）+ 0~100 **基本面质量分**与 A/B/C/D 评级（ROE/净利率/营收增速/净利增速/负债率逆向/估值，透明加权、显式阈值）+ 营收/净利近 N 期 SVG 趋势 + 近期分红。新增 `src/lib/fundamentals.ts`、`getFinancialsHistory()`、`GET /api/fundamentals`，各源 best-effort 容错，零新依赖。诚实边界：单只自评不做同业对标、不预测未来，仅供研究）**

### 5.3 明确不做（除非约束放开）
- 任何依赖**融券**的多空对冲套利。
- ETF 折溢价、期货基差、可转债、分级/LOF/QDII、AH 溢价等高门槛 / 跨品种套利。

---

## 6. 诚实边界（产品文案统一口径，必须保留）
- 套利雷达 / 校准产物均为**统计信号**，是**相对强弱择时**、**含市场 β（非市场中性）**、**非无风险对冲套利**。
- 协整为**样本内**性质，会破裂；历史回归率/胜率/收益**不代表未来**。
- 单边持有自担方向与 β 风险。**所有产物标注「非投资建议 (NFA)」**。

- [x] **v0.39.0 统一口径落地**：把全站分散手写的免责 / 风险边界文案收敛到唯一可信源 `src/lib/disclaimers.ts`（5 个规范导出 `NFA`/`ARB_BOUNDARY`/`BACKTEST_BOUNDARY`/`FUNDAMENTALS_BOUNDARY`/`AI_BOUNDARY`）+ 统一渲染组件 `src/components/Disclaimer.tsx`（`<Disclaimer variant="..." />`）。页面与 API（note 字段）一律从此引用，杜绝口径漂移。纯文案收敛、零业务逻辑改动。

---

## 7.5 经典技术指标策略组（对标 TradingView「七个值得尝试的指标」）

> 研读 CMC Markets《七个值得尝试的 TradingView 指标》（RSI / 移动均线 / MACD / 布林带 / 斐波那契回撤 / 随机指标(KDJ) / 成交量）后，结合本项目既有指标库（`indicators.ts`）、回测证明引擎（`/backtest/strategy` 带 z 检验 / PSR / DSR / Purged-CV）与**带版本号的策略注册表**（`strategies.ts`），落地 5 个「比原文裸口径更优」的策略。原文核心观点是「**任何单一指标都应与其他指标结合使用**」，故每个策略都在裸指标上叠加：①MA60 趋势闸门（避开 A 股单边下跌接飞刀）；②多重确认（零轴 / 放量 / 低位金叉企稳）；③ATR(14) 自适应跟踪止损（回撤随个股波动伸缩，不猜顶）。全部**纯多头、A 股主板、含双边手续费**，各带独立 id+版本号便于迭代。新增 `src/lib/indicatorStrategies.ts`，登记进 `strategies.ts` 即**自动接入** `/backtest/strategy` 下拉、证明引擎与 `/analyze`，零新依赖。

- [x] **v0.40.0** 5 个指标策略（均 `@1.0`）：
  - `confluence-v1`「多指标共振（旗舰）」：复用 `computeResonance`，要求 ≥3 指标（MACD/RSI/KDJ/布林/量能）同向共振 + MA60 闸门才入场，直接回应原文「指标需组合」。
  - `rsi-reversion-v1`「RSI 超卖回归（趋势过滤）」：只认 RSI 上穿 30 的修复瞬间 + MA60 闸门，离场 RSI 破 70 / 跌破 MA20 / ATR 止损。
  - `macd-zero-trend-v1`「MACD 零轴上金叉趋势跟随」：只认零轴之上金叉 + MA60 上行 + 放量确认，滤掉震荡假金叉。
  - `boll-squeeze-v1`「布林挤压突破」：识别带宽近 100 日低 40 分位的挤压后放量突破上轨（动量口径，与既有「网格·均值回归」趋势/震荡互补）。
  - `fib-kdj-pullback-v1`「斐波那契回踩 + KDJ 低位金叉」：上升趋势中回踩 38.2%~61.8% 黄金区 + KDJ 低位金叉企稳，一策略覆盖原文「斐波那契」与「随机指标」两项。
  - 门禁全绿（tsc 0 error、改动文件 eslint 0 error、build 过 + 注册表 5 策略自动接入）；真实行情功能级校验 4 股 × 5 策略全 OK（纯多头 shares>0、买卖配对、无 NaN/Infinity、下行样本里多数跑赢买入持有）。

---

## 7. 新 session 接手 checklist
1. 读本文档 §1（约束）+ §2（工作流）。向用户索取本机仓库路径与桥接隧道信息（私密、不入库），确认桥接能连通本机仓库。
2. `git rev-parse --is-shallow-repository`，必要时 `--unshallow`；确认 `git status` 干净、HEAD=origin/main、最新 tag 与 `package.json` version 一致（当前 v0.40.0）。
3. 接新需求前先确认是否触碰 §1/§5.3 的约束；触碰则先与用户对齐再动手。
4. 按 §2.4 自动发版（已获授权），中文消息走消息文件，门禁全绿后推 main + tag。
