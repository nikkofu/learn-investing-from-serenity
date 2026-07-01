import { getKlineFailover } from "../src/lib/sources";
import { executeTradesNextOpen } from "../src/lib/quant";
import { computePerformanceReport } from "../src/lib/performance";
import { getStrategy } from "../src/lib/strategies";
import { runEnsembleParams, ENSEMBLE_V1_DEFAULTS, type EnsembleConfig } from "../src/lib/ensemble";

const BASKET = ["300024","601869","300750","600522","002594","600519","000001","600036","002230","300059","601127","000858"];
const SCORE = 78;

type M = { rets: number[]; dds: number[]; wins: number[]; sharpes: number[] };
const mk = (): M => ({ rets: [], dds: [], wins: [], sharpes: [] });
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const pos = (a: number[]) => (a.filter((r) => r > 0).length / (a.length || 1)) * 100;

async function main() {
  const cores = ["tv-cardwell-rsi-navigator-v4","tv-cardwell-rsi-navigator-v3","chokepoint-momentum-v5","channel-reversion-v1","chokepoint-momentum-v7"];
  const agg: Record<string, M> = { "ENSEMBLE-v1": mk(), "ENSEMBLE(no-regime)": mk() };
  cores.forEach((c) => (agg[c] = mk()));
  const bh: number[] = [];

  for (const code of BASKET) {
    const candles = await getKlineFailover(code, 400, 101, "qfq");
    if (candles.length < 80) { console.log(code, "insufficient"); continue; }
    const ctx = { chokepointScore: SCORE, code };

    const push = (key: string, res: ReturnType<typeof runEnsembleParams>) => {
      const exec = executeTradesNextOpen(candles, res);
      // ensemble result is already next-open matched; re-matching a target-based result is a no-op-ish,
      // so for ensemble we use its own metrics directly.
      const rep = computePerformanceReport(exec.history, exec.trades);
      agg[key].rets.push(exec.strategyReturn);
      agg[key].dds.push(rep.maxDrawdown);
      agg[key].wins.push(exec.winRate);
      agg[key].sharpes.push(exec.sharpe);
    };

    // ensemble: its trades already executed at next-open inside runEnsembleParams -> use metrics directly
    const ens = runEnsembleParams(candles, ctx, ENSEMBLE_V1_DEFAULTS);
    const repE = computePerformanceReport(ens.history, ens.trades);
    agg["ENSEMBLE-v1"].rets.push(ens.strategyReturn);
    agg["ENSEMBLE-v1"].dds.push(repE.maxDrawdown);
    agg["ENSEMBLE-v1"].wins.push(ens.winRate);
    agg["ENSEMBLE-v1"].sharpes.push(ens.sharpe);

    const noReg: EnsembleConfig = { ...ENSEMBLE_V1_DEFAULTS, regimeModulation: false };
    const ens2 = runEnsembleParams(candles, ctx, noReg);
    const repE2 = computePerformanceReport(ens2.history, ens2.trades);
    agg["ENSEMBLE(no-regime)"].rets.push(ens2.strategyReturn);
    agg["ENSEMBLE(no-regime)"].dds.push(repE2.maxDrawdown);
    agg["ENSEMBLE(no-regime)"].wins.push(ens2.winRate);
    agg["ENSEMBLE(no-regime)"].sharpes.push(ens2.sharpe);

    for (const c of cores) {
      const strat = getStrategy(c);
      if (strat) push(c, strat.run(candles, ctx));
    }

    const start = candles[0].close, end = candles[candles.length - 1].close;
    bh.push(((end - start) / start) * 100);
  }

  console.log("strategy\tret%\tmaxDD%\twin%\tsharpe\tposStocks%");
  for (const [k, m] of Object.entries(agg)) {
    console.log(`${k}\t${avg(m.rets).toFixed(1)}\t${avg(m.dds).toFixed(1)}\t${avg(m.wins).toFixed(1)}\t${avg(m.sharpes).toFixed(2)}\t${pos(m.rets).toFixed(0)}`);
  }
  console.log(`BUY&HOLD\t${avg(bh).toFixed(1)}`);
}
main();
