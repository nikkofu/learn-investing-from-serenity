# CHANGELOG / 更新日志

本项目的所有重要更新都将记录在此文件中。

---

## [0.39.0] - 2026-06-24

> **§6 诚实边界 · 统一口径（单一可信源 + 组件化渲染）**。把全站此前散落在各页面与 API（note 字段）里**手写**的「非投资建议 / 统计信号 / 不代表未来 / 含市场 β 自担风险 / AI 可能有误」等免责与风险边界文案，收敛到**唯一可信源** `src/lib/disclaimers.ts`，并新增统一渲染组件 `src/components/Disclaimer.tsx`。**纯文案收敛、零业务逻辑改动、零新依赖**——只把既有口径集中到一处维护，杜绝同一句免责在不同页面措辞漂移。

### 新增：唯一可信源 + 渲染组件
- `src/lib/disclaimers.ts`（纯字符串、无 React 依赖，服务端 API note 与客户端页面皆可引用）导出 5 个规范文案：
  - `NFA`：通用尾注「仅供研究，不构成投资建议（NFA）。」所有 AI / 量化产物统一以此收尾。
  - `ARB_BOUNDARY`：套利雷达 / 协整校准 / 配对回测的统计信号边界（相对强弱择时 · 含市场 β 非市场中性 · 非无风险对冲套利 · 样本内会破裂 · 历史不代表未来 · 单边自担风险）。
  - `BACKTEST_BOUNDARY`：回测 / 情景模拟边界（不代表未来收益、样本内偏高需看样本外）。
  - `FUNDAMENTALS_BOUNDARY`：基本面质量分边界（单只透明加权自评、不做同业对标、不预测未来）。
  - `AI_BOUNDARY`：AI 生成内容边界（依据公开行情与量化方法生成、可能有误、仅供研究）。
- `src/components/Disclaimer.tsx`：`<Disclaimer variant="nfa|arb|backtest|fundamentals|ai" />`，统一样式（`text-[11px] text-[var(--faint)]`）的标准免责注脚，保证全站口径与外观一致。

### 变更：各页 / 各 API 接入统一口径
- 页面（JSX）：`/analyze`、`/scanner`、`/arb`、`/momentum`、`/compare`、`/paper`、`/watchlist`、`/alerts`、`/backtest`、`/backtest/pairs`、`/backtest/strategy`、`/mining`、全局 `layout.tsx`（metadata 描述 + 页脚）改为引用 `NFA` / `ARB_BOUNDARY` 等常量或 `<Disclaimer />` 组件。
- API（note 字段）：`/api/fundamentals`、`/api/compare`、`/api/paper/positions`、`/api/momentum/{rank,sectors}`、`/api/arb/{radar,calibrate,robustness}`、`/api/backtest/pairs`、`/api/map` 的免责说明改为拼接 `disclaimers.ts` 常量。
- 库：`src/lib/pairTrading.ts` 导出的 backtest / radar / calibrate note 文案统一收敛到 `NFA`。

### 质量门禁（本机执行）
- `npm run type-check`（`tsc --noEmit`）0 error；`npm run lint` 0 error（27 个历史遗留 warning，与上一版同数、非本次引入）；`npm run build` 通过，全部路由如常注册。
- 纯文案收敛，未改 API JSON 结构与任何业务逻辑，无回归风险。

---

## [0.38.0] - 2026-06-24

> **基本面面板增强**。§5.2-D：把此前只在调试接口（`/api/market/data`）暴露的**真实财报**搬到 `/analyze` 个股研判结果区，新增 **「基本面 · 财务质量」** 面板。面板**独立 fetch** `/api/fundamentals`，与主流式 AI 推理链路完全解耦（不延迟推理、零回归风险）。透明加权出 **0~100 基本面质量分** + **A/B/C/D 评级**，并把营收/净利近 N 期做成 SVG 趋势。全部复用既有数据源（东财 RPT_F10_FINANCE_MAINFINADATA / 分红 / 实时行情），各源 best-effort 容错，零新依赖；产物为单只个股自评、不做同业对标、不预测未来，仅供研究、非投资建议。

### 新增：基本面打分层
- `src/lib/fundamentals.ts`（纯函数、零依赖）：
  - `scoreFundamentals(fin, valuation)`：把最新一期主要财务指标 + 估值映射成 0~1 子分因子，**透明加权**合成 0~100 质量分 + 评级。权重与显式阈值——**ROE 25%**（`rampUp 0→20%`）/ **净利率 15%**（`rampUp 0→25%`）/ **营收增速 15%**（`rampUp −10→30%`）/ **净利增速 20%**（`rampUp −20→40%`）/ **资产负债率 15%**（`rampDown 30→80%`，逆向：越低越好）/ **估值 10%**（PE 分段：≤0 亏损降权 0.2、≤15→1、15~30→1→0.6、30~60→0.6→0.2、>60→0.15）。仅对**非缺失**因子按权重重归一（`coverage` 记录纳入数），缺失因子不拖累、不补默认。评级 A（≥80）/ B（≥65）/ C（≥50）/ D，星级 `round(score/20)` 夹紧 1~5。
  - `pegRatio(pe, netProfitYoy)`：`PE / 净利同比增速%`，仅在 PE>0 且增速>0 时有意义，否则 `null`。
- `src/lib/market.ts`：抽出 `mapMainFinRow()`（东财财报单行 → `StockFinancials` 映射，去重原 `getFinancials` 内联逻辑）；新增 `getFinancialsHistory(code, periods=8)`——按报告期降序拉近 N 期主要财务指标（best-effort，失败返空数组，复用 `financials` 自适应 TTL 缓存）；`getFinancials()` 改为取 history 首项，行为不变。经 `src/lib/sources` 出口转出。

### 新增：API 路由
- `src/app/api/fundamentals/route.ts`（`dynamic = "force-dynamic"`，`maxDuration = 120`）：`GET ?code=&periods=` 用 `Promise.allSettled([getQuotesFailover, getFinancialsHistory, getDividendHistory])` 聚合，**单源失败不影响其余字段**。返回 `{code,name,asOf, valuation:{price,pe,pb,totalMarketCap,floatMarketCap,turnoverPct,peg,dividendYield}, financials(最新一期), history(升序趋势), dividends(近 6 条), quality, sources, note}`。**TTM 股息率**：近 365 天除权的税前每 10 股派现求和 → 每股 → 占现价比例。

### 新增：UI 接入
- `src/app/analyze/page.tsx`：结果区估值卡之后插入 `<FundamentalsPanel code={quote.code} />`——独立 `useEffect` 取数 + 加载/错误/空态自处理，不阻断 `Result` 渲染。布局：**质量分徽标（分/评级/星级）+ 6 因子拆解条**（按子分着色，悬浮显示阈值解读）、**估值行**（PE/PB/PEG/TTM 股息率/总市值/流通市值）、**财务摘要网格**（营收/归母净利 + 同比着色按 A 股口径红涨绿跌、毛利率/净利率/ROE/资产负债率/EPS/换手率）、**营收 + 净利近 N 期 SVG 柱状趋势**（`TrendBars`，含零轴、负值向下、期标 `24A/24Q3` 简写）、**近期分红送转**标签、诚实边界提示。纯 SVG 自绘、零新图表依赖。

### 质量门禁
- `tsc --noEmit` 0 error；改动/新增文件 `eslint` 0 error / 0 warning；`next build` 通过，新路由 `/api/fundamentals` 已注册。真实行情功能级校验：600519 贵州茅台（质量分 65.6/B、PE 18.25、PEG 12.4、近 8 期趋势）、000858 五粮液（79.8/B、营收增速 33.7% 拉满、PEG 0.27）、601318 中国平安（27.9/D、营收 −6.2%、PE 6.7、净利增速为负故 PEG=null）——质量分如实拉开差距、各因子子分与原始指标一致，缺失字段优雅降级。

## [0.37.0] - 2026-06-24

> **多标的横向对比 / 布局持久化**。§5.2-C：把任意一组标的拉到同一张表里横向对比——实时行情 + 横截面动量因子（与 `/momentum` 同口径 `scoreCrossSection`），逐列按**截面百分位**着色（绿优红劣，一眼看出谁强谁弱），可点表头排序，并叠加**归一化价格走势**（取所有标的公共交易日窗口、基点统一归 100，剔除价格量纲差异后直观比强弱）。再把「对比哪些标的 + 显示哪些列 + 列序 + 排序方向」沉淀为命名**对比视图**一键复原 / 切换。全部复用既有 `.data/` JSON 落盘（`mkdir -p` + 原子 `writeFile`），零新依赖；产物为研究信号、非投资建议。

### 新增：对比计算 + 视图持久化层
- `src/lib/compare.ts`：
  - `COMPARE_COLUMNS`：11 列指标目录（现价 / 今日涨跌 / 换手率 + 近1/3/6月、12-1动量、年化波动、风险调整、趋势、合成动量分），每列带 `unit`（格式化）与 `better`（着色方向：1=越大越优、-1=越小越优、0=中性不着色）。服务端按此算值、前端按此渲染/选列，单一事实源避免两端漂移。
  - `percentile(values, better)`：横截面百分位映射到 `[0,1]`（并列取平均名次，`null` 不参与不着色，`better=-1` 反向，`better=0` 全 `null`）—— 着色与排序的统一口径。
  - `normalizeCodes` / `normalizeColumns`：去重、保序、合法性校验（6 位代码 / 合法列键），空输入回退默认列。
  - 视图持久化 → `.data/compare-views.json`（仿 `watchlist.ts` / `paperTrades.ts` 原子写）：`CompareView{codes,columns,sortKey,sortDir}` 即「对比集 + 布局」；`createView` / `updateView` / `deleteView` / `listViews`，`sanitizeLayout` 统一清洗。

### 新增：API 路由
- `src/app/api/compare/route.ts`（`dynamic = "force-dynamic"`，`maxDuration=300`）：`POST {codes,names?,limit?,chartDays?}` 批量取日 K（`getKlinesBatch`）+ 实时行情（`getQuotesFailover`）→ `scoreCrossSection` 合成动量因子 → 逐列算截面百分位（着色）→ `buildNormalizedSeries` 取公共交易日最后 N 根、基点归 100 输出叠加序列。单次最多 30 只，超限/无合法代码返 4xx。`GET` 返回列目录与默认参数。
- `src/app/api/compare/views/route.ts`（`force-dynamic`）：`GET` 列出视图；`POST` 新建（无 id）/ 更新（带 id）；`DELETE ?id=` 删除。

### 新增：UI 接入
- `src/app/compare/page.tsx`「多标的横向对比」：代码输入框（复用 `PoolControls` 载入/存为股票池）+ 可勾选显示列 + 「开始对比」；对比表按截面百分位热力着色、点表头切换排序列/方向、每行 `StockLink` + `FavoriteButton`；纯 SVG **归一化走势叠加图**（图例可点选隐藏单只、显示各标的区间涨跌幅）；顶部「已存对比视图」一键切换 + 「存为 / 更新对比视图」。
- `src/components/Nav.tsx`：新增「横向对比」入口（置于「动量轮动」之后）。

### 质量门禁
- `tsc --noEmit` 0 error；改动/新增 5 文件 `eslint` 0 error / 0 warning；`next build` 通过，新路由 `/compare`、`/api/compare`、`/api/compare/views` 均已注册。真实行情功能级校验（600519/000858/601318）：`scoreCrossSection` 合成分 ∈ [0,1]；近3月收益 `[-13.14%, -13.28%, -26.23%]` → 截面百分位 `[1, 0.5, 0]`（越大越优）正确；视图 CRUD（建/列/删）落盘正常，测试数据已清理。

## [0.36.0] - 2026-06-24

> **配对纸面交易 / 持仓跟踪**。§5.2-B：把 v0.34「沉淀策略」与 v0.33「实时行情」打通——对已验证的协整配对一键建「纸面仓」前向跟踪，记录开平流水、盯市实时盈亏、统计「回归达成率」。与 v0.34 沉淀策略（事后校准统计「历史能不能信」）互补：这是「现在跟一笔、看价差回归到底兑不兑现」。P&L 走 `costs.ts` 既有 A 股成本模型（佣金 / 印花税 / 过户费 / 滑点），全程纯多头、非投资建议，零新依赖。

### 新增：纸面交易持久化层
- `src/lib/paperTrades.ts` → `.data/paper-trades.json`（仿 `watchlist.ts` / `alerts.ts` / `savedStrategies.ts` 的 `mkdir -p` + 原子 `writeFile` 范式）：
  - `PaperPosition`：开仓快照（配对 a/b/β、买入腿、`entryPrice`、`entryZ`、名义本金、`buyShares` 折算的纸面股数）+ 参数（`lookback`/`entryZ`/`exitZ`/`stopZ`/`feeBps`/`maxHoldDays`）+ 最近盯市 `mark` + 平仓信息 `close`。
  - `computeMark(pos, price, z, asOf, holdDays)`：用 `sellProceeds(shares, price)`（已扣卖出佣金 / 印花税 / 过户费 / 滑点，与开仓 `buyShares` 对称）算 `pnl = 卖出净得 − 名义本金`、毛 / 净收益%，并判 `reverted`(|z|≤exitZ) / `stopped`(|z|≥stopZ) / `timedOut`(holdDays≥maxHoldDays)。
  - `autoCloseReason(mark)`：自动平仓优先级 **止损 > 回归 > 超时**。
  - `summarize(positions)`：汇总开 / 平仓数、**回归达成率**（已平仓中由「价差回归」兑现的占比）、胜率、平均持有交易日、已实现 / 未实现净盈亏。
  - CRUD：`openPaperPosition`（同配对 + 同方向去重）/ `applyMark`（写盯市，可同时平仓，累计 `maxAdverseZ`）/ `listPaperPositions`（持仓中在前）/ `deletePaperPosition` / `clearClosedPositions`。
- `src/lib/pairTrading.ts` 新增 `latestPairZ(pair, a, b, lookback)`：与 `currentArbSignal` / `calibratePair` 同口径算最新一根滚动 z，但**不设入场阈门槛**（开仓后无论是否还开口都要持续跟到回归），并返回对齐后的交易日序列供按「交易日」计持仓天数。

### 新增：API 路由
- `src/app/api/paper/positions/route.ts`（`dynamic = "force-dynamic"`）：
  - `GET`（`?refresh=1` 可选）：列持仓；刷新时对每个持仓中纸面仓重拉 K + 拼接实时价（`spliceLivePrice`，同 `alertEngine.ts` 口径，今日 > 末根则补一根合成「盘中」K），用 `latestPairZ` 算当前 z、`computeMark` 算实时盈亏、命中条件自动平仓。
  - `POST action="open"`：从 `strategyId`（载入沉淀策略）或手填 a/b + 参数建仓，校验配对 / K 线 / 协整、取当前信号、无开口则拒绝。
  - `POST action="refresh"`（批量盯市）/ `action="close"`（按现价手动平仓）/ `action="clear"`（清空已平仓）。
  - `DELETE ?id=`：删除一条持仓。

### 新增：UI 接入
- `src/app/paper/page.tsx` 新页「纸面交易」：顶部汇总（持仓 / 平仓数、回归达成率、胜率、平均持有、已实现 / 未实现盈亏）+ 「立即盯市」；持仓卡片（配对 / 方向 / 盈亏着色「盈红亏绿」/ z 进度条 `ZTrack` 标开仓→当前→exitZ/stopZ 边界 / 手动平仓 / 删除）；手动开仓表单（a/b 代码 + 自定义参数）。纯 React/CSS/SVG，零新图表依赖。
- `src/components/Nav.tsx`：新增「纸面交易」入口。
- `src/app/strategies/page.tsx`：沉淀策略卡片新增「**建纸面仓**」按钮，一键 POST `action="open"` + `strategyId` 建仓并提示。

### 质量门禁
- `tsc --noEmit` 0 error；改动 6 文件 `eslint` 0 error / 0 warning；`next build` 通过，新路由 `/paper`、`/api/paper/positions` 已注册。真实行情功能级校验（工行 601398 / 建行 601939）：协整 β=1.063 → 取当前信号建仓（纸面股数 1353.6）→ 盯市 +2%/z=0.3 判 `reverted` 自动平仓（净盈亏 +174.41 元）、z=4.0 判 `stopped`；汇总回归达成率 / 胜率正确，测试数据已清理（`.data/` 已 gitignore）。

---

## [0.35.0] - 2026-06-24

> **过拟合体检（稳健性可视化）**。§5.2-A：把「过拟合防护 + 校准」做成显性卖点。对任一协整配对，一键给出两张证据图——**参数高原热图**（入场阈 × z 窗口两维全样本扫描，按净值着色）与 **walk-forward 衰减曲线**（锚定式滚动前推：样本内选最优参 → 紧邻样本外用同参验证），并合成 0~100 稳健分与「稳健 / 脆弱 / 疑似过拟合」结论。全部基于既有 `backtestPair` / `evaluatePair`，零新依赖；产物均为统计信号、非投资建议。

### 新增：稳健性引擎
- `src/lib/robustness.ts`：
  - `paramPlateau(pair, a, b, base)`：在 `entryZ ∈ {1.5…3.0}` × `lookback ∈ {30,45,60,90,120}` 网格上逐格跑全样本回测，输出每格净值/胜率/笔数；`best` 取净值最优有效格；`profitableCellPct`（有效格盈利占比，衡量「高原是否成片」）；`neighborRetention`（最优格四邻净值相对保留比，越高越「不挪就崩」=稳）。
  - `walkForward(pair, a, b, base, folds=4)`：锚定式扩张前推。逐段在样本内 (IS) **重估 β** 并做参数网格寻优（WFO 专用收窄网格 `entryZ ∈ {1.5,2,2.5,3}` × `lookback ∈ {20,40,60}`，避免短窗跑不出交易），用选出的参在紧邻**样本外 (OOS)** 验证（OOS 切窗带 `maxLb` 根预热、只统计 `entryDate ≥ oosStart` 的交易）。输出逐段 IS/OOS 净值、`efficiency=OOS/IS`、`medianEfficiency`、`oosPositivePct`。
  - `robustnessReport()`：合成稳健分 = 高原盈利占比 35% + 邻域保留 20% + 样本外效率 30% + 样本外为正占比 15%；`grade` 为 `robust`（分≥65 且高原盈利≥55% 且 OOS均≥0）/ `overfit`（分<40 或 IS正而OOS负）/ `fragile`（其余）。

### 新增：API 路由
- `src/app/api/arb/robustness/route.ts`（`dynamic = "force-dynamic"`）：`POST {a,b}` 复用既有 K 线源拉两腿、`evaluatePair` 估协整、跑 `robustnessReport`，返回 `{report, asOf, note}`；按主板纯净化口径排除非法/受限标的。

### 新增：UI 接入
- `src/components/RobustnessPanel.tsx`：调 `/api/arb/robustness` 渲染——结论徽标 + 稳健分；**参数高原热图**（SVG 表格，绿盈红亏、色深=幅度、■框标最优格、悬浮显示明细）；**walk-forward 衰减曲线**（SVG 双折线 IS vs OOS + 逐段明细表）。零新图表依赖、纯 SVG 自绘。
- `src/app/arb/page.tsx`：校准表每行新增「**体检**」按钮，展开内联 `RobustnessPanel`（与「逐笔」「沉淀」并列）。

### 质量门禁
- `tsc --noEmit` 0 error；改动文件 `eslint` 0 error / 0 warning；`next build` 通过，新路由 `/api/arb/robustness` 已注册。真实行情功能级校验：白酒 600519/000858（高原盈利 85.7%，但 WFO 4 段 IS均 +4.41% → OOS均 −0.46% 判 overfit）、银行 601398/601939（高原盈利仅 6.5%、WFO OOS均 −2.36% 判 overfit）——体检如实暴露样本内强、样本外塌的过拟合特征。

## [0.34.0] - 2026-06-24

> **信号 → 策略沉淀**。把套利雷达里验证过的**协整配对 + 参数 + 校准战绩**一键沉淀成可复检、可分享的策略，接入「策略市场」。沉淀的不是死快照——可用存的 β 重拉最新 K 线复检「活战绩」与当前 live 信号，并按加权公式打分给 A/B/C/D 评级；支持导出/导入（复制粘贴 JSON 即可分享）。全部复用既有 `.data/` JSON 落盘（`fs/promises` + 原子写）。零新依赖。

### 新增：持久化 + 评分后端
- `src/lib/savedStrategies.ts`：文件落盘 `.data/saved-strategies.json`（`{ strategies[] }`），`loadStore()` / `saveStore()` 走 `mkdir -p` + 原子 `writeFile`，与 `watchlist.ts` / `alerts.ts` 等既有落盘范式一致。
  - `SavedStrategy`：协整配对（`a/b/aName/bName/beta/adfT/halfLifeDays/correlation/n`）+ 参数（`lookback/entryZ/exitZ/stopZ/feeBps/maxHoldDays`）+ 沉淀时校准战绩**快照** `snapshot` + 最近复检战绩 `latest`（含当前 live 信号 + `checkedAt`）+ 评级 `score`（`score/grade/stars`）+ `source` + `createdAt/updatedAt`。
  - `createSavedStrategy()` / `listSavedStrategies()`（按评分降序）/ `deleteSavedStrategy()` / `getSavedStrategy()` / `importSavedStrategy()`（解析 JSON 后落为新策略）。
  - `revalidateSavedStrategy(id, aCandles, bCandles)`：用存的 β 重建 `PairCandidate`，重算 `calibratePair` + `currentArbSignal`，刷新 `latest` 活战绩与当前开口/逼近止损信号。
- `scorePairStrategy(m)`：综合打分 = 回归率 30% + 单边胜率 25% + 单边净收益 20% + 逆向浅（`avgMaxAdverseZ` 取逆）15% + 信号密度 10%，夹紧 [0,100]；样本 <3 笔降权 30%。评级 A（≥75）/ B（≥60）/ C（≥45）/ D + 星级。

### 新增：API 路由
- `src/app/api/strategies/saved/route.ts`（`dynamic = "force-dynamic"`）：
  - `GET`：列出全部沉淀策略（评分降序）。
  - `POST`：`action="create"`（从 `/arb` 校准行沉淀）/ `"revalidate"`（拉最新 K 重算活战绩）/ `"import"`（粘贴 JSON 导入）。
  - `DELETE`：`?id=` 按 id 删除。

### 新增：UI 接入
- `src/app/arb/page.tsx`：信号回测校准表每行新增「**沉淀为策略**」按钮（保存中 / 已沉淀 / 失败着色 + 禁用），调 `POST /api/strategies/saved` 把该配对 + 当前参数 + 校准战绩沉淀。
- `src/app/strategies/page.tsx`：新增「**🧑‍💼 我的沉淀策略（配对均值回归）**」区（置于内置策略榜上方）。`SavedStrategyCard` 卡片含战绩（信号数 / 回归率 / 单边胜率 / 净收益 / 回归天数 / 逆向 z）+ 评级星级 + 当前 live 信号徽标（`⚠️ 当前开口` / `🔴 逼近止损`）+ **复检 / 在套利雷达打开（深链 `/arb?codes=`）/ 导出（复制 JSON）/ 删除**；`SavedStrategiesSection` 管理列表拉取与导入（粘贴 JSON）。

### 质量门禁
- `tsc --noEmit` 0 error；改动文件 `eslint` 0 error / 0 warning；`next build` 通过（新路由 `/api/strategies/saved` 已注册）。真实行情功能级校验：从校准行沉淀（score 74.3 / A）→ 复检用真实 K 重算（信号 8 / 回归率 75%）→ 列表/删除全程正常（测试数据已清理，`.data/` 已 gitignore）。

---

## [0.33.0] - 2026-06-24

> **盘中盯盘告警**。把既有「套利雷达 + 实时行情」升级为盯盘工具：为**套利配对**（价差开口 / 逼近回归止损）与**个股价格**设盯盘规则，盘中轮询实时行情触发告警，投递站内告警箱 + 可选 `webhook`（邮件可经 webhook 桥接）。全部复用既有 `.data/` JSON 落盘（`fs/promises` + 原子写），无服务端常驻定时器——由 `/alerts` 页客户端定时轮询驱动评估。零新依赖。

### 新增：持久化后端
- `src/lib/alerts.ts`：单文件落盘 `.data/alerts.json`（`{ rules[], events[] }`），`loadStore()` / `saveStore()` 走 `mkdir -p` + 原子 `writeFile`，与 `watchlist.ts` 等既有落盘惯例一致；告警箱按 `MAX_EVENTS=500` 截断防无限增长。
  - 规则：`upsertRule`（建/改共用，`buildRuleFields` 校验业务字段）/ `setRuleEnabled` / `deleteRule` / `listRules`。两类——**套利型**（引用股票池 `poolId` 或内联 `codes`，`entryZ` / `stopZ` 阈 + `arbTriggers: ["open","nearStop"]`）、**价格型**（单只 6 位 `code` + `op: ">=" | "<="` + `price`）。
  - 投递配置：`channels`（站内恒兜底）、`webhookUrl`、`cooldownMin` 冷却去重窗口。
  - 告警箱：`listEvents` / `markEventRead` / `markAllRead` / `clearEvents` / `appendEvents`（落盘并回填规则 `lastTriggeredAt`）。

### 新增：评估引擎
- `src/lib/alertEngine.ts`：`checkAlerts()` 评估全部启用规则——拉日 K（`getKlinesBatch`）+ 实时行情（`getQuotesFailover`），`spliceLivePrice` 把当前价拼成「最后一根」算盘中 live z；套利型用 `scanArbRadar` 找当前开口 / 逼近止损的协整配对，价格型比现价与阈值。命中后按 `dedupeKey` + `cooldownMin` 冷却去重，投递站内 + `webhook`（`fetch` POST，5s 超时，失败不阻断站内），落盘进告警箱。
- `inAShareTradingSession()`：A 股交易时段判断（周一~周五 09:30–11:30 / 13:00–15:00，上海钟，不含节假日），仅用于前端提示。

### 新增：API 路由
- `src/app/api/alerts/rules/route.ts`：`GET`（列规则）/ `POST`（无 `id` 建、带 `id` 改、`{toggleEnabled,enabled}` 切换启用）/ `DELETE`（`?id=` 删）。
- `src/app/api/alerts/events/route.ts`：`GET`（`?unread=1` 可选仅未读，附 `unreadCount`）/ `POST`（`{action:"read"|"readAll"|"clear",id?}`）。
- `src/app/api/alerts/check/route.ts`：`POST` 触发一次评估；`GET` 返回交易时段状态（供前端轮询节流）。

### 新增：盘中盯盘页
- `src/app/alerts/page.tsx`：左栏**规则管理**（套利 / 价格两类表单、池选择或手填代码、阈值 / 触发条件、webhook + 冷却、启停 / 删除 / 深链），右栏**告警箱**（按等级着色、未读标记、全部已读 / 清空、深链到 `/arb`·`/analyze`）；顶部交易时段指示 + 「立即检查」+ 「自动轮询（每 60s，仅本页打开时生效）」。
- `src/components/Nav.tsx`：导航新增「盘中盯盘」入口。

### 质量门禁
- `tsc --noEmit` 0 error；改动文件 `eslint` 0 error / 0 warning；`next build` 通过且新路由（`/alerts`、`/api/alerts/{rules,events,check}`）全部注册。真实行情功能级校验：建价格规则→触发评估命中实时价（600519 现价 1208.9）→冷却复检 0 重复→告警箱可见，建删 / 清空全程正常。

---

## [0.32.1] - 2026-06-24

> **修复既存 lint error**：清掉全仓 `npm run lint` 唯一的 1 个 error，使 lint 全绿。

### 修复
- `src/app/mining/page.tsx`：`useEffect` 在 `fetchDailyStatus` 函数声明之前调用它，被较新的 `react-hooks` 规则判为 "Cannot access variable before it is declared"（运行时因函数声明提升本无影响）。把该 `useEffect` 下移到 `fetchDailyStatus` 声明之后，消除该 error。该问题自 v0.32 之前即存在、与 v0.32 无关。

---

## [0.32.0] - 2026-06-24

> **自定义股票池 + 收藏 + 持久化**。新增一套用户自建数据沉淀机制：可收藏个股、自建命名股票池（即「配对池」，scanner / momentum / arb 通用）、保存筛选参数集（命名快照，一键复用）。全部复用既有 `.data/` JSON 落盘机制（`fs/promises` + 原子写），零新依赖。并新增 `/watchlist`「自选 / 收藏」管理页，与 scanner / momentum / arb 各页双向打通（深链预填 + 一键存取）。

### 新增：持久化后端
- `src/lib/watchlist.ts`：单文件落盘 `.data/watchlist.json`（`{ favorites[], pools[], screens[] }`），`loadStore()` / `saveStore()` 走 `mkdir -p` + 原子 `writeFile`，与 `calibration.ts` 等既有落盘惯例一致。
  - 收藏：`addFavorite` / `listFavorites` / `removeFavorite`（按 6 位代码 upsert，保留首次收藏时间）。
  - 股票池：`createPool` / `updatePool` / `deletePool` / `listPools`（命名 + 代码列表，`normalizeCodes` 按 `/[\s,，、]+/` 切分、`^\d{6}$` 校验、去重）。
  - 保存筛选：`createScreen` / `deleteScreen` / `listScreens`（命名 + `scope` + 标量参数集）。

### 新增：API 路由
- `src/app/api/watchlist/favorites/route.ts`：`GET`（列收藏）/ `POST`（`{code,name?,note?}` upsert）/ `DELETE`（`?code=` 删）。
- `src/app/api/watchlist/pools/route.ts`：`GET`（列池）/ `POST`（无 `id` 建池、带 `id` 改池）/ `DELETE`（`?id=` 删）。
- `src/app/api/watchlist/screens/route.ts`：`GET`（列筛选）/ `POST`（`{name?,scope,params}` 建）/ `DELETE`（`?id=` 删）。

### 新增：自选 / 收藏页
- `src/app/watchlist/page.tsx`：三 Tab 管理 —— **收藏**（列表 / 删除 / 备注 / 「全部存为股票池」 / 深链到 scanner·momentum）、**股票池**（建池表单 / 列表 / 内联改代码 / 删除 / 深链到 scanner·momentum·arb）、**保存的筛选**（列表 / 删除 / 「应用」按 `scope` 深链回对应页并预填参数）。
- `src/components/Nav.tsx`：导航新增「自选 / 收藏」入口。

### 新增：可复用组件
- `src/components/FavoriteButton.tsx`：★ 收藏按钮，模块级 `Set<string>` + 订阅模式缓存收藏集，首次渲染拉一次 `/api/watchlist/favorites`，后续按钮共享缓存、点击乐观更新并同步后端（避免 M 个按钮发 N 次请求）。
- `src/components/PoolControls.tsx`：股票池工具条（「载入股票池 ▾」下拉 / 「存为股票池」 / 可选「保存筛选」），momentum / arb 页复用。

### 接入现有页
- `src/app/momentum/page.tsx`：支持 `?codes=` / `?limit=` 深链预填；榜单与回测 Tab 接入 `PoolControls`（存/取池、存动量筛选）；榜单名称列加 ★ 收藏按钮。
- `src/app/arb/page.tsx`：支持 `?codes=` / `?minCorrelation=` / `?entryZ=` / `?stopZ=` / `?limit=` 深链预填；接入 `PoolControls`（存/取池、存套利筛选）。
- `src/app/scanner/page.tsx`：新增「存为股票池」按钮（把当前榜单存成命名池）；榜单名称列加 ★ 收藏按钮。

### 质量门禁
- `tsc --noEmit` 0 error；`next build` 通过且新路由（`/watchlist`、`/api/watchlist/{favorites,pools,screens}`）全部注册；改动文件 `eslint` 0 error。

---

## [0.31.2] - 2026-06-24

> **图标微调**：个股链接的 K 线图标换成更清爽的折线图（line-chart）样式。

### 优化
- `src/components/StockLink.tsx`：上一版的蜡烛图标在 12px 下偏杂乱，改为坐标轴 + 上升折线的折线图标（line-chart），小尺寸下更易识别、更接近常见「图表」图标。

---

## [0.31.1] - 2026-06-24

> **`/momentum` 体验修复**：个股链接的「图」文字改为 K 线图标；个股动量榜名称从基础库补全。

### 修复
- `src/components/StockLink.tsx`：尾随的「图」文字链接改为内联 SVG 图标（保留 `/chart` 跳转与无障碍标签），全站个股链接统一生效，列表更清爽。
- `src/app/api/momentum/rank/route.ts`：个股动量榜名称兜底。`/momentum` 页只向 `POST /api/momentum/rank` 传代码、未传名称，服务端原先回退成代码导致「名称」列只显示代码。现服务端对缺名称的代码用 `getQuotesFailover()` 从基础库（实时行情，带缓存）批量补全权威名称后再打分返回。

---

## [0.31.0] - 2026-06-24

> **横截面动量 / 行业轮动 · 纯多头组合回测（不做空）**。在已有组合回测引擎之上补一套**多因子动量打分**：对 A 股主板个股做横截面排名，合成 0~1 综合动量分，并把成分股因子聚合到板块做**行业轮动**信号；两套打分都包成 `PortfolioScorer` 注入既有引擎，每 N 日等权再平衡持有 top-K，**全程只买不卖空（纯多头）**。本版只新增打分逻辑与 API/UI，不改动 `portfolioBacktest.ts` 回测内核与 v0.30 既有功能。

### 新增：横截面动量 / 行业轮动打分引擎
- `src/lib/momentum.ts`：
  - `computeMomentumFactors(history)` —— 从单只个股日 K 抽取 7 个因子：近 1/3/6 月收益（`r1m`/`r3m`/`r6m`，W=20/60/120）、12-1 跳月动量（`skip`，250 日收益剔除近 20 日反转）、年化波动率（`vol`）、风险调整收益（`riskAdj`=r3m/vol）、趋势（`trend`，收盘相对均线偏离）；历史不足 `MIN_BARS=61` 根返回 `null` 不参与。
  - `scoreCrossSection(view, weights)` —— 对 6 个方向性因子**逐因子横截面排名归一**到 [0,1]，按 `MomentumWeights`（默认 r3m 0.3 / r6m 0.25 / r1m 0.15 / skip·riskAdj·trend 各 0.1）加权合成 `composite`，按综合分降序返回 `ScoredStock[]`。
  - `momentumScorer(weights)` —— 包成 `PortfolioScorer` 回调，每次再平衡返回综合分降序的代码列表（纯多头择优）。
  - `rankSectors(sectors, weights, topStocksPerSector)` —— 全场统一打分后按板块聚合：板块均综合分 `avgComposite`、上涨宽度 `breadthPct`（近 3 月收益 > 0 占比）、近 3 月均收益 `avgR3mPct`、龙头股 `topStocks`，按 `avgComposite` 降序。
  - `sectorRotationScorer({ codeToSector, topSectors, weights })` —— 每次再平衡先选动量最强的 top-K 板块，再在这些板块内按个股综合分择优返回（纯多头）。
  - 新增导出类型 `MomentumWeights` / `MomentumFactors` / `ScoredStock` / `SectorConstituents` / `SectorMomentum` 与常量 `DEFAULT_MOMENTUM_WEIGHTS`。
- `src/lib/sectorData.ts`：服务端读取板块元数据与「板块 → 成分股」映射，`loadSectorsWithStocks()` 走 `universe.ts` 主板纯净化口径过滤成分股、可选限定板块/单板块成分数。

### 新增：API 路由
- `src/app/api/momentum/rank/route.ts`：`POST /api/momentum/rank` —— 传入代码池（经 `isExcluded` 主板纯净化过滤）拉日 K 打分，返回横截面动量榜。
- `src/app/api/momentum/sectors/route.ts`：`GET/POST /api/momentum/sectors` —— 行业轮动信号，调 `loadSectorsWithStocks()` + `rankSectors()`，返回板块动量排名。
- `src/app/api/momentum/backtest/route.ts`：`POST /api/momentum/backtest` —— 纯多头组合回测，`mode` 支持 `momentum`（个股动量）/`sectorRotation`（行业轮动），注入对应 scorer 到 `backtestPortfolioByCodes()`。

### 新增：动量轮动页面
- `src/app/momentum/page.tsx`：三个 Tab —— ①个股动量榜（代码池 → 综合分 + 7 因子表）②行业轮动信号（板块动量 + 宽度 + 近 3 月 + 龙头股）③纯多头回测（动量/行业轮动切换 → 净值曲线 SVG + 汇总卡 + 交易流水）。
- `src/components/Nav.tsx`：导航新增「动量轮动」入口（`/momentum`）。

### 诚实边界
- 动量为样本内统计特征、会失效；回测含市场 β（纯多头非中性）。结果为研究信号，非投资建议。

### ✅ 质量门禁
- `tsc --noEmit` 0 error；`eslint`（改动文件 `momentum.ts`/`sectorData.ts`/`momentum/{rank,sectors,backtest}/route.ts`/`momentum/page.tsx`/`Nav.tsx`）0 error；`next build` 通过，`/api/momentum/{rank,sectors,backtest}` 与 `/momentum` 已注册。
- 数据级校验（真实行情）：10 只主板票横截面打分 composite ∈ [0,1] 且降序 OK；个股动量纯多头回测 93 笔交易全部 shares>0（无做空）；8 板块 37 成分股行业轮动排名正常、行业轮动回测 206 笔交易全部纯多头 OK。

## [0.30.0] - 2026-06-24

> **套利雷达「信号回测校准面板」**。把套利雷达从「只看当前开口」补上「历史能不能信」的一环：对候选池内**全部协整配对做全历史事后回测**，验证「每次 |z|≥入场阈开口就买入被低估那一只」这套**单边择时规则**历史上的真实表现——回归率、平均回归天数、单边净收益、胜率、最大逆向 z。回归率高·单边胜率高·逆向浅 ⇒ 当前 z 阈更可托付。本版纯属验证/分析层，不改动 v0.29.0 套利引擎本身。

### 新增：信号回测校准引擎（单边口径，事后验证）
- `src/lib/pairTrading.ts`：新增 `calibratePair()` —— 对单个配对滚动 z（同 `backtestPair` 口径）逐根回放，每次开口（|z|≥入场阈）就买入被低估的那一只（z≤0 买 A、z>0 买 B），持有到价差回归（|z|≤出场阈）/协整破裂止损（|z|≥止损阈）/超时/样本末，逐笔记录 `SignalEvent`（进出场日、买入腿、进出场 z、最大逆向 |z|、持有天数、是否回归、单边毛/净收益）。单边净收益扣一次单边往返成本（复用 `costs.ts` 的 `roundTripCostPct`），**含市场 β，非中性**——如实反映纯多头单边持有的真实结果。
- 新增 `calibrateRadar()`：对池内全部协整配对批量校准，按单边净收益均值降序，并汇总 `agg`（协整配对数、历史信号数、回归率、平均回归天数、单边净收益均值、单边胜率、平均最大逆向 z）。
- 新增导出类型 `SignalEvent` / `PairCalibration` / `RadarCalibrationResult` / `RadarCalibrationAgg`。

### 新增：API 路由
- `src/app/api/arb/calibrate/route.ts`：`POST /api/arb/calibrate`（候选池同样先走「股票池纯净化」配置 `isExcluded` 过滤，再两两协整、逐对全历史校准）+ `GET`（默认参数与口径说明）。

### 新增：/arb 页面「信号回测校准」面板
- `src/app/arb/page.tsx`：扫描区新增「信号回测校准（事后验证）」按钮，触发后在套利雷达结果下方渲染：6 张汇总卡（协整配对/历史信号数/价差回归率/平均回归天数/单边净收益均值/单边胜率，回归率与胜率按阈值红黄绿着色）+ 逐对校准表（信号数/回归率/止损·超时/平均回归天数/单边净收益/单边胜率/最大逆向 z），每对可展开**逐笔明细**（买入腿/进出场日/进出场 z/最大逆向 z/持有天数/结果标签/单边净收益），个股均接 `StockLink`。

### 诚实边界
- 单边收益**含市场 β**（非市场中性），协整为**样本内**性质会破裂，历史回归率/胜率**不代表未来**，结果为统计信号、非投资建议。面板文案显式标注。

### ✅ 质量门禁
- `tsc --noEmit` 0 error；`eslint`（改动文件 `pairTrading.ts`/`calibrate/route.ts`/`arb/page.tsx`）0 error（历史遗留 warning 不计）；`next build` 通过（`/api/arb/calibrate` 已注册）。
- 数据级校验：白酒 10 票池过滤后 4 协整对、42 条历史信号，整体回归率 71.4%、平均回归 22.6 日、单边净收益均值 -0.15%（含 β，近零，诚实）、单边胜率 40.5%；逐笔 spot-check `002304-000596` 前 5 笔，单边毛/净收益与手算（按买入腿 entryDate/exitDate 收盘价 + 0.202% 往返成本）逐笔一致（gross/net 全 OK）。

---

## [0.29.0] - 2026-06-23

> **套利雷达「主板纯净版 + 单边可执行化」**。约束收紧后聚焦 A 股主板个股、不碰高门槛品种（ETF/期货/基金/两融），并诚实面对 A 股主板无融券的事实：套利雷达不再卖「多空对冲」，重构为**单边可执行的相对强弱择时**信号。三件事：①把散落在各处的股票池过滤规则收敛成一处可复用、可在 `/settings` 配置、落盘持久化的「股票池纯净化」；②配对信号单边可执行化（买入腿「逢低分批布局」/ 规避腿「减仓/规避」）；③LLM 解读层按单边均值回归择时改写。

### 新增：股票池纯净化（全站统一口径，可配置不 hardcode）
- `src/lib/universe.ts`：新增全站统一的股票池过滤模块，把原先散落在 `miningScan.ts` 的 `isStarCode`/`isRiskyName`/`includeBJ` 等硬编码规则收敛到一处。提供 `UniverseConfig`、`isExcluded`、`filterUniverse`、`getUniverseConfig`、`setUniverseConfig`。默认剔除科创板（688/689）、北交所（8/4/920）、ST/*ST/退/PT（按名称）、B 股（900/200），创业板（300/301）默认保留。配置落盘 `.data/universe-config.json`（与 LLM/缓存/行情起始日期同套机制）。
- `src/app/api/settings/universe/route.ts`：新增 `GET/POST /api/settings/universe`（读取/保存配置）。
- `src/app/settings/page.tsx`：设置页新增「股票池纯净化」配置块，5 个开关（剔除科创/北交所/创业板/ST/B 股）即点即存、立即对挖掘与套利雷达生效。

### 变更：挖掘 / 套利雷达统一走纯净化口径
- `src/lib/miningScan.ts`：新增 `boardSegments()`，按配置动态拼装东财 clist 板块段（剔除的板块从源头不拉取，省请求）；`resolveUniverse()` 统一对所有股票池类型套 `filterUniverse()`，全站口径一致。顺带修掉「broad 全市场」池此前包含科创板且未剔 ST 的不一致。移除 `MiningRequest.includeBJ`（改由配置治理）。
- `src/app/api/arb/radar/route.ts`：构池时先按纯净化口径 `isExcluded` 过滤，过滤后不足 3 只给出明确提示。

### 变更：配对信号「单边可执行化」（核心重构）
- `src/lib/pairTrading.ts`：`ArbSignal` 新增 `buyCode`（相对被低估 → 逢低分批布局买入择时）/ `deRiskCode`（相对被高估 → 减仓/规避，仅持有者参考）。价差开口不再输出「多空两腿」，而是落到单边可执行动作。
- `src/app/arb/page.tsx`：UI 用红绿单边标签（「逢低买入」/「减仓/规避」）替代「做多/做空价差」，每条直接给出可操作的那一只 + 方向；标题与说明如实标注「这是相对强弱择时，不是无风险对冲套利，单边持有承担市场 β 风险」。
- `src/app/api/arb/interpret/route.ts`：LLM 系统提示改写为「单边均值回归择时」解读（为何买入腿被低估、回归依据、单边持有的下行风险/β 敞口、可证伪止损条件），去掉「融券对冲/两融/ETF 替代」话术。

### 诚实边界
- A 股主板无融券，配对两腿不能同时做多做空，本工具只取「可单边买入」的那一只，定位**相对强弱择时信号**，非无风险对冲套利；单边持有自担市场 β 与方向风险，非投资建议。

### ✅ 质量门禁
- `tsc --noEmit` 0 error；`eslint`（改动文件）0 error（仅历史遗留 warning）；`next build` 通过（`/api/settings/universe` 已注册）。
- 数据级校验：纯净化口径 9/9 用例通过（科创/北交所/B/ST 剔除、主板/创业板保留）；白酒 8 票池 28 对扫描得 2 协整开口信号，单边买入腿/规避腿映射正确。

---

## [0.28.0] - 2026-06-23

> **全站个股链接 + 套利解读层（LLM 解释 · Phase 2 起步）**。两件事：①把全站出现的个股代码统一接成可跳转链接（→ `/analyze` 个股分析、→ `/chart` 看 K 线）；②给套利雷达每条机会加一层「可证伪 AI 解读」——一句话核心逻辑 + 入场依据 + 回归依据 + 风险 + 可证伪/止损条件 + A 股可对冲性评估。

### 新增：可复用 StockLink 组件 + 全站个股链接
- `src/components/StockLink.tsx`：新增可复用组件，把个股代码/名称统一渲染为双链接（主体 → `/analyze?code=`，尾随小「图」→ `/chart?code=`），非 6 位 A 股代码自动退化为纯文本；支持 `newTab`（列表页用，避免丢失筛选态）。
- `src/app/arb/page.tsx`：套利雷达配对 A/B 接入 StockLink。
- `src/app/scanner/page.tsx`：代码列接 `/chart` 链接（名称列原有 `/analyze`）。
- `src/app/sectors/page.tsx`：成分股表/龙头标的补「图」→ `/chart` 链接。
- `src/app/map/page.tsx`：产业链图谱个股节点拆为「名称→分析 / 代码→看图」双链接（避免 anchor 嵌套）。
- `src/app/backtest/page.tsx`、`src/app/backtest/strategy/page.tsx`：交易流水/分标的统计的代码列接 StockLink。

### 新增：套利 LLM 解读层
- `src/app/api/arb/interpret/route.ts`：新增 `POST /api/arb/interpret`，输入一条套利机会的统计量（配对/z/方向/β/相关性/ADF-t/半衰期/预计回归天数/估算净收益/近止损），复用 `chatJson`（可证伪 AI 工作流，temperature 0.3）输出结构化 JSON：`{thesis, entryLogic, revertCatalyst, risks[], invalidation, hedgeability}`。系统提示强调只基于统计量推演、不臆造基本面、必须给出失效（止损）条件。
- `src/app/arb/page.tsx`：每条机会新增「AI 解读」按钮，点开异步拉取并在展开行内渲染（核心逻辑/入场依据/回归依据/风险清单/可证伪条件/可对冲性），含 loading/error 态，附「非投资建议」声明。

### 诚实边界
- AI 解读基于给定统计量推演，明确标注「非投资建议」；未配置大模型时返回 503 提示去「设置」填 provider/key。

### ✅质量门禁
- `tsc --noEmit` 0 error；`eslint`（改动文件）0 error（仅历史遗留 warning）；`next build` 通过（`/api/arb/interpret` 已注册）。

---

## [0.27.0] - 2026-06-23

> **统计套利雷达 StatArb Radar（专业量化套利捕捉 · Phase 1）**。把既有 `pairTrading.ts` 协整引擎从「贴代码→跑回测」的研究工具，升级为「实时机会捕捉」工具：在候选股票池里全两两做 Engle-Granger 协整检验，只报出**当前价差已开口**（|z|≥入场阈）的配对机会，按 **|z|×协整强度** 排序。

### 新增：套利雷达引擎 / API / 页面
- `src/lib/pairTrading.ts`：新增 `currentArbSignal(pair, aCandles, bCandles, opts)` —— 与 `backtestPair` 同口径（同滚动窗口/价差定义），只看最新一根的 z 偏离，输出方向（long-spread 多A空B / short-spread 空A多B）、进/出/止损 z 阈、`nearStop` 标记、半衰期推算的**预计回归天数** `halfLife·log2(|z|/exitZ)`、价差 sparkline 序列、双边成本后估算净收益 `estNetPct`、综合排序分 `rank=|z|×|adfT|`。
- `src/lib/pairTrading.ts`：新增 `scanArbRadar(candles, opts)` —— 全两两协整扫描 + 实时开口筛选 + 排序，返回 `ArbRadarResult`。
- `src/app/api/arb/radar/route.ts`：新增 `POST /api/arb/radar`（接股票池/相关性/z 阈，返回排序后的当前套利机会）。
- `src/app/arb/page.tsx`：新增「套利雷达」页面（板块预设：白酒/银行/证券/新能源车链/医药，机会表含方向/z 偏离/预计回归/估算净收益/价差走势 sparkline）。
- `src/components/Nav.tsx`：导航新增「套利雷达」入口（回测 与 策略市场 之间）。

### 诚实边界
- A 股融券受限，纯多空套利多数标的难实盘——页面/接口均如实标注，定位「信号 + 可行性验证」，优先两融/ETF 可对冲品种，收益为价差口径已扣双边成本估算，仅供研究，非投资建议。

### ✅ 质量门禁
- `tsc --noEmit` 0 error；`eslint`（新增 4 文件）0 error；`next build` 通过（`/arb`、`/api/arb/radar` 已注册）。
- 数据级校验：白酒 8 票池，28 对检验出 2 协整对，均当前开口（600702-000568 z=2.26 short-spread 预计回归 44 日；002304-000596 z=1.54）。

---

## [0.26.0] - 2026-06-23

> **共振纳入成交量确认（量价配合）**。多指标共振扫描在 MACD/RSI/KDJ/BOLL 之外新增成交量维度：放量阳线（量 ≥ 1.5×近 5 日均量且收阳）作为做多确认、放量阴线作为做空确认——量是价的确认而非独立方向，放量印证同向指标、缩量不计，与 A 股「量价配合」常识一致。

### 变更：共振纳入成交量
- `src/lib/indicators.ts`：`computeResonance` 新增 `volBull`/`volBear` 信号——成交量 ≥ 1.5×近 5 日均量且收阳→「放量上涨」做多确认，收阴→「放量下跌」做空确认；并入 reasons，`score` 上限由 4 提升到 5。
- 实测 000858 近 360 根：共振点 16 → 26，2026-01-29 升级为五指标全共振（MACD金叉+RSI超卖修复+KDJ低位金叉+触下轨反抽+放量上涨）。

### ✅ 质量
- `tsc --noEmit` 0 error；`eslint`（改动文件）0 error；`next build` 通过。仅改 1 个文件（`indicators.ts`），渲染层无需改动（沿用 `score`/`reasons`）。

---

## [0.25.0] - 2026-06-23

> **默认 Pro 画布 + 副图全开 + 多指标共振标注（对标 TradingView，并去除其角标）**。图表引擎默认进 Pro 画布；副图默认同时显示 MACD/RSI/KDJ（各占独立窗格，分开显示，量纲互不干扰）+ 主图 BOLL 叠加；新增「共振」叠加层，逐根扫描四指标同向信号，≥2 个共振时在主图打标（▲看多/▼看空），连续共振自然连成区域，悬停看命中指标。同时隐藏 lightweight-charts 的 "Chart by TradingView" 角标。

### 变更：默认 Pro 画布
- `src/app/chart/page.tsx`：`chartView` 默认 `pro`（经典 SVG 仍可一键切回看筹码/投影/VRVP）。

### 新增：副图默认全开（分开显示）
- `src/components/LightweightChart.tsx`：副图由单选改为 MACD/RSI/KDJ 三个独立开关，默认全开，各占独立窗格（量纲不同不宜叠加）；RSI 加 30/70、KDJ 加 20/80 参考线；BOLL 默认叠加主图；图表高度随副图窗格数自适应；主图/副图拉伸比 4 : 1.4。

### 新增：多指标共振标注
- `src/lib/indicators.ts`：新增 `computeResonance(candles, macd, rsi, kdj, boll, minScore=2)`——逐根检查 MACD 金叉/死叉、RSI 超卖修复(上穿30)/超买回落(下穿70)、KDJ 低位金叉(D<40)/高位死叉(D>60)、BOLL 触下轨反抽/触上轨回落；用 2 根窗口聚合（信号少恰好同根），仅在 episode 上升沿输出一次，返回 `{ index, dir, score, reasons }`。
- `src/components/LightweightChart.tsx`：新增「共振」开关（默认开），共振点在主图打圆点标记（▲看多/▼看空 ×命中数），紫粉色与涨跌/买卖标记区分；十字光标悬停共振 K 线时读数条显示「看多/看空共振：命中指标」。
- 实测 000858 近 360 根：16 个共振点，含 2026-01-29 四指标全共振（MACD金叉+RSI超卖修复+KDJ低位金叉+触下轨反抽）。

### 移除：TradingView 角标
- `src/components/LightweightChart.tsx`：`layout.attributionLogo = false`，去掉画布右下「Chart by TradingView」角标。

### ✅ 质量
- `tsc --noEmit` 0 error；`eslint`（改动文件）0 error；`next build` 通过。仅改 3 个文件，分析管线/经典 SVG/回测零影响；共振口径与 A 股券商软件常见用法对齐，便于肉眼校验。

---

## [0.24.0] - 2026-06-23

> **LLM 交互式画图 / AI 自动画线标注（对标 TradingView 画图工具 + AI 助手）**。Pro 画布新增「AI 画图」面板：按钮一键（支撑阻力/趋势线/形态识别/买卖区间）或自然语言对话，由 LLM 把技术分析意图输出为结构化绘图基元（水平线/趋势线/区间/标注），自动叠加到图上并附判断依据。

### 新增：LLM 交互式画图
- `src/lib/drawings.ts`（新增）：绘图基元类型（`hline`/`trendline`/`zone`/`marker`）+ `sanitizeDrawPlan()`——价位夹到 `[minLow*0.6, maxHigh*1.4]`、日期就近吸附到真实交易日、丢弃非法基元、上限 12 条，杜绝模型越界/幻觉坐标；内置 `DRAW_PRESETS` 四个快捷指令。
- `src/app/api/chart/draw/route.ts`（新增）：`POST { code, fq?, period?, question?, preset? }`，喂最近 ~90 根 K 线 + 价格区间给 LLM（复用 `chatJson` 结构化输出），返回 `{ plan: { rationale, drawings } }`；LLM 未配置 → 503 友好提示。
- `src/components/LightweightChart.tsx`：新增 `drawings` 叠加层渲染——`hline`/`zone` 走价格线（带轴标签）、`trendline` 走两点线序列、`marker` 并入买卖标记；语义配色（支撑蓝/阻力琥珀/偏多绿/偏空红），仅日线口径渲染。
- `src/app/chart/page.tsx`：Pro 画布上方「AI 画图」面板（4 预设按钮 + 对话输入 + 绘制中/清除态 + 依据展示）；切换标的/复权/周期自动清空旧绘图。

### ✅ 质量
- `tsc --noEmit` 0 error；`eslint`（改动文件）0 error；`next build` 通过。仅新增 2 个端点 + 1 个库 + Pro 画布叠加层 + 面板，分析管线与经典 SVG 视图零影响。绘图坐标全程 sanitize，模型仅决定"画什么"、不决定"画到哪个越界价位"。

---

## [0.23.0] - 2026-06-23

> **多周期分时 / 日内 5·15·30·60m（对标 TradingView 日内多周期）**。Pro 画布视图周期切换新增 5m / 15m / 30m / 60m 分时档，按需向东财 push2his 拉取分钟级 K 线，原生时间轴显示北京钟面时间；十字光标读数、对数/百分比纵轴、MACD/RSI/KDJ 副图、逐根回放全部在分时档下可用。

### 新增：日内多周期
- `src/lib/sources/unified.ts`（+ `index.ts` 导出）：新增 `getIntradayKline(code, limit, klt∈{5,15,30,60}, fq)`，东财 push2his 直取最近 N 根分钟 K（不入日线落盘库；`fq=hfq` 走 `fqt=2`）。
- `src/app/api/market/kline/route.ts`（新增）：`GET ?code=&period=5m|15m|30m|60m&fq=` → `{ candles }`，专供 Pro 画布日内切换按需取数。
- `src/components/LightweightChart.tsx`：周期选择器新增分时档（5m/15m/30m/60m | 日/周/月分组）；选中分时档时按需拉取并渲染分钟 K（切个股/复权/分钟周期自动重拉，带加载/错误态）。分时日期 `YYYY-MM-DD HH:MM` 按 UTC 解析成时间戳，使库 UTC 标签恰好显示为北京钟面时间，并开启 `timeVisible`。

### ✅ 质量
- 数据源实测：东财 push2his `klt=5` 返回带时间戳的分钟 K（如 `2026-06-23 14:25 …`）；多周期同一代码路径仅 `klt` 不同。`tsc --noEmit` 0 error；`eslint`（改动文件）0 error；`next build` 通过。仅改动 Pro 画布 + 数据层 + 新端点，经典 SVG 视图与分析管线零影响。

---

## [0.22.0] - 2026-06-23

> **逐根回放 / Bar Replay（对标 TradingView Bar Replay）**。Pro 画布视图新增「回放」模式：隐藏未来 K 线，单步或自动逐根显露，配速度档与进度读数，用于不开"上帝视角"地复盘临场决策与练习。

### 新增：逐根回放
- `src/components/LightweightChart.tsx`：工具栏新增「回放」控制——`▷ 开始回放` / `⏮ 回到起点` / `◀ 后退一根` / `▶ ⏸ 播放暂停` / `▶| 前进一根` / 速度档（慢 700ms · 中 350ms · 快 120ms）/ `进度 i/n` / `退出`；读数条显示「● 回放中」。回放从第 60 根起步，到末根自动停。
- 重构图表渲染为「结构层 + 数据层」：结构层仅在指标/周期/纵轴/副图变化时重建图表与序列；数据层在回放游标变化时只重绘各序列数据（每序列携带自身重绘闭包）并 `scrollToRealTime` 将最新显露的 K 线滚入视野——逐根推进不再重建图表、无闪烁。
- 回放严格防"未来函数"：K线/量/MA/BOLL/MACD/RSI/KDJ/买卖标记/读数条全部只显露到当前游标，切换个股/周期自动复位回放态。

### ✅ 质量
- `tsc --noEmit` 0 error；`eslint src/components/LightweightChart.tsx` 0 error；`next build` 通过。仅改动 Pro 画布组件，经典 SVG 视图与其它功能零影响。

---

## [0.21.0] - 2026-06-23

> **策略参数化表单 + 实时重跑回测（对标 TradingView Strategy 参数面板）**。「传统均线突破策略」全部硬编码阈值抽成可调参数，交易面板内表单调参后一键重跑，即时返回标准化绩效报表（含权益/回撤曲线）。

### 新增：参数化回测
- `src/lib/quant.ts`：`runTraditionalMaBacktest` 重构为参数化（`MaStrategyParams`：均线周期 / 止盈涨幅 / 放量倍数 / 安全价位上限 / 超买价位 / 超买天量换手），新增 `DEFAULT_MA_PARAMS` 与 `sanitizeMaParams`（夹紧非法值）。**默认参数完全还原旧行为**（数值验证：000858=-10.52 / 300308=0 / 600519=-0.47，逐一对齐重构前基线）。
- `src/app/api/market/backtest/route.ts`（新增）：`POST { code, fq?, period?, params? }` → `{ params(已校正), backtest, report }`，按当前复权/周期口径即时重跑 + 计算绩效报表。
- `src/app/chart/page.tsx`：交易面板新增「策略调参」表单（6 个参数 + 重跑 / 恢复默认），调参结果覆盖回测统计并展示标准化绩效报表；切换个股自动清空调参态。顺手修正回测统计胜率显示口径（胜率本为百分比，旧逻辑误乘 100）。

### ✅ 质量
- 默认参数 ≡ 重构前（三只标的逐一核对）；非法参数夹紧（maPeriod 9999→250、volMultiple -5→0.5）；`tsc` / `eslint`（改动文件 0 error）/ `next build` 全通过。

---

## [0.20.0] - 2026-06-23

> **回测交易成本模型（A股口径）**。所有策略（v1–v8 / 网格 / 传统均线）在每个买卖成交点统一扣减真实成本，回测收益从"理想毛收益"变为"可下单的净收益"，杜绝高频策略在零成本假设下的虚高。

### 新增：交易成本
- 新文件 `src/lib/costs.ts`：`CostModel` + `DEFAULT_COST_MODEL`（佣金万2.5、单笔最低 5 元；印花税 0.05% 仅卖出；过户费 0.001% 双边；滑点 0.05% 单边）+ `buyShares` / `sellProceeds` / `roundTripCostPct` 纯函数。往返约当成本 **0.202%**。
- `src/lib/quant.ts`：全部策略的买卖成交点改用 `buyShares` / `sellProceeds`（整仓 7 处 + 分批 v6/v7/v8 各 1 处），成本计入每日净值与最终收益。
- `src/components/BacktestReport.tsx`：绩效报表新增成本披露脚注。
- 数值验证：零成本模型与旧行为完全等价（`buyShares(10万,10)=1万股`、`sellProceeds(1万,10)=10万`）；默认模型下买入股数/卖回现金均下降，往返实测拖累 0.202%。

### ✅ 质量
- `tsc --noEmit`、`eslint`（改动文件，仅余 3 条历史无关 warning）、`next build` 全通过。

---

## [0.19.0] - 2026-06-23

> **引入 TradingView 官方开源 lightweight-charts 画布引擎（Pro 视图）**。图表工作区新增「图表引擎：经典 SVG / Pro 画布」一键切换，二者并存、互不影响：经典 SVG 保留我们独有的筹码分布 / 价格投影 / VRVP 自绘叠加；Pro 画布主打专业交互与性能。

### 新增：Pro 画布视图（lightweight-charts v5）
- 新增依赖 `lightweight-charts@5.2.0`（canvas 渲染，6000+ 根丝滑，解决长历史全量 SVG 卡顿）。
- 新组件 `src/components/LightweightChart.tsx`：K线 + 成交量 + MA(5/10/20/60/120/250) + 布林带叠加、买卖标记（B/S 箭头）、**库原生十字光标 + OHLCV 读数条**、**库原生对数 / 百分比纵轴**、MACD / RSI / KDJ **独立窗格**副图、周期 日/周/月 聚合。
- 新文件 `src/lib/candleAgg.ts`：抽出周/月 K 聚合纯函数（Pro 视图复用）。
- `src/app/chart/page.tsx`：图表区新增引擎切换；Pro 视图复用现有复权/数据管线（筹码/投影/VRVP 提示切回经典视图）。

### ✅ 质量
- `tsc --noEmit`、`eslint`（改动文件）、`next build` 全通过；lightweight-charts 选用发布满 7 天的稳定版（5.2.0，2026-04-24）。

---

## [0.18.0] - 2026-06-23

> **标准化回测绩效报表（对标 TradingView Strategy Tester / 券商回测报告）**。回测不再只看「收益率 + 胜率」，补齐专业风险/收益指标与可视化，让回测可信到能指导下单。随所选策略实时重算。

### 新增：绩效报表
- 新文件 `src/lib/performance.ts`：`computePerformanceReport(history, trades)` 纯函数，从净值序列 + 交易明细算出：年化收益/波动、**Sharpe / Sortino / Calmar**、**最大回撤**（含峰谷日期）、**Profit Factor**、平仓胜率、平均盈/亏与盈亏比、**最大连亏**、**平均持仓天数**（FIFO 配对）、持仓占比。
- 新组件 `src/components/BacktestReport.tsx`：指标卡片阵 + **权益曲线**（策略 vs 买入持有，起点归一 1.0）+ **回撤水下图**。
- `src/components/QuantChart.tsx`：交易面板新增「绩效报表」页签（置顶默认），与策略切换联动。

### ✅ 质量
- `tsc --noEmit`、`eslint`（改动文件）、`next build` 全通过。

---

## [0.17.0] - 2026-06-23

> **可插拔副图框架 + 首批技术指标（MACD / RSI / KDJ / BOLL，对标 TradingView）**。同花顺/通达信用户熟悉的主图叠加（布林带）+ 副图振荡指标一键切换。口径对齐常见券商软件默认参数，便于拿同花顺/通达信数值互校。

### 新增：技术指标
- 新文件 `src/lib/indicators.ts`：纯函数实现 `computeMACD`(12,26,9)、`computeRSI`(14, Wilder 平滑)、`computeKDJ`(9,3,3)、`computeBOLL`(20,2)；预热不足处填 NaN，渲染端跳过。
- `src/components/QuantChart.tsx`：
  - **BOLL 主图叠加**（复用 K 线纵轴，含对数轴）：上/中/下轨，上下轨并入价格极值以免被裁切；均线区加 BOLL 勾选。
  - **可插拔副图**：工具栏新增「副图：无 / MACD / RSI / KDJ」单选；选中时在成交量下方动态加一栏振荡面板，SVG 总高自适应。MACD 柱+DIF/DEA+零轴；RSI 线+30/50/70 参考线；KDJ K/D/J 三线+20/80 参考线。副图与主图缩放/平移同步（复用 `getX` 与可视区切片）。

### ✅ 质量
- `tsc --noEmit`、`eslint`（改动文件）、`next build` 全通过。

---

## [0.16.0] - 2026-06-23

> **图表专业化第一步：纵轴标度切换（线性 / 对数 / 百分比，对标 TradingView）**。对数轴是后复权长周期的「正确看法」——五粮液类后复权 53→1672，线性轴几乎贴底看不清结构，对数轴下各阶段涨跌等比例可读；百分比轴以可视区首根收盘为基准显示相对涨跌，便于横向比较。与 0.15 的前/后复权切换天然互补。

### 新增：纵轴标度 线性 / 对数 / 百分比
- `src/components/QuantChart.tsx`：K 线图工具栏新增「纵轴：线性 / 对数 / %」三态切换。
  - **对数**：`getY` 在最小值为正时走 `ln` 映射（否则自动回退线性，避免 log 负数）；网格轴标签按指数刻度反推显示真实价位。
  - **百分比**：以可视区首根收盘为基准，轴标签显示 `±x.x%`（曲线形态与线性一致，仅标度口径不同）。
  - 缩放/平移（滚轮 + 方向键）下实时随标度重算；净值回测视图保持线性。

### ✅ 质量
- `tsc --noEmit`、`eslint`（改动文件）、`next build` 全通过。

---

## [0.15.0] - 2026-06-23

> **前复权 / 后复权统一切换（对标通达信「正经复权」）**。图表 / 筹码 / 交易标记 / 回测整体切到同一复权口径：**前复权**贴现价看操作买卖，**后复权**看长周期真实回测。彻底解决「五粮液类」高分红老股——前复权全量历史半数为负价（000858 全量 6276 根中 3162 根 < 0，最低 −29.82），喂回测必失真；后复权全量 6689 根 0 负价（1998 的 53.57 → 2026 的 1672.21），长周期收益真实。

### 新增：前复权 / 后复权一键切换
- `src/app/chart/page.tsx`：顶栏周期按钮旁新增「前复权 / 后复权」切换；切换即按新口径并发重载 `chart-data` 与 `analyze`，并把对应口径的现价基准传给 `QuantChart`（后复权用所选序列末根收盘价，避免实时价与 hfq 标度错配）。
- `src/app/api/market/chart-data/route.ts`：接受 `?fq=qfq|hfq`，K 线 / 筹码 / 技术形态 / 回测 / 投影同口径计算；新增返回 `fq` 与 `refPrice`（hfq 下为序列末根收盘价）。
- `src/app/api/analyze/route.ts`：接受 body `fq`，量化层（筹码 / 交易标记 / 回测 / 胜率 / 投影）走所选口径序列；**AI 打分仍走前复权近端窗口**（基本面与绝对价位无关，买卖区间贴现价）；后复权拉取失败自动回退前复权。
- `src/lib/sources/unified.ts`、`src/lib/sources/index.ts`：`getDailyKline` / `getKlineFailover` 透传 `fq: FqMode`；从 barrel 导出 `FqMode`。

### ✅ 实测 & 质量
- `tsc --noEmit` 通过；`eslint`（改动文件）0 报错（仅余与本次无关的既有 `mining/page.tsx` 报错）。
- 接口实测 000858：qfq → `refPrice` 74.76（=实时价）；hfq → `refPrice` 1672.21、360 根全正价、筹码 / 回测同标度。
- 数据层全量实测 000858：前复权 6276 根 / 3162 根负价 / 最低 −29.82；后复权 6689 根 / 0 负价 / 1998-04-27 起 53.57 → 1672.21。

---

## [0.14.0] - 2026-06-23

> **修复长周期回测「前复权负价」失真**。前复权对高分红老股拉到早年会把价格做成负数/近零（如五粮液早年收盘 < 0、茅台早年 −71），直接喂回测会算出 −2600% 这类不可能的收益。本版在所有回测入口只取「前复权有效正价区间」，使茅台/恒瑞等长周期回测回到合理量级，且交易标记、理由文案（内嵌价位）、筹码定位、现价口径全程一致；300024 等无负价个股结果完全不变。

### 修复：前复权负价污染回测
- `src/app/api/analyze/route.ts`：回测/胜率/图表 K 线改用「正价区间」（裁掉 `close/open/high/low ≤ 0` 的坏 bar），打分/筹码/技术形态仍用前复权近端窗口，口径不变。
- `src/lib/portfolioBacktest.ts`、`src/lib/strategyLeaderboard.ts`、`src/lib/recommendationBacktest.ts`、`src/app/api/backtest/pairs/route.ts`：批量回测入口同样只取正价区间。
- 实测：茅台 −2599.9%→+296.2%、恒瑞 −4322.4%→+266.1%、300024 +141.7%（不变）。

### 新增：后复权数据层（为「复权切换」预留）
- `src/lib/market.ts`：`getKline` 增加 `fqt` 参数（0 不复权 / 1 前复权 / 2 后复权）。
- `src/lib/sources/klineStore.ts`：新增 `FqMode`（qfq/hfq），前/后复权各自独立落盘（`.data/kline-cache` 与 `.data/kline-cache-hfq`），后复权只用东财 `fqt=2`（不接百度/新浪，避免污染）。
- `src/lib/sources/unified.ts`：导出 `getHfqDailyHistory(code, limit)`，供后续「后复权回测视图」使用。

### ✅ 质量
- `tsc --noEmit` 通过；`eslint` 仅余与本次无关的既有 `mining/page.tsx` 报错。

---

## [0.13.0] - 2026-06-23

> **行情数据从 ~1.5 年扩到 ~10 年**，并引入「全量落盘 + 增量更新」的本地行情库（对标通达信/同花顺等本地行情软件）：首次拉全量、之后只补增量，回测样本更长更稳，且不再每次重复下载全量。

### 新增：日 K「全量落盘 + 增量更新」本地行情库
- `src/lib/sources/klineStore.ts`（新）：`getDailyHistory(code)` 统一取数入口。
  - **全量落盘**：首次访问拉约 10 年日线（`HISTORY_LIMIT=2600`），落盘 `.data/kline-cache/<code>.json`（gitignore，重启不丢）。
  - **增量更新**：之后每次只补最近一小段窗口（默认 60 根），与盘内按日期去重合并后回写，不再重复下载 10 年。
  - **复权漂移检测**：增量窗口与盘内重叠「已结算」日收盘价整体偏移超阈值（除权除息导致前复权价平移）时，自动触发一次全量刷新，保证历史价不串档。
  - **新鲜度短路**：盘中 2 分钟 / 收盘后 12 小时内直接回放盘内、不打网络；网络全失败则降级回放盘内旧数据。
  - 全量历史在内存层（`globalCache`）做请求合并 + 短 TTL 复用。
- `src/lib/sources/unified.ts`：`getDailyKline` / `getKlineFailover` 改为统一走本地行情库后按 `limit` 切片；放开旧的 1023 上限（改用 `HISTORY_LIMIT`）。
- `src/lib/sources/sina.ts`：放开新浪 `datalen` 自设上限 1023 → `SINA_KLINE_MAX=3000`（实测可回溯约 12 年）。
- 百度源全量拉取按窗口补 `start_time`（默认不传只给约 8 年）。

### 回测窗口扩到约 10 年
- 个股分析 `analyze`：**回测/胜率吃全量历史**（约 10 年），打分/筹码/技术形态仍用近端 360 根窗口，**评分口径保持不变**（避免 `deriveStats` 区间位置被 10 年量程改写）；返回前端的 K 线改为全量历史，图表可看 10 年。
- 策略榜单 `strategyLeaderboard` 默认窗口 500 → `HISTORY_LIMIT`；组合/建议/配对回测上限 800 → `HISTORY_LIMIT`（可按需取满 10 年）。

### ✅ 实测 & 质量
- 600519 实测：首次全量 2600 根（2015-10 → 2026-06，~10.7 年，2.3s）；即时复用 +disk 4ms 不打网络；增量补更 +incremental 471ms 只拉小窗口；日期升序无重复。
- `tsc --noEmit`、`eslint`（改动文件）全通过（0 error；仅余与本次无关的既有告警）。

---

## [0.12.0] - 2026-06-23

> 新增策略 **v7（瓶颈动量突破·regime 自适应出场）**：入场信号与 v4/v5/v6 完全一致（七类买点 + MA60 闸门，可严格对照），仅升级出场逻辑，专治 v6 在箱体震荡票上「只买不卖、坐电梯回吐」的痛点。已设为默认策略。

### 新增 v7 策略：regime 自适应出场
- `src/lib/quant.ts`（新增 `runChokepointMomentumBacktestV7` + `ChokepointV7Options`）：
  - **regime 判定**：用 `adxWilder(14)` + MA60 斜率区分「趋势 / 箱体」（ADX<22 且 MA60 走平 → 箱体）。
  - **箱体高抛（核心修复）**：确认箱体时，价升至区间上沿（rangePos≥0.82）且当根滞涨/收阴即均值回归清仓——让策略在箱体里终于有卖点。
  - **前移止盈阶梯**：浮盈 +8% 先减约 1/3 落袋（箱体反弹也能兑现），保留 v6 的 +25% 再减 + 6×ATR 宽 runner。
  - **结构 + 时间止损**：买入后迟迟未站上成本 +6%（跟踪未激活）、持仓超 15 根又跌破 MA20，判突破失败砍掉死钱。
  - 趋势行情下 ADX 走高则不判为箱体、仍按 v6 让利润奔跑，是「趋势照旧奔跑、箱体主动高抛」的自适应版；其余风控（筹码支撑止损 / 天量滞涨）与 v6 一致。
- `src/lib/strategies.ts`：注册 `chokepoint-momentum-v7` 并置顶为默认策略（`DEFAULT_STRATEGY_ID`）。

### A/B 回测（12 只代表性蓝筹篮子，新浪日线 360 根，同口径对照）
- **「有买无卖」股数 1 → 0**：彻底解决箱体票买入后无卖点干等的问题。
- **总卖出次数 35 → 114**：箱体高抛 / 结构止损让出场真正发生。
- **平均收益 −11.7% → −9.8%**（样本期为震荡偏弱市，两者均为负，属行情非策略）；跑赢买入持有 3/12 持平。
- 诚实权衡：换手率显著上升，个股表现有好有坏（如五粮液 −44.5%→−19.7%、宁德 +18.2%→+33.0% 改善；格力、海康因来回高抛略差），参数（ADX 阈值 / 前移止盈档位 / 结构止损根数）仍可继续调优。

### ✅ 质量
- `tsc --noEmit`、`eslint` 全通过（0 error；仅余与本次无关的既有告警）。

---

## [0.11.0] - 2026-06-22

> 丰富「方法论 / 知识库」页的「近期 X 发言」板块：因已无独立详情页，改为**原文全文展示**，并为每条发言映射**最相关的 A 股板块/个股**，附直达分析诊断的链接。

### 知识库「近期 X 发言」增强
- `src/lib/postMapping.ts`（新）：`mapPostToSectors` 将一条发言映射到知识库「主题 → A 股瓶颈点」表中最相关的板块/个股。评分 = 美股 ticker 命中 ×2 + 正文关键词命中；规则用 anchor（主题 usExamples 之一）绑定到主题，避免对中文主题名硬编码；**无命中即返回空、不臆造**。
- `src/app/methodology/page.tsx`：发言卡片由「点击跳转原文的整块链接」改为信息卡——① 全文展示（去掉 4 行截断）；② 互动数据（点赞/转发/浏览）；③ 原始 $ticker；④ 相关 A 股板块标签 + 个股 chips（每个链接 `/analyze?code=` 自动诊断）；⑤「在扫描器批量分析」链接 `/scanner?codes=...&title=...`。
- `scratch/verify-postmapping.ts`：真实知识库数据 8 项断言全 PASS。

### ✅ 质量
- `tsc --noEmit`、`next build`、ESLint 全过（0 error）。

---

## [0.10.0] - 2026-06-22

> 三件事一起落地（用户「1-3 都要」）：① 把验证池从 15 只扩到 **50 只大盘蓝筹**（按总市值先验选样、不挑历史牛股）做更大样本显著性；② 新增 **统计套利 / 配对交易** 模块（协整 + 价差均值回归，市场中性）；③ 用 **ADX** 强化网格的 regime 门控。三项全部用真实 A 股数据验证，**诚实呈现负面结论**（这正是扩样本与样本外检验的价值）。

### ① 扩池显著性（50 只大盘蓝筹，剔 ST/科创）
- `scratch/build-universe.ts`：按 Eastmoney 总市值（f20）先验选 50 只，不看历史收益（避免数据挖掘）。
- 建议忠实回测页加「① 大盘蓝筹 50」一键填池按钮。
- **真实结论（49 只有效 / ~200 笔）**：胜率对 50% 仍**不显著**（v6 p=0.15、v5 p=0.06，均 > Bonferroni 阈 0.0063）——动量策略胜率本就 <50% 附近、靠盈亏比取正期望。**更大样本反而暴露 v6 的过拟合**：15 只池 v6 全面胜 v5，但 50 只池里 **v5 跨时间稳健性远胜 v6**（v5 5/5 折正期望判稳健；v6 仅 1/5 判不稳健）。结论修正：v6 仍作默认（强趋势捕获更好），但**不再宣称「v6 全面胜出」**。

### ② 统计套利 / 配对交易（新模块，市场中性，与趋势内核互补）
- `src/lib/stats.ts` 新增协整工具：`ols`（最小二乘对冲比例）、`adfTest`（ADF 单位根检验）、`halfLife`（OU 半衰期）、`pearson`。
- `src/lib/pairTrading.ts`：Engle-Granger 两步选协整配对 + z 分数阈值市场中性回测（双边手续费 + 破裂止损）；`runPairScan` 一站式给出**样本内 vs 样本外**对照。
- 新页 `/backtest/pairs` + API `/api/backtest/pairs`。
- **真实结论**：选股经济合理（银行股间高度协整、煤炭~石油、医药），但**朴素静态-β 协整样本外失效**：样本内胜率 68%、每笔 +2%，**样本外（前 60% 选配对、后 40% 交易）胜率跌到 38%、每笔 -2.6%、仅 2-3/15 配对盈利**——典型 stat-arb 衰减。**定位为研究工具，不作可投资策略**；A 股融券受限，纯多空难落地。

### ③ ADX 强化的 regime 门控网格
- `src/lib/quant.ts` 新增 `adxWilder`（Wilder ADX 趋势/震荡判别器），并入 `runGridMeanReversionBacktest` 箱体闸门：仅当 **ADX < 25**（无明显趋势）+ MA60 走平 + 布林带宽适中 + 价格被上下沿包住才开仓。
- **真实结论（15 只池）**：regime 闸门**真正绑定**（全部 79 个开仓日 ADX 均 <25）、破箱止损触发 45 次。但网格 DSR 仅 7%、每笔约 0%，**远逊 v5（DSR 85%）**——确认网格只作震荡区专用模块、绝不作主策略。

### ✅ 质量
- `tsc --noEmit`、`next build`、ESLint 全过（0 error）。新增 `verify-universe.ts`/`verify-pairs.ts`/`verify-grid.ts` 真实数据断言全 PASS。

---

## [0.9.0] - 2026-06-22

> 仓位管理升级：回应用户真实疑问「策略只赚 +5%、个股同期涨 +66%」——把国际趋势跟随机构的「分批建仓 / 分批止盈」逐一用真实数据 A/B 验证，**只把验证有效的部分接进默认策略**。结论：**逐步卖出（分批止盈 + 宽 runner）显著有效；逐步买入（金字塔加仓）实测证伪、默认关闭**。

### 📈 新策略 chokepoint-momentum-v6（分批止盈 + 宽 runner，设为新默认）
- `quant.ts` 新增 `runChokepointMomentumBacktestV6`。入场「信号」与 v4/v5 **完全一致**（七类买点 + MA60 闸门），只升级「仓位管理」：
  - **分批止盈（逐步卖出 / 留 runner，✅ 有效）**：浮盈达 +25% 先止盈约 1/4 落袋锁利，剩余 3/4「底仓 runner」改挂更宽的 **6.0×ATR** 跟踪止损（远宽于 v5 收紧档 3.0×），让利润奔跑、吃趋势尾段。
  - **金字塔加仓（逐步买入，❌ 证伪、默认关闭）**：先建底仓再逐档加仓的做法在本策略上抬高均价、震荡票被洗，净收益与捕获率反而大幅下降（捕获率掉到 ~31–48%）。代码保留 `initialFrac/maxAdds/addFrac` 可调能力，但默认 `initialFrac=1.0、maxAdds=0`（整仓建仓、不加仓）。
- `TradeAction` 新增可选 `sizePct`（分批仓位比例）；`recommendationBacktest.ts` 重放引擎升级为**分数仓位累加器**，支持分批建仓/分批止盈的逐笔撮合（双边手续费 + 涨跌停），对不带 `sizePct` 的 v1–v5 **退化为与旧单仓位逻辑完全一致**（无回归）。
- `DEFAULT_STRATEGY_ID` 改为 `chokepoint-momentum-v6`；v1–v5 / grid / 传统均线原样保留作对照。

### 🔬 参数寻优（真实数据网格扫描，非拍脑袋）
- 对「止盈阈值 × 止盈比例 × runner 宽度」做 27 组真实数据扫描，最优口径稳健落在 **+25% / 卖 1/4 / 6.0×ATR** 的邻域（非单点过拟合）。
- 同时验证：所有**含加仓**的配置（4 组）均显著劣于整仓——证伪「逐步买入提升收益」的直觉。

### ✅ 质检与测试
- `tsc --noEmit`、`next build`、ESLint 全过（0 error）；`scratch/verify-v6.ts` 8 项断言全 PASS。
- **真实数据 15 只池 A/B：v6 全面优于 v5**——每笔均值 +6.11%（v5 +4.86%）、盈亏比 2.61（2.04）、择时 edge +0.85pp（−0.15pp）、逐笔 Sharpe 0.302（0.215）/ 年化 1.74（1.30）、Sortino 0.99（0.64）、Calmar **5.09（2.65）**、最大回撤 **66.2%（72.8%）**、**DSR 97%（85%，首次稳过 95% 机构线）**；对买入持有的平均捕获率 **96%（v5 81%）**，正收益股数 13/15。
- **诚实权衡**：分批止盈在极端单边大牛股里仍会少赚卖飞的那 1/4（如 300059 捕获 136% vs v5 162%），但以更低回撤、更高一致性与组合复利净值（10.4→26.6）换取——不能既「砍亏损」又「满吃每一只赢家」，这是趋势跟随的固有取舍。

---

## [0.8.0] - 2026-06-22

> Phase 3：继续引入国际顶级量化机构的通用做法，三件一起落地——① **ATR 自适应止损接进策略买卖逻辑**（v5）；② **Purged + Embargo K-Fold 时间分折交叉验证**（防时间序列泄漏的稳健样本外检验）；③ **regime 门控的网格 / 均值回归模块**（只在确认箱体震荡时启用、强制破箱止损）。全部用真实行情数据（15 只池）验证。

### 📈 新策略 chokepoint-momentum-v5（ATR 自适应止损，新默认）
- `quant.ts` 新增 `runChokepointMomentumBacktestV5` 与 `atrWilder`（Wilder ATR(14)）。入场口径与 v4 **完全一致**（七类买点 + MA60 中期趋势闸门），并沿用 v4 跟踪止损「结构」（浮盈 +6% 启动、分段收紧、筹码支撑止损、高位天量滞涨）。
- **唯一升级**：把 v4 的固定回撤百分比（15%/9%）替换为**随个股真实波动自适应的回撤距离**——跟踪回撤% = clamp(mult × ATR%, 7%, 25%)，mult 随浮盈分段收紧（未到 +20% 用 5.0×、≥ +20% 收紧到 3.0×）。对 3% ATR 的中等波动票回撤≈15%/9%，与 v4 等价；高波动票自动给更宽止损（少被洗）、低波动票自动收紧（少回吐）。
- 因仅改「止损距离」不改启动条件，v5 换手率与 v4 同量级，是可对照的 A/B。`DEFAULT_STRATEGY_ID` 改为 `chokepoint-momentum-v5`，v1–v4 / 传统均线原样保留作对照。

### 🧪 Purged + Embargo K-Fold 时间分折交叉验证（López de Prado）
- `recommendationBacktest.ts` 新增 `purgedKFoldCV`，结果新增 `crossValidation` 字段。把完成交易按买入日切成 K 折，逐折独立统计胜率/每笔均值，回答「边际收益是否跨时间稳健」。
- **Purge**：丢弃持仓跨折边界的交易（标签泄漏到下一折）；**Embargo**：再丢弃每折起始隔离带内开仓的交易（避免序列相关泄漏）。输出各折胜率 mean±std、最差折、正期望折数与「跨时间稳健」判定。
- `/backtest/strategy` 页「风险调整与稳健性」卡片下新增交叉验证分折明细表与稳健性徽标；结论横幅文案追加 CV 摘要。

### 🧩 新策略 grid-mean-reversion（regime 门控的网格 / 均值回归）
- `quant.ts` 新增 `runGridMeanReversionBacktest`，登记为 `grid-mean-reversion`。**震荡区专用模块**：仅在 regime 闸门确认箱体（MA60 走平 + 布林带宽适中 + 近 40 日价格被上下沿包住）时才低吸（触布林下沿且企稳）、高抛（回布林上沿）；强制**破箱止损**（跌破开仓下沿 3% 立即出局、不补仓不马丁格尔），箱体被向上突破则交回趋势策略。
- 与动量内核互补、非替代。真实数据印证此前结论：网格抬高交易频次但**不抬高风险调整后收益**（本池 Sharpe≈0、DSR 9%），仅作震荡行情对照。

### ✅ 质量与测试
- `tsc --noEmit`、`next build`、ESLint 全过（0 error）；`scratch/verify-v5.ts` 7 项断言 PASS。
- 真实数据 15 只池 A/B：**v5 全面优于 v4**——胜率 46.5%（v4 44.3%）、盈亏比 2.04（1.85）、逐笔 Sharpe 0.215（0.194）、Sortino 0.64（0.55）、Calmar 2.65（1.87）、最大回撤 72.8%（79.4%）、DSR 86%（76%），且交易数 71≈70（证明入场口径一致）。
- **诚实结论**：经 7 次试验 Bonferroni 校正（p<0.0071）后胜率对 50% 仍不显著；Purged+Embargo 5 折交叉验证显示各折离散度大、最差折胜率仅 14%——边际收益高度依赖个别行情段，须警惕过拟合，仍需扩大样本池。

---

## [0.7.0] - 2026-06-22

> 引入国际主流量化机构的**诚实评估**通用做法：把「建议忠实回测」从只看胜率/均值，升级为带**风险调整指标 + 多重检验校正 + 波动率目标仓位**的稳健评估，专治小样本 + 多策略反复比较时「撞出假显著」的可信度短板。

### 📐 新增统计库 `src/lib/stats.ts`
- **风险调整指标**：Sharpe（逐笔 + 年化）、Sortino、Calmar、最大回撤、CAGR，均由逐笔净收益的「等权串行复利」近似净值曲线计算（已注明忽略并发持仓的近似口径）。
- **Bootstrap 置信区间**：对胜率与每笔均值给出可复现（固定种子）的 95% percentile CI，量化"运气成分"——区间跨越 50%/0 即说明结论脆弱。
- **PSR / Deflated Sharpe Ratio（López de Prado, 2014）**：PSR 计入收益偏度/峰度（非正态修正）；DSR 用"试过 N 个策略"抬高运气门槛（期望最大 Sharpe），再算真实 Sharpe 超过门槛的概率——比较的策略越多，门槛越高。含 Acklam 逆正态分位数实现。
- **多重检验校正**：Bonferroni 阈值与 Benjamini-Hochberg（FDR）。
- **波动率目标仓位**：`volTargetedStats` 按入场 ATR% 反比调仓（风险平价），度量"低波动多下、高波动少下"对风险调整后收益的改善。

### 📊 建议忠实回测接入新指标
- `recommendationBacktest.ts` 的结果新增 `risk / avgReturnCI / winRateCI / psr / dsr / numTrials / bonferroniAlpha / significantAfterCorrection / avgAtrPctAtEntry / volTargeted` 等字段；`numTrials` 默认取已登记策略数（5），`volTargetPct` 默认 3。每笔交易记录入场 ATR(14)%。
- 结论文案在 z 检验之外，**追加 Bonferroni 校正后的显著性、风险调整指标摘要与波动率目标仓位效果**，并据此把结论横幅"变绿"的标准提高到**多重检验校正后仍显著**。
- `/api/backtest/recommendation` 接受 `numTrials / volTargetPct`；`/backtest/strategy` 页新增「风险调整与稳健性」卡片（Sharpe/Sortino/Calmar/最大回撤/CAGR、95% CI、PSR/DSR、Bonferroni）与「波动率目标仓位」对照行。

### ✅ 质量与实测
- `tsc --noEmit`、`next build`、ESLint 全通过；`scratch/verify-stats.ts` 15 项断言全 PASS（含 normInv↔normCdf 互逆、DSR 随试验次数变严、BH/Bonferroni、bootstrap CI 包含点估计）。
- 真实数据 15 只池实测：v4 逐笔 Sharpe 0.19 / Sortino 0.55 / Calmar 1.87 / DSR 82%，全面优于 v3（0.17 / 0.46 / 1.22 / 72%）；波动率目标仓位把 v4 Sharpe 提到 0.21（v3 反而下降），结论文案据实自适应。两者经 5 次试验 Bonferroni 校正后胜率均不显著——诚实结论：动量策略胜率本就 <50%，靠盈亏比取正期望，要做显著的胜率证明须扩大样本。

---

## [0.6.0] - 2026-06-22

> 在 v3 底部反转增强之上，新增 **v4 策略（MA60 趋势过滤 + 跟踪止损调优）** 并设为默认；同时把「建议忠实回测」从内置简化口径升级为**按所选策略忠实重放**，使 `/backtest/strategy` 能对 v1/v2/v3/v4 做多股票池显著性对照。

### 📈 新策略 chokepoint-momentum-v4（趋势过滤 + 跟踪止损调优）
- **MA60 中期趋势闸门（仅作用于右侧动量入场）**：`quant.ts` 新增 `runChokepointMomentumBacktestV4`。右侧四类买点（均线金叉 / VCP 平台突破 / 强势起爆创新高 / 趋势回踩再起）新增闸门——仅在「价在 MA60 之上 **或** MA60 近 10 日不下行」时才允许追入，压住在 MA60 仍向下的震荡/下行区里追突破被诱多。
- **底部三类买点不加闸门**：放量反包·底部启动 / W底突破 / 老鸭头二次金叉本就发生在 MA60 下方的底部（老鸭头自带 MA60 向上要求），保持原样 → **04-17 漏买修复完全不受影响**（合成数据验证：v4 底部买点与 v3 逐笔一致）。
- **跟踪止损分段调优**：启动阈值由 +8% 提前到 **+6%**；浮盈未到 +20% 用 **15%** 宽松回撤（少被建仓初期正常震荡洗出，v3 为 12%），峰值浮盈 ≥ +20% 后收紧到 **9%** 锁定大段利润。全部参数（`trailActivate / trailPctBase / trailPctTight / tightenGain / ma60Filter`）可通过 opts 调，便于参数寻优。
- **登记为默认策略**：`strategies.ts` 中 `DEFAULT_STRATEGY_ID` 改为 `chokepoint-momentum-v4`，v1/v2/v3/传统均线**原样保留**作诚实对照。

### 📊 建议忠实回测接入真实策略（多股票池显著性对照）
- **按策略忠实重放**：`recommendationBacktest.ts` 重构，新增 `strategyId` 配置。指定策略时，按该策略在每只票上产生的买卖点（与个股看盘页**同一套规则**）叠加 A 股涨跌停撮合（涨停买不进、跌停卖不出顺延）+ 双边手续费成交，再汇总胜率 / 期望 / 盈亏比并对 50% 做 z 检验；留空（`""`）则退回内置「均线放量突破 + 固定止盈」简化口径作历史对照。
- **池内中性基本面分**：新增 `poolChokepointScore`（默认 60），池内无逐股基本面分，故不触发依赖高基本面分的「强势起爆」信号——诚实的保守口径。
- **API / UI**：`/api/backtest/recommendation` 接受 `strategyId` / `poolChokepointScore`；`/backtest/strategy` 页新增**策略下拉**（v4/v3/v2/v1/传统均线 + 内置简化口径），结论横幅回显「跑的是哪个策略」。

### ✅ 质量
- 本地 `tsc --noEmit` 通过；生产 `next build` 通过；合成数据三项断言全 PASS（v4 底部买点与 v3 一致、v4 拦截 MA60 向下区的金叉诱多、策略多股票池回测打通并回显元信息）。

---

## [0.5.0] - 2026-06-22

> 本次为里程碑级版本：围绕**准确性优先、诚实优先**，把单 Agent 单趟打分升级为多智能体协作工作流，并补齐了组合 / 建议忠实回测、样本外胜率与校准闭环，同时引入全市场智能挖掘的高吞吐数据管线。

### 🧠 多智能体 AI 工作流（Generator → Critic → Judge）
- **三智能体协作复核**：新增 `src/lib/agentWorkflow.ts`，把"单 Agent 单趟"升级为 **生成器 → 批判者 → 裁判** 工作流（对齐 Google Agentic 的 Reflection / Critic / Debate 模式）。生成器初评 → 批判者（风控）专挖反证 / 无依据论断 / 过拟合叙事并标注严重度 → 裁判据此保守下调分数与置信度。任一步 LLM 失败均**自动降级**为纯确定性调和（`reconcileDeterministic`），绝不阻断主流程。
- **强制证据引用**：生成器 prompt 要求每个五因子打分必须引用具体数据点（如"毛利率 31% → 需求 4 分"），无支撑的论断填"无直接数据支撑"并降权，错误从此可审计。
- **自洽投票 (Self-Consistency)**：新增 `runSelfConsistencyVote`，最终打分独立跑 N 次取**中位数**降方差（`SELF_CONSISTENCY_RUNS` 控制，默认 2，设 0 关闭）。analyze 进度条新增「自洽投票」步骤，结果卡展示各因子 `主趟→共识(±极差)`。
- **结构化输出强约束**：`src/lib/llm.ts` 的 `chatJson` 支持严格 `json_schema`（`additionalProperties:false` + 全字段 required），应用到投票 / 批判 / 裁判三处，杜绝字段漂移；provider 不支持时自动降级到 `json_object` → 纯文本。

### 📈 诚实准确性体系（样本外胜率 + 校准闭环）
- **样本外 walk-forward 胜率**：`quant.ts` 新增 `runWalkForwardWinRate`，信号在第 t 日只用 ≤t 的数据判定，仅在留出尾段统计 t→t+5 前瞻收益，杜绝未来函数。UI 并排展示"样本外 N 日前瞻 M 次信号"与"样本内对照（通常偏高）"。
- **校准闭环 (Calibration Loop)**：新增 `src/lib/calibration.ts` + `/api/calibration/record`。每次分析自动把预测落库（`.data/calibration.json`），事后回填真实涨跌即可计算 **Brier 分 + 可靠性曲线 + 实际命中率**；analyze 页新增「校准闭环·可靠性」卡片。

### 📊 回测体系扩建（组合 / 建议忠实 / 涨跌停真实性）
- **组合级回测引擎**：新增 `src/lib/portfolioBacktest.ts` + `/api/backtest/portfolio` + `/backtest` 页。按截面排名每 N 日轮动持有 top-K，输出净值曲线 + CAGR + 最大回撤 + 年化夏普 + 换手率 + 交易流水（纯 SVG 可视化）。严格防未来函数。
- **建议忠实回测框架**：新增 `src/lib/recommendationBacktest.ts` + `/api/backtest/recommendation` + `/backtest/strategy` 页。把模型买入 / 卖出价区间执行逻辑放到多股票 + 样本外滚动 + 涨跌停撮合 + 手续费下跑，统计真实胜率 / 期望 / 盈亏比，对比买入持有并给 z 检验显著性结论。
- **A 股涨跌停撮合真实性**：`priceLimitFraction` 主板 ±10 / ST ±5 / 创业科创 ±20 / 北交 ±30，**涨停买不进、跌停卖不出、停牌顺延**。
- **单只回测对比基准**：analyze 胜率区新增策略累计收益 vs 同期买入持有、超额 pp、对 50% 的单比例 z 检验显著性徽章（样本 < 30 明确标"不显著"）。

### 🔍 全市场智能挖掘高吞吐管线
- **两段漏斗加速 (P1)**：`miningScan.ts` clist 翻页多取 `f6/f8/f10`（成交额 / 换手 / 量比，零额外请求）→ 先粗筛再拉 K 线，冷扫 K 线请求量降约 5–10×；每日全量池用"仅跳停牌"保覆盖粗筛。
- **批量 K 线原语 (P2)**：`unified.ts` 新增 `getKlinesBatch()`，有界并发 + 缓存 + 单只重试，baidu-first 免封源优先。
- **卖方一致预期 (P3)**：`eastmoney.ts` 新增 `getEmAnalystConsensus()`，聚合研报看多占比 / 一致 EPS / 目标价 / 上行空间，24h 缓存，单只 8s 超时降级 + `anySucceeded` 区分"源宕机"与"确实无数据"。
- **截面相对排名 (F3)**：`MiningResult` 新增 `percentile`，用 `rankNormalize` 给出每只在"综合分 / 预期收益"上的全市场排名。

### 📝 文档
- **README 全面重写**：产品 / 市场 / 设计主导，新增"为什么是 Serenity"对比表、核心能力总览、逐页详细使用说明、API 速查表、环境变量与诚实准确性边界说明。
- **CHANGELOG**：补齐 0.4.4 之后到本版本的全部更新。

### ✅ 质量
- 全量 `tsc --noEmit` 通过；生产 `next build` 通过（全部路由编译成功）；新增引擎均通过离线烟雾测试。

---

## [0.4.4] - 2026-06-18

### 🐛 关键崩溃修复 (Critical Bug Fix)
- **修复多个股看盘页面 `QUANT DATA PROCESSING FAILED` 崩溃问题**：
  - **净值模式必崩修复**：在 `QuantChart.tsx` 中，当用户切换为"策略净值对比"视图时，`chipParams` 会正常返回 `null`（因为净值折线图无需筹码直方图），但全局拦截逻辑将其与 `chartParams` 进行了 AND 组合判断，导致必定崩溃。现已修改为仅检查 `chartParams`，`chipParams` 为空时只降级隐藏筹码区。
  - **VRVP 算术防御加固**：在 `quant.ts` 的 `calculateChipDistribution` 和 `analyzeTechnicalPatterns` 中加入 `safeNum` 辅助函数，全面拦截 `NaN`、`Infinity`、`-Infinity` 等非法浮点运算结果。对 `avgCost`、`profitRatio`、`priceLow70/priceHigh70`、`supportPrice`、`resistancePrice` 等关键指标实施安全回退，确保经 JSON 序列化后不会产生 `null` 值污染前端。

### ⚡ 首屏性能优化 (Performance)
- **行情与 AI 诊断请求并行化**：
  - 重构 `chart/page.tsx` 的 `loadStock` 函数。原有逻辑为先 `await` 基础行情接口（~300ms）、再串行发起 AI 流式诊断请求（~15s）。现改为在函数入口同时 `fetch` 两个请求：优先 await 轻量行情响应渲染 K 线首屏（用户秒看到图表），AI 诊断则在后台并发消费流式数据。极速压缩用户等待感知时间。

---

## [0.4.3] - 2026-06-18

### ⚡ 交互升级与稳定性增强 (UX Streamlining & Robustness)
- **实现流式推理终端自动滚动至底部 (Terminal Auto-Scrolling)**：
  - 针对大模型长流式文本推理输出时可能出现的被容器遮挡误以为中断的问题，在 `src/app/chart/page.tsx` 中为侧边栏大容器（`sidebarRef`） and 终端日志视窗（`terminalRef`）分别引入了 DOM 引用，并挂载了高精度状态侦听器。在 AI 处于加载且流式推送文本时，实时自动将滚动条拉至最底端，让最新渲染的词句始终处于可视区核心，大幅提升了流式体验。
- **防止生成过长被提前截断 (LLM Buffer Safety)**：
  - 针对由于大模型前置思考过程（Reasoning）过长，或因复杂的六步研判和五因子 NDJSON 结构化大输出导致可能在流中途由于达到中继商默认上限而被提前截断的问题，在 `src/lib/llm.ts` 的流式接口 `chatStream` 中，显式添加了 `max_tokens: 8192` 参数限制。提供极度充足的上下文输出缓冲区，彻底杜绝了大模型流式长文本在中间腰斩的风险。

---

## [0.4.2] - 2026-06-18

### 🛠️ 修复与联动优化 (Fixed & Interaction Alignment)
- **修复切片索引误用导致的价格与筹码严重错位 Bug**：
  - 修复了在看盘控制台上移动鼠标时，高亮指示线和联动筹码取值错位的硬伤。由于交互中 `hoveredIdx` 保存的是当前可视 K 线切片（`slicedCandles`）的相对索引，而在计算筹码分布 `activeChips` 和现价联动线 `activePrice` 时，误将其作为了包含全部历史数据的 `currentCandles` 绝对索引使用，导致了严重的价格偏差（如在用户鼠标悬浮于收盘价为 `15.06` 的 K 线柱上时，右侧联动虚线却错位指向历史最远端收盘价为 `20.58` 的位置）。
  - 通过在 `chartParams` 中将当前可视区间起始绝对偏移量 `sliceStart` 作为属性返回，在计算 `activeChips` 和 `activePrice` 时，利用 `absoluteIdx = sliceStart + hoveredIdx` 准确还原了在完整历史数据中的绝对索引，实现左右价格及对应历史筹码切片的完美精确对齐。
  - 修正了 `isHoveredPast` 的预测区范围拦截判定。限制其只有在 K 线模式且 `hoveredIdx < chartParams.slicedCandles.length` 时才判定为历史走势，避免在悬浮于右侧未来预测区时，界面误显示“收盘: xxx”文本，现在会正确展示为“现价: xxx”。

---

## [0.4.1] - 2026-06-18

### ✨ 新增与重构 (Added & Refactored)
- **单 SVG 物理同轴绝对对齐 (Unified SVG Alignment)**：
  - 将左侧 K 线走势与右侧筹码直方图完全合并至同一个大 SVG 容器内（总宽度 `760px`），使得两图天然共享相同的 Y 轴价格刻度和映射。彻底解决了由于两个独立 SVG 分开布局、受 responsive viewport 缩放比例不一致导致的价格线微小垂直偏移硬伤。
  - 水平对齐高亮虚线及现价/收盘价水平虚线实现一笔通栏横穿（横跨 `[padding, 760]`），使走势图与筹码密集峰之间的价格对应关系更加直观、专业。
- **活力盘（获利盘）比例双维联动计算 (Profit Ratio Interactions)**：
  - **时间维度联动**：当光标 hover 在左侧 K 线图时，顶部 Tooltip 栏实时显示对应历史时刻收盘价下的全市场获利盘比例。
  - **价格维度联动**：当光标 hover 右侧筹码直方图时，系统自动反向计算当前鼠标物理 Y 轴对应的最临近筹码价格 bin，并在筹码区上方实时计算该价格线以下所有筹码的累计获利盘比例（活力盘比例）和该 bin 占比（如 `16.50元 | 获利: 60.5% (占比: 2.1%)`）。
- **全局自适应配色与 Tab 去 Emoji 净化 (Theme Integration & Polish)**：
  - 彻底移除了看盘控制台右侧长驻面板、输入框、下拉浮层、雷达图和 Tab 栏硬编码的纯黑色背景。全面统一接入系统的全局 CSS 变量（`var(--bg)`、`var(--surface)`、`var(--border)` 等），保证在切换浅色系（Light）与深色系（Dark）主题时，界面所有组件均能优雅自然地自适应颜色显示。
  - 去除了 Tab 标签文字中显得不专业的 Emoji 符号（⚡、📊、💻），重构为底部高亮细边线（`border-b-2 border-[var(--accent)]`）的极简高端金融终端风格。
- **全高自适应与滚动溢出优化 (Flexible Height Scroll)**：
  - 移除了流式推理终端日志框 `h-[420px]` 等硬编码的局部固定高度限制，使右侧面板内部卡片高度自适应拉满，当内容超出视口时，交由侧栏大容器 `flex-1 overflow-y-auto` 统一进行优雅的原生半透明垂直滚动，提升信息获取效率。

### 🛠️ 修复与质量核验 (Fixed & Quality Check)
- **修复 QuantChart 遗留语法错误**：修正了现价指示线渲染中 `y1={y` 缺少右括号导致 ESLint 解析失败的问题，恢复正常的静态分析和顺利编译。
- **通过项目 Lint 与构建核验**：执行了全项目的 `npm run lint` 和生产环境构建，确保代码质量和零静态分析警告。

---

## [0.4.0] - 2026-06-18

### ✨ 新增与重构 (Added & Refactored)
- **全屏独立看盘控制台布局重构 (Dedicated Dashboard Refactoring)**：
  - **左侧全画幅 K 线画布**：将可视高度自适应公式由 `window.innerHeight - 180` 优化为 `window.innerHeight - 90`，彻底移除走势区下方的表格，实现大屏无遮挡纯净行情展现。
  - **右侧长驻多功能面板**：统一控制右侧宽度为 `380px`，新增 `⚡ AI 研判`、`📊 交易信号` 与 `💻 推理终端` 三个大类 Tab，极大丰富了长驻看盘的控制选项，配合 AI 后台诊断进程设置了 Tab 小动画。
  - **推理流式状态与自动切 Tab 联动**：载入个股启动 AI 研判时，自动切至 `terminal` 展现后台的流式推理打字机效果；诊断完成获取到完整 NDJSON 数据结构后，自动切回 `ai` 展示五因子雷达打分、BOM成本链与结论。
  - **模拟交易卡片流布局**：废弃了侧栏环境下严重挤压变形的横向 Table，将其全新改写为垂直滚动的交易卡片流。各单笔盈亏、买卖价日期清晰对齐，解决了原先交易“触发原因”字段被截断的痛点，使其可完整换行展示。

### 🛠️ 修复与质量核验 (Fixed & Lint)
- **消除 ESLint 冗余警告**：删除了看盘页中未使用的 `useMemo` 引用，并针对仅在 URL 参数改变时加载的 `useEffect` 添加了 `react-hooks/exhaustive-deps` 豁免注释。
- **全项目 Lint 走通**：在完成功能重构后对全项目执行了 lint 代码规范性排查，确保静态编译与日常工程化质量。

---

## [0.3.1] - 2026-06-17

### 🛠️ 修复与优化 (Fixed & Optimized)
- **实现左右图表联动完美对齐 (Coordinate Alignment)**：
  - 彻底重构右侧筹码直方图的 Y 轴价格区间，废弃原先独立计算的 `minP`/`maxP` 范围，统一复用左侧 K 线图通过可视范围计算出来的 `chartParams.getY` 映射函数。
  - 将筹码图 SVG viewBox 的高度统一为与左侧完全相等的 `totalSvgHeight` (300px)，实现左右侧物理像素位置的绝对水平对齐。
  - 重构筹码条 `binHeight` 动态计算公式，使其直接基于相邻 bin 的 y 轴坐标像素差（`yDiff`）算得，完美适配当前图表的滚轮/键盘缩放与拉伸。
  - 引入了主绘图区可视范围 `[padding, padding + mainDrawHeight]` 的 Y 轴边界安全裁剪逻辑。当筹码 bins、POC 控制线、收盘现价线、或者是联动悬浮虚线的价格坐标超出可视范围时，自动执行隐藏过滤，避免线段与标签溢出到主绘图区之外遮挡刻度或界面。

---

## [0.3.0] - 2026-06-17

### ✨ 新增功能 (Added)
- **TradingView 级深度图表缩放与自适应 (Interactive Zooming)**：
  - 支持在图表区域内通过鼠标滚轮、触控板双指划动或键盘上下键（ArrowUp/ArrowDown）进行流畅缩放。
  - 精细实现了价格 Y 轴自适应（Auto Scale），纵坐标范围将根据当前屏幕内可视的 K 线区间极值（最高价与最低价）动态重算。
  - 挂载非 passive 原生监听器锁定页面滚动，确保看盘缩放时不会导致外部网页整体上下晃动。
- **全历史周期多波段自动回归通道 (Historical Regression Channels)**：
  - 研发了基于滑动窗口和线性回归的趋势通道检测算法，自动测绘历史周期内出现过的上升通道、下降通道以及横盘区间。
  - 精细化多通道半透明填充渲染（上升/下降通道透明度加深为 0.08，横盘通道为 0.04），方便判断历史价格与当前价格的长期通道共振。
- **1M 月度 K 线聚合支持 (Monthly Candlestick)**：
  - 周期栏新增 `1M` 月 K 线档位。
  - 实现了日 K 线到月 K 线的后台自动合并（Open、High、Low、Close、Volume、Date），并全面联动 MA 均线系统与筹码分布模块。
- **行业板块与概念选股雷达 (Sectors Hub)**：
  - 新增概念板块大盘页（`/sectors`），展示各大题材行业的多维热度、技术多头占比和主力打分。
  - 支持板块穿透，可一键获取行业成分股，并通过“基本面 Chokepoint 打分 + 技术动量”双维筛选策略定位行业核心瓶颈股。
  - 提供了同步脚本 `sync-sectors.mjs` 和缓存机制，实现自动化行业和个股数据映射的批量更新。
- **独立全屏极简看盘工作台 (Dedicated Chart Page)**：
  - 独立路由 `/chart?code=xxxxxx`，去除了多余内容干扰，专注流畅的行情图表画线与深度筹码交互。

### 🛠️ 修复与优化 (Fixed & Optimized)
- **修复趋势发散预测崩塌与回测警告**：修复了量化诊断接口中基本面默认评分被硬编码为百分制下 `3.5` 分的致命 Bug。修正为正常中性评分 `70` 分，彻底解决了低评分带来的巨幅负偏置，使中长期预测曲线从塌陷回归科学，消除了假死式回测错误警报。
- **个股知识库主题及推文精准匹配**：在 A 股概念知识库中补充录入 `300024`（机器人）与“机器人/减速器”的产业链概念关联，更新缓存失效策略，使个股页面首次加载即可完美呈现 Serenity 对该板块的洞察推文。
- **全系均线默认选中显示**：将均线的初始化状态改为默认全勾选（包含 MA5、MA10、MA20、MA60 以及长线 MA120 半年线和 MA250 年线），避免用户需要手动多次勾选的繁琐。
- **性能与体验升级**：针对高频数据交互加入了优化锁，减少重复拉取与渲染卡顿。

---

## [0.2.0] - 2026-06-16

### ✨ 新增功能 (Added)
- **中长期趋势预测扩充**：将未来股价预测天数从 15 天扩充至 **60 个交易日（整整 3 个月）**。
- **均值回归指数阻尼预测模型**：引入阻尼均值回归算法 $e^{-0.015 \times (i - 1)}$。在中长期趋势的第 60 交易日终点使斜率自然衰减收敛，结合布朗运动 $\sqrt{i}$ 的不确定性随机扩散，构建了科学的股价预测喇叭口置信度区域，有效避免斜率无限延伸造成的暴涨或归零极化。
- **K 线与筹码图日期级深度联动**：鼠标划过左侧 K 线时，右侧筹码直方图实时根据光标对应日期切片并重新计算输出历史那一刻的筹码分布，呈现主力筹码流动转移；同时右侧现价线联动变为当天的“收盘: XX.XX”并随之平移。
- **双向高亮价格虚线交互 (Elite UX)**：
  - 鼠标在右侧筹码图高度范围内滑动时，筹码图本身及左侧 K 线图的相应价格位置将**同步绘制高亮的水平对齐虚线**。
  - 左侧 K 线图左侧边缘同步生成带主色背景的价格数字气泡，便于投资者一眼识别任意密集筹码峰对应历史 K 线的支撑与阻力位。
- **牛熊生命均线 (MA120 / MA250)**：
  - 行情获取接口的拉取天数从 120 提升至 **360天**，以确保半年线与年线计算的充分性。
  - 新增 MA120 半年线（紫色）、MA250 年线（红色）的绘制。
  - 头部 Toolbar 追加 `MA120` 和 `MA250` 开关复选框。
  - 十字光标悬停时，指标卡片栏按周期顺序对齐，动态输出所有被勾选的均线实时数值。

### 🛠️ 修复与优化 (Fixed & Optimized)
- **解除低评分个股一刀切屏蔽**：删除了 `chokepointScore < 55` 时强行屏蔽技术面回测的一刀切规则。改为在买入信号描述头部标注 `【评分偏低警示】...`，保障对低分基本面标的技术突破的连续研判与仓位防御警示。
- **引入 VCP 箱体收缩整理突破算法**：针对此前“最后一次卖出（S）信号后，股价在 20 日线上盘整后再次起爆却无法再次触发买入（B）踏空”的 Bug，引入了 VCP 箱体整固突破检测。当近 10 日收盘价波动极窄（波幅 $< 8\%$），且今日放量长阳突破 10 日平台高点时，将敏锐触发买入信号。
- **静态构建完全通过**：再次通过 `npm run build` 打包，前后端 TypeScript 类型定义零报错。

---

## [0.1.0] - 2026-06-13
- 初始化 Serenity 瓶颈点选股与智能投研台项目。
- 提供大趋势五因子链条拆解与量化基本面打分设置。
- 提供基本的 K 线分析与 5/10/20/60 均线图绘制。
- 提供 2 倍无损社交分享海报生成器（9:16 与 16:9 比例自适应）。
