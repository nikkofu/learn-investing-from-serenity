/**
 * 全站「买卖引擎 / 交易策略」偏好（单一事实来源）。
 *
 * 目标：让看盘页（/chart 的 Pro 画布买卖引擎、经典 SVG 的策略选择）与批量回测页
 * （/backtest/strategy）等所有页面，默认带出同一策略，并记忆用户「最后一次选择」——
 * 任意页面切换策略都会写入 localStorage，下次打开任意页面自然带出上次选择。
 *
 * 优先级：深链 ?strategy= > 上次保存 > 偏好默认（Cardwell RSI Trade Navigator 趋势延续版 V2）> 后端默认 > 列表首个。
 * 所有候选都按「是否存在于当前策略列表」校验，失效时安全回退。
 */

/** 偏好默认买卖引擎：Cardwell RSI Trade Navigator 趋势延续版 V2（解决 V1 强趋势出局后回不来）。 */
export const PREFERRED_PRO_STRATEGY_ID = "tv-cardwell-rsi-navigator-v2";
/** 持久化键：全站共用同一 key，保证各页面一致。 */
export const PRO_STRATEGY_LS_KEY = "serenity.chart.proStrategyId";

/** 读取上次保存的策略 id（仅客户端有效；服务端 / 异常时返回 null）。 */
export function readSavedStrategyId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PRO_STRATEGY_LS_KEY);
  } catch {
    return null;
  }
}

/** 保存用户当前选择的策略 id（仅客户端；空值或异常静默忽略）。 */
export function saveStrategyId(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    window.localStorage.setItem(PRO_STRATEGY_LS_KEY, id);
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/**
 * 在给定策略列表中决定「初始应选」的策略 id。
 * 优先级：深链(urlId) > 上次保存 > 偏好默认(Cardwell) > 后端默认 > 列表首个。
 * 每个候选都校验是否存在于 ids，失效则继续回退。
 */
export function resolveInitialStrategyId(opts: {
  ids: string[];
  urlId?: string | null;
  backendDefaultId?: string | null;
}): string {
  const { ids, urlId, backendDefaultId } = opts;
  const has = (id?: string | null): id is string => !!id && ids.includes(id);
  if (has(urlId)) return urlId;
  const saved = readSavedStrategyId();
  if (has(saved)) return saved;
  if (has(PREFERRED_PRO_STRATEGY_ID)) return PREFERRED_PRO_STRATEGY_ID;
  if (has(backendDefaultId)) return backendDefaultId;
  return ids[0] ?? "";
}
