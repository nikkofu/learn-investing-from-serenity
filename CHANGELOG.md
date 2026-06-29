# CHANGELOG / 更新日志

本项目的所有重要更新都将记录在此文件中。

---

## [0.54.1] - 2026-06-29

> **修复 TypeScript 编译错误**：修复 `eveningScan.ts` 中 `criteria.maxChannelPosition` 可能为 undefined 的错误，使用空值合并运算符提供默认值 0.15；修复 `scheduler.ts` 中 `cron` 命名空间错误，改用 namespace import。

### 修复
- `src/lib/eveningScan.ts`：在访问 `criteria.maxChannelPosition` 的四处位置（过滤条件、HTML 模板、纯文本模板）添加空值合并运算符 `?? 0.15`，提供默认值以避免 TypeScript 编译错误。
- `src/lib/scheduler.ts`：将 `import cron from "node-cron"` 改为 `import * as cron from "node-cron"`，修复命名空间错误。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error

---

## [0.54.0] - 2026-06-29

> **新增晚间自动股票扫描与邮件报告功能**：集成 Agent Mail CLI，支持每日定时扫描热门股票并自动发送投资建议邮件。系统会筛选符合"上升趋势 + 5日内B信号 + 35%+预期涨幅 + 通道底部15%以内"条件的股票，生成详细分析报告并通过配置的邮箱发送。用户可在设置页面配置发件人（需先在 agent.qq.com 授权）和收件人邮箱，支持手动触发和定时任务两种模式。**配置信息安全存储在 `.data/email-config.json`，不含敏感信息，可安全提交到 GitHub。**

### 新增
- `src/lib/eveningScan.ts`：晚间精选扫描核心逻辑，支持精确过滤条件（上升趋势、B信号时效、预期涨幅、通道位置）；邮件HTML模板生成（含股票详细分析表格）；纯文本摘要生成。
- `src/lib/agentlyMailer.ts`：Agent Mail CLI 邮件发送封装，支持两步确认机制；HTML富文本邮件支持；错误处理和日志记录。
- `src/lib/scheduler.ts`：基于 node-cron 的定时任务调度器；支持手动触发和定时执行；完整的任务状态管理。
- `scripts/evening-scan.ts`：独立执行的晚间扫描脚本，便于测试和手动触发。
- `src/lib/types.ts`：新增 `EmailConfig` 和 `PublicEmailConfig` 接口，用于邮件配置类型定义。
- `src/lib/config.ts`：新增邮件配置加载/保存/公开化函数（`loadEmailConfig`、`saveEmailConfig`、`getPublicEmailConfig`）；支持邮箱地址脱敏显示。
- `src/app/api/settings/email/route.ts`：邮件配置 API 端点，支持 GET（获取公开配置）和 POST（保存配置）。
- `src/app/settings/page.tsx`：设置页面新增"晚间扫描邮件配置"区域；发件人邮箱输入（含 agent.qq.com 注册引导）；收件人邮箱输入；配置保存和状态显示。

### 改进
- 更新 README.md：新增 v0.54.0 亮点说明；晚间自动扫描功能详细使用说明；技术栈补充 Agent Mail CLI 和 node-cron；项目结构新增相关模块。
- 邮件配置安全性：配置存储在 `.data/email-config.json`，已在 `.gitignore` 中排除；API 返回脱敏邮箱地址；前端不显示完整邮箱地址。

### 使用说明
- **手动执行**：`npx tsx scripts/evening-scan.ts`
- **配置步骤**：1. 安装 Agent Mail CLI 并授权；2. 在设置页面配置发件人和收件人邮箱；3. 运行脚本或集成定时任务
- **默认筛选条件**：上升趋势（是）、B信号时效（5个交易日内）、预期涨幅（≥35%）、通道位置（底部15%以内）

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error

---

## [0.53.9] - 2026-06-26

> **`/mining` 新增「下轨支撑」过滤条件——上升趋势中寻找高抛低吸切入点**：此前 `/mining` 只能筛「必须上升通道」，但上升通道里现价可能正贴近上轨（追高风险）。本版叠加「必须下轨支撑」过滤：在**上升通道**基础上，进一步要求**现价贴近回归通道下轨**（纵向位置 ≤ 通道宽该百分比，默认 35%）**且未跌破下轨**，从而锁定「上升趋势 + 当前回踩下轨支撑」的高抛低吸切入点。阈值页面可调。**不改回归通道的任何计算/拟合口径，仅在已有 `technical.trendChannel` 数据上新增一条筛选维度。**

### 新增
- `src/lib/mining.ts`：`MiningResult` 新增 `channelPosition`（现价在回归通道内的纵向位置，0=贴下轨 / 1=贴上轨，由 `(price-下轨)/(上轨-下轨)` 归一化并钳到 [0,1]）；`evaluateMiningSignal()` 计算并回填，满足「上升通道 + 未跌破 + 贴近下轨」时向命中信号追加「下轨支撑」标签。
- `src/lib/mining.ts`：`MiningFilters` 新增 `requireLowerBandSupport`（必须下轨支撑，勾选即隐含必须上升通道）与 `lowerBandPct`（贴近下轨阈值，缺省常量 `DEFAULT_LOWER_BAND_PCT=0.35`）；`RejectReason` 与 `rejectReason()` 新增 `requireLowerBandSupport` 卡掉逻辑（上升通道 + 未跌破下轨 + 纵向位置 ≤ 阈值，任一不满足即卡掉）。
- `src/app/mining/page.tsx`：筛选区新增「必须下轨支撑」勾选框 + 「贴近下轨阈值（% 通道宽）」数字输入（勾选后显示，默认 35）；`buildFilters()` 随请求携带 `requireLowerBandSupport`/`lowerBandPct`；执行计划（plan）/元信息（meta）回显本条件，结束（done）未命中原因映射新增「未贴近下轨支撑」。

### 说明
- 「下轨支撑」与「必须上升通道」可叠加；勾选「必须下轨支撑」时其逻辑已隐含上升通道要求。
- 不改挖掘评分算法、过滤其它口径、缓存与东财限流；仅新增一条可选筛选维度与对应回显。

---

## [0.53.8] - 2026-06-26

> **`/chart` Pro 视图新增「回归通道」图形渲染——与 `/scanner` 展开评估、经典 SVG 同口径**。背景：用户在 `/scanner` 一键扫描热门股池、展开评估时能看到回归通道图形（QuantChart 经典 SVG 渲染），但切到 `/chart` 的 Pro 视图（基于 lightweight-charts 的画布）却没有这条通道。本版把回归通道补到 Pro 画布，**不改任何回归通道的计算/口径/算法**，只新增渲染层。

### 新增
- `src/components/regressionChannelPrimitive.ts`：新建 lightweight-charts v5 自定义 **series primitive**（`RegressionChannelPrimitive`），在 Pro 画布上绘制回归通道——沿最近 N 根 K 线还原上轨/中轨/下轨三条斜线 + 轨间半透明填充带。lightweight-charts 内置的 LineSeries/AreaSeries 无法表达「两条斜线之间的填充带」，故用官方 primitive 接口直接在画布绘制；坐标用 media 空间（`useMediaCoordinateSpace` + `priceToCoordinate` / `timeToCoordinate`），挂在 K 线序列上随平移/缩放自动重绘，zOrder `bottom` 画在蜡烛之下不遮挡。
- `src/components/LightweightChart.tsx`：新增 `trendChannel` 入参与 `showChannel` 开关（默认开启），按当前周期（日/周/月）从 `technical.trendChannel` 还原通道点位并 attach primitive；工具栏新增「回归通道」勾选框（盘中分时或无 `trendChannel` 数据时禁用并给出提示）。
- `src/app/chart/page.tsx`：把诊断管线返回的 `data.quant.technical?.trendChannel` 作为 `trendChannel` 入参传给 `<LightweightChart>`。

### 口径对齐（与经典 SVG / `/scanner` 评估完全一致）
- 上行通道（`type === "up"`）红系：填充 `rgba(239,68,68,0.08)`、上轨 `rgba(239,68,68,0.22)`、下轨 `rgba(239,68,68,0.18)`；其余（down/range）绿系：填充 `rgba(16,185,129,0.08)`、上轨 `rgba(16,185,129,0.18)`、下轨 `rgba(16,185,129,0.22)`。
- 上/下轨虚线 dash `2 3`；中轨更淡点线 dash `1 4`、opacity 0.5、色跟随主题 `--faint`——与 QuantChart SVG 渲染逐一对齐。

### 不改动
- 回归通道的计算/拟合/口径（`technical.trendChannel`：最近 60 日线性回归 + 标准差上下轨）、诊断管线、东财取数与限流均保持原样。本版纯属把已有数据补渲到 Pro 画布。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。

---

## [0.53.7] - 2026-06-26

> **`/scanner` 性能修复：全局 LLM 在途并发闸 + 每行缓存命中指示——稳定批量扫描耗时**。背景：用户在 `/scanner` 批量诊断时观察到单只耗时从 22s 一路恶化到 11.6min、且「越扫越久」。根因有二：① `/api/analyze` 诊断管线缓存未命中时每只要串行跑 5 次大模型调用（主推理 + 自洽投票×2 + Critic 批判 + Judge 裁判），而前端 worker-pool 默认并发 5 只 → 峰值约 **25 个请求同时砸向同一个大模型 API**，此前 `llm.ts` 对模型调用**没有任何并发上限**，全部直接发出 → 模型侧排队/限流让每个调用都变慢、尾延迟滚雪球；② 命中静态层缓存（秒级回放）与未命中（全量管线）耗时本就差 10~20 倍，但 UI 不展示，用户无从判断「为何差异这么大」。本版**不改任何提示词/管线步骤/打分口径**，只加一道全局在途并发闸 + 一个每行缓存指示。

### 新增
- `src/lib/llmGate.ts`：新建**全局大模型在途并发闸**（priority-aware semaphore）。只限制「同时在途的模型调用数」（默认 6，可用 `LLM_MAX_CONCURRENCY` 覆盖，≤0 视为不限），超限时进入等待队列；队列**按优先级出队**（复用 `requestContext.priority`，数值越小越优先），同优先级内 FIFO。把「25 个互相拖慢」收敛为「至多 N 个稳定在途」，单只耗时更稳、更可预测，且单股 `/analyze` 交互请求不会被 `/scanner` 批量（`BULK_PRIORITY`）的几十个调用饿死。对最终诊断结果无任何影响。
- `src/app/scanner/page.tsx`：扫描结果每行新增**缓存命中指示**徽标——「⚡ 缓存命中 Xs」（命中静态层缓存，秒级回放）或「⧗ 全量推理 Xmin」（未命中，跑完整多智能体管线），并附本次实际耗时与悬浮说明，让用户一眼区分「为何这只快/这只慢」。

### 优化
- `src/lib/llm.ts`：`chat()`（含其衍生的 `chatJson()`）与 `chatStream()` 的模型调用统一经 `withLlmSlot()` / `withLlmSlotGenerator()` 取槽位后再发起；流式调用持槽至「流结束 / 抛错 / 消费方提前中断」才释放。**提示词、温度、max_tokens、reasoning 等参数与管线步骤完全不变。**

### 不改动
- 诊断管线步骤（主推理 + 自洽投票×2 + Critic + Judge）、打分口径、缓存策略与 TTL、东财公平限流（`FairScheduler` 单并发 + 间隔抖动）与 `BULK_PRIORITY` 退让逻辑均保持原样。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。

---

## [0.53.6] - 2026-06-26

> **条件可见化 Phase 4（市场数据接口可视化调试台 `/market`）：把 Phase 3 回显的 `params` / `defaults` 接到 UI，做成「页面可见、页面可调」的闭环**。背景：`/api/market/data` 是个纯 API 端点（按 `?type=...` 手动/外部查询），此前**没有任何前端页面消费它**——Phase 3（v0.53.5）虽已让每个响应回显本次「生效口径」（`params`）与「完整默认目录」（`defaults`），但这些回显在 UI 里仍无处可见、无处可调。本版新建轻量调试台 `/market`：选 `type` → 填通用入参 → 一键查询 → 只读回显「本次生效口径」+「完整默认目录」，并把每个可调取数口径（`limit/num/topN/lookBack/pageSize/forwardDays/maxPages/size` 等）做成输入框，改了即拼进 URL 重新查询。**不改任何取数口径/算法/路由，纯属把隐藏参数可视化、可调。**

### 新增
- `src/app/market/page.tsx`：新建「数据接口调试台」页（Client Component）。顶部按分组（行情/K线、财务、信号/资金、龙虎榜、筹码/交易、基本面/研报/新闻）下拉选 `type`（含 25+ 数据类型），按该 type 规格条件渲染通用入参（`code/codes/date/q`）。
- 查询结果分三块只读+可调展示：① **本次生效口径**（读响应 `params`：参数名 / 中文标签 / 本次取值 / 默认值 / 是否来自 URL），每行附输入框，改写后「应用改写并重新查询」即把 `?param=newvalue` 拼进 URL 重查；② **完整默认目录**（挂载时无 `type` 调一次取 `defaults`，一眼看全部可调参数及默认值）；③ **返回数据**（原始 JSON 美化展示，附「复制」按钮）。
- `src/lib/navConfig.ts`：「系统」分组新增「数据接口调试台」入口（`/market`，Database 图标，含命令面板搜索别名）。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。

---

## [0.53.5] - 2026-06-26

> **条件可见化 Phase 3（市场数据统一接口 `/api/market/data`）：把各数据类型「隐藏」的 URL 默认口径回显到响应**。背景：统一数据出口的一大批取数口径——日K `limit=120`、财务三表 `num=8`、行业对比 `topN=20`、龙虎榜 `lookBack=30`、两融 `pageSize=30`、大宗 `20`、股东数 `10`、分红 `20`、解禁 `forwardDays=90`、研报 `maxPages=5`、个股新闻 `20`、全球资讯 `50`、公告 `30`、问财 `size=50` 等——此前全是散落在各分支里的 `?? 字面量`：前端不传、响应不回显、设置页也没有，用户拿到数据后无从得知本次到底取了多少条 / 回看多少天。本版统一提取为具名常量 `DEFAULTS`，并在**每个响应**里回显本次「生效口径」（`params`：值 / 默认值 / 是否来自 URL / 中文标签）；不带 `type` 调用还会回显**完整默认目录**。**口径数值完全不变，纯属可见化。**

### 新增
- `src/app/api/market/data/route.ts`：新增 `makeParamReader()`，统一解析查询参数并记录本次「生效口径」——每个分支套用默认或 URL 覆盖时都登记 `{ value, default, fromUrl, label }`；响应新增 `params` 字段回显，调用方一眼可见本次 `limit/num/topN/lookBack/pageSize/forwardDays/maxPages/size` 等取了多少、是默认还是显式传入。
- `src/app/api/market/data/route.ts`：未知/空 `type` 的帮助响应新增 `defaults` 字段，一次性回显全部数据类型的可调参数默认口径，便于发现并按需用 URL 覆盖。

### 优化
- `src/app/api/market/data/route.ts`：把散落在 14 个分支里的魔法数默认值统一提取为具名常量 `DEFAULTS`（`klineLimit` / `financialsNum` / `industryTopN` / `dragonLookBack` / `marginPageSize` / `blockTradePageSize` / `holderPageSize` / `dividendPageSize` / `lockupForwardDays` / `reportsMaxPages` / `newsPageSize` / `globalNewsPageSize` / `announcementsPageSize` / `iwencaiChannel` / `iwencaiSize` 等）并加注释，各分支统一引用，口径完全不变。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。

> 注：至此「隐藏参数可见化」三期收官——Phase 1（`/mining`）、Phase 2（`/chart`·`/analyze` 诊断）、Phase 3（市场数据统一接口）。

---

## [0.53.4] - 2026-06-26

> **条件可见化 Phase 2（`/chart` · `/analyze` 个股诊断）：把诊断链路里写死/隐藏的执行口径在「拉数据之前」回显到页面**。背景：个股诊断（`/chart` Pro 画布与 `/analyze` 五因子研判）同样藏着一批前端不传、UI 不显示、设置页也没有的服务端默认——近端分析窗口 `DISPLAY_WINDOW = 360`、历史回测上限 `HISTORY_LIMIT`、默认买卖策略 `DEFAULT_STRATEGY_ID`、中性瓶颈分 `NEUTRAL_CHOKEPOINT_SCORE = 70`、自洽投票轮数 `SELF_CONSISTENCY_RUNS`、关联推文 `slice(0, 3)`、基本面静态缓存 TTL 等，用户要等 2~5 分钟出结果后才能（部分）反推本次用了什么口径。本版把这些口径在执行前一次性回显到前端（`/analyze` 流式 `plan` 事件 + `/chart` 图表接口 `diagnostics` 字段），并附「复制参数」便于把上下文 + 问题一起反馈。**不改任何诊断/分析算法、口径阈值、缓存策略与限流速率**——纯属「可见化」，沿用 Phase 1 同款做法。

### 新增
- `src/app/api/analyze/route.ts`：新增 `plan` 事件，在拉取行情数据**之前**最先发出，一次性回显本次个股诊断的全部生效口径：复权口径（`fq` / `fqLabel`）、近端分析窗口（`displayWindow`）、历史回测上限（`historyLimit`）、默认买卖策略源（`defaultStrategyId` / `defaultStrategyLabel`，带策略名 + 版本）、自洽投票轮数（`selfConsistencyRuns`）、关联推文上限（`relatedTweetsLimit`）、评估模型（`model`）、基本面静态缓存 TTL（`cacheTtlMs`）与是否强制刷新（`refresh`）。
- `src/app/api/market/chart-data/route.ts`：响应新增 `diagnostics` 字段，回显图表链路口径：复权口径、图表 K 线根数（`klineLimit` / 实际载入 `loadedBars`）、中性瓶颈分（`neutralScore`）、默认策略源（`defaultStrategyLabel`，并标注是否来自 URL `?strategy=` 指定）。
- `src/app/analyze/page.tsx`：新增「本次诊断执行参数（执行前回显）」只读面板（`DiagnosticPlanCard`），消费 `plan` 事件并在结果区上方常驻展示，附「复制参数」按钮一键导出。
- `src/app/chart/page.tsx`：终端日志面板新增「◆ 本次诊断执行参数」只读回显块（`DiagnosticsPanel`），合并图表链路 `diagnostics` 与 AI 诊断 `plan` 两路口径展示，附「复制」按钮。

### 优化
- `src/app/api/analyze/route.ts`：把诊断链路里写死的魔法数提取为具名常量并加注释——`RELATED_TWEETS_LIMIT = 3`（关联推文展示上限）、`SELF_CONSISTENCY_RUNS`（自洽投票额外轮数，可环境变量覆盖），原 `matchedTweets.slice(0, 3)` 与 `Number(process.env.SELF_CONSISTENCY_RUNS ?? 2)` 改为引用常量，口径完全不变。
- `src/app/api/market/chart-data/route.ts`：把 `360`（图表 K 线根数）与 `70`（中性瓶颈分）提取为具名常量 `CHART_KLINE_LIMIT` / `NEUTRAL_CHOKEPOINT_SCORE` 并加注释，调用处统一引用，口径完全不变。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。

> 注：本版覆盖 `/chart`·`/analyze`（Phase 2）。市场数据接口（龙虎榜/两融/大宗/解禁/研报等）的隐藏 URL 默认参数（Phase 3）将在后续版本落地。

---

## [0.53.3] - 2026-06-26

> **条件可见化 Phase 1（仅 `/mining`）：把藏在服务端的执行参数在「执行前」一次性回显，并把粗筛口径提到页面可调**。背景：此前全市场全量扫描的粗筛口径（`DEFAULT_FULL_PREFILTER = { minAmount: 1e8（≥1 亿成交额）, maxCandidates: 800 }`）纯属服务端兜底默认——前端 payload 不带、UI 不显示、设置页也没有；用户只能在候选池拉完（数分钟后）才在 `meta` 事件里看到部分回显，导致「为什么只扫 800 只」「是不是漏了」无从自查。本版把全部生效条件在点击「开始挖掘」的第一时间（任何耗时拉取之前）推一条 `plan` 事件回显，并将粗筛口径做成表单可调。**不改任何挖掘评分算法、过滤口径、缓存策略与限流速率**——纯属「可见化 + 可配置」。

### 新增
- `src/lib/miningScan.ts`：新增 `plan` 事件（`ScanEvent` 变体），在 `resolveUniverse()` 拉候选池**之前**最先发出，一次性回显本次扫描的全部生效条件：板块范围（`boards` / `excluded`，由设置页「股票池纯净化」决定）、粗筛口径（`prefilter`）、筛选条件（`filters`）、策略源（`strategyId` / `strategyName`）、并发·重试、候选池翻页上限（`maxPages`）。
- `src/lib/miningScan.ts`：新增 `earlyStop` 事件 + `UniverseProgress.onEarlyStop` 回调，候选池阶段触发「提前终止翻页」时显式告知前端（`capReached` 已集齐 top-N / `amountBelowMin` 整页跌破最低成交额），并附「跳过后续约 M 页、零遗漏」说明，消除「是不是漏了」的疑虑。
- `src/lib/miningScan.ts`：导出 `UNIVERSE_PAGE_SIZE = 100`、`UNIVERSE_MAX_PAGES = 80` 常量与 `describeUniverseScope()`（人类可读的板块范围/剔除项描述）。
- `src/app/mining/page.tsx`：表单新增可调粗筛口径——「最低成交额（亿元）」与「取前 N 只（1–8000）」两个输入框（仅 `full`/`broad` 全市场场景显示），随 payload 以 `prefilter` 传给 `/api/mining`，覆盖服务端默认；附口径说明（设最低成交额为 0 即不按成交额过滤）。
- `src/app/mining/page.tsx`：日志面板新增「复制报告」按钮（`copyReport()`），一键复制完整运行报告（含执行前条件、逐页进度、命中/异常、用时）到剪贴板，便于把上下文 + 问题一起反馈。

### 优化
- `src/app/mining/page.tsx`：`consumeStream()` 新增 `plan` / `earlyStop` 事件处理——执行前打印「◆ 执行计划」块（板块范围 / 粗筛口径 / 筛选条件 / 买卖策略 / 并发·重试·翻页上限），提前终止时打印「✓ 已集齐 top-N…跳过后续约 M 页，零遗漏」。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。

> 注：本版仅覆盖 `/mining`（Phase 1）。`/chart`·`/analyze` 诊断隐藏参数（Phase 2）与市场数据接口隐藏参数（Phase 3）将在后续版本逐步落地。

---

## [0.53.2] - 2026-06-26

> **韧性补丁：修复非交易时段候选池拉取「单页瞬时故障即整轮 `✗ fetch failed`」**。现象：非交易时段点「开始挖掘」，第 1 页正常（已 100 只）后立即整轮失败。根因：非交易时段 push2 系接口 host 兜底顺序为 `[push2delay, push2primary]`——`push2delay`（实测全球可达）排首位，`push2.eastmoney.com` 主站排末位且境外/数据中心 IP 固定返回 502。但 `push2Json` 的「快速失败」预算**按位置**分配（非末位仅 2.5s 超时 + 0 重试，末位才给完整 15s + 1 重试），恰好把**唯一可用的 `push2delay` 当成快速失败**、把**只会 502 的主站当成完整预算**。于是 `push2delay` 一遇瞬时抖动（>2.5s 或偶发断连）就立刻跌穿到必 502 的主站 → 单页失败 → 1~4 分钟整轮扫描全挂。**不改任何限流速率与并发（仍单并发 + 最小 1s 间隔 + 抖动，零额外封 IP 风险）**。

### 修复
- `src/lib/sources/http.ts`：`push2Json()` 的「快速失败」（短超时 + 不重试，尽快降级）改为**仅对实时探针主站 `push2.eastmoney.com` 且其非末位时**生效；`push2delay.eastmoney.com` 无论排第几都给完整超时 + 重试预算。修正了非交易时段唯一可用 host 被快速失败、瞬时抖动即跌穿到必 502 主站的问题。
- `src/lib/miningScan.ts`：新增 `fetchUniversePage()`，候选池逐页拉取内置**限流内至多 3 次重试**（退避 800ms→1600ms，仍走 emScheduler 单并发限流，零额外封 IP 风险），自愈单页瞬时故障；3 次仍失败才抛出（错误信息含页号，便于定位），不再因任一页抖动让整轮多分钟扫描直接挂掉。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。
- 隧道实测（非交易时段复现场景）：连续拉取候选池前 3 页（含此前失败的第 2 页）均成功返回、无整轮中断，请求速率与限流不变。

> 注：本补丁纯属「韧性/重试」修复，不改挖掘评分算法、过滤口径、缓存策略与限流速率。

---

## [0.53.1] - 2026-06-26

> **算法补丁：候选池拉取「提前终止」提速**。在**完全不提高并发、不改限流速率**（仍单并发 + 最小 1s 间隔 + 抖动，零额外封 IP 风险）的前提下，仅靠算法把全市场候选池拉取从 ~50 页降到个位数页。核心依据：东财 `clist` 按成交额（`fid=f6, po=1`）**严格倒序**返回，配置了 `maxCandidates`（两段漏斗第 1 段粗筛上限，默认 800）时，一旦集齐 top-N 个「过板块过滤 + 过 min-* 阈值」的候选，后续页成交额只会更低、绝不可能再进入结果，故可安全停止翻页。实测可把那段 ~4 分钟基础耗时压到约 1 分钟内（首次未命中缓存时；TTL 内仍为秒级复用）。

### 优化
- `src/lib/miningScan.ts`：`fetchFullUniverse()` 新增 `pf?: Prefilter | null` 入参与「提前终止」逻辑——逐页累计「过 `isAllowed` 板块过滤 + 过 `minAmount/minTurnover/minVolumeRatio` 阈值」的去重候选数，满足以下任一即停：① 已集齐 `maxCandidates` 只；② 整页末行成交额 < `minAmount`（该页之后全部更低）。仅在配置了 `maxCandidates` 上限时启用；**无粗筛口径（`pf` 为空，如「生成今日股票池」全量覆盖）时不提前终止**，仍拉完整全市场。
- `src/lib/miningScan.ts`：`runMiningScan()` 调整为「拉取候选池前」先算好粗筛口径 `pf`，并经 `resolveUniverse()` → `resolveUniverseRaw()` 透传至 `fetchFullUniverse()`，使提前终止可用到 `maxCandidates`。新增 `prefilterSig()` 生成粗筛签名。
- `src/lib/universeCache.ts`：`UniverseSnapshot` 新增 `complete?`（是否完整拉完全市场）与 `prefilterSig?`（粗筛签名）。**完整快照**（翻到末页）可服务任意粗筛口径；**部分快照**（提前终止得到）仅当粗筛签名一致时可复用（其前缀恰为该口径所需 top-N），避免不同口径互相挤兑缓存或误用截断结果。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）。
- 隧道实测：配置 `maxCandidates=800` 时，`fetchFullUniverse` 在集齐 top-800 后于个位数页停止翻页（不再拉满 ~50 页），请求速率与限流不变。

> 注：本补丁不改任何挖掘评分算法、过滤口径或限流速率，纯属「少翻无意义的页」。

---

## [0.53.0] - 2026-06-26

> **挖掘提速 + 可观测 + 策略对齐**：解决「每次『开始挖掘』都要逐页重拉 ~5000 只全市场候选池（约 4 分钟基础耗时）、0 命中却看不出被哪条筛选卡掉、挖掘的 B 信号写死 v1 而非跟随全局所选策略」三个痛点。三项改动协同：候选池快照按时段自适应缓存（TTL 内秒级复用免去重拉）、扫描全程回显完整筛选/粗筛条件并在结束打印「未命中原因分布」、「B 买入信号」改为跟随 `/chart` 全局所选策略（默认 Cardwell RSI Trade Navigator 趋势延续版 V2）。**不改挖掘评分算法与过滤口径本身，仅加缓存/日志/策略来源。**

### 新增
- `src/lib/universeCache.ts`：全市场候选池快照缓存（内存为主 + `data/universe_cache.json` 落盘兜底、原子写）。按 Asia/Shanghai 时段自适应 TTL：**盘中 5 分钟**（实时字段时效高）/ **午间休市 30 分钟** / **盘后·盘前·夜间凌晨 6 小时** / **周末 12 小时**。缓存键为板块段标识（随「股票池纯净化」配置变化即自动失效）。
- 挖掘「B 买入信号」策略对齐：`/api/mining` 新增可选 `strategyId` 入参，前端 `/mining` 随请求携带全局所选策略（与 `/chart`、`/backtest/strategy` 共用 `serenity.chart.proStrategyId` 偏好），并新增策略下拉可即时切换；缺省/未知 id 回退内置「瓶颈动量 v1」。

### 优化
- `src/lib/miningScan.ts`：`fetchFullUniverse()` 先查候选池快照缓存，命中则免去逐页串行重拉（节省约数分钟基础耗时），未命中才逐页拉取并回写缓存；新增 `onCacheHit` 进度回调，前端显示「⚡ 复用候选池快照：N 只 · 缓存龄 X 分钟 · 时段 …（TTL …）」。
- `src/lib/miningScan.ts`：`meta` 事件回显完整筛选条件（最低复合分/最低预期收益/必须上升通道/必须 B 信号/B 新鲜度）+ 粗筛阈值（成交额/换手/量比/取前 N）+ 策略名；`done` 事件新增 `reasons` 未命中原因分布。
- `src/lib/mining.ts`：新增 `rejectReason()` 返回「首个未通过的筛选项」，`passesFilters()` 改为委托它（严格同序、DRY），用于统计「预期收益卡掉 X / B 新鲜度卡掉 Y / 取数失败 Z」。
- `src/app/mining/page.tsx`：`consumeStream` 解析并打印筛选/粗筛回显与「未命中原因分布」，0 命中时即可定位是被哪条筛选卡掉。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项既有 warning 不变）· `next build` 通过。

> 注：`/api/mining/daily`「生成今日股票池」仍沿用固定口径（不随所选策略变化）；本次仅其候选池拉取阶段一并享受快照缓存提速。

---

## [0.52.1] - 2026-06-26

> **修复：`/mining`「开始挖掘」全市场全量扫描点击后长时间无反馈（看起来「点了不动」、右侧日志与已扫描数都不动）**。根因：`/api/mining` 候选池解析阶段（`fetchFullUniverse` 逐页串行限流拉取全市场数十页）在拉取完成前不发任何事件，且前端 `startScan()` 点击后无即时日志（与 `generateDaily()` 不同），形成「双重静默」。

### 修复
- `src/app/mining/page.tsx`：`startScan()` 点击后立即输出「▶ 开始挖掘：正拉取候选池…」日志（全量场景额外提示「逐页串行限流拉取、约数分钟、下方持续显示进度」），与「生成今日股票池」对齐。
- `src/lib/miningScan.ts`：`fetchFullUniverse()` / `resolveUniverse()` 新增逐页进度回调，`runMiningScan` 在候选池解析阶段每翻一页向客户端推送 `{ type: "universe", loaded, pages }` 事件。
- `src/app/mining/page.tsx`：`consumeStream` 新增 `universe` 事件处理，持续打印「拉取候选池中：已 N 只（第 M 页）」，使候选池拉取阶段有可见进度，消除「点了不动」观感。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint`（改动件）0 error（21 项既有 warning 不变）。
- 隧道实测 `/api/mining`（universe=full）：点击后即时流式输出 `universe` 进度事件（第 1→7 页持续递增），不再长时间静默。

---

## [0.52.0] - 2026-06-26

> **性能架构：东财请求公平调度器（`FairScheduler`）替代全局 FIFO 链**。修复「一个标签页跑 `/scanner` 批量诊断时，另一个标签页在 `/mining` 点『生成今日股票池』点了不动」的并发争用问题。根因：全进程所有东财请求都串在唯一一条全局 FIFO Promise 链（单并发 + 最小间隔 1s 防封 IP）上，批量任务把链占满后交互任务被饿死（队头阻塞 / starvation）。本方案在**完全保持对东财实际速率不变**（不增封 IP 风险）的前提下，仅改「出队顺序」：优先级分层 + 同层泳道 round-robin，让低频高优的交互请求抢先、批量任务之间公平轮转。**不改任何业务计算口径、零新增运行时依赖。**

### 新增
- `src/lib/sources/emScheduler.ts`：新增 `FairScheduler`——优先级分层（交互 3 / 普通 5 / 批量 7，数值小者整体抢先）+ 同优先级内泳道 round-robin（批量任务互不独占）；精确保持原始节流（单并发 + `EM_MIN_INTERVAL_MS` 最小间隔 + 100~500ms 抖动）。
- `src/lib/requestContext.ts`：基于 `AsyncLocalStorage` 的请求上下文，跨 await 透传 `{ lane, priority }` 到深层 `emFetch`，业务逻辑零改动；导出 `withRequestContext` / `currentRequestContext` 与 `INTERACTIVE_PRIORITY(3)` / `NORMAL_PRIORITY(5)` / `BULK_PRIORITY(7)`。
- `docs/perf-concurrency-analysis.md`：完整根因分析、方案选型、实现与验证文档（含修正后的东财请求精确口径：单只 `/api/analyze` 走东财 0~3 次，真实洪峰来自 `/api/sync` 批量 + 失败级联，而非「每只 analyze 10+ 请求」）。
- `scripts/verify-scheduler.ts`：调度器自检脚本（节流间隔、交互抢先、泳道公平轮转三项断言）。

### 优化
- `src/lib/sources/http.ts`：`emFetch` 由全局 FIFO `emChain` 改为经 `FairScheduler.enqueue(run, lane, priority)` 出队；新增 `emSchedulerStats()`。
- 路由泳道/优先级标注：`POST /api/mining/daily`→`mining-daily`(交互 3)、`POST /api/mining`→`mining`(普通 5)、`POST /api/analyze`→`analyze:${code}`(批量 7，每只一条泳道)、`POST /api/sync`→`sync`(批量 7)。
- `src/app/api/mining/daily/route.ts` 新增即时 `accepted` 事件 + `src/app/mining/page.tsx` 对应日志反馈，点击「生成今日股票池」后立刻提示「已受理」，消除「点了不动」的观感。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint`（改动文件）0 error。
- 调度器自检：节流间隔 ✓ / 交互抢先 ✓ / 泳道公平轮转 ✓ 全部通过。

---

## [0.51.0] - 2026-06-25

> **新增策略：Cardwell RSI Trade Navigator 趋势延续版 V2，并设为买卖引擎偏好默认**。针对 V1「强趋势被跟踪止损洗出后再也回不来」的痛点——V1 唯一入场钥匙是 RSI(14) 全新上穿中线 50，被 1.5×ATR 跟踪止损打出来时 RSI 常仍在多头区(>50)，要再入场必须 RSI 先跌回 ≤50 再上穿；可主升浪里 RSI 长期 >50，钥匙永远插不上，于是空仓走完整段拉升（600522 实测：2026-05-27 止损离场后整段主升浪再无 B）。V2「只增不改」：完整保留 V1 入场 / 离场 / 止损口径，额外增加一条**趋势延续再入场**通道，把主升浪里的「柱子翻红 / KDJ 金叉」显式纳为补充买点。**V1 保持不变；后端默认策略不变（仍 `chokepoint-momentum-v7`），仅前端买卖引擎偏好默认由 Cardwell V1 升级为 V2。**

### 新增
- `src/lib/tvStrategies.ts`：新增 `tv-cardwell-rsi-navigator-v2`（compute 复用 V1 图层、backtest 为 `runTvCardwellRsiNavigatorV2`）。
  - **趋势延续再入场**：空仓且趋势未破（收盘 ≥ MA20、RSI(14) > 50 且较前一根上行）时，**KDJ 金叉（K 上穿 D）或 MACD 柱由负转正翻红**即顺势重新建仓，无需等 RSI 先跌破 50 再上穿；量能放大（量 ≥ 1.2×量MA5）作附注。
  - 入场 / 离场 / 止损口径与 V1 完全一致（RSI 上穿 50 入场、下穿 50 离场、1.5×ATR 自适应跟踪止损）。纯多头、单仓、含双边手续费。
- `src/lib/strategies.ts`：在买卖引擎注册表登记 `tv-cardwell-rsi-navigator-v2`，供 /chart 买卖引擎与 /backtest/strategy 选用。

### 优化
- `src/lib/strategyPref.ts`：全站买卖引擎偏好默认 `PREFERRED_PRO_STRATEGY_ID` 由 `tv-cardwell-rsi-navigator-v1` 升级为 `tv-cardwell-rsi-navigator-v2`。优先级不变：深链 `?strategy=` > 上次保存 > 偏好默认(V2) > 后端默认 > 列表首个；用户上次显式选择仍优先于新默认。

### 实测（600522，T+1 open 口径）
- V1：24 笔 · 胜率 41.7% · 策略收益 +32.1% · Sharpe 0.92。
- V2：35 笔 · 胜率 52.9% · 策略收益 **+190.6%** · Sharpe 2.11。V2 在 2026-05-27 止损后于 2026-06-03 @43.89「趋势延续再入场」补回 B，全程多抓 6 个再入场点。
- 诚实口径：再入场是趋势跟随式延续确认而非抄底，会增加交易笔数；震荡市可能多出几笔由跟踪止损兜底的小亏损（本例 600522 为强趋势票故提升显著，不代表所有标的）。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint`（改动文件）0 error。

---

## [0.50.1] - 2026-06-25

> **B/S 与看多 / 看空共振信号配色校正为 A 股市场惯例（红涨绿跌）**。v0.50.0 的买卖标记与共振标记沿用了美股 / 全球惯例（涨绿跌红），与 A 股大陆市场「红涨绿跌」相反；本补丁将所有**方向性信号**统一为 **红 = 上涨 / 看多 / 买入，绿 = 下跌 / 看空 / 卖出**（中性 / 分歧仍为灰），两套图表引擎（Pro 画布 / 经典 SVG）与 BS 理由标签全部对齐。**纯配色调整，不改任何信号判定逻辑、阈值或计算口径。**

### 修复
- `src/components/LightweightChart.tsx`（Pro 画布）：
  - 共振语义色翻转——`RESO_BULL` `#10b981`(绿) → `#ef4444`(红)、`RESO_BEAR` `#ef4444`(红) → `#10b981`(绿)，`RESO_NEUTRAL` 灰不变；遵循 A 股「红涨绿跌」。
  - 主图 B/S 标记着色由「买绿卖红」翻转为「买红卖绿」（`buy → UP(红) / sell → DOWN(绿)`）。
  - 工具栏「共振」开关 tooltip 同步为「▲看多(红) / ▼看空(绿) / ◆多空分歧(灰)」。
- `src/components/tradeReasonsPrimitive.ts`（Pro 画布常驻理由层）：`BUY_COLOR` 翻转为 `#ef4444`(红)、`SELL_COLOR` 翻转为 `#10b981`(绿)。
- `src/components/QuantChart.tsx`（经典 SVG）：B/S 标记点 / 标签 / 悬浮卡片 / 图例文案由「买绿卖红」翻转为「买红卖绿」；走势预测「乐观路径(Bull)」改红、「悲观路径(Bear)」改绿，与「红涨绿跌」一致。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 改动文件 0 error · 盈亏数字配色（盈红亏绿）与 K 线蜡烛（阳红阴绿）未变。

---

## [0.50.0] - 2026-06-25

> **/chart 共振标记按「好 / 坏 / 中性」三色区分 + BS 理由标签远离 K 线避免遮挡**。在 v0.49.4「BS 点常驻理由标签」基础上做两项可读性增强：① 共振标记不再统一紫粉色 + 「共振」二字，改用**语义色 + 形状**表意——看多绿 ▲ / 看空红 ▼ / 多空分歧灰 ◆，一眼区分信号好坏，悬停读数条给出命中指标明细；② BS 理由标签上下推离 K 线高低点，不再压盖 MA 均线与其它指标线。**纯前端标注调整，零新依赖、不改共振判定阈值与任何计算口径。**

### 优化
- `src/lib/indicators.ts`（共振判定）：
  - `ResonancePoint.dir` 由二值 `bull | bear` 扩展为三值 `bull | bear | neutral`；当看多 / 看空两侧命中指标数**同时** ≥ `minScore` 时记为 `neutral`（多空分歧，信号相互打架）。
  - 中性时 `score` 取多空两侧较大者，`reasons` 拆为「看多 …」「看空 …」两组，供悬停依据展示；判定阈值与既有触发条件不变。
- `src/components/LightweightChart.tsx`（Pro 画布）：
  - 新增语义色 `RESO_BULL` / `RESO_BEAR` / `RESO_NEUTRAL`(#94a3b8 灰)，`resoColor()` / `resoGlyph()` / `resoLegend()` 将方向映射到颜色、形状（▲▼◆）与读数说明。（注：本版按美股惯例上色看多绿 / 看空红，已在 v0.50.1 校正为 A 股惯例看多红 / 看空绿。）
  - 主图共振标记文案由 `共振▲×N` 精简为 `▲×N`（去掉「共振」二字，颜色 + 形状即表意）；颜色随方向着色。读数条共振说明按方向显示「看多共振 / 看空共振 / 多空分歧」并用对应色点标识。
  - 工具栏「共振」开关图标改为 `▲◆▼` 三色三形态，tooltip 说明「▲看多(绿) / ▼看空(红) / ◆多空分歧(灰)」。
- `src/components/tradeReasonsPrimitive.ts`（Pro 画布常驻理由层）：
  - `ANCHOR_GAP` 由 26px 增至 46px，标签整体向 K 线高低点外侧推离，避免压盖 MA 均线及副图指标线。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 改动文件 0 error（21 项 pre-existing warning，均不在本次改动文件）· `build` 27/27。**零新依赖、不改任何既有计算口径与共振判定阈值。**

---

## [0.49.4] - 2026-06-25

> **/chart 买卖 BS 点旁常驻显示「触发理由」标签**。此前买卖标记只显示 `B`/`S`（及分批仓位），触发理由仅在悬浮提示卡或下方「交易明细」里可见，且 Pro 画布的标记文字在点位密集时会被库自动丢弃；现在每个 BS 点旁直接常驻一枚小标签，显示该笔交易的**触发理由（策略简称）+ 卖点本笔盈亏**，看图即知买卖逻辑。两套图表引擎（Pro 画布 / 经典 SVG）均已支持，并各自带「BS理由」开关，点位密集时可一键关闭以减少遮挡。**纯前端标注调整，零新依赖、不改任何业务逻辑与计算口径。**

### 新增
- `src/components/tradeReasonsPrimitive.ts`（**新增**，Pro 画布 / 默认引擎）：
  - 新增 lightweight-charts v5 自定义 series primitive `TradeReasonsPrimitive`，在画布上为每个买卖点常驻绘制理由标签——买点画在 K 线下方、卖点画在上方，内容 = 策略简称 +（卖点）本笔盈亏，背景半透明深色框 + 买绿/卖红描边。
  - 坐标用 media 空间，随平移/缩放实时换算重排；买/卖各一条 lane 自左向右贪心**横向避让**，互相重叠的标签跳过，避免长周期密集成交时糊成一片。
- `src/components/LightweightChart.tsx`（Pro 画布）：
  - 把 `TradeReasonsPrimitive` attach 到蜡烛序列，数据由 `trades` 派生（买点锚当根最低价、卖点锚最高价）；新增 `showTradeReasons` 状态（默认开启）与工具栏「BS理由」开关（紧邻「共振」）。
  - 库自带买卖标记文案精简为 `B`/`S` + 分批仓位（建仓/减仓/清仓 X%），触发理由改由常驻标注层呈现，避免与标记文字重复、减少拥挤。
- `src/components/QuantChart.tsx`（经典 SVG）：
  - 新增 `tradeReasonTag()` 工具：优先取理由文案 `【…】` 内的策略名作极简标签，无括号时截取首段（≤10 字省略号收尾）。
  - 主图买卖标记 `tradePoints` 渲染处，在 `B`/`S` 文字之外追加一枚自适应宽度的常驻理由标签：买点置于圆点下方、卖点置于上方；卖点附带本笔盈亏（红绿着色），背景半透明深色框 + 买绿/卖红描边，`pointer-events-none` 不干扰悬浮。
  - 标签宽度按「中文按字号、ASCII 按 0.62 字号」粗算自适应，并对 `x` 做左右边界夹取，避免溢出绘图区。
  - 新增 `showTradeReasons` 状态（默认开启）与工具栏「BS理由」复选框（紧邻「回归通道」）；关闭后隐藏全部常驻理由标签。
  - 更新标记图例说明：新增一条说明常驻理由标签的来源与开关位置。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 改动文件 0 error（21 项 pre-existing warning，均不在本次改动文件）。**零新依赖、不改任何既有计算口径。**

---

## [0.49.3] - 2026-06-25

> **/map 产业链图谱破版修复 + ⌘K 命令面板式样优化**。修复思维导图卡片中「瓶颈点」徽章被挤成竖排、与脉冲点重叠的破版与 BOM 占比标签折断问题，个股「· 图」文字入口换成蜡烛图 K 线图标；命令面板列表改为内缩圆角高亮 + 图标容器化，观感对齐主流命令面板。**纯前端样式 / 标记调整，零新依赖、不改任何业务逻辑与计算口径。**

### /map 修复
- `src/app/map/page.tsx`：
  - 思维导图环节卡头部由 `flex items-center` 改 `flex items-start justify-between`，标题 `min-w-0` 顶对齐自然换行；「瓶颈点」徽章加 `shrink-0 whitespace-nowrap` 保持单行，不再被挤成竖排「瓶颈\n点」。
  - 删除独立的右上 `absolute` 脉冲点，将脉冲小圆点**内联合并进徽章**，消除徽章与脉冲点重叠。
  - BOM 占比行改 `items-start` 顶对齐，标签「BOM占比」加 `shrink-0 whitespace-nowrap` 不再被拦腰折断，长占比文案整体优雅换行。
  - 新增内联蜡烛图图标组件 `ChartGlyph`，把个股链接里的「`{code} · 图`」文字入口替换为 **K 线图标**（`/chart` 直达，带 `title`/`aria-label`），思维导图 + 卡片列表两视图同步。

### ⌘K 命令面板优化
- `src/components/shell/CommandPalette.tsx`：列表容器加 `px-2`，每行改 `rounded-[var(--radius-md)] px-2.5 py-2` 内缩圆角高亮（不再通栏贴边）；图标包进 `h-8 w-8` 带边框/底色方形容器，选中态用 `accent-line` 描边 + `accent-soft` 软底；分节标题留白对齐。

### 质量门禁
- `npm run lint` 0 error（21 项 pre-existing warning，均不在本次改动文件）· `tsc --noEmit` 0 error · `next build` 通过 27/27 页；dev 实测 /map 思维导图徽章单行不重叠、BOM 行不折断、个股 K 线图标可点直达 `/chart`，⌘K 面板内缩高亮 + 图标容器化生效（最近访问 / 页面 / 个股直达三态）。**零新依赖、不改任何既有计算口径。**

---

## [0.49.2] - 2026-06-25

> **下线「📡 TradingView 热门策略（参考）」发现板块**。v0.49.0 引入的该板块只能抓取 TradingView 脚本列表的**公开元数据**作外链引用——这些社区策略**无法在本项目内直接使用**（闭源拿不到源码 / 无可靠 Pine→TS 转译），仅提供外链跳转，价值有限，故按用户要求整体移除。**真正可用的复刻库 `tvStrategies.ts`（GBB / Cardwell / KAMA 策略）完全不受影响**，照旧运行。

### 移除内容
- 删除发现抓取解析库 `src/lib/tvScripts.ts` 与读取接口 `src/app/api/tv-scripts/route.ts`（整个路由目录）。
- `src/lib/sync.ts`：移除 `tvStrategies` 同步源（`SyncSourceId` 联合类型项 + `SYNC_SOURCES` 配置 + `syncTvStrategies()` 运行器 + `RUNNERS`/`readCount`/`FILE_BY_ID` 接入 + `tvScripts` 导入）。
- `src/app/strategies/page.tsx`：删除 `TvStrategiesSection` 组件、`TvScriptRef`/`TvStrategiesData` 接口、`TV_ACCESS_STYLE` 常量及其页面挂载。
- `src/app/sync/page.tsx`：数据同步中心副标题去掉「TradingView 热门策略（参考）」，对应行随同步源移除而自动消失（剩 5 个源）。

### 不受影响
- 复刻策略 `tv-supertrend-adaptive-v1`（GBB）/ `tv-cardwell-rsi-navigator-v1` / `tv-kama-momentum-v1`（KAMA）均在 `tvStrategies.ts`，照旧接入 `/analyze`、`/backtest/strategy`、`/chart` 策略图层、UI 下拉。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 改动文件 0 error · `next build` 通过 27/27 页；dev 实测 `/strategies` 已无该板块、`/sync` 仅剩 5 源、`GET /api/tv-scripts` 返回 404。**零新依赖、不改任何既有计算口径。**

---

## [0.49.1] - 2026-06-25

> **复刻 TradingView 开源策略：Kaufman Moving Average Adaptive Strategy [MKB]**。继 v0.49.0 的「发现同步」之后，走既有「逐个、具名、原作链接 + 差异说明、人工 + 回测双校验」路线，复刻 muratkbesiroglu(MKB) 的开源脚本 **KAMA Momentum Strategy**（`qgTc4zie`）。登记进策略注册表后**自动接入** `/analyze`、`/backtest/strategy`、`/chart` 策略图层、UI 下拉，无需改 UI。**零新依赖、不改任何既有计算口径。**

### 原作逻辑（开源可见）
- **KAMA（Kaufman 自适应均线）**：用效率比 ER（|净变动|/Σ|逐根变动|，近 21 根）在快(2)/慢(30) 两个 EMA 平滑常数间插值——趋势强时贴快线灵敏跟随、震荡时贴慢线迟钝抗洗。
- **入场**：收盘上穿「KAMA + 0.5×标准差(20)」上带（用波动率带抬高门槛、过滤震荡市里 KAMA 附近的弱信号与噪声）。
- **出场**：收盘跌破 KAMA，纪律化离场，以 KAMA 作主趋势参考。
- 纯多头、单仓位、不加仓；建议参数 KAMA 长度 21 / 标准差长度 20 / 倍数 0.5（默认采用）。

### 实现（`src/lib/tvStrategies.ts`）
- 新增 `kaufmanAMA(closes, erPeriod, fast, slow)`（KAMA 序列，复用既有 `efficiencyRatio`）+ `rollingStdev`（总体标准差，对齐 Pine `ta.stdev` 默认）。
- `computeKamaMomentum()` 产出 `TvStrategyLayers`：KAMA 跟踪线 / 多空方向（持仓态状态机）/ 翻多(上穿上带)·翻空(跌破KAMA) 点 / regime（按 ER 分趋势·震荡）/ regimeValue(ER)。
- `runTvKamaMomentumV1()` 纯多头可回测包装：翻多入场 / 跌破 KAMA 离场，含双边手续费；**忠实原版不另叠加 ATR 止损**（`atrMult=0`，出场只认跌破 KAMA）。
- 登记进 `TV_STRATEGIES` + `strategies.ts` 的 `STRATEGIES[]`（id `tv-kama-momentum-v1`、具名 muratkbesiroglu、原作链接、诚实差异说明）。

### 诚实口径（差异说明）
- Pine 内 KAMA 的「首根种子值」实现细节不公开，本复刻在首个可算根用前一根收盘播种（差异数根内收敛）。
- 标准差用总体口径（除以 N）对齐 Pine `ta.stdev` 默认 `biased=true`。
- 原作面向加密日线，A 股主板日线同样适用；入场带=动量确认而非择时预测，震荡市仍会有「突破后跌回 KAMA」的小亏损。**实测在小样本(300750+000001)上胜率 22.6% 未跑赢买入持有(+78%)，证明引擎诚实标注 `z=-3.05, p=0.0023` 不显著**——价值在过滤弱信号、吃干净单边动量，符合原作「趋势跟随动量过滤器」定位。

### 顺带修复
- `recommendationBacktest.ts` 的 `shortExitReason` 新增 `KAMA` 离场标签分支（置于 `自适应` 关键词前），避免本策略「跌破 Kaufman 自适应均线」的离场原因被误归类为「ATR自适应跟踪止盈」。纯标签展示、不改任何回测计算。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 改动文件 0 error · `next build` 通过 27/27 页；合成数据断言 + 真实 A 股数据（300750/000001）跨股票跑通 + dev 浏览器实测（/chart 策略图层叠加 + /backtest/strategy 证明引擎）+ 标注录屏。**零新依赖、不改任何既有回测/套利/打分/复权计算口径。**

---

## [0.49.0] - 2026-06-25

> **TradingView 热门策略发现同步（合规·元数据·参考）**。在「策略市场 `/strategies`」新增 **「TradingView 热门策略（参考）」** 区，一键同步 `https://cn.tradingview.com/scripts/?script_type=strategies` **第一页热门**策略的**公开元数据**，建立「值得复刻」清单。**只抓公开元信息、不抓脚本源码、不绕付费墙、保留原作者署名 + 回链**；版权归 TradingView 与各原作者。**零新依赖、不改任何计算口径**。

### 合规与范围
- **只做发现 + 展示，不做自动复刻**：社区脚本自动复刻按字面不可行——版权（大量 invite-only/protected 闭源拿不到源码）、技术（无可靠通用 Pine→TS 转译）、规模（数万脚本且每日新增）三道硬墙。本版仅抓**公开元数据**作外链参考，复刻仍走既有「逐个、具名、原作链接 + 差异说明、人工 + `/backtest/strategy` 回测双校验」路线，不自动登记进 `STRATEGIES`。
- **合规边界**：仅作外链参考与署名跳转，**不在本站复刻或宣称等价**；每张卡片点击直达原 TradingView 脚本页（`target="_blank"`）。

### 抓取解析库（`src/lib/tvScripts.ts`，新增）
- `fetchTopTvStrategies()` 抓列表页（20s 超时 + 浏览器 UA），`parseTvScriptsHtml()` 解析服务端直出的内嵌 JSON（`"ideas":{"data":{"items":[...]}}`，括号平衡子串提取、尊重字符串字面量转义）。
- 每条 `TvScriptRef` 提取：名称 / 作者(+主页) / 链接 / 点赞 / 评论 / 访问级别（`mapAccess` 把数字 1/2/3 → 开源·受保护·邀请制）/ 缩略图 / 标的 / Pine 版本 / 创建·更新时间 / 摘要（`toExcerpt` 扁平化 markdown，≤180 字）。
- 落盘 `.data/tv-strategies.json`（`TvStrategiesFile`：source/version/syncedAt/count/list）。

### 接入数据同步框架（`src/lib/sync.ts`）
- 新增 `tvStrategies` 源（`SYNC_SOURCES` 项 + `syncTvStrategies()` 运行器 + `RUNNERS`/`readCount`/`FILE_BY_ID` 接入）：版本化 + 快照（保留 5 份）+ **防缩水校验**（返回 <5 条、或有效 URL 占比 <80%、或 `guardShrink` minRatio 0.5 触发即拒绝写入），哈希仅取稳定子集（`id+updatedAt+likes`）判变更。
- `/sync` 数据同步中心新增一行「TradingView 热门策略（参考）」，支持「单独同步」/「依次同步全部」。
- 读取接口 `GET /api/tv-scripts`（`src/app/api/tv-scripts/route.ts`，新增）：未同步时返回空壳。

### UI（`src/app/strategies/page.tsx`）
- 新增 `TvStrategiesSection`：进站拉 `/api/tv-scripts`；卡片网格（桌面 3 列 → 平板 2 列 → 手机 1 列），每卡缩略图 + 名称 + 访问徽章（开源绿 / 受保护琥珀 / 邀请制灰）+ 摘要 + 作者 / 点赞 / 评论 / Pine 版本 / 标的；「同步第一页热门」按钮触发 `POST /api/sync { source:"tvStrategies" }`，展示版本 / 同步时间 / 条数；加载骨架 + 空态。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 改动文件 0 error · `next build` 通过 27/27 页；dev 实测同步（24 条）/ 读取 / UI 展示 + 数据同步中心 + 录屏。**零新依赖、不改任何回测/套利/打分/复权计算口径。**

---

## [0.48.4] - 2026-06-25

> **v0.48 产品化改版 · 第五阶段（收官）：全站页头统一 + 视觉收尾 + a11y**。把全站 18 个页面各自手写的 `<h1>+副标题` 页头收敛到统一的 `PageHeader` 组件（语义化 `<header>`），观感与间距一致、复用 v0.48 设计 token。**不动任何页面内业务逻辑与计算口径、零新依赖**。

### 全站页头统一（`PageHeader`，按导航分组分批落地）
- **发现组**：`/methodology`、`/scanner`、`/sectors`、`/map`、`/mining`。其中 `/scanner`、`/sectors` 由旧「mono 终端式」页头换为统一 `PageHeader`，条件标题（自定股票池模式）与副标题保留为表达式。
- **分析组**：`/analyze`、`/compare`、`/momentum`（`/compare`、`/momentum` 富文本副标题以 JSX 保留 `<strong>`，子标签行保留在页头上方）。
- **策略与回测组**：`/strategies`、`/backtest`、`/backtest/strategy`、`/backtest/pairs`、`/arb`（页头动作按钮走 `actions` 槽位；带标签行的页用 `className="mb-0"` 避免重复外边距）。
- **交易与监控组**：`/watchlist`、`/paper`、`/alerts`（`/watchlist` 标签行保留在页头上方；`/paper` 双动作按钮入 `actions`）。
- **系统组**：`/sync`、`/settings`（`/sync` 的「依次同步全部」按钮入 `actions`）。
- **有意豁免**：首页 `/`（v0.48.3 已审定的仪表盘 Hero，本身已用 token）与 `/chart`（`fixed inset-0` 全屏交易终端，自带顶栏）保留各自结构。

### a11y / 视觉
- 键盘 `Tab` 经 `:focus-visible` 全局焦点环可见（实测 preset 按钮出现 accent 焦点环）；页头统一为语义化 `<header><h1>`。
- 暗 / 亮双模对比度抽检正常；圆角 / 间距 / 阴影继续走 v0.48 token。

### 质量门禁
- `tsc --noEmit` 0 error · `eslint` 0 error（21 项历史 warning 不计）· `next build` 通过（27/27 页）。
- 全站点回归实测（录屏 + 标注）：发现 / 分析 / 策略 / 交易 / 系统 五大分组逐页核验页头统一、面包屑、标签行、动作按钮、表格 / 热力图等业务区完好，暗色模式与键盘焦点环正常。

---

## [0.48.3] - 2026-06-25

> **v0.48 产品化改版 · 第四阶段：首页改版（仪表盘）**。把首页 `/`（工作台）从静态介绍页升级为**投研仪表盘**，进站 5 秒内回答「大盘什么状态 / 我的自选怎样 / 今天有什么热门 / 有没有待处理告警」。**纯前端自研、零新依赖、复用 v0.48 ui/ 组件，不改任何页面内逻辑与计算口径**。

### 仪表盘模块（`src/components/home/*`，各模块独立 fetch + Skeleton + 空态/失败降级）
- **市场快照** `MarketSnapshot`：按行业板块聚合的上涨 / 下跌家数与平均涨跌（情绪），底部涨跌占比迷你条；深链「板块热力」。
- **我的自选** `WatchlistSnapshot`：收藏数 + 今日涨跌分布条 + Top 异动（按 `/api/watchlist/favorites` + `/api/market/batch` 实时补行情）；无收藏走「去扫描添加」空态。
- **今日热门** `HotList`：东财人气榜 Top 10（`/api/market/hot-rank`），代码·名称·涨跌 + 一键个股分析 / K 线（新开页）；底部「扫描全部」带 codes 深链 `/scanner`。
- **最近告警** `RecentAlerts`：盯盘最新命中事件（`/api/alerts/events`），规则 + 时间 + 级别徽标；无告警走「配置盯盘规则」空态。
- **快捷研究入口** `QuickLinks`：扫描 / 挖掘 / 回测 / 套利 / 动量 / 对比 工作流卡（复用 `navConfig`，新开页）。
- **板块热力 mini** `SectorMini`：领涨 / 领跌行业板块红绿色块（复用 `.heat-*` 与 `/sectors` 同口径）。
- **品牌下沉**：原「瓶颈点五因子」与「知识库」保留并下沉至页尾（用 `Card` / `SectionTitle` 重排）。

### 布局与口径
- 响应式网格：桌面 6 列（3 卡一行）→ 平板 2 列 → 手机 1 列（侧栏收为汉堡）。
- 深链均带上下文（人气榜 codes / 个股 code / 规则），个股与外链沿用 v0.47.1 `target="_blank"` **新开页**口径。
- 涨跌色集中在 `src/components/home/format.ts`（A 股红涨绿跌，与 `KPIStat` / 热力图同口径），不在各模块散写颜色。
- 市场快照原计划「主要指数」，因现有 6 位代码行情口径无法稳妥区分指数与个股，改用板块聚合做市场情绪快照（真实数据、单一现有接口）。

### 质量门禁
- `tsc --noEmit` 0 error · 改动文件 `eslint` 0 error · `next build` 通过。
- 本地 dev 浏览器实测：有/无自选、有/无告警、热门榜可用三类状态渲染正常；桌面 / 平板 / 手机三档断点布局正确；个股深链新开页；暗 + 亮双模观感正常。

---

## [0.48.2] - 2026-06-25

> **v0.48 产品化改版 · 第三阶段：全局命令面板（⌘K）**。为 19 页投研台补上国际化专业工具（Linear / Vercel 风）标配的全局搜索 / 跳转能力：`Cmd/Ctrl + K` 唤起，输入页面名模糊跳转、输入 6 位代码直达个股分析 / 图表、空输入展示最近访问。**纯前端自研、零新依赖、不改任何页面内逻辑与计算口径**。

### 命令面板（`src/components/shell/CommandPalette.tsx`）
- **唤起 / 关闭**：全局 `⌘K`（Windows/Linux `Ctrl K`）或点击顶栏新增的搜索框唤起；`Esc` 关闭；点击遮罩关闭。
- **页面模糊跳转**：基于 `navConfig` 菜单项的「标题 + 搜索别名」做模糊匹配（子串优先，其次子序列），支持中文 / 英文 / 拼音全拼 / 拼音首字母（如 `huice` / `hc` / `回测` 均可命中「策略回测」）。命中页面属**结构性导航**，沿用 v0.47.1 例外口径**同窗跳转**。
- **个股直达**：输入含 6 位代码即提供「个股分析 `/analyze?code=`」与「K 线图表 `/chart?code=`」两个动作，沿用 v0.47.1 `target="_blank"` 口径**新开页**。
- **最近访问**：自动记录最近浏览的页面与个股（localStorage，去重置顶，上限 12 条），空输入即展示最近 8 条；选中最近个股回填代码以选择分析 / 图表。
- **键盘可达**：`↑↓` 选择（环绕）、`↵` 执行、`Esc` 关闭；选中项自动滚入可视区；打开时锁定背景滚动并自动聚焦输入框（a11y）。

### 数据与接线
- `src/lib/navConfig.ts`：`NavItem` 新增可选 `keywords`（英文 / 拼音别名，不展示），并新增 `searchNavItems()` 模糊搜索；**单一数据源不变**。
- 新增 `src/lib/recentVisits.ts`：最近访问的 localStorage 读写工具（页面 / 个股两类）。
- `Topbar` 新增全局搜索框（窄屏收为图标按钮，自动识别 ⌘ / Ctrl）；`AppShell` 挂载 `CommandPalette` 并按 pathname 记录页面访问。

### 质量门禁
- `tsc --noEmit` 0 error · 改动文件 `eslint` 0 error · `next build` 通过。
- 本地 dev 浏览器实测：⌘K 唤起 / 中英拼音跳页 / 6 位代码直达分析·图表 / 最近访问 / 键盘上下回车 / 暗+亮双模均正常。

---

## [0.48.1] - 2026-06-24

> **v0.48 产品化改版 · 第二阶段：导航外壳（首个可见改版）**。把顶栏 17 个扁平入口
重构为「有层级、可折叠、可搜索」的应用外壳：5 大分组**可折叠侧边栏** + 精简顶栏 +
面包屑，响应式适配窄屏抽屉。**不改任何页面内逻辑与计算口径**，仅替换全站导航骨架。

### 信息架构（IA）重构
- 顶栏 17 项扁平入口 → 按投研工作流分 **5 大分组**：发现 / 分析 / 策略与回测 /
  交易与监控 / 系统（外加「概览·工作台」单项）。单一数据源 `src/lib/navConfig.ts`，
  新增页面只改配置。
- **新增 `/chart`（K 线图表）导航入口**——此前 936 行的 Pro 画布只能从个股深链进入，
  现在主导航直达。

### 导航外壳（`src/components/shell/`）
- `AppShell`：组合顶栏 + 侧栏 + 主内容 + 页脚；响应式。
- `Sidebar`：5 分组 + lucide 图标 + 当前项高亮（左侧 accent 竖条 + accent-soft 底）；
  桌面可折叠为 64px 图标栏（悬停 title 提示），折叠态记忆到 localStorage；窄屏转
  抽屉式 + 遮罩，点击项后自动关闭。
- `Topbar`：精简 56px——移动汉堡 / 桌面折叠按钮 + Logo + 面包屑 + 模型 / 主题 /
  明暗切换。
- `Breadcrumbs`：基于 pathname 渲染「分组 / 父级 / 当前页」层级（深层子路由如
  `/backtest/strategy` 显示父级可点回链）。

### 依赖与退役
- 引入 `lucide-react@1.20.0`（固定版本，发布满 7 天；React 19 兼容）作为导航图标库。
- 退役旧的横向顶栏 `src/components/Nav.tsx`（其能力由 `AppShell` 承接）。

### 质量门禁
- `tsc --noEmit` 0 error · 改动文件 `eslint` 0 error · `next build` 通过。
- 本地 dev 浏览器实测：侧栏分组 / 折叠图标栏 / 面包屑父级回链 / 当前项高亮 / 明暗模式
  均渲染正常（暗 + 亮双模验证）。

---

## [0.48.0] - 2026-06-24

> **v0.48 产品化改版 · 第一阶段：设计系统地基（无可见破坏）**。深入研究项目后，按用户要求「整理优化框架结构/布局/菜单 + 首页改版 + 全局国际化审美/视觉/UX」先落档详细设计文档与分阶段任务清单，评审通过后启动实现。本版（v0.48.0）只铺地基：扩展设计 token + 自托管中文字体 + 基础组件库，**不改任何计算口径与业务逻辑**，现有页面外观不变，**零运行时新依赖**（仅新增字体）。

### 设计文档落档 `docs/`
- `docs/v0.48-redesign-overview.md`：总览、现状盘点、8 条设计原则、In/Out 范围。
- `docs/v0.48-information-architecture.md`：IA / 菜单重构（17 扁平入口 → 5 大分组可折叠侧边栏 + 精简顶栏 + 面包屑 + ⌘K 命令面板）。
- `docs/v0.48-design-system.md`：设计 token 扩展规范 + 基础组件库清单。
- `docs/v0.48-homepage-redesign.md`：首页改版为仪表盘（市场快照 / 我的自选 / 今日热门 / 最近告警 / 快捷入口）。
- `docs/v0.48-task-checklist.md`：分 v0.48.0→.4 五个小版本的任务清单与决策点。

### 设计 token 扩展（`src/app/globals.css`，只追加不重写）
- 新增主题无关 token：间距 `--space-1..16`（8pt 基准）、圆角 `--radius-sm..xl/full`、阴影 `--shadow-sm/md/lg`（明暗各一档）、字阶 `--text-*`/`--lh-*`、层级 `--z-*`、动效 `--ease`/`--dur*`。
- 新增全局 `:focus-visible` 焦点环（a11y，所有可交互元素键盘聚焦可见）与 `.tnum` 数字等宽工具类。
- 既有 5 主题 × 明暗的语义色 token（`--bg`/`--surface`/`--accent` 等）与 A 股红涨绿跌热力图配色**完全不动**。

### 简体中文字体自托管（`src/app/layout.tsx`）
- 引入 `next/font/google` 的 **Noto Sans SC**（weight 400/500/700，`display: swap`，变量 `--font-noto-sans-sc`，自托管零外链），并接入 `body` 与 `@theme inline` 的 `--font-sans` 字栈；中文渲染不再依赖系统回退，跨平台一致。

### 基础组件库（新增 `src/components/ui/`，纯展示/交互壳，统一消费 token）
- `Card`（标准卡片容器，可 interactive 抬升）、`Badge`（语义徽章 6 色调）、`Button`（primary/secondary/ghost/danger × sm/md）、`KPIStat`（指标卡，A 股红涨绿跌）、`SectionTitle`（区块标题 + 操作）、`EmptyState`（空/失败占位）、`Skeleton`（加载骨架）、`PageHeader`（统一页头 + 面包屑挂点）、`Tabs`（受控分段切换）、`DataTable`（通用数据表：粘性表头 + 可排序 + 行 hover + 等宽对齐，提炼自 v0.46 回测表）。
- 统一出口 `src/components/ui/index.ts`。本版仅提供组件，未改动现有页面引用（v0.48.1+ 渐进接入）。

### 质量门禁
- `tsc --noEmit` 0 error；改动文件 `eslint` 0 error；`next build` 通过（Noto 字体构建期自托管成功，路由清单不变）。

---

## [0.47.1] - 2026-06-24

> **全站链接体检 + 交叉访问优化（补丁版）**。回应用户：「全站点扫描，看看哪些页面链接不合理，或者可以做交叉访问优化的，打个补丁版本，记得链接都是新开页面 target _blank」。纯前端 + 链路增强，**不改数据/接口/口径**，**零新依赖**。

### 统一站内「跨页 / 跨工具」链路为新开页（`target="_blank" rel="noopener noreferrer"`）
此前部分跨页深链为同页跳转，点击后会丢失当前列表/筛选/分析上下文。本次统一补齐：
- `src/app/page.tsx`：首页三枚 CTA（趋势→产业链 / 个股瓶颈点评分 / 方法论）+「查看完整方法论」原先 `/analyze` 已 `_blank` 但 `/map`、`/methodology` 未带，现统一新开页。
- `src/app/watchlist/page.tsx`：「扫描全部收藏 / 动量打分全部收藏」、每个股票池的「扫描 / 动量 / 套利」、已存筛选的「应用」全部新开页。
- `src/app/strategies/page.tsx`：「多股票池实测 → / 单票分析切换此策略 / 在套利雷达打开」+ 正文内「套利雷达 / 建议忠实回测」深链新开页。
- `src/app/paper/page.tsx`：「在套利雷达打开」+ 正文「策略市场」新开页。
- `src/app/alerts/page.tsx`：告警条目「查看」（跳 `/analyze` 或 `/arb`）新开页。
- `src/app/map/page.tsx`、`src/app/analyze/page.tsx`：错误提示里「前往『设置』配置 LLM」新开页。

### 交叉访问优化
- `src/app/compare/page.tsx`：横向对比表头新增交叉访问入口——「用这 N 只去 → 动量轮动 / 扫描诊断 / 套利配对（≥2 只）」，复用全站统一的 `?codes=` 深链口径，均新开页。

### 保留同页导航的例外（有意为之，避免标签页堆积）
- 顶部全局导航栏（`Nav.tsx`）、`/chart`「返回分析 ↵」回退链接、回测三模式切换 tab（单股 `/backtest` ↔ 多股池 `/backtest/strategy` ↔ 配对 `/backtest/pairs`）仍为同页跳转。

### 质量门禁
- `npm run type-check`、`npm run lint`（0 error）、`npm run build` 三关全绿；零新依赖。

---

## [0.47.0] - 2026-06-24

> **方法论 → 站内深度研究 链路打通**。回应用户：「在 `/methodology` 页面，增加对『相关 A 股板块 半导体自主可控 / 国产替代』这类信息的链接，链接到站内相关 `/map` 趋势 → 产业链瓶颈点拆解 页面……设计比较好的链路，来支持更深入的研究」。纯前端 + 链路增强，**不改数据/接口/口径**，**零新依赖**。

### `/map` 支持 URL 预填与自动拆解（`src/app/map/page.tsx`）
- 新增 `?trend=<主题>&auto=1` 支持：用 `useSearchParams` 读取，进页面自动把主题填入输入框；带 `auto=1` 时自动触发 AI 产业链瓶颈点拆解，不带则仅预填等用户手动点「拆解」。
- 组件拆成 `MapPageInner` + 外层 `<Suspense>` 包裹（与 `/scanner` 同款写法，满足 Next.js `useSearchParams` 的 CSR bailout 要求）；`autoRan` ref 防止重复触发。

### `/methodology` 研究链路（`src/app/methodology/page.tsx`）
- **主题卡（主题 → A 股瓶颈点映射）**：每个主题名旁新增两枚研究链路按钮——
  - 「拆解产业链瓶颈点 →」→ `/map?trend=<主题名>&auto=1`，一键带入该主题的 AI 产业链拆解。
  - 「批量诊断 N 只 →」→ `/scanner?codes=<该主题全部 A 股代码>&title=<主题名>`（仅在有有效 6 位 A 股代码时显示，自动去重）。
- **主题下个股卡片**：原纯展示 `div` 改为可点链接，A 股代码直达 `/analyze?code=<code>` 个股诊断（非 A 股代码保持不可点）。
- **近期发言「相关 A 股板块」标签**：原纯色块 `span` 改为链接 `a`，点击直达 `/map?trend=<板块名>&auto=1`，带 ↗ 角标提示可跳转。

### 质量门禁
- `npm run type-check`、`npm run lint`（0 error）、`npm run build` 三关全绿；浏览器实测：主题卡按钮 / 个股链接 / 发言板块标签均渲染正常，`/map?trend=&auto=1` 进页即自动拆解，仅带 `trend` 时只预填。

---

## [0.46.0] - 2026-06-24

> **回测结果表格 TradingView 化改造**。回应用户：「`/backtest/strategy?strategy=…` 这类页面，交易流水、分股票表现等，UI/UX 需要增强，现在太简陋了，多学学 TradingView 的 UI/UX 吧」。纯前端增强，**不改任何回测口径/数据/字段**，**零新依赖**。

### `/backtest/strategy` 两张结果表升级（`src/app/backtest/strategy/page.tsx`）
- **可排序表头**：新增 `SortTh` 组件，点击列头切换升/降序，带 ▲▼（激活）/↕（未激活）指示。分股票表现可按 代码/交易/胜率/每笔均值/全程买入持有 排序（默认每笔均值降序）；交易流水可按 代码/买入日/收益/持有 排序。
- **交易流水**：
  - 盈利/亏损/全部 分段过滤按钮，实时显示「显示 N / 共 M 笔」。
  - 行首 `border-l-2` 红/绿状态条标盈亏；买入列 ▲（红）/ 卖出列 ▼（绿）方向标。
  - 收益做成带底色 **P&L 药丸**（盈红/亏绿，A 股口径）+ 下方行内 `MiniBar` 迷你强弱条（按全表收益绝对值归一）。
  - 离场原因做成语义色徽章 `exitBadgeCls`：止盈/目标=绿、止损/跌破/回撤/吊灯=琥珀、信号/翻空/均线=蓝、其余（强制平仓等）=灰。
- **分股票表现**：
  - 搜代码/名称输入框即时过滤；盈利 / 亏损 / 跑赢持有 三枚汇总徽章。
  - 胜率做成 `WinRateCell` 迷你进度条（≥50% 红 / 否则绿，A 股涨红口径）。
  - 每笔均值、全程买入持有各配 `MiniBar` 行内强弱条。
- 统一 TradingView 式排版：粘性表头 + `shadow-[0_1px_0_var(--border)]` 分隔线、行 `hover:bg` 高亮、圆角边框滚动容器、`tabular-nums` 数字对齐、`uppercase tracking-wider` 表头。

### 验证
- 三关全绿（type-check / lint 0 error、build 通过），零新依赖。
- 浏览器实测 `tv-supertrend-adaptive-v1` 回测页：排序（每笔均值/胜率）、盈利过滤（显示 12/31）、搜索、语义徽章配色、P&L 药丸 + 迷你条均正常渲染。

## [0.45.0] - 2026-06-24

> **复刻 Cardwell RSI Trade Navigator [MarkitTick]——交易计划色块（Entry/SL/TP1-3 矩形带 + 右轴标签）**。回应用户：「他这里做出了多个矩形色块，对应不同功能的价位，看着很醒目，UI/UX 很棒，你知道原理并能复刻在我们的 chart 页面吗？」——懂原理，已复刻。**零新依赖**。

### 新增：第二个 TV 复刻策略 `tv-cardwell-rsi-navigator-v1`（`tvStrategies.ts`）
- **原理**：你 TV 截图里那套红/绿矩形来自 Cardwell RSI Trade Navigator（图例首行，非 GBB）——一个「交易计划可视化」层：出信号定方向后，以**入场价 Entry** 为锚向右画一组水平矩形带——**红=风险带（Entry↔止损）**、**绿=盈利带（Entry↔TP1/TP2/TP3）**，右轴贴 × SL / ► Entry / ● TP1 / ★ TP2 / ▲ TP3 标签。
- **复刻口径**（诚实——Cardwell 原脚本精确公式并非公开）：①方向/择时用 RSI(14) 上/下穿中线 50 判多空转换（两次翻转最少间隔 2 根降噪）；②止损取 1.5×ATR(14)；③目标按风险 R=|入场−止损| 的 1/2/3 倍投影 TP1/TP2/TP3（对应原作参数 1.5 与 1/2/3）。即「同款 UI/UX + 一套合理可解释的 RSI/R 倍数交易计划」，盒子位置不与 TV 逐位相同。
- 输出扩展 `TvStrategyLayers.tradePlan`（`{anchorIndex, dir, entry, stop, targets[]}`），渲染端据此画色块；该策略不画跟踪线（`line` 整列 null）。

### 新增：交易计划色块渲染层（`tradeZonesPrimitive.ts`，lightweight-charts v5 自定义 series primitive）
- LineSeries/AreaSeries 无法表达「两价位之间、自某根向右延伸的填充矩形」，故用官方 `ISeriesPrimitive` 在画布上直接绘制：**填充矩形** zOrder `bottom`（画在 K 线之下，半透明不挡蜡烛）、**价位虚线** zOrder `top`（画在 K 线之上，清晰可见）、**右轴标签** 走 `priceAxisViews`（库自动避让堆叠，文案/配色完全自定义）。坐标用 media 空间，与 `priceToCoordinate / timeToCoordinate` 同口径。
- 以入场根为锚向右延伸；逐根回放时锚定根不在序列里则不画（游标到达入场根才显现，避免色块铺满全图）。
- 配色按「盈亏语义」（红=风险/绿=盈利，同 TV），与 A 股蜡烛涨跌色（红涨绿跌）属不同维度；盈利带越近入场越浓。

### 接入：`/chart` 图层 + 回测引擎
- `/chart`「策略图层」下拉自动新增该策略（注册表驱动），可单选或与 GBB 切换；右上角配套 **Navigator 读数面板**（Bias / RSI / Entry / SL / TP1-3 / Since Signal），与 GBB 统计表互斥显示（带 `tradePlan` 的策略显示 Navigator 面板、跟踪线型策略显示 GBB 面板）。
- `strategies.ts` 登记 `tv-cardwell-rsi-navigator-v1`，自动接入 `/backtest/strategy`（z 检验/PSR/DSR）与 `/analyze`（纯多头：上穿 50 入场/下穿 50 离场，叠加 1.5×ATR 跟踪止损，含双边手续费）。

### 校验
- 合成 K 线校验：空头计划 entry 151.15 / stop 154.53（在上方）/ TP1-3 在下方，实测倍数精确 1.00/2.00/3.00R、止损方向正确；多头为对称镜像。
- 三关全绿（type-check / lint 0 error、build 通过）。

## [0.44.1] - 2026-06-24

> **校准 GBB 自适应带宽，让 Supertrend 跟踪线贴合 TradingView 实际渲染**。用户对比 TV 截图发现我们的跟踪线「又平又低」、远离价格，与 TV「紧贴价格、阶梯抬升」差距明显。**零新依赖**。

### 修复：自适应带宽 widen 过猛 → 跟踪线远离价格
- 根因：`effMult = baseMult×(1 + trendGain·趋势强度 + chopGain·震荡强度)`，原作口径 `trendGain/chopGain=0.8/0.5`，在干净趋势里把乘数推到 **5~6×ATR**，使跟踪线远远落在价格下方、看起来又平又低（601869：价 580 时线停在 ~357~430）。而 **TradingView 实际渲染的 GBB 线 ≈3×ATR 紧贴价格**。
- 修法：把增益收紧到 `0.25/0.15` 并新增 `maxMultGain=0.25` 上限（最宽 `1.25×base=3.75×ATR`），保留「趋势/震荡加宽、转折收紧」的 regime 自适应特征，但避免乘数膨胀。**601869 校验：收紧后末根线 ≈454.25（3.48×ATR），对齐 TV≈465**；多头段阶梯抬升、800/800 根均有有效线值。
- 口径变化提示：该带宽同时用于已登记的 GBB 回测（`tv-supertrend-adaptive-v1`），跟踪止损更紧 → 在回调中可能更早离场，回测收益数字会相应变化（更贴近 TV 真实表现）。
- 三关全绿（type-check / lint 0 error、build 通过）。

## [0.44.0] - 2026-06-24

> **GBB 策略图层视觉补齐，对标 TradingView [GBB] 显示层**：在已修复可见的 Supertrend 跟踪线基础上，新增趋势云带 + 右上角统计表（Trend / ATR / ADX / Strength / HTF Bias / Since Signal）。**零新依赖**。

### 新增：GBB 显示层（`LightweightChart`）
- **趋势云带**：在 Supertrend 线附近叠加半透明渐隐填充（多头绿 / 空头红），用两条 `AreaSeries`（顶色半透明、底色全透明）实现「贴线云带」，自身线透明、可见线仍由两条 3px 粗线绘制。
- **右上角统计表**（对标 TV [GBB] 面板）：实时显示当前显露末根的 **Trend**（多/空，红绿）、**ATR**（Wilder ATR(10)，与 Supertrend 同口径）、**ADX**（Wilder ADX(14)，趋势强度）、**Strength**（regime 效率%，即那个「44%」读数）、**HTF Bias**（收盘 vs MA50 的高周期偏置）、**Since Signal**（距上次翻多/翻空的根数）；随逐根回放游标实时更新。
- 新增组件内 `atrOf` / `adxOf` 工具函数（Wilder 平滑，与 K 线等长）。

### 诚实口径
- 统计表数值基于**我们自己的行情源 + 我们逆向复刻的 GBB**，**不会与 TradingView 逐位相同**（不同数据源 + 复刻的翻转节奏与原版 Pine 不同，尤其 *Since Signal* 根数）。601869 校验：ATR(10)=36.10（TV 显示 34.58，吻合），ADX(14)=34%（TV 的 68% 系另一套行情源/窗口）。
- 用户 TV 截图右侧的**红/绿目标盒 + 箭头价标**多半来自另一个脚本 **Cardwell RSI Trade Navigator [MarkitTick]**，不属于 GBB；如需可后续单独登记为 `tv-cardwell-rsi-navigator` 复刻。
- 三关全绿（type-check / lint 0 error、build 通过）。

## [0.43.1] - 2026-06-24

> **修复 GBB 策略图层「读数正常但线画不出来」**。用户开启 Modern Adaptive Supertrend [GBB] 图层后，顶部读数条（多头/效率%/线值）正常，但主图上看不到任何 Supertrend 线。**零新依赖**。

### 修复：lightweight-charts v5 不渲染线序列的「逐点 color」
- 根因：`LightweightChart` 的 Supertrend 线序列创建时**未设底色**，靠 `LineData` 的逐点 `color`（多头红/空头绿）上色；但 **lightweight-charts v5 不渲染线序列的逐点 `color`**（均线能显示是因为它们都设了底色）。结果图层数据完全正确（601869 实测 800/800 根均有有效线值、最长 417 根连续多头段、读数条正常），但线在画面上不可见。
- 修法：把单条逐点着色线改为**两条底色线**——多头红线 `stUp`（仅在 `dir===1` 的根上有值）+ 空头绿线 `stDn`（仅在 `dir===-1` 的根上有值），其余根置空白（whitespace）断开。底色直出、不依赖逐点色，**保证图层清晰可见**；线宽加粗到 3px。R 倍数目标横线改挂在多头线上。
- 三关全绿（type-check / lint 0 error、build 通过）。

## [0.43.0] - 2026-06-24

> **K 线图买卖策略从「最旧 v1」升级到旗舰 v7 + Pro 画布可切换买卖引擎（含 GBB）+ 从回测页点进自动叠加 TradingView 风格策略图层**。修复「为什么大趋势启动前没买点、半山腰就卖飞」的根因，并打通「从 GBB 回测点个股 → 图表自动呈现 Supertrend 复刻图层」。**零新依赖**。

### 修复：`/chart` 买卖标记一直用「最旧 v1」固定 35% 止盈，导致卖飞 + 错过主升浪
- 根因：`src/app/api/market/chart-data/route.ts` 写死 `runChokepointMomentumBacktest(candles, 70)`（瓶颈动量 **v1**，固定 +35% 止盈、且买入要求贴近主力成本线），而 `/strategies` 榜单与 `/backtest/strategy` 早已用旗舰 **v7**。结果图表上的 B/S 是全仓库最旧的策略：大趋势股 +35% 一刀切、强势中又因「价格远离成本线」给不出买点，于是完美错过主升浪（601869：v1 累计 +102.9%，远逊买入持有 +1576.8%）。
- 修法：路由改为 `runAllStrategies(candles, { chokepointScore: 70, code })` 跑全部已登记策略，返回 `strategies` + `defaultStrategyId`，`backtest` 默认取旗舰 **v7 趋势跟随**（ATR 吊灯自适应跟踪止盈 + 金字塔分批建仓 + 前移/分批止盈 + 结构/箱体/天量止损，让利润奔跑而非固定止盈）。601869 实测：默认买卖收益 **102.9% → 337.6%**。
- 支持 `?strategy=<id>`：从策略榜 /「多股票池实测」点进 `/chart` 时，路由按该 id 预选买卖引擎。

### 新增：Pro 画布「买卖引擎」下拉 —— 图表上直接切换 B/S 所用策略
- `src/app/chart/page.tsx`：Pro 画布工具条新增「买卖引擎」下拉，列出全部已登记策略（默认旗舰 v7）。切换即**客户端即时**用所选策略的 `trades` 重画主图 B/S，无需重新拉数（数据已随 `chart-data` 一次性返回）。
- 选 **Modern Adaptive Supertrend [GBB]**（`tv-supertrend-adaptive-v1`）作买卖引擎时，601869 实测**一笔吃满主升浪 +1498.8%**（翻空才离场、绝不卖飞），与 v7 的波段口径形成对照——直观展示「趋势跟随 vs 分批止盈」的取舍。

### 新增：`/chart?layer=<tvId>` —— 从回测页点个股自动叠加 TradingView 风格策略图层
- 此前从 GBB 回测「分股票表现」点个股落到 `/chart`，但 Pro 画布「策略图层」下拉默认「关闭」，所以看不到任何 Supertrend 叠加（用户预期的 TV 风格效果缺失）。
- 修法：① `LightweightChart` 新增 `initialTvStrategyId` 入参，`/chart` 读取 `?layer=` 自动启用对应 TV 复刻图层；② `StockLink` 新增 `chartStrategyId`/`chartLayerId`，`/backtest/strategy` 的个股链接按所跑策略带上 `strategy`+`layer`（TV 策略额外带 `layer`）；③ 图层视觉补齐到接近 TV：读数条加 **regime 效率% 读数**，末根仍为多头时按「最近翻多价=入场、Supertrend 线=止损」画 **入场 / 止损 / 1R~3R 目标横线**（对标 TV [GBB] 右侧 R 目标盒）。
- 诚实提示：用户的 TV 截图里另叠了 `Cardwell RSI Trade Navigator [MarkitTick]` 指标，右侧盒子部分元素可能来自它；本项目复刻的是 **GBB 本体**的可视化，尽量贴近但不逐像素一致。长期持有的大赢家（如 601869，跟踪止损已远高于初始入场价）不画 1R~3R 目标横线（避免误导），仅显示真实的 Supertrend 跟踪止损线。

### 质量门禁（本机执行）
- `npm run type-check` 0 error；`npm run lint` 0 error（27 条均历史警告，本轮改动文件零新告警）；`npm run build` 通过，`/chart` 路由正常。
- 真实行情实测（601869，360 根日线）：chart 默认买卖 v7 = 337.6%（12 笔）、GBB 买卖引擎 = 1498.8%（1 笔，仍持有）、GBB 图层末根多头·效率 65%。**零新依赖**。

## [0.42.0] - 2026-06-24

> **修复「多股票池实测」按钮丢策略 + 回测页接入东财人气榜热门池**。从 `/strategies` 策略榜点「多股票池实测」过去回测页会丢掉所选策略、永远落到默认 v7.0——本轮修复；并新增实时「东财人气榜」热门股票池来源，弥补原静态清单覆盖偏少的问题。**零新依赖**。

### 修复：`/strategies`「多股票池实测 →」不携带所选策略
- 此前策略卡片里的「多股票池实测 →」是写死的 `<Link href="/backtest/strategy">`，**不带任何策略参数**；而 `/backtest/strategy` 又只从 `/api/strategies` 读 `defaultStrategyId`（当前默认 v7.0）作初始选中。结果：无论在策略榜点击哪个策略，跳到回测页都显示并回测默认策略，与用户预期不符。
- 修法：① `src/app/strategies/page.tsx` 该链接改为 `?strategy=${encodeURIComponent(r.meta.id)}`，把卡片对应的策略 id 带过去；② `src/app/backtest/strategy/page.tsx` 用 `useSearchParams()` 读取 URL 上的 `strategy`，在拉到策略列表后**若命中已登记策略则覆盖默认选中**，否则回退默认；因 `useSearchParams` 在客户端组件需 Suspense 边界，外层补 `<Suspense>` 包裹（与 `/chart` 页一致）。

### 新增：`GET /api/market/hot-list` + 回测页「东财人气榜」热门池按钮
- 回测页原有「热门 15 只」「① 大盘蓝筹 50」均为**静态清单**、覆盖偏少且不随行情更新。本轮复用项目既有的**东财人气榜**数据源（`getStockRankList` → emappdata `stockrank/getAllCurrentList`，实时人气排行；已在 `src/lib/sources` 导出），新增 `src/app/api/market/hot-list/route.ts`：`GET /api/market/hot-list?n=50`（`n∈[1,200]`）返回 `{ asOf, count, codes, items }`，`codes` 即按人气名次排序的 6 位代码清单。
- `src/app/backtest/strategy/page.tsx` 在预设按钮旁新增「🔥 东财人气榜 50」「🔥 东财人气榜 100」两个按钮，点击即拉取当前人气榜代码填入股票池（带拉取中态与错误提示）。这是当前可得的最接近「最近热门榜单」的实时口径。

### 质量门禁（本机执行）
- `npm run type-check` 0 error；`npm run lint` 0 error（27 条均历史警告，本轮新增文件零新告警）；`npm run build` 通过，`/api/market/hot-list` 路由已登记。
- 数据源实测：`getStockRankList(50)` 返回 50 只真实人气榜代码（沪深两市）。**零新依赖**。

---

## [0.41.0] - 2026-06-24

> **复刻 TradingView 社区脚本框架 · 首发 Modern Adaptive Supertrend [GBB]**。新方向：把 TradingView 社区里值得复刻的 Pine 脚本**逆向出核心算法**、本地实现，并为每个策略配套实现可叠加到 K 线主图的**分析图层**（方向线 / 翻多翻空标记 / regime 读数），从而脱离 TradingView 把这些策略直接套用到 A 股个股行情上。本轮交付**复刻框架** + **第一个策略端到端打通**作为模板，后续脚本照此范式逐个复刻。**零新依赖**。

### 新增：`src/lib/tvStrategies.ts`（TV 社区脚本复刻库 · 带版本号注册表）
- 与经典指标组 `indicatorStrategies.ts` **平行**：那一组是「对标教科书指标的自研改进版」，本库是「逐一复刻具名社区脚本」。每个策略 = 元信息（`id` / 版本 / **原作者** / **原作链接** / 与原版的差异与诚实说明 / 标签）+ `compute(candles)→TvStrategyLayers`（纯函数，产出与 K 线等长的 `line`(方向线) / `dir`(每根方向) / `flips`(翻转点) / `regime`(每根状态) / `regimeValue`(效率比分位)）+ 可选 `backtest(candles)→BacktestResult`（纯多头可回测包装）。
- `listTvStrategies()` / `getTvStrategy(id)` 供 UI 下拉与渲染消费；新增脚本只需在 `TV_STRATEGIES` 数组追加一项，UI 与接口自动跟随。

### 逆向：Modern Adaptive Supertrend [GBB]（作者 goodBadBitcoin）
- 原作链接 https://cn.tradingview.com/script/Wagz8RF1-Modern-Adaptive-Supertrend-GBB/ 。本质是经典 Supertrend（ATR(10)×3 波动率跟踪线，价上方/下方翻转，收盘越线即翻）+ 两层现代化改造：
  - **① Commit filter（迟滞过滤，真正起作用的一层）**：不再「碰线即翻」，收盘要越过线 **≥ `commitBuffer`×ATR（默认 0.5）** 并保持 `persistence` 根（默认 1）才确认翻转。作者实测假翻转减少约 60%。
  - **② Adaptive distance（regime 自适应带宽）**：用市场**自身近况**而非固定阈值判趋势/震荡——取效率比（Kaufman ER）在近 `pctlWindow`（默认 500）根里的**分位** `pr`，`effMult = baseMult×(1 + trendGain·max(0,(pr−.5)/.5) + chopGain·max(0,(.5−pr)/.5))`。干净趋势（`trendGain` 0.8）与震荡（`chopGain` 0.5）均加宽抗洗，仅「转折」（`pr≈0.5`）收紧到基准、让线灵敏。
  - **③ Adaptive period（自适应周期）**：作者承认无效、原脚本默认关，本复刻**未实现**（仅保留口径说明）。
- **诚实口径（沿用原作）**：这是趋势**过滤器**而非择时系统，裸方向胜率≈48%（约等于抛硬币，因为 Supertrend 跟随趋势而不预测趋势），价值在更干净的趋势读数与更低回撤、而非抄顶摸底。

### 新增：分析图层（`/chart`「策略图层」下拉）
- `src/components/LightweightChart.tsx`：新增「策略图层」下拉，选中复刻策略后在主图叠加——Supertrend **方向线**（A 股配色：多头红 / 空头绿，翻转处断开线段避免画出跨越价格的斜线）、**翻多 / 翻空标记**（箭头）、读数条显示当前**方向 · regime · 线值**；随周期切换 / 逐根回放自动对齐，关闭即移除（复用既有「按可见 K 线重绘」的 painter 结构，不重建图表）。

### 变更：登记进证明引擎
- `strategies.ts` 登记 **`tv-supertrend-adaptive-v1`**（翻多入场 / 翻空离场，单仓位、纯多头、含双边手续费；翻空即为离场/止损，不再叠加额外 ATR 跟踪止损以忠实原策略口径），登记即自动接入 `/backtest/strategy` 证明引擎（z 检验 / PSR / DSR）与 `/analyze`、策略榜。
- `indicatorStrategies.ts` 导出 `runSignalBacktest` / `SignalSpec` / `HoldState` 供 `tvStrategies.ts` 复用，统一回测口径与统计（净值 / 夏普 / 对照买入持有 / A 股双边费）。

### 质量门禁（本机执行）
- `npm run type-check`（`tsc --noEmit`）0 error；`npm run lint` 0 error（27 个历史遗留 warning，与上一版同数、非本次引入）；`npm run build` 通过，注册表新增策略自动接入、全部路由如常注册。
- 数值校验（近 600 根日线缓存 000001/000333/000651/600519）：commit filter 实测**降噪 62~75%**（默认 `buffer=0.5` 对比 `buffer=0` 的翻转次数），与原作「约 60%」吻合；方向线在多头时贴价下方、空头时贴价上方（仅迟滞确认窗口内允许短暂越线，符合 commit filter 设计）；regime 趋势/震荡/转折分布均衡；纯多头回测无 NaN/Infinity、买卖配对、交易点带可读理由。
- 诚实边界：回测结果**不代表未来收益**；该策略为趋势过滤器、裸方向≈抛硬币，请结合其它信号使用（已在策略简介与 `compute` 注释中如实声明）。

---

## [0.40.0] - 2026-06-24

> **经典技术指标策略组 · 对标 TradingView「七个值得尝试的指标」**。研读 CMC Markets《七个值得尝试的 TradingView 指标》（RSI / 移动均线 / MACD / 布林带 / 斐波那契回撤 / 随机指标(KDJ) / 成交量）后，结合本项目既有指标库（`indicators.ts`）、回测**证明引擎**（`/backtest/strategy` 带 z 检验 / PSR / DSR / Purged-CV）与**带版本号的策略注册表**（`strategies.ts`），落地 **5 个「比原文裸口径更优」的策略**。原文反复强调「**任何单一指标都应与其他指标结合使用**」——故每个策略都在裸指标上叠加：①**MA60 趋势闸门**（避开 A 股单边下跌里接飞刀）；②**多重确认**（零轴 / 放量 / 低位金叉企稳）；③**ATR(14) 自适应跟踪止损**（回撤距离随个股波动伸缩、不猜顶）。全部**纯多头、A 股主板、含双边手续费**，各带独立 `id@版本号`便于后续单独迭代。**零新依赖**。

### 新增：`src/lib/indicatorStrategies.ts`（指标策略生产器）
- 通用「信号式」单股回测状态机 `runSignalBacktest()`：整仓买卖、100k 起始、走 `costs.ts` A 股双边费模型、内建 ATR 自适应跟踪止损，统一产出 `BacktestResult`（净值曲线对照「同期买入持有」基线），把各策略差异收敛到 `entry`/`exit` 两个回调，保证口径与统计一致、便于横向对照与迭代。
- 5 个导出策略函数，各自精算所需指标后给出入场 / 离场逻辑（仅用 ≤ 当根数据，无未来函数）。

### 新增：5 个注册策略（`strategies.ts`，均 `@1.0`，登记即自动接入 `/backtest/strategy` 下拉、证明引擎与 `/analyze`）
- **`confluence-v1`「多指标共振（旗舰·指标组合）」**：复用 `computeResonance` 多指标共振扫描，要求 **≥3 个指标**（MACD 金叉 / RSI 超卖修复 / KDJ 低位金叉 / 触布林下轨反抽 / 放量上涨）同向共振 + MA60 闸门才入场；≥2 指标看跌共振翻空离场。把原文 7 指标里的 5 个拧成一股绳，直接回应「指标需组合」。
- **`rsi-reversion-v1`「RSI 超卖回归（趋势过滤）」**：只认 RSI **上穿 30** 的修复瞬间（非单纯 <30），叠加 MA60 闸门；离场 = RSI 高位回落破 70 / 跌破 MA20 / ATR 止损。
- **`macd-zero-trend-v1`「MACD 零轴上金叉趋势跟随」**：只认**零轴之上**（DIF>0）的金叉 + MA60 上行 + 放量确认（5 日量能>20 日 1.2 倍），滤掉震荡假金叉；离场 = MACD 死叉 / 跌破 MA20 / ATR 止损。
- **`boll-squeeze-v1`「布林挤压突破」**：反向取用布林带的**波动率**属性做动量——识别挤压（带宽处于近 100 日低 40 分位）后**放量向上突破上轨**追突破；跌破中轨(MA20) 离场 + ATR 止损。与既有「网格·均值回归」形成趋势 / 震荡互补。
- **`fib-kdj-pullback-v1`「斐波那契回踩 + KDJ 低位金叉」**：上升趋势中自动取近 40 日波段低→高算 **38.2%~61.8% 黄金回撤区**，价回踩进区且 **KDJ 低位金叉**（K 上穿 D 且 D<45）企稳才买，目标看波段高、跌破 61.8% 认结构破位止损 + KDJ 高位死叉止盈 + ATR 止损。一策略覆盖原文「斐波那契」与「随机指标」两项。

### 质量门禁（本机执行）
- `npm run type-check`（`tsc --noEmit`）0 error；改动文件 `eslint` 0 error；`npm run build` 通过，注册表 5 策略自动接入、全部路由如常注册。
- 真实行情功能级校验：4 只样本（600519/000858/601318/000001）× 5 策略 = 20 跑全 **OK**——纯多头（shares>0）、买卖配对、`BacktestResult` 无 NaN/Infinity、所有交易点带可读理由；下行样本里多数策略（趋势闸门 + ATR 止损）显著跑赢「买入持有」基线（如 600519 +4.59% vs 持有 −17.66%、000858 −5.78% vs −48.99%），体现防守性而非过拟合堆收益。
- 诚实边界：回测结果**不代表未来收益**，样本内偏高需看样本外（已挂 `BACKTEST_BOUNDARY` / `NFA`，可在 `/backtest/strategy` 用证明引擎做 DSR/Purged-CV 多重检验校验稳健度）。

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
