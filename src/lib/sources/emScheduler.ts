/**
 * 东财请求公平调度器（替代原 http.ts 里的单条 FIFO Promise 链 emChain）。
 *
 * 背景：东财系接口有风控（每秒 >5 次 / 单 IP 并发 ≥10 / 1 分钟 ≥200 次 → 临时封 IP），
 * 故所有东财请求必须「单并发 + 最小间隔 + 抖动」串行节流。原实现用一条全局 Promise 链，
 * 严格 FIFO：先入队者先执行。问题是当 /scanner 批量诊断把成百上千个东财请求灌进链尾后，
 * /mining「生成今日股票池」发出的候选池请求只能排在队尾，几分钟拿不到额度 → 前台「点了不动」。
 *
 * 本调度器在「完全保持原有限流强度（单并发 + 最小间隔 + 100~500ms 抖动）」的前提下，
 * 只改变「出队顺序」：
 *   1) 优先级层：数值越小越优先，高优先级层整体先于低优先级层被调度；
 *   2) 同优先级层内：按泳道（lane）round-robin 公平轮转，
 *      使「批量任务」与「前台任务」各占约一半额度，互不饿死。
 *
 * 对东财的实际请求速率不变（仍是单并发 + 最小间隔），不会增加封 IP 风险。
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Job {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  lane: string;
  priority: number;
  /** 入队序号，用于同泳道同优先级的 FIFO 决胜。 */
  seq: number;
}

export interface SchedulerOptions {
  /** 两次请求之间的最小间隔（ms），与上一次「完成」时刻计起。 */
  minIntervalMs: number;
  /** 抖动下限（ms），默认 100。 */
  jitterMinMs?: number;
  /** 抖动上限（ms），默认 500。 */
  jitterMaxMs?: number;
}

export interface SchedulerStats {
  /** 当前等待执行的任务数。 */
  pending: number;
  /** 各泳道当前等待数。 */
  lanes: Record<string, number>;
  /** 是否有 pump 正在运行。 */
  running: boolean;
}

export class FairScheduler {
  private pending: Job[] = [];
  /** 泳道首次出现顺序（稳定），round-robin 指针基于它轮转。 */
  private lanesOrder: string[] = [];
  private rr = 0;
  private seqCounter = 0;
  private running = false;
  /** 上一次请求「完成」的时刻（ms）；间隔从这里计起，与原 emLastCall 语义一致。 */
  private lastFinish = 0;
  private readonly minIntervalMs: number;
  private readonly jitterMinMs: number;
  private readonly jitterMaxMs: number;

  constructor(opts: SchedulerOptions) {
    this.minIntervalMs = opts.minIntervalMs;
    this.jitterMinMs = opts.jitterMinMs ?? 100;
    this.jitterMaxMs = opts.jitterMaxMs ?? 500;
  }

  /** 入队一个东财请求；返回的 Promise 在该请求真正执行后 resolve/reject。 */
  enqueue<T>(run: () => Promise<T>, lane: string, priority: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        run: run as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
        lane,
        priority,
        seq: this.seqCounter++,
      };
      this.pending.push(job);
      if (!this.lanesOrder.includes(lane)) this.lanesOrder.push(lane);
      if (!this.running) void this.pump();
    });
  }

  stats(): SchedulerStats {
    const lanes: Record<string, number> = {};
    for (const j of this.pending) lanes[j.lane] = (lanes[j.lane] ?? 0) + 1;
    return { pending: this.pending.length, lanes, running: this.running };
  }

  /** 选取下一个待执行任务：先取全局最小优先级层，再在该层内按泳道 round-robin。 */
  private pickNext(): Job | undefined {
    if (this.pending.length === 0) return undefined;
    let minP = Infinity;
    for (const j of this.pending) if (j.priority < minP) minP = j.priority;

    const n = this.lanesOrder.length;
    for (let i = 0; i < n; i++) {
      const lane = this.lanesOrder[(this.rr + i) % n];
      let pick: Job | undefined;
      for (const j of this.pending) {
        if (j.lane === lane && j.priority === minP) {
          if (!pick || j.seq < pick.seq) pick = j;
        }
      }
      if (pick) {
        this.rr = (this.lanesOrder.indexOf(lane) + 1) % n;
        return pick;
      }
    }
    // 兜底（理论不可达）：直接取最早入队者。
    return this.pending.reduce((a, b) => (a.seq <= b.seq ? a : b));
  }

  private async pump(): Promise<void> {
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pickNext();
        if (!job) break;
        const idx = this.pending.indexOf(job);
        if (idx >= 0) this.pending.splice(idx, 1);

        // 节流：与上一次完成保持最小间隔 + 抖动（完全沿用原 emFetch 语义）。
        const wait = this.minIntervalMs - (Date.now() - this.lastFinish);
        if (wait > 0) {
          await sleep(wait + this.jitterMinMs + Math.random() * (this.jitterMaxMs - this.jitterMinMs));
        }
        try {
          const res = await job.run();
          job.resolve(res);
        } catch (e) {
          job.reject(e);
        } finally {
          this.lastFinish = Date.now();
        }
      }
    } finally {
      this.running = false;
      // 防御：pump 退出瞬间若刚好有新任务入队（极少见），再拉起一次。
      if (this.pending.length > 0) void this.pump();
    }
  }
}
