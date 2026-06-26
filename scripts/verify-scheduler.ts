/**
 * 调度器自检脚本（仅本地验证用，不参与构建）。
 * 运行：npx tsx scripts/verify-scheduler.ts
 *
 * 验证三件事：
 *   1) 节流：相邻两次执行的真实间隔 ≥ minIntervalMs（与原 emChain 一致，不增加封 IP 风险）；
 *   2) 公平：两个泳道交替入队后，出队顺序按泳道 round-robin（不会让先入队的批量泳道独占）；
 *   3) 优先级：高优先级（数值小）泳道整体先于低优先级泳道被调度。
 */
import { FairScheduler } from "../src/lib/sources/emScheduler";

const MIN = 200; // 自检用小间隔，加快脚本

async function main() {
  // 场景 1+2：scanner（批量，5 个泳道）先灌入大量任务，随后 mining（交互）入队 1 个。
  const sched = new FairScheduler({ minIntervalMs: MIN, jitterMinMs: 0, jitterMaxMs: 0 });
  const order: string[] = [];
  const times: number[] = [];
  const t0 = Date.now();

  const mk = (lane: string, priority: number) =>
    sched.enqueue(
      async () => {
        order.push(lane);
        times.push(Date.now() - t0);
        return lane;
      },
      lane,
      priority,
    );

  const jobs: Promise<string>[] = [];
  // 先灌 scanner 批量（BULK=7），模拟 /scanner 把额度占满
  for (let i = 0; i < 6; i++) jobs.push(mk(`analyze:${i % 3}`, 7));
  // 紧接着 mining 交互（INTERACTIVE=3）入队 —— 应抢在剩余 scanner 之前
  jobs.push(mk("mining-daily", 3));
  // 再补几个 scanner
  for (let i = 0; i < 3; i++) jobs.push(mk(`analyze:${i % 3}`, 7));

  await Promise.all(jobs);

  // 校验节流：相邻间隔 ≥ MIN（允许 5ms 误差）
  let minGap = Infinity;
  for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, times[i] - times[i - 1]);
  const pacingOk = minGap >= MIN - 5;

  // 校验优先级：第一个 scanner 跑完（已在执行中无法抢占）后，mining 应在下一个出队
  const miningIdx = order.indexOf("mining-daily");
  const priorityOk = miningIdx === 1; // 第 0 个已在途，mining 紧随其后

  console.log("出队顺序:", order.join(" → "));
  console.log("相邻最小间隔(ms):", Math.round(minGap), pacingOk ? "✓ 满足节流" : "✗ 节流不足");
  console.log(
    "mining-daily 出队位次:",
    miningIdx,
    priorityOk ? "✓ 交互请求抢先于剩余批量任务" : "✗ 优先级未生效",
  );

  // 场景 3：同优先级两泳道交替 round-robin
  const s2 = new FairScheduler({ minIntervalMs: 1, jitterMinMs: 0, jitterMaxMs: 0 });
  const ord2: string[] = [];
  const p2: Promise<unknown>[] = [];
  for (let i = 0; i < 3; i++) p2.push(s2.enqueue(async () => void ord2.push("A"), "A", 5));
  for (let i = 0; i < 3; i++) p2.push(s2.enqueue(async () => void ord2.push("B"), "B", 5));
  await Promise.all(p2);
  // 首个任务在「B 泳道尚未入队」前即被派发（首次 enqueue 同步拉起 pump），属预期；
  // 之后两泳道交替。公平性判定：两泳道各执行 3 次，且没有任一泳道连续出现 ≥3 次。
  const countOk = ord2.filter((x) => x === "A").length === 3 && ord2.filter((x) => x === "B").length === 3;
  let maxRun = 1;
  for (let i = 1, run = 1; i < ord2.length; i++) {
    run = ord2[i] === ord2[i - 1] ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  const fairOk = countOk && maxRun <= 2;
  console.log("同优先级 round-robin 顺序:", ord2.join(" "), `最长连占 ${maxRun}`, fairOk ? "✓ 公平轮转" : "✗ 未轮转");

  const allOk = pacingOk && priorityOk && fairOk;
  console.log(allOk ? "\n全部通过 ✓" : "\n存在失败 ✗");
  process.exit(allOk ? 0 : 1);
}

main();
