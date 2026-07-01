/** V2 验收对比：ensemble-v1 vs ensemble-v2（+ 关键消融）。 */
import { getKlineFailover } from "../src/lib/sources";
import { computePerformanceReport } from "../src/lib/performance";
import {
  runEnsembleParams,
  ENSEMBLE_V1_DEFAULTS,
  ENSEMBLE_V2_DEFAULTS,
  type EnsembleConfig,
} from "../src/lib/ensemble";

const BASKET = ["300024","601869","300750","600522","002594","600519","000001","600036","002230","300059","601127","000858"];
const SCORE = 78;
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const posPct = (a: number[]) => (a.filter((r) => r > 0).length / (a.length || 1)) * 100;

async function main() {
  const variants: Record<string, EnsembleConfig> = {
    "v1": ENSEMBLE_V1_DEFAULTS,
    "v2(equal+cluster+gate)": ENSEMBLE_V2_DEFAULTS,
    "v2-noGate": { ...ENSEMBLE_V2_DEFAULTS, riskGate: false },
    "v2-noCluster": { ...ENSEMBLE_V2_DEFAULTS, trendClusterCap: 0 },
    "v2-invVolCapped": { ...ENSEMBLE_V2_DEFAULTS, weightScheme: "invVolCapped" },
  };
  const candlesByCode: Record<string, Awaited<ReturnType<typeof getKlineFailover>>> = {};
  const bh: number[] = [];
  for (const code of BASKET) {
    const candles = await getKlineFailover(code, 400, 101, "qfq");
    if (candles.length < 80) continue;
    candlesByCode[code] = candles;
    const s = candles[0].close, e = candles[candles.length - 1].close;
    bh.push(((e - s) / s) * 100);
  }

  console.log("variant\tret%\tmaxDD%\twin%\tsharpe\tposStocks%\tret/|DD|");
  for (const [name, cfg] of Object.entries(variants)) {
    const rets: number[] = [], dds: number[] = [], wins: number[] = [], shs: number[] = [];
    for (const code of Object.keys(candlesByCode)) {
      const candles = candlesByCode[code];
      const res = runEnsembleParams(candles, { chokepointScore: SCORE, code }, cfg);
      const rep = computePerformanceReport(res.history, res.trades);
      rets.push(res.strategyReturn); dds.push(rep.maxDrawdown); wins.push(res.winRate); shs.push(res.sharpe);
    }
    const r = avg(rets), d = avg(dds);
    console.log(`${name}\t${r.toFixed(1)}\t${d.toFixed(1)}\t${avg(wins).toFixed(1)}\t${avg(shs).toFixed(2)}\t${posPct(rets).toFixed(0)}\t${(r / Math.abs(d || 1)).toFixed(2)}`);
  }
  console.log(`BUY&HOLD\t${avg(bh).toFixed(1)}`);
}
main();
