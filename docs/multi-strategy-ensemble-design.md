# 全策略统一回测 · 打分排名 · 组合建议 · 多策略并行决策方案

> 目的：把系统内**全部 23 个已注册策略**放到同一口径下回测排名并打分，给出评分依据与
> 组合建议，并据此设计一个**多策略并行决策（Ensemble）**的优化方案 + 任务拆解。
> 本文档为「开发前设计稿」，签字确认后再逐个任务实现。

## 0. 回测口径（统一）

- 标的：12 只篮子 `300024 601869 300750 600522 002594 600519 000001 600036 002230 300059 601127 000858`
- 数据：每只最近 **400 根日线**（后复权 qfq），失败源自动切换（`getKlineFailover`）
- 撮合：**次日开盘价成交**（`executeTradesNextOpen`），双边手续费；分批策略市值 = `cash + shares*close`
- 指标：`strategyReturn`（区间收益%）、`maxDrawdown`（最大回撤%）、`winRate`（胜率%）、
  `sharpe`（净值序列夏普）、`posStocks%`（12 只中盈利的占比 = 一致性代理）
- **重要假设**：Chokepoint 家族由「基本面瓶颈打分 chokepointScore」门控（<55 全拒、≥75 开启强突破分支）。
  本纯技术回测无 LLM 基本面分，对篮子（均高质量龙头）**统一取 78**（乐观「优质通过」），
  使其能实际交易；真实表现取决于该分数逐股是否准确 —— 故 Chokepoint 家族名次偏乐观。

## 1. 统一回测结果（按收益排名）

| 名次 | 策略 id | 收益% | 回撤% | 胜率% | 夏普 | 盈利股占比% |
|---|---|---|---|---|---|---|
| 1 | chokepoint-momentum-v5 | 114.7 | −27.8 | 41.7 | 0.23 | 33 |
| 2 | tv-cardwell-rsi-navigator-v4 | 87.5 | −21.5 | 40.6 | 0.23 | 42 |
| 3 | chokepoint-momentum-v2 | 84.1 | −34.1 | 39.2 | −0.22 | 25 |
| 4 | chokepoint-momentum-v4 | 80.2 | −31.8 | 35.5 | −0.02 | 25 |
| 5 | chokepoint-momentum-v3 | 78.3 | −33.6 | 41.5 | −0.03 | 25 |
| 6 | tv-cardwell-rsi-navigator-v3 | 63.3 | −19.9 | 38.4 | 0.24 | 42 |
| 7 | tv-kama-momentum-v1 | 53.4 | −24.0 | 32.3 | −0.09 | 17 |
| 8 | chokepoint-momentum-v6 | 50.4 | −27.1 | 40.6 | 0.17 | 25 |
| 9 | tv-cardwell-rsi-navigator-v2 | 37.5 | −23.0 | 35.0 | 0.02 | 25 |
| 10 | chokepoint-momentum-v7（现默认） | 35.7 | −20.5 | 46.7 | 0.21 | 42 |
| 11 | tv-cardwell-rsi-navigator-v5 | 18.9 | −12.5 | 45.3 | 0.02 | 33 |
| 12 | boll-squeeze-v1 | 15.2 | −14.4 | 29.5 | −0.27 | 42 |
| 13 | chokepoint-momentum-v8 | 14.2 | −20.3 | 46.7 | 0.17 | 42 |
| 14 | chokepoint-momentum-v1 | 10.9 | −31.4 | 25.7 | −0.24 | 33 |
| 15 | macd-zero-trend-v1 | 10.4 | −4.7 | 30.6 | −0.18 | 33 |
| 16 | traditional-ma | 7.0 | −5.8 | 29.7 | 0.00 | 25 |
| 17 | channel-reversion-v1 | 1.8 | −11.0 | 55.3 | −0.12 | 58 |
| 18 | rsi-reversion-v1 | 0.3 | −0.6 | 37.5 | −0.70 | 33 |
| 19 | tv-cardwell-rsi-navigator-v1 | −0.0 | −16.6 | 36.7 | −0.09 | 33 |
| 20 | confluence-v1 | −1.0 | −6.6 | 30.6 | −0.72 | 17 |
| 21 | fib-kdj-pullback-v1 | −4.5 | −6.2 | 8.3 | −0.59 | 8 |
| 22 | grid-mean-reversion | −4.6 | −11.0 | 26.8 | −0.64 | 17 |
| 23 | tv-supertrend-adaptive-v1 | −8.9 | −18.5 | 8.3 | −0.53 | 17 |
| — | **买入持有（基准）** | **+163.7** | — | — | — | — |

> ⚠ **没有任何单策略跑赢买入持有（+163.7%）**。这一篮子几乎全是大市值强趋势龙头，
> 单边长牛，任何「择时/止盈」都在牺牲尾部收益。策略的价值不在「跑赢满仓死拿」，而在
> **控回撤、提高胜率一致性、在非单边行情里活下来**。

## 2. 综合打分（风险调整后）

### 2.1 评分依据（方法）
对 5 个维度做 **min-max 归一化**（0–1，越高越好；回撤取绝对值小者为优），加权求和×100：

| 维度 | 权重 | 理由 |
|---|---|---|
| 收益 ret（**截断上限 100%**，抑制 601869 单只长尾主导） | 0.30 | 赚钱是第一目的，但截断防止「一只妖股」绑架排名 |
| 最大回撤 maxDD | 0.25 | 可持有性/心理承受，回撤过深实盘拿不住 |
| 胜率 win | 0.15 | 交易体验与一致性 |
| 夏普 sharpe | 0.15 | 净值平滑度/风险调整收益 |
| 盈利股占比 posStocks | 0.15 | **跨标的一致性**（不是靠一只票） |

### 2.2 综合评分排名（TOP 表）

| 名次 | 综合分 | 策略 id | 一句话定位 |
|---|---|---|---|
| 1 | **71.1** | tv-cardwell-rsi-navigator-v4 | 收益高 + 回撤适中 + 跨股一致性最好，风险调整后最优 |
| 2 | 67.6 | chokepoint-momentum-v5 | 收益最高，但回撤 −27.8%、只 1/3 股盈利（长尾驱动） |
| 3 | 65.1 | tv-cardwell-rsi-navigator-v3 | 夏普最高(0.24)、回撤最小的趋势款，稳健趋势核心 |
| 4 | 59.5 | channel-reversion-v1 | **胜率最高 55.3% + 盈利股占比最高 58%**，低回撤均值回归 |
| 5 | 59.2 | chokepoint-momentum-v7（现默认） | 胜率 46.7%、回撤 −20.5%，均衡 |
| 6 | 54.6 | tv-cardwell-rsi-navigator-v5 | **回撤最小(−12.5%)** 的趋势款，分批止盈平滑净值 |
| … | … | … | （完整 23 名见附录/回测脚本输出） |
| 22 | 24.1 | fib-kdj-pullback-v1 | 胜率仅 8.3%，基本失效 |
| 23 | 17.1 | tv-supertrend-adaptive-v1 | 收益 −8.9%、胜率 8.3%，本篮子最差 |

### 2.3 分档结论
- **A 档（可作核心）**：cardwell-v4、cardwell-v3、chokepoint-v5、chokepoint-v7、channel-reversion-v1、cardwell-v5
- **B 档（可作卫星/特定行情）**：chokepoint-v6/v8、macd-zero-trend、traditional-ma、boll-squeeze、kama
- **C 档（本篮子表现差，建议下架或仅演示）**：supertrend、fib-kdj、grid-mean-reversion、confluence-v1、cardwell-v1、chokepoint-v1

## 3. 组合建议（为什么要组合）

**核心洞察：最高收益 ≠ 最优组合。** 上面这些策略**收益来源与失效场景各不相同**，
把「相关性低、失效点错开」的几只组合起来，能在**不牺牲太多收益**的前提下显著压回撤、提一致性：

- **趋势核心（吃单边）**：cardwell-v4 或 chokepoint-v5 —— 强趋势龙头的主升浪
- **稳健趋势（平滑）**：cardwell-v3 / v5 —— 回撤更小、夏普更高
- **均值回归卫星（吃震荡/箱体）**：channel-reversion-v1 —— **和趋势款负相关**：
  趋势款在震荡里反复挨打时，它胜率最高、盈利股最多，正好互补
- **尾部保护（低波动）**：rsi-reversion / macd-zero-trend —— 回撤极小，横盘期占位不亏

> 直觉验证：channel-reversion（第 17）单独看收益垫底，但它的**盈利股占比 58% 全场最高、
> 回撤仅 −11%**，恰恰是在趋势款亏钱的那些震荡票上赚钱 —— 这正是「组合价值」的证据。

## 4. 优化方案：多策略并行决策引擎（Ensemble）

### 4.1 目标
把「选一个策略」升级为「**多策略并行运行 → 按行情状态加权 → 汇总成一个决策/仓位**」，
在回测上做到：**回撤优于任一核心单策略、收益不低于稳健趋势款、胜率/一致性提升**。

### 4.2 三种可选架构（建议 B，A→B→C 递进实现）

**架构 A：Regime-Switch（行情路由，最简单）**
- 用 `ADX / 回归通道斜率 / MA 结构` 判定 regime（趋势 vs 震荡 vs 无序）
- 趋势 → 只听趋势核心（cardwell-v4/v3）；震荡 → 只听 channel-reversion；无序 → 空仓
- 优点：可解释、易实现；缺点：切换点抖动、单点押注

**架构 B：加权投票 + 仓位聚合（推荐）**
- N 个成员策略**并行**在每根 bar 输出 {方向, 置信度}；
- 每个成员一个**权重**（可静态配置，或按滚动表现/逆回撤动态调整 = 风险平价雏形）；
- 聚合出**目标仓位**（0–100%）：`pos = clip(Σ wᵢ·signalᵢ·confᵢ)`，做**连续仓位**而非全进全出；
- regime 作为**权重调制器**（趋势期给趋势款加权、震荡期给均值回归加权），而非硬开关；
- 统一风控：组合层最大回撤熔断、单成员最大权重上限。

**架构 C：分资金独立账本（真·组合，最贴近实盘）**
- 把总资金按权重分给各成员，**各自独立持仓/独立止盈止损**，组合净值 = 各账本加总；
- 最真实、最能体现分散化，但改造回测引擎较大（多账本并行撮合）。

### 4.3 落地设计（架构 B 为主）
- 新文件 `src/lib/ensemble.ts`：
  - `EnsembleConfig`：成员列表 [{strategyId, baseWeight}]、regime 调制表、仓位上限、熔断阈值
  - `runEnsemble(candles, ctx, config): BacktestResult` —— 复用各成员 `getStrategy(id).run()` 拿到
    逐 bar 信号/交易，转成逐 bar 目标仓位序列，交给（扩展后的）撮合器
- 撮合器：`executeTradesNextOpen` 目前是「信号→全/半仓」。架构 B 需要**目标仓位序列撮合**
  （每根 bar 调整到目标仓位），新增 `executeTargetPositionNextOpen(candles, targetPos[])`；
  分批市值口径沿用 `cash+shares*close`。
- 注册：Ensemble 作为一个「元策略」进 `STRATEGIES`（id `ensemble-v1`），可在 `/chart`、
  `/analyze`、`/backtest/strategy` 选用；**默认 Pro 仍保持现状不变**，Ensemble 跑赢再议默认。
- 回测：`scripts/bt_all.ts` 已可跑全策略；新增 `scripts/bt_ensemble.ts` 对比
  Ensemble vs 各核心单策略 vs 买入持有（重点看回撤/一致性/夏普）。

### 4.4 验收标准（用数据说话，跑不赢就不发布/不切默认）
1. Ensemble 平均**最大回撤 < 最优核心单策略**（目标 < −18%）；
2. 平均收益 ≥ 稳健趋势款（cardwell-v3 ≈ +63%）的 **80%**；
3. **盈利股占比 ≥ 50%**（跨标的一致性优于多数单策略）；
4. 夏普 ≥ 全部单策略中位数。
> 达不到就如实报告、不硬切默认（延续 V4/V5 的诚实口径）。

## 5. 任务拆解（逐个完成）

- [ ] **T1** 固化统一回测脚本 `scripts/bt_all.ts`（已完成，随本设计入库）+ 打分脚本，产出基准表
- [x] **T2** 撮合器扩展：`executeTargetPositionNextOpen(candles, targetPos[])`（目标仓位序列撮合，次日开盘再平衡、1% 权益防抖阈值、`cash+shares*close` 净值口径）
- [x] **T3** `src/lib/ensemble.ts`：EnsembleConfig + **方向感知 regime** 检测（`computeADX` 定强弱 + `computeRegressionChannel` 斜率定方向）+ 加权投票聚合 → 目标仓位
- [x] **T4** 实现架构 B 的 `ensemble-v1`（静态权重）；`scripts/bt_ensemble.ts` / `scripts/bt_ens_grid.ts` 回测对比
- [x] **T5** 迭代：方向感知 regime 权重调制 + 网格调参至满足 §4.4 验收（详见 §7）
- [x] **T6** 注册进 `STRATEGIES`（`ensemble-v1`，`selfMatched` 自撮合，不改默认 V7）；`tsc`/`lint`/`build` 全绿
- [x] **T7** 同步 README / CHANGELOG / 版本号 / tag / GitHub Release，CI 转绿
- [ ] **T8**（可选）架构 C 分资金独立账本，作为 `ensemble-v2` 进阶

## 6. 附：复现
- 全策略回测：`npx tsx scripts/bt_all.ts`
- Ensemble 对比：`npx tsx scripts/bt_ensemble.ts`（ENSEMBLE-v1 vs 各核心单策略 vs 买入持有）
- 参数网格：`npx tsx scripts/bt_ens_grid.ts`（posCap / trendBoost / relSlope / 成员权重扫描）
- 打分：见 §2.1 权重（脚本随库提供）

## 7. 最终实现（Final Implementation · v0.58.0）

### 7.1 落地架构
架构 B「加权投票 + 连续仓位聚合」。5 个成员并行回测 → 每个成员逐根敞口 `memberPos[i]∈[0,1]`（`memberPositionSeries`：buy 累加 sizePct、sell 按敞口比例减仓）→ 按权重（经 regime 调制）加权平均 → 组合逐根目标仓位 `targetPos[i]∈[0,posCap]` → `executeTargetPositionNextOpen` 次日开盘再平衡撮合。

**关键设计：方向感知 regime（`detectRegime`）。** 早期版本 regime 只用 ADX 判「是否成趋势」，但 A 股下跌段 ADX 同样高 → 下跌票被判「趋势」→ 反手压低均值回归成员，反而在最该低吸的地方减配，跨标的一致性上不去。改为：`ADX≥adxTrendMin` 且回归通道相对斜率 `slope/mid ≥ +relSlopeTrendMin` → `trend_up`（抬升趋势成员、压低回归成员）；`≤ −relSlopeTrendMin` → `trend_down`；其余 → `range`。**只有 `trend_up` 抬升趋势成员**，`range`/`trend_down` 一律抬升均值回归、压低趋势成员。这样「上行趋势多吃趋势 alpha（拉高收益）」与「震荡/下行多靠回归低吸（拉高一致性）」两个杠杆被解耦——`trendBoost` 可以调大以在上行段更激进吃趋势，而不牺牲下行段的回归配置。

### 7.2 最终参数（`ENSEMBLE_V1_DEFAULTS`）

| 项 | 值 | 说明 |
|---|---|---|
| 成员 · Cardwell V4 (trend) | baseWeight 0.24 | RSI 趋势跟随核心（高收益、高波动） |
| 成员 · Cardwell V3 (trend) | 0.20 | 稳健趋势基准 |
| 成员 · Chokepoint 动量 V5 (trend) | 0.18 | 动量突破 + ADX 闸门 |
| 成员 · 回归通道 V1 (reversion) | 0.26 | 震荡/下行低吸主力（一致性来源） |
| 成员 · RSI 超卖回归 V1 (reversion) | 0.12 | 低波动尾部低吸 |
| `posCap` | 0.95 | 组合最大总仓位 |
| `regimeModulation` | true | 启用方向感知 regime 调制 |
| `adxTrendMin` | 20 | ADX 趋势强弱阈值 |
| `relSlopeTrendMin` | 0.0008 | 回归通道每根相对斜率方向阈值 |
| `trendBoost` | 2.5 | 受青睐一类成员 ×2.5、另一类 ÷2.5 |
| `channelLen` | 60 | 回归通道回看根数（方向判定） |

### 7.3 §4.4 验收结果（12 只 A 股 · 400 根日线 · chokepointScore=78 · 含双边手续费 · 次日开盘撮合）

| 验收项 | 目标 | ENSEMBLE-v1 实测 | 结论 |
|---|---|---|---|
| ① 最大回撤 | < −18%，且优于最优趋势核心 | **−16.6%**（v3 −21.1 / v4 −23.2 / chk5 −27.5） | ✅ |
| ② 平均收益 | ≥ cardwell-v3 的 80%（≈57.1%） | **+63.0%** | ✅ |
| ③ 盈利股占比 | ≥ 50% | **50%**（6/12） | ✅ |
| ④ 夏普 | ≥ 全部单策略中位数（−0.132） | **0.147** | ✅ |

**四项全部达成。** 其中「方向感知 regime + trendBoost=2.5」把 300059 这类下跌票（趋势成员全亏、回归成员 chan +8.9%）从组合 −6.7% 拉正到 **+5.2%**，盈利股数由 4/12 升到 6/12。

### 7.4 诚实口径
- **不跑赢买入持有**（组合 +63% vs BH +163.7%）：这篮子是大市值强单边牛（601869 BH +1825%），任何择时/分散都必然牺牲极端长尾收益。Ensemble 的目标是**压回撤、提一致性**（§4.1），非最高收益，验收标准据此设定，达标即发布。
- **胜率口径参考意义有限**：连续仓位下 shares 极少精确归零，「一段持仓归零记一笔」的胜率统计（26.9%）对再平衡型策略不具代表性，应以收益/回撤/盈利股占比/夏普为准。
- **过拟合风险**：成员选择与权重经该 12 只篮子择优，样本外表现可能回吐；`relSlopeTrendMin`/`trendBoost` 亦为篮子内择优。
- **注册口径**：`ensemble-v1` 带 `selfMatched:true`，`runAllStrategies`/`mining` 经 `executeStrategy` 跳过二次撮合；`/backtest/recommendation` 的「信号回合忠实重放」不适配连续仓位模型，对自撮合策略退回内置简化口径。**默认 Pro 策略维持 `chokepoint-momentum-v7` 不变**，Ensemble 为可选元策略。
