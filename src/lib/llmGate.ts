/**
 * 全局大模型在途并发闸（priority-aware semaphore）。
 *
 * 背景：`/api/analyze` 的诊断管线每只股票（缓存未命中时）要串行跑 5 次大模型调用
 * （主推理 + 自洽投票 2 次 + Critic 批判 + Judge 裁判），而 `/scanner` 前端 worker-pool
 * 默认并发 5 只 → 峰值约 25 个请求同时砸向同一个大模型 API。此前 llm.ts 对模型调用
 * **没有任何并发上限**，全部直接发出 → 模型侧排队/限流让每个调用都变慢，越堆越多、
 * 尾延迟滚雪球（用户实测单只从 30s 恶化到 6~11min）。
 *
 * 本闸只限制「同时在途的模型调用数」，**不改任何提示词 / 管线步骤 / 打分口径**：
 *   1) 在途数 < 上限时立即放行；超限则进入等待队列；
 *   2) 队列按优先级出队（数值越小越优先，复用 requestContext.priority）——
 *      单股 `/analyze`（交互优先级）不会被 `/scanner` 批量（BULK_PRIORITY）的几十个调用饿死；
 *   3) 同优先级内 FIFO（按入队序号决胜）。
 *
 * 结果：把「25 个互相拖慢」收敛为「至多 N 个稳定在途」，单只耗时更稳、更可预测，
 * 且交互请求始终优先。对最终诊断结果无任何影响。
 */
import { currentRequestContext, NORMAL_PRIORITY } from "./requestContext";

/** 在途上限：默认 6，可用 LLM_MAX_CONCURRENCY 覆盖（≤0 视为不限）。 */
const MAX_CONCURRENCY = Number(process.env.LLM_MAX_CONCURRENCY ?? 6);

interface Waiter {
  priority: number;
  seq: number;
  resolve: () => void;
}

class LlmGate {
  private active = 0;
  private waiters: Waiter[] = [];
  private seqCounter = 0;
  private readonly max: number;

  constructor(max: number) {
    // ≤0 视为不限并发（退化为直接放行）。
    this.max = Number.isFinite(max) && max > 0 ? max : Infinity;
  }

  /** 获取一个在途槽位；超限则按优先级排队等待。 */
  private acquire(priority: number): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push({ priority, seq: this.seqCounter++, resolve });
    });
  }

  /** 释放一个槽位，唤醒队列中优先级最高（其次最早入队）的等待者。 */
  private release(): void {
    if (this.waiters.length === 0) {
      this.active = Math.max(0, this.active - 1);
      return;
    }
    let pick = 0;
    for (let i = 1; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      const best = this.waiters[pick];
      if (w.priority < best.priority || (w.priority === best.priority && w.seq < best.seq)) {
        pick = i;
      }
    }
    const [next] = this.waiters.splice(pick, 1);
    // active 计数不变：释放一个、立刻唤醒一个。
    next.resolve();
  }

  /** 当前在途数与排队数快照（调试/自检用）。 */
  stats(): { active: number; waiting: number; max: number } {
    return { active: this.active, waiting: this.waiters.length, max: this.max };
  }

  /** 持槽执行一次普通（非流式）模型调用。 */
  async run<T>(priority: number, fn: () => Promise<T>): Promise<T> {
    await this.acquire(priority);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * 持槽包裹一个异步生成器（流式调用）：先取槽位，再开始流式产出，
   * 流结束 / 抛错 / 提前中断（消费方 break）时都在 finally 释放槽位。
   */
  async *runGenerator<T>(priority: number, gen: () => AsyncGenerator<T>): AsyncGenerator<T> {
    await this.acquire(priority);
    try {
      yield* gen();
    } finally {
      this.release();
    }
  }
}

const gate = new LlmGate(MAX_CONCURRENCY);

/** 读取当前异步上下文的优先级（未设置时按普通优先级）。 */
function currentPriority(): number {
  return currentRequestContext()?.priority ?? NORMAL_PRIORITY;
}

/** 持「全局 LLM 在途槽位」执行一次模型调用（普通/非流式）。 */
export function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  return gate.run(currentPriority(), fn);
}

/** 持「全局 LLM 在途槽位」包裹一次流式模型调用，直到流结束/中断才释放。 */
export function withLlmSlotGenerator<T>(gen: () => AsyncGenerator<T>): AsyncGenerator<T> {
  return gate.runGenerator(currentPriority(), gen);
}

/** 调试/自检用：当前在途与排队快照。 */
export function llmGateStats() {
  return gate.stats();
}
