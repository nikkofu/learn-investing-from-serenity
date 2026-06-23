/**
 * 回测交易成本模型（A股口径）。
 * 在每次买入/卖出成交点扣减：佣金（含最低 5 元）、印花税（仅卖出）、过户费（双边）、滑点（双边）。
 * 默认参数贴近主流券商实际：佣金万2.5、印花税 0.05%（2023-08 起）、过户费 0.001%（双边）、滑点 0.05%。
 */
export interface CostModel {
  commissionRate: number; // 佣金费率（双边）
  commissionMin: number; // 单笔佣金最低（元）
  stampTaxRate: number; // 印花税（仅卖出）
  transferFeeRate: number; // 过户费（双边）
  slippageRate: number; // 滑点（单边，买入抬价/卖出压价）
}

export const DEFAULT_COST_MODEL: CostModel = {
  commissionRate: 0.00025,
  commissionMin: 5,
  stampTaxRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageRate: 0.0005,
};

/** 单边滑点后的成交价：买入抬价、卖出压价。 */
export function fillPrice(price: number, side: "buy" | "sell", m: CostModel): number {
  return side === "buy" ? price * (1 + m.slippageRate) : price * (1 - m.slippageRate);
}

/**
 * 用 cashToSpend 现金买入，返回扣除佣金/过户费/滑点后实际获得的股数。
 * 预算守恒：notional + 佣金 + 过户费 = cashToSpend（含滑点的成交价）。
 */
export function buyShares(cashToSpend: number, price: number, m: CostModel = DEFAULT_COST_MODEL): number {
  if (cashToSpend <= 0 || price <= 0) return 0;
  const effPx = fillPrice(price, "buy", m);
  const est = cashToSpend / (1 + m.commissionRate + m.transferFeeRate);
  const commission = Math.max(est * m.commissionRate, m.commissionMin);
  const transfer = est * m.transferFeeRate;
  const notional = Math.max(0, cashToSpend - commission - transfer);
  return notional / effPx;
}

/** 卖出 shares 股，返回扣除佣金/印花税/过户费/滑点后的净现金。 */
export function sellProceeds(shares: number, price: number, m: CostModel = DEFAULT_COST_MODEL): number {
  if (shares <= 0 || price <= 0) return 0;
  const gross = shares * fillPrice(price, "sell", m);
  const commission = Math.max(gross * m.commissionRate, m.commissionMin);
  const stamp = gross * m.stampTaxRate;
  const transfer = gross * m.transferFeeRate;
  return Math.max(0, gross - commission - stamp - transfer);
}

/** 一次完整买卖往返的约当成本率（%），用于 UI 提示。 */
export function roundTripCostPct(m: CostModel = DEFAULT_COST_MODEL): number {
  const oneWay = m.commissionRate + m.transferFeeRate + m.slippageRate;
  return (oneWay * 2 + m.stampTaxRate) * 100;
}
