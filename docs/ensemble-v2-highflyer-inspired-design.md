# Ensemble V2 — 幻方式「多策略正交融合 + 风控闸门」设计与实施计划

> 参考文档：`docs/high-flyer-stragory.md`（幻方 High-Flyer 式架构：GP 因子挖掘、层次化强化学习(HRL)路由 + 值分解(VDN)融合、多智能体相互监督(MARL) + 风控 Critic 否决权、多时段流水线，"三防一算"）。
>
> 本文把参考文档中**可落地**的思想，映射到本项目现有的日线回测 + 元策略(Ensemble)架构上，给出 V2 的设计、任务分解与实施计划。

---

## 0. 诚实前提（Scope 边界）

- 本项目是**日线级、可解释、可回测**的量化系统，无 Level-2、无强化学习训练基建、无实时新闻流。参考文档中的 GP 遗传算法自动挖因子、TCN/Transformer、完整 MARL/MAPPO **训练类**能力属"屠龙之技"，本轮**不做**（过拟合风险高、`eval()` 动态因子有安全风险，与定位不符），列入远期。
- 现有 `ensemble-v1`（架构 B：加权投票 + 连续仓位，方向感知 regime）**并不跑赢买入持有**；V2 的目标不是"变魔术拉收益"，而是**提升稳健性与跨标的一致性**：在几乎不牺牲收益的前提下压低回撤、降低成员同质化风险、增加对抗性风控。

## 1. 参考文档 → 本项目 采纳矩阵

| 参考文档思想 | 对应本项目 | 本轮决策 |
|---|---|---|
| 多策略叠加须做**正交化**、防"虚假多因子共振"（三防一算的"一算"） | `ensemble.ts` 成员为固定权重加权平均，趋势核心 cardwell-v4/v3 + chokepoint-v5 高度同源 | **采纳**（A：相关性感知 / 风险平价配权） |
| HRL 上层路由 + VDN 值分解按夏普最大化合并子策略 | 我们已有"regime 调制权重 + 仓位加权求和"（VDN 的加和本质一致），但 baseWeight 是**手调固定值** | **采纳（简化正规化）**：把配权从人工拍数改为数据驱动（风险平价 / 相关性惩罚 / 夏普倾斜），可选滚动走前 | 
| 风控官(Critic)拥有**无条件否决权 / 硬止损**，量价风控状态机最高执行权 | 我们只有成员内 ATR 止损 + `posCap`，**缺组合级 kill-switch** | **采纳**（B：组合级风控闸门） |
| 正交的 LLM 语义/事件因子（与量价相关性≈0 才叫 alpha 复合） | 已有 LLM 层（chokepoint 打分 / AI 研判 assessment），但未作为独立因子进 ensemble | **远期**（V2.1：把催化剂/事件做成正交成员，先验证相关性） |
| 动态时间窗（开盘博弈期 vs 尾盘趋势期分时段配权） | 我们 regime 已做"方向决定权重"；但策略跑**日线**，无日内分时段路由 | **远期**（需先补分时数据管线） |
| GP 挖因子 / TCN / Transformer / 完整 MARL 训练 | — | **不做**（远期） |

---

## 2. V2 设计

V2 = `ensemble-v1` 的两处增强，**不改动** v1 与默认 Pro 策略（`chokepoint-momentum-v7`）。新增独立元策略 `ensemble-v2`，`selfMatched: true`。

### A. 成员正交化 + 数据驱动配权

**动机**：加权平均若成员高度同源，只是放大同一 beta、不降风险。真正的分散来自**低相关成员**。

**成员收益序列**：复用 `memberPositionSeries` 得到各成员逐根敞口 `pos[i]∈[0,1]`，其**逐根策略收益**近似为 `r_i[t] = pos_i[t-1] * (close[t]/close[t-1] - 1)`（用上一根敞口吃当根涨跌，无未来函数）。

**相关矩阵**：对成员收益序列两两算 Pearson 相关（复用 `pairTrading.ts` 里已有的相关性计算，必要时抽出一个通用 `pearson(a,b)` 工具）。

**配权方案（`weightScheme` 配置项）**：
1. `fixed`（= v1 现状：手调 baseWeight）——基线；
2. `equal`——等权；
3. `invVol`——反波动（风险平价一阶近似）：`w_i ∝ 1/σ_i`，`σ_i` 为成员收益标准差；
4. `riskParity`——等风险贡献（ERC，迭代解或用相关矩阵的近似）；
5. `corrPenalized`——相关性惩罚：`w_i ∝ baseWeight_i / Σ_j |ρ_ij|`，对与他人高相关的成员降权。

**走前因果（无未来函数）**：默认对权重做**滚动窗口**估计——第 `i` 根用 `[i-L, i-1]` 的成员收益估相关/波动、定权重，应用到第 `i` 根的仓位混合；窗口不足时回退 `fixed`。（先用全样本 in-sample 做**诊断脚本**选型，确定收益/回撤最优的方案后，再落地为走前版本。）

**regime 叠加**：配权得到的 `w_i` 仍乘以现有 `regimeFactor`（方向感知 regime 保留），二者正交——一个管"成员间风险分散"，一个管"行情状态择时"。

### B. 组合级风控闸门（Global Risk Gate / Critic）

**动机**：参考文档"三防"——量化风控状态机拥有最高无条件执行权。给 Ensemble 加一个**独立于成员信号**的组合级降仓/清仓闸门。

**因果口径**：在 `computeEnsembleTargets` 混合出 `blendedTarget[i]` 后，逐根维护一条**因果合成净值**（用已决定的、只依赖 `≤i` 信息的目标仓位对标的做 mark-to-market：`eq[t] = eq[t-1] * (1 + posTarget[t-1]*ret[t])`），据此在第 `i` 根用 `≤i` 的信息计算风控乘数 `gate[i]∈[0,1]`，作用到 `target[i] = gate[i] * blendedTarget[i]`，再交给 `executeTargetPositionNextOpen`（第 i 根决策、第 i+1 开盘执行，口径一致）。

**两条闸门（取更严者）**：
1. **回撤闸门**：合成净值自峰值回撤 `dd`；`dd ≤ ddSoft`（如 −8%）不干预；`ddSoft < dd ≤ ddHard`（如 −8%~−15%）时线性降仓 `gate = (ddHard-|dd|)/(ddHard-ddSoft)`；`dd > ddHard` 强制 `gate=0`（kill-switch），并进入**冷却期** `cooldownBars`（回撤修复到 `ddSoft` 以内且冷却结束才恢复）。
2. **波动闸门**：近 `volLen` 根标的已实现波动（或 ATR%）超阈值 `volCap` 时按超出比例降仓。

**配置项**（挂进 `EnsembleConfig`）：`riskGate: boolean`、`ddSoft`、`ddHard`、`cooldownBars`、`volLen`、`volCap`。

---

## 3. 验收标准（§ Acceptance，12 只 A 股 · 400 日线 · chokepointScore=78 · 次日开盘撮合 · 含双边成本）

对照 `ensemble-v1`（收益 +63.0% / 回撤 −16.6% / 盈利股占比 50% / 夏普 0.147）：

1. **回撤严格优于 v1**：`ensemble-v2` 最大回撤 **< −16.6%**（风控闸门应压回撤）。
2. **收益不大幅损失**：`ensemble-v2` 收益 **≥ v1 的 90%**（≈ +56.7%）。
3. **分散度提升**：加权后成员的**有效个数** `1/Σw_i²`（权重 HHI 倒数）较 v1 提升，或加权成员两两相关的加权均值下降。
4. **盈利股占比维持** ≥ 50%。
5. **无未来函数**：配权走前 + 风控因果，诊断脚本需给出"全样本 in-sample vs 走前 out-of-sample"两版对照，避免过拟合自欺。

若 ①与②冲突（压回撤必然损收益），以"**单位回撤换来的收益**（收益/|回撤|，类 Calmar）**不低于 v1**"作为兜底判定，并在文档如实记录取舍。

---

## 4. 任务分解与实施计划

- **T1 诊断脚本** `scripts/bt_ens_orthon.ts`：输出 5 成员**收益相关矩阵** + 5 种 `weightScheme` 的**全样本对比回测表**（收益/回撤/夏普/盈利股占比/权重 HHI）。数据驱动选出候选配权方案。里程碑：出数据汇报。
- **T2 配权落地**：`ensemble.ts` 加 `weightScheme` 与走前滚动配权（含通用 `pearson`/`stddev` 工具，复用/抽取自 `pairTrading.ts`）；`fixed` 保持与 v1 完全一致（回归保护）。
- **T3 风控闸门**：实现因果 `applyRiskGate(blended, candles, cfg)`；挂进 `computeEnsembleTargets` 末端；`riskGate:false` 时行为与不加闸门一致。
- **T4 调参**：`scripts/bt_ens_v2_grid.ts` 扫 `weightScheme × ddSoft/ddHard × volCap`，锁定 `ENSEMBLE_V2_DEFAULTS`，跑通 §3 验收；出数据汇报。
- **T5 注册**：`STRATEGIES` 增 `ensemble-v2`（`selfMatched:true`），**保留 `ensemble-v1`、默认 Pro 不变**。
- **T6 收尾**：更新本文 §5 实施结果 + `README`/`CHANGELOG` + `package.json` 版本；`tsc --noEmit && eslint && npm run build` 全绿。
- **T7 提交**：按用户约定**直接提交 main** 并汇报（附验收对照表与诚实取舍）。

## 5. 实施结果（开发完成后回填）

> 待 T4/T6 完成后回填：最终 `ENSEMBLE_V2_DEFAULTS`、相关矩阵、§3 验收对照、in-sample vs 走前对照、诚实取舍说明。
