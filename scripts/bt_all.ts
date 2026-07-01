import { getKlineFailover } from "../src/lib/sources";
import { executeTradesNextOpen } from "../src/lib/quant";
import { computePerformanceReport } from "../src/lib/performance";
import { runAllStrategies } from "../src/lib/strategies";

// Chokepoint 家族由「基本面瓶颈打分」门控（<55 全拒、>=75 开启强突破分支）。
// 本纯技术回测无 LLM 基本面分，故对篮子（均为高质量龙头）统一取 78（乐观「优质通过」），
// 让 Chokepoint 策略能实际交易；真实表现取决于该分数逐股是否准确。
const FIXED_CHOKEPOINT_SCORE = 78;

const BASKET = ["300024","601869","300750","600522","002594","600519","000001","600036","002230","300059","601127","000858"];

type Agg = { rets: number[]; dds: number[]; wins: number[]; sharpes: number[] };

async function main() {
  const agg: Record<string, { name: string } & Agg> = {};
  const bh: number[] = [];
  for (const code of BASKET) {
    const candles = await getKlineFailover(code, 400, 101, "qfq");
    if (candles.length < 80) { console.log(code, "insufficient"); continue; }
    const list = runAllStrategies(candles, { chokepointScore: FIXED_CHOKEPOINT_SCORE, code });
    for (const sb of list) {
      const exec = executeTradesNextOpen(candles, sb.result);
      const rep = computePerformanceReport(exec.history, exec.trades);
      const id = sb.meta.id;
      if (!agg[id]) agg[id] = { name: sb.meta.name, rets: [], dds: [], wins: [], sharpes: [] };
      agg[id].rets.push(exec.strategyReturn);
      agg[id].dds.push(rep.maxDrawdown);
      agg[id].wins.push(exec.winRate);
      agg[id].sharpes.push(exec.sharpe);
    }
    const start = candles[0].close, end = candles[candles.length - 1].close;
    bh.push(((end - start) / start) * 100);
  }
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const rows = Object.entries(agg).map(([id, a]) => ({
    id, name: a.name,
    ret: avg(a.rets), dd: avg(a.dds), win: avg(a.wins), sharpe: avg(a.sharpes),
    posRate: (a.rets.filter((r) => r > 0).length / a.rets.length) * 100,
  }));
  rows.sort((x, y) => y.ret - x.ret);
  console.log("RANK | id | ret% | maxDD% | win% | sharpe | posStocks%");
  rows.forEach((r, i) => {
    console.log(`${i + 1}\t${r.id}\t${r.ret.toFixed(1)}\t${r.dd.toFixed(1)}\t${r.win.toFixed(1)}\t${r.sharpe.toFixed(2)}\t${r.posRate.toFixed(0)}`);
  });
  console.log(`\nBUY&HOLD avg ret ${avg(bh).toFixed(1)}%`);
  // dump JSON for scoring
  console.log("JSON_START");
  console.log(JSON.stringify(rows));
  console.log("JSON_END");
}
main();
