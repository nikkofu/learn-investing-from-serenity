/**
 * T1 诊断：Ensemble 成员收益相关矩阵 + 配权方案对比回测（全样本 in-sample）。
 * 用途：数据驱动选出候选配权方案（fixed/equal/invVol/riskParity/corrPenalized），
 * 供 V2 走前落地参考。不改动线上策略。
 */
import { getKlineFailover } from "../src/lib/sources";
import { computePerformanceReport } from "../src/lib/performance";
import { getStrategy } from "../src/lib/strategies";
import {
  runEnsembleParams,
  memberPositionSeries,
  ENSEMBLE_V1_DEFAULTS,
  ENSEMBLE_V1_MEMBERS,
  type EnsembleConfig,
} from "../src/lib/ensemble";

const BASKET = ["300024","601869","300750","600522","002594","600519","000001","600036","002230","300059","601127","000858"];
const SCORE = 78;
const M = ENSEMBLE_V1_MEMBERS;
const N = M.length;

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const cov = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length || 1);
};
const corr = (a: number[], b: number[]) => {
  const c = cov(a, b), sa = std(a), sb = std(b);
  return sa > 0 && sb > 0 ? c / (sa * sb) : 0;
};
const avg = (a: number[]) => mean(a);
const posPct = (a: number[]) => (a.filter((r) => r > 0).length / (a.length || 1)) * 100;

/** ERC（等风险贡献）不动点迭代：w_i <- w_i / (Σw)_i，归一化，重复至收敛。 */
function erc(covM: number[][], iters = 200): number[] {
  let w = covM.map((_, i) => 1 / Math.sqrt(covM[i][i] || 1e-12));
  const norm = (v: number[]) => { const s = v.reduce((a, x) => a + x, 0); return v.map((x) => x / (s || 1)); };
  w = norm(w);
  for (let it = 0; it < iters; it++) {
    const mc = w.map((_, i) => covM[i].reduce((s, cij, j) => s + cij * w[j], 0)); // (Σw)_i
    const nw = w.map((wi, i) => wi / (mc[i] || 1e-12));
    w = norm(nw);
  }
  return w;
}

async function main() {
  // 成员逐根收益序列（pooled 跨标的拼接）：r_i[t] = pos_i[t-1] * (close[t]/close[t-1]-1)
  const pooled: number[][] = Array.from({ length: N }, () => []);
  const bh: number[] = [];
  const candlesByCode: Record<string, Awaited<ReturnType<typeof getKlineFailover>>> = {};

  for (const code of BASKET) {
    const candles = await getKlineFailover(code, 400, 101, "qfq");
    if (candles.length < 80) { console.log(code, "insufficient"); continue; }
    candlesByCode[code] = candles;
    const ctx = { chokepointScore: SCORE, code };
    const ret: number[] = candles.map((c, i) => (i === 0 ? 0 : c.close / candles[i - 1].close - 1));
    for (let mi = 0; mi < N; mi++) {
      const strat = getStrategy(M[mi].strategyId);
      if (!strat) continue;
      const pos = memberPositionSeries(candles, strat.run(candles, ctx));
      for (let t = 1; t < candles.length; t++) pooled[mi].push(pos[t - 1] * ret[t]);
    }
    const s = candles[0].close, e = candles[candles.length - 1].close;
    bh.push(((e - s) / s) * 100);
  }

  // 相关矩阵 + 协方差矩阵
  const C: number[][] = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => corr(pooled[i], pooled[j])));
  const COV: number[][] = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => cov(pooled[i], pooled[j])));
  const sig = pooled.map((p) => std(p));

  console.log("\n=== 成员收益相关矩阵（pooled 跨标的）===");
  console.log("\t" + M.map((m) => m.strategyId.replace(/^tv-cardwell-rsi-navigator-/, "cw-").replace("chokepoint-momentum-", "chk-").replace("channel-reversion-v1", "chan-rev").replace("rsi-reversion-v1", "rsi-rev")).join("\t"));
  for (let i = 0; i < N; i++) {
    const label = M[i].strategyId.replace(/^tv-cardwell-rsi-navigator-/, "cw-").replace("chokepoint-momentum-", "chk-").replace("channel-reversion-v1", "chan-rev").replace("rsi-reversion-v1", "rsi-rev");
    console.log(label + "\t" + C[i].map((x) => x.toFixed(2)).join("\t"));
  }
  console.log("成员日收益σ(%):\t" + sig.map((x) => (x * 100).toFixed(2)).join("\t"));

  // 配权方案
  const norm = (v: number[]) => { const s = v.reduce((a, x) => a + x, 0); return v.map((x) => x / (s || 1)); };
  const schemes: Record<string, number[]> = {
    fixed: norm(M.map((m) => m.baseWeight)),
    equal: norm(M.map(() => 1)),
    invVol: norm(sig.map((s) => (s > 0 ? 1 / s : 0))),
    riskParity: erc(COV),
    corrPenalized: norm(M.map((m, i) => m.baseWeight / C[i].reduce((s, r) => s + Math.abs(r), 0))),
  };

  const effN = (w: number[]) => 1 / w.reduce((s, x) => s + x * x, 0);

  // 每方案跑回测（regimeModulation 保持 v1=true，只换 baseWeight 观察配权效果）
  console.log("\n=== 配权方案对比回测（12 只 · in-sample）===");
  console.log("scheme\tret%\tmaxDD%\twin%\tsharpe\tposStocks%\teffN\tret/|DD|\t权重");
  for (const [name, w] of Object.entries(schemes)) {
    const cfg: EnsembleConfig = { ...ENSEMBLE_V1_DEFAULTS, members: M.map((m, i) => ({ ...m, baseWeight: w[i] })) };
    const rets: number[] = [], dds: number[] = [], wins: number[] = [], shs: number[] = [];
    for (const code of BASKET) {
      const candles = candlesByCode[code];
      if (!candles) continue;
      const res = runEnsembleParams(candles, { chokepointScore: SCORE, code }, cfg);
      const rep = computePerformanceReport(res.history, res.trades);
      rets.push(res.strategyReturn); dds.push(rep.maxDrawdown); wins.push(res.winRate); shs.push(res.sharpe);
    }
    const r = avg(rets), d = avg(dds);
    console.log(`${name}\t${r.toFixed(1)}\t${d.toFixed(1)}\t${avg(wins).toFixed(1)}\t${avg(shs).toFixed(2)}\t${posPct(rets).toFixed(0)}\t${effN(w).toFixed(2)}\t${(r / Math.abs(d || 1)).toFixed(2)}\t[${w.map((x) => x.toFixed(2)).join(",")}]`);
  }
  console.log(`BUY&HOLD\t${avg(bh).toFixed(1)}`);
}
main();
