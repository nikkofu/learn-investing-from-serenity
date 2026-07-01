/** T4：风控闸门参数扫描（基底 = equal + trendClusterCap，仅调 ddSoft/ddHard/cooldown/vol）。 */
import { getKlineFailover } from "../src/lib/sources";
import { computePerformanceReport } from "../src/lib/performance";
import { runEnsembleParams, ENSEMBLE_V2_DEFAULTS, type EnsembleConfig } from "../src/lib/ensemble";

const BASKET = ["300024","601869","300750","600522","002594","600519","000001","600036","002230","300059","601127","000858"];
const SCORE = 78;
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const posPct = (a: number[]) => (a.filter((r) => r > 0).length / (a.length || 1)) * 100;

async function main() {
  const cache: Record<string, Awaited<ReturnType<typeof getKlineFailover>>> = {};
  const bh: number[] = [];
  for (const code of BASKET) {
    const c = await getKlineFailover(code, 400, 101, "qfq");
    if (c.length >= 80) { cache[code] = c; const s = c[0].close, e = c[c.length - 1].close; bh.push(((e - s) / s) * 100); }
  }

  const cfgs: { name: string; over: Partial<EnsembleConfig> }[] = [
    { name: "noGate", over: { riskGate: false } },
    { name: "s-.10 h-.18 cd0", over: { ddSoft: -0.10, ddHard: -0.18, cooldownBars: 0 } },
    { name: "s-.12 h-.18 cd0", over: { ddSoft: -0.12, ddHard: -0.18, cooldownBars: 0 } },
    { name: "s-.12 h-.20 cd0", over: { ddSoft: -0.12, ddHard: -0.20, cooldownBars: 0 } },
    { name: "s-.12 h-.22 cd0", over: { ddSoft: -0.12, ddHard: -0.22, cooldownBars: 0 } },
    { name: "s-.15 h-.22 cd0", over: { ddSoft: -0.15, ddHard: -0.22, cooldownBars: 0 } },
    { name: "s-.15 h-.25 cd0", over: { ddSoft: -0.15, ddHard: -0.25, cooldownBars: 0 } },
    { name: "s-.12 h-.20 cd3", over: { ddSoft: -0.12, ddHard: -0.20, cooldownBars: 3 } },
    { name: "s-.12 h-.20 vol.035/20", over: { ddSoft: -0.12, ddHard: -0.20, cooldownBars: 0, volLen: 20, volCap: 0.035 } },
    { name: "s-.12 h-.20 vol.03/20", over: { ddSoft: -0.12, ddHard: -0.20, cooldownBars: 0, volLen: 20, volCap: 0.03 } },
  ];

  console.log("cfg\tret%\tmaxDD%\twin%\tsharpe\tposStocks%\tret/|DD|");
  for (const { name, over } of cfgs) {
    const cfg: EnsembleConfig = { ...ENSEMBLE_V2_DEFAULTS, riskGate: true, ...over };
    const rets: number[] = [], dds: number[] = [], wins: number[] = [], shs: number[] = [];
    for (const code of Object.keys(cache)) {
      const res = runEnsembleParams(cache[code], { chokepointScore: SCORE, code }, cfg);
      const rep = computePerformanceReport(res.history, res.trades);
      rets.push(res.strategyReturn); dds.push(rep.maxDrawdown); wins.push(res.winRate); shs.push(res.sharpe);
    }
    const r = avg(rets), d = avg(dds);
    console.log(`${name}\t${r.toFixed(1)}\t${d.toFixed(1)}\t${avg(wins).toFixed(1)}\t${avg(shs).toFixed(2)}\t${posPct(rets).toFixed(0)}\t${(r / Math.abs(d || 1)).toFixed(2)}`);
  }
  console.log(`BUY&HOLD\t${avg(bh).toFixed(1)}`);
}
main();
