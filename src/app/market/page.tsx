"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Card } from "@/components/ui";

/**
 * 数据接口浏览/调试台（隐藏参数可见化 Phase 4）。
 * `/api/market/data` 是个纯 API 端点（按 ?type=... 手动/外部查询），此前没有任何页面消费它，
 * 它在 Phase 3 回显的「生效口径」（params）与「默认目录」（defaults）在 UI 里无处可见。
 * 本页把这个出口做成可视化调试器：选 type → 填通用入参 → 一键查询 →
 * 只读回显「本次生效口径」+「完整默认目录」，并把每个可调参数做成输入框，改了即拼进 URL 重查。
 * 不改任何取数口径/算法，纯属让隐藏参数「页面可见、页面可调」。
 */

// 每个 type 暴露的通用入参（可调取数口径由响应 params 动态渲染，无需在此枚举）。
type CommonInput = "code" | "codes" | "date" | "q";
interface TypeSpec {
  value: string;
  label: string;
  group: string;
  inputs: CommonInput[]; // 该 type 用到的通用入参
  note?: string; // 必填/特殊说明
}

const TYPE_SPECS: TypeSpec[] = [
  { value: "quote", label: "实时行情", group: "行情 / K线", inputs: ["code", "codes"], note: "需要 code 或 codes（逗号分隔多只）" },
  { value: "kline", label: "日K线（东财→百度互备）", group: "行情 / K线", inputs: ["code"], note: "需要 6 位 code" },
  { value: "baidu-kline", label: "百度K线（原始）", group: "行情 / K线", inputs: ["code"], note: "需要 6 位 code" },
  { value: "financials-main", label: "主要财务指标", group: "财务", inputs: ["code"], note: "需要 6 位 code" },
  { value: "financials", label: "财务三表（新浪原始）", group: "财务", inputs: ["code"], note: "需要 6 位 code" },
  { value: "hot", label: "同花顺热点", group: "信号 / 资金", inputs: ["date"] },
  { value: "northbound", label: "北向资金", group: "信号 / 资金", inputs: [] },
  { value: "eps-forecast", label: "盈利预测", group: "信号 / 资金", inputs: ["code"], note: "需要 6 位 code" },
  { value: "industry", label: "行业对比排名", group: "信号 / 资金", inputs: [] },
  { value: "concept-blocks", label: "所属概念板块", group: "信号 / 资金", inputs: ["code"], note: "需要 6 位 code" },
  { value: "fund-flow-min", label: "分钟资金流", group: "信号 / 资金", inputs: ["code"], note: "需要 6 位 code" },
  { value: "fund-flow-120d", label: "120 日资金流", group: "信号 / 资金", inputs: ["code"], note: "需要 6 位 code" },
  { value: "dragon-tiger", label: "个股龙虎榜", group: "龙虎榜", inputs: ["code", "date"], note: "需要 6 位 code" },
  { value: "daily-dragon-tiger", label: "全市场龙虎榜", group: "龙虎榜", inputs: ["date"], note: "需要 date（默认今日）" },
  { value: "margin", label: "两融历史", group: "筹码 / 交易", inputs: ["code"], note: "需要 6 位 code" },
  { value: "block-trade", label: "大宗交易", group: "筹码 / 交易", inputs: ["code"], note: "需要 6 位 code" },
  { value: "holders", label: "股东人数变动", group: "筹码 / 交易", inputs: ["code"], note: "需要 6 位 code" },
  { value: "dividend", label: "分红送配", group: "筹码 / 交易", inputs: ["code"], note: "需要 6 位 code" },
  { value: "lockup", label: "解禁前瞻", group: "筹码 / 交易", inputs: ["code", "date"], note: "需要 6 位 code" },
  { value: "stock-info", label: "公司概况", group: "基本面 / 研报 / 新闻", inputs: ["code"], note: "需要 6 位 code" },
  { value: "reports", label: "研报", group: "基本面 / 研报 / 新闻", inputs: ["code"], note: "需要 6 位 code" },
  { value: "news", label: "个股新闻", group: "基本面 / 研报 / 新闻", inputs: ["code"], note: "需要 6 位 code" },
  { value: "global-news", label: "全球资讯", group: "基本面 / 研报 / 新闻", inputs: [] },
  { value: "announcements", label: "公告", group: "基本面 / 研报 / 新闻", inputs: ["code"], note: "需要 6 位 code" },
  { value: "iwencai", label: "问财（需 API key）", group: "基本面 / 研报 / 新闻", inputs: ["q"], note: "需要 q（自然语言查询）" },
];

const GROUP_ORDER = ["行情 / K线", "财务", "信号 / 资金", "龙虎榜", "筹码 / 交易", "基本面 / 研报 / 新闻"];
const COMMON_PARAM_NAMES = new Set<string>(["code", "codes", "date", "q"]);

interface ResolvedParam {
  value: number | string;
  default: number | string;
  fromUrl: boolean;
  label: string;
}
interface ApiResponse {
  type?: string;
  source?: string;
  attempts?: unknown;
  params?: Record<string, ResolvedParam>;
  data?: unknown;
  error?: string;
  available?: string[];
  defaults?: Record<string, number | string>;
}

const inputCls =
  "rounded-[2px] border border-[var(--border)] bg-[var(--inset)] px-2.5 py-1.5 text-xs font-mono text-[var(--text)] outline-none focus:border-[var(--accent-line)]";

export default function MarketDataPage() {
  const [type, setType] = useState<string>("kline");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState("");
  const [date, setDate] = useState("");
  const [q, setQ] = useState("");
  // 用户对可调取数口径的显式覆盖（key=参数名）。仅记录被改过的，空字符串视为「恢复默认」。
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [defaultsCatalog, setDefaultsCatalog] = useState<Record<string, number | string> | null>(null);
  const [copied, setCopied] = useState(false);

  const spec = useMemo(() => TYPE_SPECS.find((t) => t.value === type), [type]);

  // 挂载时拉一次「不带 type」的帮助响应，拿到完整默认目录（defaults）。
  useEffect(() => {
    fetch("/api/market/data")
      .then((r) => r.json())
      .then((j: ApiResponse) => {
        if (j.defaults) setDefaultsCatalog(j.defaults);
      })
      .catch(() => {});
  }, []);

  const buildUrl = useCallback(() => {
    const u = new URL("/api/market/data", window.location.origin);
    u.searchParams.set("type", type);
    if (spec?.inputs.includes("code") && code.trim()) u.searchParams.set("code", code.trim());
    if (spec?.inputs.includes("codes") && codes.trim()) u.searchParams.set("codes", codes.trim());
    if (spec?.inputs.includes("date") && date.trim()) u.searchParams.set("date", date.trim());
    if (spec?.inputs.includes("q") && q.trim()) u.searchParams.set("q", q.trim());
    for (const [k, v] of Object.entries(overrides)) {
      if (v.trim() !== "") u.searchParams.set(k, v.trim());
    }
    return u;
  }, [type, code, codes, date, q, overrides, spec]);

  const runQuery = useCallback(async () => {
    setLoading(true);
    setErrMsg("");
    try {
      const u = buildUrl();
      const r = await fetch(u.toString());
      const j: ApiResponse = await r.json();
      setResp(j);
      if (!r.ok) setErrMsg(j.error ? `HTTP ${r.status}：${j.error}` : `HTTP ${r.status}`);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "请求失败");
      setResp(null);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  const onTypeChange = (next: string) => {
    setType(next);
    setOverrides({});
    setResp(null);
    setErrMsg("");
  };

  const copyResponse = async () => {
    if (!resp) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(resp, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  // 可调取数口径：从响应 params 里剔除通用入参后逐个渲染为输入框。
  const tunableParams = useMemo(() => {
    if (!resp?.params) return [];
    return Object.entries(resp.params).filter(([name]) => !COMMON_PARAM_NAMES.has(name));
  }, [resp]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据接口调试台 / Market Data Inspector"
        subtitle="统一数据出口 /api/market/data 的可视化调试器：选数据类型、填入参、一键查询，只读回显本次「生效口径」与「完整默认目录」，每个隐藏参数都可在页面上改写并重查。口径数值不变，纯属可见化。"
      />

      {/* ── 查询表单 ── */}
      <Card padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--faint)]">数据类型 type</span>
            <select
              value={type}
              onChange={(e) => onTypeChange(e.target.value)}
              className={`${inputCls} min-w-[220px]`}
            >
              {GROUP_ORDER.map((g) => (
                <optgroup key={g} label={g}>
                  {TYPE_SPECS.filter((t) => t.group === g).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}（{t.value}）
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {spec?.inputs.includes("code") && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--faint)]">code（6 位）</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="600519"
                className={`${inputCls} w-28`}
              />
            </label>
          )}
          {spec?.inputs.includes("codes") && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--faint)]">codes（逗号分隔，可选）</span>
              <input
                value={codes}
                onChange={(e) => setCodes(e.target.value)}
                placeholder="600519,000001"
                className={`${inputCls} w-44`}
              />
            </label>
          )}
          {spec?.inputs.includes("date") && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--faint)]">date（YYYY-MM-DD，空=今日）</span>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="2026-06-26"
                className={`${inputCls} w-32`}
              />
            </label>
          )}
          {spec?.inputs.includes("q") && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--faint)]">q（问财查询）</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="今日涨停且换手率大于10%"
                className={`${inputCls} w-60`}
              />
            </label>
          )}

          <button
            onClick={runQuery}
            disabled={loading}
            className="rounded-[2px] border border-transparent bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "查询中…" : "查询"}
          </button>
        </div>
        {spec?.note && <p className="mt-2 text-[11px] text-[var(--faint)]">入参说明：{spec.note}</p>}
      </Card>

      {errMsg && (
        <div className="rounded-[2px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {errMsg}
        </div>
      )}

      {/* ── 本次生效口径（params）+ 可调输入框 ── */}
      {resp?.params && (
        <Card padding="md">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--text)]">本次生效口径</h2>
            <div className="flex items-center gap-2 text-[11px] text-[var(--faint)]">
              {resp.source && <span>数据源：<span className="font-mono text-[var(--muted)]">{resp.source}</span></span>}
              <button onClick={copyResponse} className="rounded-[2px] border border-[var(--border)] px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)]">
                {copied ? "已复制" : "复制完整响应 JSON"}
              </button>
            </div>
          </div>

          {tunableParams.length === 0 ? (
            <p className="text-xs text-[var(--faint)]">该数据类型没有可调取数口径（仅通用入参）。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--faint)]">
                    <th className="py-1.5 pr-3 font-normal">参数</th>
                    <th className="py-1.5 pr-3 font-normal">含义</th>
                    <th className="py-1.5 pr-3 font-normal">本次值</th>
                    <th className="py-1.5 pr-3 font-normal">默认</th>
                    <th className="py-1.5 pr-3 font-normal">来源</th>
                    <th className="py-1.5 font-normal">改写后重查</th>
                  </tr>
                </thead>
                <tbody>
                  {tunableParams.map(([name, pr]) => {
                    const isNum = typeof pr.default === "number";
                    const inputVal = overrides[name] ?? String(pr.value);
                    return (
                      <tr key={name} className="border-b border-[var(--border)]/50">
                        <td className="py-1.5 pr-3 font-mono text-[var(--text)]">{name}</td>
                        <td className="py-1.5 pr-3 text-[var(--muted)]">{pr.label}</td>
                        <td className="py-1.5 pr-3 font-mono text-[var(--text)]">{String(pr.value)}</td>
                        <td className="py-1.5 pr-3 font-mono text-[var(--faint)]">{String(pr.default)}</td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`rounded-[2px] px-1.5 py-0.5 text-[10px] ${
                              pr.fromUrl
                                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                                : "bg-[var(--inset)] text-[var(--faint)]"
                            }`}
                          >
                            {pr.fromUrl ? "URL 传入" : "服务端默认"}
                          </span>
                        </td>
                        <td className="py-1.5">
                          <input
                            type={isNum ? "number" : "text"}
                            value={inputVal}
                            onChange={(e) => setOverrides((o) => ({ ...o, [name]: e.target.value }))}
                            className={`${inputCls} w-32`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3">
                <button
                  onClick={runQuery}
                  disabled={loading}
                  className="rounded-[2px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--hover)] disabled:opacity-50"
                >
                  应用改写并重新查询
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── 返回数据原文 ── */}
      {resp && "data" in resp && (
        <Card padding="md">
          <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">返回数据</h2>
          <pre className="max-h-[480px] overflow-auto rounded-[2px] bg-[var(--inset)] p-3 text-[11px] leading-5 text-[var(--muted)]">
            {JSON.stringify(resp.data, null, 2)}
          </pre>
        </Card>
      )}

      {/* ── 完整默认目录（defaults）── */}
      {defaultsCatalog && (
        <Card padding="md">
          <h2 className="mb-1 text-sm font-semibold text-[var(--text)]">完整默认目录（隐藏取数口径）</h2>
          <p className="mb-3 text-[11px] text-[var(--faint)]">
            以下是各数据类型可调参数的服务端默认值（不带 type 调用 /api/market/data 时回显）。在上方任选 type 查询后，可逐个改写并重查。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--faint)]">
                  <th className="py-1.5 pr-3 font-normal">参数名</th>
                  <th className="py-1.5 font-normal">默认值</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(defaultsCatalog).map(([k, v]) => (
                  <tr key={k} className="border-b border-[var(--border)]/50">
                    <td className="py-1.5 pr-3 font-mono text-[var(--text)]">{k}</td>
                    <td className="py-1.5 font-mono text-[var(--muted)]">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
