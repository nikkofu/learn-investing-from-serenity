# 🚀 Learn Investing from Serenity · 瓶颈点智能投研台

> **把"白毛股神"的供应链卡脖子投资学，变成一套会自我审查、可被回测、敢于认错的自动化选股武器。**

[![Next.js](https://img.shields.io/badge/Framework-Next.js%2016-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/Library-React%2019-blue?style=for-the-badge&logo=react)](https://react.dev)
[![Tailwind v4](https://img.shields.io/badge/CSS-Tailwind%20v4-38bdf8?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

**Serenity 瓶颈点智能投研台**，是一款把 X 顶级半导体与算力供应链分析师 **Serenity（@aleabitoreddit，"白毛股神"）** 的 **"瓶颈点投资法 (Chokepoint Investing)"** 彻底系统化的全栈选股 / 投研台。我们把最先进的大语言模型与 A 股实时行情数据深度耦合，协助投资者拆解产业链、定位那些**低关注度、高定价权的上游隐形冠军**——并且，**用多智能体协作 + 样本外回测 + 校准闭环，让每一个结论都有据可查、可被证伪、敢于认错。**

> ⚠️ **免责声明**：本项目仅供学习与研究之用，**不构成任何投资建议 (NFA)**。所有评分、胜率、价格情景均为模型与量化推演结果，不保证收益。股市有风险，入市需谨慎。

---

## 🆕 v0.18.0 亮点

*   **标准化回测绩效报表（对标 TradingView Strategy Tester / 券商回测报告）**：交易面板新增「绩效报表」页签，给出 Sharpe / Sortino / Calmar / Profit Factor / 最大回撤（含峰谷日期）/ 平仓胜率 / 盈亏比 / 最大连亏 / 平均持仓天数 / 持仓占比，并配**权益曲线**（策略 vs 买入持有，起点归一 1.0）与**回撤水下图**，随所选策略实时重算。
*   **可插拔副图 + 首批技术指标（MACD / RSI / KDJ / BOLL，对标 TradingView）**：主图勾选布林带（复用 K 线纵轴、含对数轴）；工具栏「副图：无/MACD/RSI/KDJ」一键切换，选中时在成交量下方动态加一栏振荡面板，与主图缩放/平移同步。口径对齐同花顺/通达信默认参数。
*   **图表纵轴标度切换（线性 / 对数 / 百分比，对标 TradingView）**：对数轴是后复权长周期的「正确看法」——五粮液类后复权 53→1672，线性轴几乎贴底，对数轴下各阶段涨跌等比例可读；百分比轴以可视区首根收盘为基准看相对涨跌，便于横向比较。与前/后复权切换天然互补。
*   **前复权 / 后复权一键切换（对标通达信「正经复权」）**：图表 / 筹码 / 交易标记 / 回测整体切到同一复权口径——**前复权**贴现价看操作买卖，**后复权**看长周期真实回测。彻底解决「五粮液类」高分红老股：前复权全量历史半数为负价（000858 全量 6276 根中 3162 根 < 0），喂回测必失真；后复权全量 6689 根 0 负价（1998 的 53.57 → 2026 的 1672.21），长周期收益真实。后复权口径下 AI 打分仍走前复权（基本面与绝对价位无关）。
*   **自适应出场策略迭代（V7 / V8）**：在 V6「让利润奔跑」之上，新增 regime 判定（趋势 / 箱体）+ 箱体高抛 + 前移止盈（+8% 先减）+ 结构/时间止损，专治「箱体里只买不卖坐电梯」；V8 进一步引入「高水位新高阶梯减仓」（最优停止 / 秘书问题思路），不靠固定目标位猜顶。
*   **~10 年本地行情库（全量落盘 + 增量更新）**：对标通达信 / 同花顺本地行情软件——首次拉全量落 `.data/kline-cache`，之后只补增量，复权漂移自动全量刷新；回测样本更长更稳，不再每次重复下载。数据起始日期可在 `/settings` 配置（默认 2000-01-01，按数据源最早可得自适应）。
*   **根治长周期回测「前复权负价」失真**：前复权（减式除权）对高分红老股拉到早年会把价格压成负数 / 近零（如五粮液早年收盘 < 0），算出 −2600% 这类不可能收益。现所有回测入口只取「前复权有效正价区间」，茅台 −2599.9%→+296.2%、恒瑞 −4322.4%→+266.1%，无负价个股结果不变。已铺好后复权数据层（`fqt=2` 独立落盘）为「前复权 / 后复权切换」预留。
*   **B/S 标记透明度 = 仓位比例**：满仓动作实心、减仓半透明，悬浮卡 / 明细行给出「操作仓位 + 本笔盈亏」，策略规则按当前所选策略动态显示。

---

## 🎯 为什么是 Serenity？

市面上多数 AI 选股工具只做一件事：把数据塞进一个大 prompt，让模型一口气吐出一个"看多 85 分"的结论。**它自信，但你无法验证它对不对。**

Serenity 的设计哲学完全相反——**准确性优先，诚实优先**：

| 行业常见做法 | Serenity 的做法 |
| :--- | :--- |
| 单 Agent 单趟打分，无人复核 | **生成器 → 批判者 → 裁判** 三智能体协作，专设"唱反调"角色找反证与过拟合 |
| 模型自报"成功率 90%" | **禁止模型自报胜率**，改用样本外 walk-forward 历史命中率，并标注样本量与显著性 |
| 打分没有依据 | **每个因子必须引用具体数据点**，无支撑的论断自动降权 |
| 回测样本内、单只、无基准 | **三套回测体系**：单只 / 组合 / 建议忠实回测，含 A 股涨跌停撮合真实性 + 对比基准 + z 检验 |
| 说"更准"却从不度量 | **校准闭环**：预测落库，事后用真实涨跌算 Brier 分与可靠性曲线，把"准"变成可观测指标 |

---

## ✨ 核心能力总览

### 🧠 多智能体 AI 工作流（Generator → Critic → Judge）
对齐 [Google Agentic Design Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) 的 Reflection / Critic / Debate 模式，把"单 Agent 单趟"升级为三步协作：

1. **生成器 (Generator)**：按瓶颈点五因子框架产出初评，**每个因子强制引用数据证据**。
2. **批判者 (Critic / 风控)**：专职唱反调，挖掘反证、无依据论断与过拟合叙事，标注严重度。
3. **裁判 (Judge)**：根据反证保守调和分数与置信度，给出最终结论；**LLM 不可用时自动降级为纯确定性调和**，绝不阻断主流程。
4. **自洽投票 (Self-Consistency)**：最终打分独立跑 N 次取**中位数**，压低大模型方差。
5. **结构化输出强约束**：投票 / 批判 / 裁判三处采用严格 `json_schema`，从源头杜绝字段漂移；provider 不支持时自动降级。

### 💡 瓶颈点投资法五因子自动量化
告别昂贵研报与繁琐产业链核对。输入任何大趋势，AI 按科学框架自动打分：
*   **确定需求 (Confirmed Demand · 20%)**：下游景气度是否明确且可持续。
*   **受限供给 (Constrained Supply · 30%)**：**瓶颈核心！** 短期难复制、没它不行的核心壁垒。
*   **低关注度 (Low Attention · 15%)**：未被市场充分定价的冷门洼地。
*   **价值捕获 (Value Capture · 20%)**：定价权、毛利率、客户绑定深度与份额。
*   **催化剂 (Catalyst · 15%)**：财报、量产、招标、指数纳入等重估节点。

### 🔍 全市场智能挖掘（两段漏斗 + 并行批量）
*   **两段漏斗加速**：先用 clist 批量字段（成交额 / 换手 / 量比，零额外请求）把 4448 只全市场粗筛到数百只，再拉 K 线，**冷扫 K 线请求量降约 5–10×**。
*   **批量 K 线原语**：`getKlinesBatch()` 有界并发 + 缓存 + 单只重试，为高吞吐扫描与回测供能。
*   **截面相对排名**：每只命中股给出在"综合分 / 预期收益"上的全市场 percentile，回答"它今天在命中里排第几"。
*   **卖方一致预期**：聚合东财研报，给出看多占比 / 一致 EPS / 目标价 / 上行空间，单只超时自动降级不拖垮整批。

### 📊 三套回测体系（含 A 股涨跌停撮合真实性）
*   **单只回测**：传统均线突破 + Serenity 瓶颈动量突破多策略（V4→V8 可切换对照），新增**对比基准（买入持有）+ 样本量 + z 检验显著性**标注；回测口径只取前复权有效正价区间，杜绝长周期负价失真。
*   **组合级回测**：按截面排名每 N 日轮动持有 top-K，输出净值曲线 + CAGR + 最大回撤 + 年化夏普 + 换手率 + 交易流水。
*   **建议忠实回测**：把模型给出的买入 / 卖出价区间执行逻辑，放到多股票 + 样本外滚动下跑，统计真实胜率 / 期望收益 / 盈亏比，并对比买入持有，给出显著性结论。
*   **A 股涨跌停撮合真实性**：主板 ±10 / ST ±5 / 创业科创 ±20 / 北交 ±30——**涨停买不进、跌停卖不出、停牌顺延**，杜绝失真成交。

### 📈 诚实准确性体系（样本外胜率 + 校准闭环）
*   **样本外 walk-forward 胜率**：信号在第 t 日只用 ≤t 的数据判定，仅在留出尾段统计前瞻收益，杜绝未来函数；UI 同时并排展示"样本内对照（通常偏高）"。
*   **校准闭环 (Calibration Loop)**：每次分析自动把预测落库，事后回填真实涨跌后计算 **Brier 分 + 可靠性曲线 + 实际命中率**——不度量，就不宣称"更准"。

### 🎨 沉浸式专业投研美学
精心设计 **8 套极具科技感的配色主题**，渐变与毛玻璃（Glassmorphism）让数据界面如高端金融杂志：极光冰川、熔岩赤金、雨林寒露、冰川极光、香槟宣纸……冷暖明暗一键切换，全局 CSS 变量自适应。

### 📸 爆款社交分享海报生成器
一键生成专为**小红书 / X / Meta** 设计的专业研报海报：9:16 竖版与 16:9 横版自适应、内置博主资质栏与超大评分徽章、高保真 SVG 因子雷达图、Serenity 金句引用卡、2 倍超清 PNG 离线导出。

### 🖥️ TradingView 级深度图表
鼠标滚轮 / 触控板 / 键盘极速缩放、Y 轴价格自适应、~10 年全量历史多波段自动回归通道、1M 月线聚合、MA5–MA250 全系均线、K 线与筹码分布双向深度联动、3 个月阻尼趋势预测、B/S 交易标记透明度即仓位比例（滚动均线 O(n) + 可视窗口通道，扛得住数千根 K 线）。

### 🧭 概念行业选股雷达
行业概念大盘（`/sectors`）追踪题材热度、技术多头比例与行业瓶颈指数，支持从行业穿透至个股的"基本面打分 × 价格动量"双维矩阵筛选。

---

## 🛠️ 技术栈

| 维度 | 选型 |
| :--- | :--- |
| 前端框架 | Next.js 16 (App Router) · React 19 |
| 样式体系 | Tailwind CSS v4（含 PostCSS） |
| 语言 | TypeScript（严格模式，全量 `tsc --noEmit` 通过） |
| LLM 接入 | `openai` SDK，兼容任意 OpenAI 风格服务（OpenAI / DeepSeek / OpenRouter / 通义千问…） |
| 海报渲染 | `html-to-image` 无损离线导出 |
| 数据采集 | `playwright-core`（抓取 X 一手发言） |
| 行情来源 | 东方财富 / 腾讯 / 新浪 / 百度 / 同花顺 / 巨潮 多源互备 |

> 🧩 **零额外重型依赖**：所有量化引擎（回测 / 校准 / 排名 / 漏斗）均为纯 TypeScript 实现，无 Python sidecar 也可完整运行。

---

## 🚀 快速开始

### 1. 安装与本地启动
```bash
npm install
npm run dev        # 默认运行在 http://localhost:3000
```

### 2. 配置大语言模型
打开浏览器导航至 **`/settings`（设置页）**，填入任意 OpenAI 兼容服务：
*   **Provider**：如 `DeepSeek`
*   **Base URL**：如 `https://api.deepseek.com/v1`
*   **Model**：如 `deepseek-chat`
*   **API Key**：`sk-...`

> 🔒 API Key **仅存储在你的本地服务端** `.data/llm-config.json`，绝不回传浏览器。

配置完成即解锁全部 AI 能力（个股分析 / 智能挖掘 / 多智能体复核）。

### 3. 质量核验（发版前必跑）
```bash
npm run type-check     # tsc --noEmit 全量类型核验
npm run lint           # ESLint 规范与最佳实践
npm run build          # 生产构建
```

---

## 📖 详细使用说明

### 🔬 个股分析 · `/analyze`
最核心的工作台。输入 6 位代码或名称，走完整多智能体工作流：

1. **获取行情** → 拉取实时报价、K 线与统计窗口。
2. **AI 五因子推理** → 生成器流式输出五因子打分与论述，每项附数据证据。
3. **结构化汇总** → 解析为可量化的 `ChokepointAssessment`。
4. **自洽投票** → 独立多次打分取中位降方差（可关闭，见环境变量）。
5. **批判者复核** → 列出反证 / 无依据论断 / 过拟合提示，带严重度。
6. **裁判调和** → 给出**最终置信度**与保守调整后的总分。

页面下方还会呈现：
*   **回测口径胜率**：样本外 walk-forward 命中率 + 样本内对照 + N 日前瞻 + 信号数。
*   **对比基准**：策略累计收益 vs 同期买入持有、超额 pp、对 50% 的 z 检验显著性徽章（样本 < 30 明确标"不显著"）。
*   **校准闭环卡片**：当前全局 Brier 分、实际命中率与可靠性曲线。
*   **筹码分布 / 技术形态 / 价格情景 / 一键分享海报。**

```bash
# API（流式 NDJSON）
curl -N -X POST localhost:3000/api/analyze \
  -H 'content-type: application/json' -d '{"code":"600519"}'
```

### 🔍 智能挖掘 · `/mining`
全市场扫描隐形冠军。支持 `full` / `broad` / 自定义股票池，两段漏斗自动粗筛，可选补充卖方一致预期。

```bash
curl -s -X POST localhost:3000/api/mining -H 'content-type: application/json' \
  -d '{"universe":"full","stream":false,"withAnalyst":true,"analystTopN":10}'
# 关闭粗筛跑真全量：追加 "prefilter": null
```

### 📊 组合回测 · `/backtest`
填入股票池与参数（初始资金 / 最大持仓 / 再平衡间隔 / 单边手续费 bps / 取 K 根数），运行后渲染统计卡 + 净值曲线（纯 SVG）+ 交易流水。

```bash
curl -s -X POST localhost:3000/api/backtest/portfolio -H 'content-type: application/json' \
  -d '{"codes":["600519","000858","300750","600036","000333"],
       "maxPositions":3,"rebalanceEveryNDays":5,"feeBps":30}'
# 默认参数演示：GET /api/backtest/portfolio
```

### 🎯 建议忠实回测 · `/backtest/strategy`
**回答"照着策略建议买卖，到底有没有较大胜率"** 的关键工具。多股票池 + 样本外滚动 + 涨跌停撮合 + 手续费，统计买卖建议真实胜率 / 期望 / 盈亏比，对比买入持有，给出 z 检验显著性结论（绿=有据且超额 / 琥珀=高胜率无超额 / 红=不显著或样本不足）。

```bash
curl -s -X POST localhost:3000/api/backtest/recommendation -H 'content-type: application/json' \
  -d '{"codes":["600519","000858","300750"],"feeBps":30}'
```

### 📈 校准闭环 · `/api/calibration/record`
每次 `/analyze` 会自动落库一条预测。一段时间后用真实前瞻收益回填，即可得到 Brier 分与可靠性曲线：

```bash
# 回填真实涨跌（hit 默认按 actualReturnPct>0 判定）
curl -s -X POST localhost:3000/api/calibration/record -H 'content-type: application/json' \
  -d '{"code":"600519","actualReturnPct":3.5,"horizonDays":5}'
# 查看当前校准摘要（Brier / 命中率 / 可靠性曲线）
curl -s localhost:3000/api/calibration/record
```

### 🧭 板块热力 · `/sectors`　🔄 数据同步 · `/sync`　⚙️ 设置 · `/settings`
*   **板块热力**：题材热度、技术多头比例、行业瓶颈指数，支持穿透至个股雷达。
*   **数据同步**：本地缓存行业-成分股映射与一手发言（`scripts/sync-sectors.mjs` / `scripts/scrape-x.mjs`）。
*   **设置**：LLM 配置、模型选择、缓存 TTL 管理。

---

## 🔌 API 速查表

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `POST` | `/api/analyze` | 个股多智能体分析（流式 NDJSON） |
| `POST` | `/api/mining` | 全市场 / 自定义池智能挖掘 |
| `POST` | `/api/mining/daily` | 每日全量池挖掘（保覆盖粗筛） |
| `POST` `GET` | `/api/backtest/portfolio` | 组合级回测 / 默认参数 |
| `POST` `GET` | `/api/backtest/recommendation` | 建议忠实回测 / 默认参数 |
| `POST` `GET` | `/api/calibration/record` | 回填真实涨跌 / 校准摘要 |
| `GET` | `/api/market/*` | 行情、搜索、K 线、板块、批量报价等 |

---

## 🌱 环境变量

| 变量 | 默认 | 说明 |
| :--- | :--- | :--- |
| `SELF_CONSISTENCY_RUNS` | `2` | 自洽投票额外打分次数；设 `0` 关闭以节省 token |

> LLM 凭据通过 `/settings` 页写入 `.data/llm-config.json`，无需环境变量。

---

## 📂 项目结构

```
├── src/
│   ├── app/                      # 路由页面与 API
│   │   ├── analyze/              # 个股多智能体分析
│   │   ├── mining/               # 全市场智能挖掘
│   │   ├── backtest/             # 组合回测 + strategy 建议忠实回测
│   │   ├── sectors/ scanner/ chart/ map/ sync/ settings/
│   │   └── api/                  # analyze / backtest / calibration / mining / market …
│   ├── components/               # QuantChart / SharingCard / RadarChart / ThemeSwitcher …
│   └── lib/                      # 算法与数据层
│       ├── agentWorkflow.ts      # 生成器→批判者→裁判 编排 + 回测锚定胜率
│       ├── serenity.ts           # 五因子 / 批判 / 裁判 / 投票 prompt
│       ├── quant.ts              # 单只回测 / 筹码 / 技术形态 / 样本外胜率
│       ├── portfolioBacktest.ts  # 组合级回测引擎
│       ├── recommendationBacktest.ts # 建议忠实回测框架
│       ├── calibration.ts        # 校准闭环（Brier / 可靠性）
│       ├── miningScan.ts mining.ts   # 两段漏斗 + 截面排名 + 卖方一致预期
│       ├── llm.ts                # OpenAI 兼容封装（含 json_schema 强约束）
│       └── sources/              # 东财/腾讯/新浪/百度/同花顺/巨潮 多源 + unified 门面
├── data/                         # 行业映射 / 知识库 / 热度榜 JSON
├── knowledge/                    # 方法论 markdown
├── scripts/                      # 行业同步 / X 抓取脚本
└── public/                       # 静态资源
```

---

## 🧪 准确性与诚实边界（务必阅读）

*   **UI 胜率 ≠ 模型买卖建议胜率**：样本外 walk-forward 胜率度量的是"该价格形态的历史前瞻命中率"，是诚实下界；要验证"照模型建议买卖"的真实胜率，请用 **`/backtest/strategy` 建议忠实回测**。
*   **单只样本通常偏小**（< 30），统计上不显著——证明策略请用多股票池。
*   **样本外信号基于纯价格动量代理**，非逐日重算 LLM 瓶颈点分（那需历史财报快照）。
*   **多智能体复核会增加 LLM 调用**（批判 / 裁判各 +1 次非流式；投票默认 +2 次，可用 `SELF_CONSISTENCY_RUNS=0` 关闭）。

---

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request！项目内代码注释、文档与提交信息统一采用**简体中文**。发版流程：升级 `package.json` 版本号 → 在 `CHANGELOG.md` 记录详细条目 → 构建通过后推 tagged 标签。

*如果你喜欢这个项目，不妨点一个 ⭐ Star，感谢支持！*
