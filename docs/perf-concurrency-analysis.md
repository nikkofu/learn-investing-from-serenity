# 并发性能分析 · 东财请求公平调度架构

> 本文回答一个具体故障：**两个浏览器标签页同时使用时，一个在 `/scanner` 跑批量诊断，另一个在 `/mining` 点「生成今日股票池」却「点了不动」**。
> 内容包含：现象复盘 → 根因分析（架构层）→ 改善方案设计 → 落地实现 → 验证方式 → 后续可选项。
>
> 配套代码：
> - `src/lib/requestContext.ts` —— 请求级上下文（泳道 / 优先级标签）
> - `src/lib/sources/emScheduler.ts` —— 东财请求公平调度器
> - `src/lib/sources/http.ts` —— `emFetch()` 统一入口（接入调度器）
> - `scripts/verify-scheduler.ts` —— 调度器节流 / 公平 / 优先级自检脚本

---

## 1. 现象复盘

| 标签页 | 操作 | 现象 |
|---|---|---|
| A | `/scanner` 批量扫描热门股 | 持续刷出 `POST /api/analyze 200 in 2.4min ~ 5min` |
| B | `/mining` 点「生成今日股票池」 | 按钮点了**长时间无反应**，前端无数据回流 |

后台日志佐证（用户提供）：
- `POST /api/analyze 200 in 2.4min`、`... in 5min`（大量并发，单个请求耗时数分钟）；
- `POST /api/sync 200 in 9.9min`（后台同步任务一次跑近 10 分钟）。

这些都是**跑在同一个 Next.js Node 进程**里的超长请求。问题不在前端按钮，而在后端的**全局请求节流架构**。

---

## 2. 根因分析（架构层）

### 2.1 东财风控约束

所有行情 / 财务 / 候选池数据来自东方财富系接口（`push2` / `datacenter` / `reportapi` / `search` / `np-weblist`）。这些接口有风控：

> **每秒 > 5 次 / 单 IP 并发 ≥ 10 / 1 分钟 ≥ 200 次 → 临时封 IP。**

因此项目要求：所有东财请求必须**单并发 + 最小间隔 + 随机抖动**地串行节流。这一约束本身是**正确且必须保留**的。

### 2.2 原实现：单条全局 FIFO Promise 链

`src/lib/sources/http.ts` 的 `emFetch()` 是所有东财请求的唯一入口。原实现把每个请求**串到一条全局 Promise 链 `emChain` 的队尾**：

```ts
let emChain: Promise<unknown> = Promise.resolve();
let emLastCall = 0;

export function emFetch(url, init = {}) {
  const run = async () => {
    const wait = EM_MIN_INTERVAL_MS - (Date.now() - emLastCall);
    if (wait > 0) await sleep(wait + 100 + Math.random() * 400); // 间隔 + 抖动
    try { return await fetchRetry(url, { ...init, headers: { "User-Agent": UA, ... } }); }
    finally { emLastCall = Date.now(); }
  };
  const result = emChain.then(run, run); // ← 严格 FIFO：串到队尾
  emChain = result.catch(() => undefined);
  return result;
}
```

这条链的语义是**严格先到先服务（FIFO）**：谁先调用 `emFetch`，谁先执行；间隔 ≥ `EM_MIN_INTERVAL_MS`（默认 1000ms）+ 100~500ms 抖动 ⇒ **整个进程对东财的有效吞吐约 0.7~0.9 次/秒**。

### 2.3 故障链路：批量任务把链占满 → 交互任务饿死

`/scanner` 的工作方式（`src/app/scanner/...` → `/api/analyze`）：前端以并发度 5 同时发起多个 `/api/analyze`，**每个**诊断内部又要拉 K 线、指标、资金流等 **10+ 个东财请求**。于是短时间内有**成百上千个**东财请求被灌进 `emChain` 队尾。

此时标签页 B 在 `/mining` 点「生成今日股票池」（`/api/mining/daily` → `generateDailyPool` → 拉全市场候选池 `emClist` 等），它发出的请求**只能排在这条全局链已有的成百上千个请求之后**。按 ~0.8 次/秒的节流速率，排队几分钟才轮得到 ⇒ 前端**点了不动**。

```
emChain (FIFO, 全局唯一, ~0.8 req/s):
  [analyze#1.req1][analyze#1.req2]...[analyze#5.req10]  ← /scanner 灌入数百个
                                              ...
                                   [mining-daily.req1]  ← /mining 只能排队尾
                                                     ↑ 几分钟后才执行 = 点了不动
```

**这是架构层面的资源争用（队头阻塞 / starvation），不是前端 bug，也不是单个接口慢。** 根因是：唯一的全局节流通道 + 纯 FIFO 出队策略，使「大批量低优任务」可以无限挤占「低频高优交互任务」的额度。

### 2.4 为什么不能简单「提高并发 / 去掉节流」

直接放开并发或缩短间隔会**触发东财封 IP**，让所有功能瘫痪。所以**对东财的实际速率必须保持不变**，只能在「**出队顺序**」上做文章——这正是本方案的核心约束。

---

## 3. 改善方案设计

### 3.1 设计目标

1. **保持对东财的实际速率完全不变**（单并发 + 最小间隔 + 100~500ms 抖动），不增加封 IP 风险；
2. 让**交互型前台请求**（如「生成今日股票池」）**不被批量任务饿死**，点击后能尽快开始拿数据；
3. 同优先级的多个批量任务之间**公平共享**额度，互不独占；
4. **最小侵入**：不改动各业务逻辑（扫描 / 诊断 / 同步算法）与对外 API 契约。

### 3.2 方案选型

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 提高并发 / 缩短间隔 | 直接放量 | ✗ 触发东财封 IP，否决 |
| B. 给东财起多 IP / 代理池 | 横向扩容额度 | 成本高、超出本次范围，列入「后续可选」 |
| **C. 公平调度器（本方案）** | 保持速率不变，只改出队顺序：优先级分层 + 同层泳道 round-robin | ✓ 零封禁风险、最小侵入、直接解决饿死 |

采用 **方案 C**。

### 3.3 调度模型

把全局唯一的 FIFO 链替换为**公平调度器 `FairScheduler`**，出队规则两层：

1. **优先级层**：每个请求带 `priority`（数值越小越优先）。调度器永远先服务当前等待集合里的**最小优先级层**，使交互请求整体抢先于批量任务。
2. **同优先级层内 · 泳道 round-robin**：每个请求带 `lane`（泳道）。同一优先级层内，按泳道首次出现顺序**轮转**取任务，使多个批量任务（如 `/scanner` 并发的多个诊断）各占约等量额度，互不独占；同泳道内部仍 FIFO。

节流逻辑（单并发、与上次**完成**时刻保持 `minIntervalMs` + 抖动）**原样保留**，因此对东财的实际请求速率与改造前一致。

```
FairScheduler 出队：
  ① 取等待集合中最小 priority 层（交互 3 < 普通 5 < 批量 7）
  ② 该层内按 lane round-robin 取一个（同 lane 内 FIFO）
  ③ 距上次"完成"不足 minIntervalMs 则 sleep(差值 + 100~500ms 抖动)
  ④ 执行 → 记 lastFinish → 回到 ①
```

### 3.4 如何把「泳道 / 优先级」从 HTTP 入口传到深层 `emFetch`

请求处理链很深（route → `generateDailyPool` → 各 source → `emFetch`），逐层透传参数侵入太大。改用 **Node `AsyncLocalStorage`（ALS）**：在 route 入口用 `withRequestContext({ lane, priority }, fn)` 包裹整个处理过程，`emFetch` 内部用 `currentRequestContext()` 读取标签。ALS 跨 `await` / Promise 链不丢失，无需改动任何中间函数签名。

> 关键细节：上下文只在「**调用 `emFetch` 的那一刻**」读取并**固化到任务对象**上；调度器的 `pump` 循环本身不依赖 ALS。因此即便任务在队列里等待、之后在另一个异步续体里执行，泳道 / 优先级也不会错乱。

---

## 4. 落地实现

### 4.1 新增：请求级上下文 `src/lib/requestContext.ts`

```ts
export interface RequestContext { lane: string; priority: number; }
export const NORMAL_PRIORITY = 5;      // 默认
export const INTERACTIVE_PRIORITY = 3; // 前台交互（抢先）
export const BULK_PRIORITY = 7;        // 后台批量（退让）

const storage = new AsyncLocalStorage<RequestContext>();
export function withRequestContext<T>(ctx, fn): T { return storage.run(ctx, fn); }
export function currentRequestContext() { return storage.getStore(); }
```

### 4.2 新增：公平调度器 `src/lib/sources/emScheduler.ts`

`FairScheduler` 类，核心方法：
- `enqueue<T>(run, lane, priority): Promise<T>` —— 入队，返回的 Promise 在该请求真正执行后 resolve/reject；
- `pickNext()` —— 先选最小优先级层，再在层内按泳道 round-robin（同泳道按入队序号 `seq` FIFO 决胜）；
- `pump()` —— 单并发循环：保持 `minIntervalMs + 抖动` 节流，串行执行；
- `stats()` —— 调试 / 自检用的排队快照（各泳道等待数）。

### 4.3 改造：`emFetch` 接入调度器 `src/lib/sources/http.ts`

```ts
const emScheduler = new FairScheduler({ minIntervalMs: EM_MIN_INTERVAL_MS });

export function emFetch(url, init = {}) {
  const run = () => fetchRetry(url, { timeoutMs: 15000, retries: 1, ...init,
    headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
  const ctx = currentRequestContext();           // 调用方异步上下文里的标签
  const lane = ctx?.lane ?? "default";            // 未设置 → 默认泳道
  const priority = ctx?.priority ?? NORMAL_PRIORITY;
  return emScheduler.enqueue(run, lane, priority);
}
```

### 4.4 改造：在各 route 标注泳道 / 优先级

| 路由 | 泳道 lane | 优先级 | 理由 |
|---|---|---|---|
| `POST /api/mining/daily` | `mining-daily` | `INTERACTIVE_PRIORITY` (3) | 「生成今日股票池」是前台交互，候选池拉取应抢先 |
| `POST /api/mining` | `mining` | `NORMAL_PRIORITY` (5) | 手动形态扫描，与批量诊断公平共享 |
| `POST /api/analyze` | `analyze:${code}` | `BULK_PRIORITY` (7) | `/scanner` 并发的逐只诊断，**每只一条泳道**互相轮转，整体退让交互请求 |
| `POST /api/sync` | `sync` | `BULK_PRIORITY` (7) | 后台数据同步，主动退让交互请求 |
| 其它未标注 | `default` | `NORMAL_PRIORITY` (5) | 兜底，行为与改造前的普通请求一致 |

`/api/analyze` 用 `analyze:${code}` **按个股代码分泳道**：这样 `/scanner` 同时诊断 5 只股票时，5 条泳道在批量层内轮转，不会出现「第 1 只的全部请求跑完才轮到第 2 只」。

### 4.5 前端即时反馈 `src/app/mining/page.tsx`

流式接口在受理后**立即下发一条 `accepted` 事件**（"已受理，正在拉取全市场候选池…"），前端据此打日志，让用户立刻知道「请求已到后端」，而非停留在「点了不动」的观感。配合优先级抢先，交互体验显著改善。

---

## 5. 验证方式

### 5.1 调度器单元自检 `scripts/verify-scheduler.ts`

```bash
npx tsx scripts/verify-scheduler.ts
```

覆盖三条性质（全部通过）：
1. **节流**：相邻两次执行真实间隔 ≥ `minIntervalMs`（与原 `emChain` 一致，不增封 IP 风险）；
2. **优先级**：批量任务（`priority=7`）灌满后再入队的交互任务（`priority=3`）抢在剩余批量任务**之前**执行；
3. **公平**：同优先级两泳道交替 round-robin（无任一泳道连续独占 ≥ 3 次）。

输出示例：
```
出队顺序: analyze:0 → mining-daily → analyze:0 → analyze:1 → ...
相邻最小间隔(ms): 201 ✓ 满足节流
mining-daily 出队位次: 1 ✓ 交互请求抢先于剩余批量任务
同优先级 round-robin 顺序: A A B A B B 最长连占 2 ✓ 公平轮转
全部通过 ✓
```

### 5.2 质量门禁

```bash
npm run lint        # 0 error
npm run type-check  # 0 error
```

### 5.3 端到端复现

标签页 A 在 `/scanner` 跑批量扫描的同时，标签页 B 在 `/mining` 点「生成今日股票池」：
- **改造前**：B 长时间无反应（排在 A 的数百请求之后）；
- **改造后**：B 立刻收到 `accepted` 反馈，且其候选池请求因高优先级抢先，秒级开始回流数据，A 的批量诊断退让但不中断、继续公平推进。

---

## 6. 影响与兼容性

- **对东财的实际速率不变**：仍单并发 + `EM_MIN_INTERVAL_MS` + 100~500ms 抖动，封 IP 风险与改造前一致。
- **API 契约不变**：路由入参 / 出参未改；仅 `/api/mining/daily` 流额外多一条 `accepted`、一条 `saved` 事件（前端已兼容，未知事件忽略）。
- **业务逻辑零改动**：扫描 / 诊断 / 同步算法本身未触碰，仅在最外层包裹上下文。
- **可观测性**：`emSchedulerStats()` 暴露各泳道等待数，便于排障。

---

## 7. 后续可选增强（非本次范围）

1. **多出口扩容**：为东财配置代理 IP 池 / 多出口，横向放大总额度（方案 B），从根上提高吞吐。
2. **请求去重 / 单飞（single-flight）**：相同 URL 在窗口内合并，减少 `/scanner` 与 `/mining` 的重复候选池拉取。
3. **结果缓存分层**：候选池 / K 线按交易时段缓存（部分已有 `isAShareActiveTime` 判定），降低对东财的请求量。
4. **任务可取消**：标签页关闭 / 路由切换时取消其泳道内排队任务，释放额度。
5. **动态优先级老化（aging）**：批量任务等待过久时缓慢提权，防止极端场景下的长尾饥饿。
