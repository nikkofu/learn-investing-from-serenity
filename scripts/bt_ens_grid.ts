import { getKlineFailover } from "../src/lib/sources";
import { computePerformanceReport } from "../src/lib/performance";
import { runEnsembleParams, type EnsembleConfig, type EnsembleMember } from "../src/lib/ensemble";
import type { Candle } from "../src/lib/types";

const BASKET = ["300024","601869","300750","600522","002594","600519","000001","600036","002230","300059","601127","000858"];
const SCORE = 78;
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const pos = (a: number[]) => (a.filter((r) => r > 0).length / (a.length || 1)) * 100;
const median = (a: number[]) => { const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };

// base members (trend core + reversion satellites)
const mk = (cw4:number,cw3:number,chk5:number,chan:number,rsir:number): EnsembleMember[] => [
  { strategyId: "tv-cardwell-rsi-navigator-v4", baseWeight: cw4, kind: "trend" },
  { strategyId: "tv-cardwell-rsi-navigator-v3", baseWeight: cw3, kind: "trend" },
  { strategyId: "chokepoint-momentum-v5", baseWeight: chk5, kind: "trend" },
  { strategyId: "channel-reversion-v1", baseWeight: chan, kind: "reversion" },
  { strategyId: "rsi-reversion-v1", baseWeight: rsir, kind: "reversion" },
];

interface Cfg { name: string; members: EnsembleMember[]; posCap: number; boost: number; rel: number; reg: boolean; }
const CFGS: Cfg[] = [
  { name: "A cw.24/.20/.18 rev.26/.12 cap.95 b1.5 rel.0008", members: mk(.24,.20,.18,.26,.12), posCap:.95, boost:1.5, rel:.0008, reg:true },
  { name: "B same b2.0",                                     members: mk(.24,.20,.18,.26,.12), posCap:.95, boost:2.0, rel:.0008, reg:true },
  { name: "C same b2.5",                                     members: mk(.24,.20,.18,.26,.12), posCap:.95, boost:2.5, rel:.0008, reg:true },
  { name: "D same b2.0 cap1.0",                              members: mk(.24,.20,.18,.26,.12), posCap:1.0, boost:2.0, rel:.0008, reg:true },
  { name: "E rev.22/.10 b2.0 cap1.0",                        members: mk(.26,.22,.20,.22,.10), posCap:1.0, boost:2.0, rel:.0008, reg:true },
  { name: "F rev.30/.14 b2.2 cap1.0",                        members: mk(.22,.18,.16,.30,.14), posCap:1.0, boost:2.2, rel:.0008, reg:true },
  { name: "G F b2.0 rel.0005",                               members: mk(.22,.18,.16,.30,.14), posCap:1.0, boost:2.0, rel:.0005, reg:true },
  { name: "H F b2.5 rel.0004",                               members: mk(.22,.18,.16,.30,.14), posCap:1.0, boost:2.5, rel:.0004, reg:true },
  { name: "I rev.28/.14 b2.3 rel.0004 cap1.0",               members: mk(.24,.18,.16,.28,.14), posCap:1.0, boost:2.3, rel:.0004, reg:true },
];

async function main() {
  const cache: Record<string, Candle[]> = {};
  for (const code of BASKET) { const c = await getKlineFailover(code, 400, 101, "qfq"); if (c.length >= 80) cache[code] = c; }
  console.log("config\tret%\tmaxDD%\twin%\tsharpe\tposStocks%");
  for (const cf of CFGS) {
    const cfg: EnsembleConfig = { members: cf.members, posCap: cf.posCap, regimeModulation: cf.reg, adxTrendMin: 20, relSlopeTrendMin: cf.rel, trendBoost: cf.boost, channelLen: 60 };
    const rets: number[] = [], dds: number[] = [], wins: number[] = [], shps: number[] = [];
    for (const code of Object.keys(cache)) {
      const candles = cache[code];
      const res = runEnsembleParams(candles, { chokepointScore: SCORE, code }, cfg);
      const rep = computePerformanceReport(res.history, res.trades);
      rets.push(res.strategyReturn); dds.push(rep.maxDrawdown); wins.push(res.winRate); shps.push(res.sharpe);
    }
    console.log(`${cf.name}\t${avg(rets).toFixed(1)}\t${avg(dds).toFixed(1)}\t${avg(wins).toFixed(1)}\t${avg(shps).toFixed(2)}\t${pos(rets).toFixed(0)}\t(medShp ${median(shps).toFixed(2)})`);
  }
}
main();
