/**
 * 策略市场榜单 —— 把策略注册表里所有策略放到同一个代表性 A 股篮子上回测，
 * 汇总出可比较的「历史战绩」，并据真实指标推出客观评级（不伪造用户评论）。
 *
 * 诚实口径：
 * - 同一篮子、同一时间窗、同一中性基本面分（75）跑全部策略，衡量的是**纯量价信号**的优劣，
 *   消除「不同策略用不同股票/分数」带来的不可比。
 * - 评级（A/B/C/D）、星级与点评全部由真实回测指标推出（胜率/超额/夏普/收益/信号密度），
 *   没有任何人工编造的「用户好评」。
 * - 牛市样本里择时策略普遍跑不赢买入持有，这是行情属性；故榜单同时给出「跑赢买入持有比例」，
 *   不以单一收益论英雄。
 */
import { getKlinesBatch } from "./sources";
import { runAllStrategies, type StrategyMeta } from "./strategies";
import { globalCache } from "./cache";

/** 代表性篮子：跨行业大中盘 + 一只高波动品种，兼顾普适性与压力测试。 */
export const REPRESENTATIVE_BASKET: { code: string; name: string }[] = [
  { code: "600519", name: "贵州茅台" },
  { code: "000858", name: "五粮液" },
  { code: "300750", name: "宁德时代" },
  { code: "600036", name: "招商银行" },
  { code: "000333", name: "美的集团" },
  { code: "002594", name: "比亚迪" },
  { code: "601318", name: "中国平安" },
  { code: "600276", name: "恒瑞医药" },
  { code: "000651", name: "格力电器" },
  { code: "002415", name: "海康威视" },
  { code: "600887", name: "伊利股份" },
  { code: "600703", name: "三友化工" },
];

const NEUTRAL_SCORE = 75;
const DEFAULT_LIMIT = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface StrategyTrackRecord {
  meta: StrategyMeta;
  rank: number;
  /** 成功取到 K 线并纳入统计的标的数。 */
  sampleStocks: number;
  /** 完成交易（含买卖闭环）总数。 */
  totalTrades: number;
  /** 各股胜率均值（仅计有完成交易的标的）。 */
  avgWinRatePct: number;
  /** 各股策略累计收益均值。 */
  avgReturnPct: number;
  medianReturnPct: number;
  /** 年化夏普均值。 */
  avgSharpe: number;
  /** 盈亏比（跨标的合并所有完成交易：总盈利 / |总亏损|，>1 即系统期望为正）。 */
  profitFactor: number;
  /** 跑赢「同期买入持有」的标的数与占比。 */
  beatBuyHold: number;
  beatBuyHoldPct: number;
  /** 平均超额收益（策略 − 个股同期），pp。 */
  avgExcessPct: number;
  /** 综合评分 0–100。 */
  score: number;
  grade: "A" | "B" | "C" | "D";
  /** 1–5 星（由综合分映射）。 */
  stars: number;
  /** 一句话客观点评。 */
  assessment: string;
  pros: string[];
  cons: string[];
}

export interface StrategyLeaderboard {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  universe: { code: string; name: string }[];
  neutralScore: number;
  records: StrategyTrackRecord[];
  note: string;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 综合分（侧重「系统内在质量」，弱化与行情强相关的跑赢买入持有项）：
 *   胜率 28% + 盈亏比 27% + 夏普 20% + 平均收益 15% + 跑赢买入持有 10%。
 * 盈亏比/胜率/夏普衡量「这套规则每次出手的质量」，受牛熊影响较小；
 * 跑赢买入持有受行情属性主导（牛市择时普遍跑输），故只占 10% 作参考。
 */
function compositeScore(r: {
  avgWinRatePct: number;
  beatBuyHoldPct: number;
  avgSharpe: number;
  avgReturnPct: number;
  profitFactor: number;
}): number {
  const winC = clamp(r.avgWinRatePct, 0, 100);
  const pfC = clamp(r.profitFactor * 50, 0, 100); // 盈亏比 1→50, 2→100
  const sharpeC = clamp(((r.avgSharpe + 0.5) / 2) * 100, 0, 100); // 夏普 -0.5→0, 1.5→100
  const retC = clamp(50 + r.avgReturnPct, 0, 100); // 收益 -50%→0, +50%→100
  const beatC = clamp(r.beatBuyHoldPct, 0, 100);
  return Number((0.28 * winC + 0.27 * pfC + 0.2 * sharpeC + 0.15 * retC + 0.1 * beatC).toFixed(1));
}

function gradeOf(score: number): "A" | "B" | "C" | "D" {
  if (score >= 62) return "A";
  if (score >= 50) return "B";
  if (score >= 38) return "C";
  return "D";
}

function starsOf(score: number): number {
  return clamp(Math.round(score / 20), 1, 5);
}

function buildProsCons(r: {
  avgWinRatePct: number;
  beatBuyHoldPct: number;
  avgSharpe: number;
  avgReturnPct: number;
  profitFactor: number;
  totalTrades: number;
  sampleStocks: number;
}): { pros: string[]; cons: string[]; assessment: string } {
  const pros: string[] = [];
  const cons: string[] = [];

  if (r.profitFactor >= 1.5) pros.push(`盈亏比优秀（${r.profitFactor.toFixed(2)}，赚多亏少）`);
  else if (r.profitFactor < 1 && r.totalTrades > 0) cons.push(`盈亏比 <1（${r.profitFactor.toFixed(2)}，期望为负）`);

  if (r.avgWinRatePct >= 60) pros.push(`胜率高（${r.avgWinRatePct.toFixed(0)}%）`);
  else if (r.avgWinRatePct < 45 && r.totalTrades > 0) cons.push(`胜率偏低（${r.avgWinRatePct.toFixed(0)}%）`);

  const tradesPerStock = r.sampleStocks > 0 ? r.totalTrades / r.sampleStocks : 0;
  if (tradesPerStock >= 3) pros.push(`信号密集（均 ${tradesPerStock.toFixed(1)} 笔/股，少踏空）`);
  else if (tradesPerStock < 1.2) cons.push(`信号稀疏（均 ${tradesPerStock.toFixed(1)} 笔/股，易踏空）`);

  if (r.beatBuyHoldPct >= 50) pros.push(`半数以上标的跑赢买入持有`);
  else cons.push(`牛市样本里多数跑不赢买入持有（${r.beatBuyHoldPct.toFixed(0)}%）`);

  if (r.avgSharpe >= 0.5) pros.push(`风险调整后收益尚可（夏普 ${r.avgSharpe.toFixed(2)}）`);
  else if (r.avgSharpe < 0) cons.push(`夏普为负（${r.avgSharpe.toFixed(2)}）`);

  if (r.avgReturnPct > 0) pros.push(`平均正收益（${r.avgReturnPct.toFixed(1)}%）`);
  else cons.push(`平均收益为负（${r.avgReturnPct.toFixed(1)}%）`);

  const assessment =
    r.avgWinRatePct >= 60 && r.avgReturnPct > 0
      ? "高胜率、信号充足，适合趋势跟随；牛市单边里仍难全面跑赢买入持有。"
      : r.totalTrades === 0
        ? "在该篮子上几乎不出手，过于保守。"
        : r.avgWinRatePct < 45
          ? "胜率偏低，震荡环境易反复止损，需配合趋势过滤使用。"
          : "中规中矩，作为对照基准或与其他策略组合使用更佳。";

  return { pros: pros.slice(0, 4), cons: cons.slice(0, 3), assessment };
}

/**
 * 计算策略市场榜单（带 24h 缓存）。
 * 对代表性篮子批量取 K → 每只用中性分跑全部策略 → 跨标的汇总 → 评分排名。
 */
export async function computeStrategyLeaderboard(opts: { limit?: number; force?: boolean } = {}): Promise<StrategyLeaderboard> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cacheKey = `strategy-leaderboard:${limit}:${REPRESENTATIVE_BASKET.map((b) => b.code).join(",")}`;
  if (opts.force) globalCache.delete(cacheKey);

  return globalCache.getOrCreate<StrategyLeaderboard>(
    cacheKey,
    async () => {
      const codes = REPRESENTATIVE_BASKET.map((b) => b.code);
      const batch = await getKlinesBatch(codes, limit, "baidu-first", { concurrency: 6, retries: 2 });

      // 每个策略累积各标的结果
      const acc = new Map<
        string,
        { meta: StrategyMeta; returns: number[]; winRates: number[]; sharpes: number[]; trades: number; beat: number; excess: number[]; stocks: number; grossWin: number; grossLoss: number }
      >();

      let windowStart = "";
      let windowEnd = "";
      let usedStocks = 0;

      for (const { code } of REPRESENTATIVE_BASKET) {
        const item = batch.get(code);
        if (!item || item.candles.length < 60) continue;
        usedStocks++;
        const candles = item.candles;
        if (!windowStart || candles[0].date < windowStart) windowStart = candles[0].date;
        if (!windowEnd || candles[candles.length - 1].date > windowEnd) windowEnd = candles[candles.length - 1].date;

        const results = runAllStrategies(candles, { chokepointScore: NEUTRAL_SCORE, code });
        for (const { meta, result } of results) {
          const cur =
            acc.get(meta.id) ??
            { meta, returns: [], winRates: [], sharpes: [], trades: 0, beat: 0, excess: [], stocks: 0, grossWin: 0, grossLoss: 0 };
          cur.returns.push(result.strategyReturn);
          cur.sharpes.push(result.sharpe);
          cur.excess.push(result.strategyReturn - result.stockReturn);
          cur.stocks++;
          // 按买→卖配对统计每笔盈亏，累计盈利/亏损用于盈亏比
          let completed = 0;
          let openBuy: number | null = null;
          for (const t of result.trades) {
            if (t.type === "buy") openBuy = t.price;
            else if (t.type === "sell" && openBuy != null && openBuy > 0) {
              const pnl = (t.price - openBuy) / openBuy;
              if (pnl >= 0) cur.grossWin += pnl;
              else cur.grossLoss += -pnl;
              completed++;
              openBuy = null;
            }
          }
          cur.trades += completed;
          if (completed > 0) cur.winRates.push(result.winRate);
          if (result.strategyReturn > result.stockReturn) cur.beat++;
          acc.set(meta.id, cur);
        }
      }

      const records: StrategyTrackRecord[] = Array.from(acc.values()).map((a) => {
        const avgReturnPct = a.returns.length ? a.returns.reduce((s, v) => s + v, 0) / a.returns.length : 0;
        const avgWinRatePct = a.winRates.length ? a.winRates.reduce((s, v) => s + v, 0) / a.winRates.length : 0;
        const avgSharpe = a.sharpes.length ? a.sharpes.reduce((s, v) => s + v, 0) / a.sharpes.length : 0;
        const avgExcessPct = a.excess.length ? a.excess.reduce((s, v) => s + v, 0) / a.excess.length : 0;
        const beatBuyHoldPct = a.stocks ? (a.beat / a.stocks) * 100 : 0;
        const profitFactor = a.grossLoss > 1e-9 ? a.grossWin / a.grossLoss : a.grossWin > 0 ? 99 : 0;
        const base = { avgWinRatePct, beatBuyHoldPct, avgSharpe, avgReturnPct, profitFactor };
        const score = compositeScore(base);
        const { pros, cons, assessment } = buildProsCons({ ...base, totalTrades: a.trades, sampleStocks: a.stocks });
        return {
          meta: a.meta,
          rank: 0,
          sampleStocks: a.stocks,
          totalTrades: a.trades,
          avgWinRatePct: Number(avgWinRatePct.toFixed(1)),
          avgReturnPct: Number(avgReturnPct.toFixed(1)),
          medianReturnPct: Number(median(a.returns).toFixed(1)),
          avgSharpe: Number(avgSharpe.toFixed(2)),
          profitFactor: Number(profitFactor.toFixed(2)),
          beatBuyHold: a.beat,
          beatBuyHoldPct: Number(beatBuyHoldPct.toFixed(0)),
          avgExcessPct: Number(avgExcessPct.toFixed(1)),
          score,
          grade: gradeOf(score),
          stars: starsOf(score),
          assessment,
          pros,
          cons,
        };
      });

      records.sort((a, b) => b.score - a.score);
      records.forEach((r, i) => (r.rank = i + 1));

      return {
        asOf: new Date().toISOString(),
        windowStart,
        windowEnd,
        universe: REPRESENTATIVE_BASKET.filter((b) => batch.get(b.code) && (batch.get(b.code)!.candles.length >= 60)),
        neutralScore: NEUTRAL_SCORE,
        records,
        note:
          `榜单基于 ${usedStocks} 只代表性 A 股、统一中性基本面分 ${NEUTRAL_SCORE}、同一时间窗（${windowStart}~${windowEnd}）回测得出，` +
          `衡量纯量价信号的优劣。所有评级/星级/点评均由真实回测指标推出，非人工编造。牛市样本中择时策略普遍难跑赢买入持有，请结合「跑赢比例」综合判断。`,
      };
    },
    CACHE_TTL_MS,
  );
}
