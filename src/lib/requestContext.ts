/**
 * 请求级上下文（基于 Node AsyncLocalStorage）。
 *
 * 用途：给「同一次 HTTP 请求 / 同一个后台任务」内发出的所有东财请求打上「泳道 lane」
 * 与「优先级 priority」标签，让 emFetch 的公平调度器（emScheduler）据此分配限流额度：
 *   - 不同泳道之间公平轮转（round-robin），避免某个批量任务（如 /scanner 批量诊断）
 *     把全局串行限流链占满，导致另一个任务（如 /mining 生成今日股票池）长时间拿不到额度；
 *   - 优先级数值越小越优先：低频交互请求可设更高优先级，整体先于批量任务被调度。
 *
 * 关键：上下文只在「调用 emFetch 的那一刻」（调用方异步上下文中）读取并固化到任务对象上，
 * 调度器自身的 pump 循环不依赖 ALS，因此跨 await / 跨 Promise 链不会丢失标签。
 */
import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  /** 调度泳道名：同泳道内部 FIFO，跨泳道公平轮转。 */
  lane: string;
  /** 优先级：数值越小越优先（高优先级泳道整体先于低优先级被调度）。 */
  priority: number;
}

/** 普通优先级（默认）。交互型低频请求可用更小值抢先，批量任务可用更大值退让。 */
export const NORMAL_PRIORITY = 5;
/** 交互型前台请求（如「生成今日股票池」首屏候选池拉取）优先级。 */
export const INTERACTIVE_PRIORITY = 3;
/** 批量后台任务（如 /scanner 批量诊断）优先级，主动退让交互请求。 */
export const BULK_PRIORITY = 7;

const storage = new AsyncLocalStorage<RequestContext>();

/** 在给定上下文中执行 fn；fn 内（含其 await 续体）调用 emFetch 会自动继承该泳道/优先级。 */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** 读取当前异步上下文的请求标签（未设置时返回 undefined，调用方按默认处理）。 */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
