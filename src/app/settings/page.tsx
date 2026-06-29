"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";

const PRESETS: Record<string, { baseURL: string; model: string }> = {
  OpenAI: { baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  OpenRouter: {
    baseURL: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
  },
  DeepSeek: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  SiliconFlow: {
    baseURL: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
  Moonshot: { baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  通义千问: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
};

// 股票池纯净化口径（与 src/lib/universe.ts 的 UniverseConfig 同构）
interface UniverseConfig {
  excludeStar: boolean;
  excludeBeijing: boolean;
  excludeChiNext: boolean;
  excludeST: boolean;
  excludeB: boolean;
}

const DEFAULT_UNIVERSE: UniverseConfig = {
  excludeStar: true,
  excludeBeijing: true,
  excludeChiNext: false,
  excludeST: true,
  excludeB: true,
};

const UNIVERSE_TOGGLES: { key: keyof UniverseConfig; label: string; hint: string }[] = [
  { key: "excludeStar", label: "剔除科创板", hint: "688/689（含科创板 CDR）" },
  { key: "excludeBeijing", label: "剔除北交所", hint: "8/4 开头老代码段 + 920 新代码段" },
  { key: "excludeChiNext", label: "剔除创业板", hint: "300/301（默认保留）" },
  { key: "excludeST", label: "剔除 ST/*ST/退/PT", hint: "按证券名称判定的风险或非正常交易股" },
  { key: "excludeB", label: "剔除 B 股", hint: "沪 900xxx / 深 200xxx" },
];

export default function SettingsPage() {
  const [activeProvider, setActiveProvider] = useState("");
  const [providerConfigs, setProviderConfigs] = useState<Record<string, any>>({});
  
  // 表单状态
  const [provider, setProvider] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [filters, setFilters] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  // 编辑态
  const [editingProvider, setEditingProvider] = useState<string | null>(null);

  const [status, setStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 知识库状态
  const [dbStatus, setDbStatus] = useState<{
    available: boolean;
    handle: string;
    scrapedAt: string | null;
    mtime: string | null;
    count: number;
  } | null>(null);
  const [syncingDb, setSyncingDb] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);

  // 数据缓存策略
  type CacheCat = {
    category: string;
    label: string;
    desc: string;
    default: { active: number; inactive: number };
    current: { active: number; inactive: number };
  };
  const [cacheCats, setCacheCats] = useState<CacheCat[]>([]);
  const [cacheDraft, setCacheDraft] = useState<Record<string, { active: string; inactive: string }>>({});
  const [cacheStats, setCacheStats] = useState<{ total: number; valid: number; pending: number } | null>(null);
  const [llmStats, setLlmStats] = useState<{ total: number; valid: number } | null>(null);
  const [cacheStatus, setCacheStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);

  // 行情历史起始日期
  const [historyStartDraft, setHistoryStartDraft] = useState("");
  const [defaultHistoryStart, setDefaultHistoryStart] = useState("2000-01-01");
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketStatus, setMarketStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);

  const [universe, setUniverse] = useState<UniverseConfig>(DEFAULT_UNIVERSE);
  const [universeDefaults, setUniverseDefaults] = useState<UniverseConfig>(DEFAULT_UNIVERSE);
  const [universeBusy, setUniverseBusy] = useState(false);
  const [universeStatus, setUniverseStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);

  // Email configuration
  const [emailConfig, setEmailConfig] = useState({ 
    senderEmail: "", 
    recipientEmail: "",
    filters: {
      requireUptrend: true,
      maxBSignalAgeDays: 5,
      minExpectedReturn: 35,
      maxChannelPosition: 0.15,
      maxResults: 10,
      enableAdaptiveRelaxation: true,
    }
  });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);

  const fetchMarket = async () => {
    try {
      const res = await fetch("/api/settings/market");
      const d = await res.json();
      if (d.historyStart) setHistoryStartDraft(d.historyStart);
      if (d.defaultHistoryStart) setDefaultHistoryStart(d.defaultHistoryStart);
    } catch {
      /* ignore */
    }
  };

  const saveMarket = async () => {
    setMarketBusy(true);
    setMarketStatus(null);
    try {
      const res = await fetch("/api/settings/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyStart: historyStartDraft }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "保存失败");
      setMarketStatus({ kind: "ok", msg: "已保存。新起始日期对今后新拉取/全量刷新生效；如需让已缓存个股的历史立即变长，请清空 K 线缓存后重新分析。" });
      await fetchMarket();
    } catch (err) {
      setMarketStatus({ kind: "err", msg: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setMarketBusy(false);
    }
  };

  const fetchUniverse = async () => {
    try {
      const res = await fetch("/api/settings/universe");
      const d = await res.json();
      if (d.config) setUniverse(d.config as UniverseConfig);
      if (d.defaults) setUniverseDefaults(d.defaults as UniverseConfig);
    } catch {
      /* ignore */
    }
  };

  const saveUniverse = async (next: UniverseConfig) => {
    setUniverseBusy(true);
    setUniverseStatus(null);
    setUniverse(next);
    try {
      const res = await fetch("/api/settings/universe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error((await res.json()).error || "保存失败");
      const d = await res.json();
      if (d.config) setUniverse(d.config as UniverseConfig);
      setUniverseStatus({ kind: "ok", msg: "已保存。新口径对智能挖掘与套利雷达的股票池构造立即生效。" });
    } catch (err) {
      setUniverseStatus({ kind: "err", msg: err instanceof Error ? err.message : "保存失败" });
      await fetchUniverse();
    } finally {
      setUniverseBusy(false);
    }
  };

  const fetchEmailConfig = async () => {
    try {
      const res = await fetch("/api/settings/email");
      const d = await res.json();
      if (d.config) {
        setEmailConfig({
          senderEmail: "",
          recipientEmail: "",
          filters: d.config.filters || {
            requireUptrend: true,
            maxBSignalAgeDays: 5,
            minExpectedReturn: 35,
            maxChannelPosition: 0.15,
            maxResults: 10,
            enableAdaptiveRelaxation: true,
          },
        });
      }
    } catch {
      /* ignore */
    }
  };

  const saveEmailConfig = async () => {
    setEmailBusy(true);
    setEmailStatus(null);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailConfig),
      });
      if (!res.ok) throw new Error((await res.json()).error || "保存失败");
      setEmailStatus({ kind: "ok", msg: "邮件配置已保存。晚间扫描功能将使用此配置发送报告邮件。" });
    } catch (err) {
      setEmailStatus({ kind: "err", msg: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setEmailBusy(false);
    }
  };

  const runEveningScanNow = async () => {
    if (!emailConfig.senderEmail || !emailConfig.recipientEmail) {
      setEmailStatus({ kind: "err", msg: "请先配置发件人和收件人邮箱" });
      return;
    }
    setEmailBusy(true);
    setEmailStatus({ kind: "info", msg: "正在执行晚间扫描并发送邮件，请稍候..." });
    try {
      const res = await fetch("/api/settings/evening-scan", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "扫描执行失败");
      setEmailStatus({ 
        kind: "ok", 
        msg: `扫描完成！扫描日期: ${data.scanResult.date}，总扫描: ${data.scanResult.totalScanned} 只，符合条件: ${data.scanResult.filteredCount} 只，精选: ${data.scanResult.stocksCount} 只。邮件已发送。` 
      });
    } catch (err) {
      setEmailStatus({ kind: "err", msg: err instanceof Error ? err.message : "扫描执行失败" });
    } finally {
      setEmailBusy(false);
    }
  };

  const fetchCache = async () => {
    try {
      const res = await fetch("/api/settings/cache");
      const d = await res.json();
      const cats: CacheCat[] = d.categories || [];
      setCacheCats(cats);
      setCacheStats(d.stats || null);
      setLlmStats(d.llmTotal || null);
      const draft: Record<string, { active: string; inactive: string }> = {};
      for (const c of cats) draft[c.category] = { active: String(c.current.active), inactive: String(c.current.inactive) };
      setCacheDraft(draft);
    } catch {
      /* ignore */
    }
  };

  const fmtSec = (n: number): string => {
    if (n >= 3600) return `${+(n / 3600).toFixed(n % 3600 === 0 ? 0 : 1)} 小时`;
    if (n >= 60) return `${+(n / 60).toFixed(n % 60 === 0 ? 0 : 1)} 分钟`;
    return `${n} 秒`;
  };

  const setDraft = (cat: string, field: "active" | "inactive", val: string) => {
    setCacheDraft((prev) => ({ ...prev, [cat]: { ...prev[cat], [field]: val } }));
  };

  const saveCache = async () => {
    setCacheBusy(true);
    setCacheStatus(null);
    try {
      const settings: Record<string, { active: number; inactive: number }> = {};
      for (const c of cacheCats) {
        const d = cacheDraft[c.category];
        if (!d) continue;
        const active = Number(d.active);
        const inactive = Number(d.inactive);
        if (!Number.isFinite(active) || !Number.isFinite(inactive) || active < 0 || inactive < 0) {
          throw new Error(`${c.label} 的 TTL 必须是非负数字（单位：秒）`);
        }
        settings[c.category] = { active, inactive };
      }
      const res = await fetch("/api/settings/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", settings }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "保存失败");
      setCacheStatus({ kind: "ok", msg: "缓存策略已保存并即时生效。" });
      await fetchCache();
    } catch (err) {
      setCacheStatus({ kind: "err", msg: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setCacheBusy(false);
    }
  };

  const resetCache = async () => {
    if (!confirm("确定恢复全部缓存类别为默认 TTL 吗？")) return;
    setCacheBusy(true);
    setCacheStatus(null);
    try {
      const res = await fetch("/api/settings/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (!res.ok) throw new Error("恢复默认失败");
      setCacheStatus({ kind: "info", msg: "已恢复全部默认 TTL。" });
      await fetchCache();
    } catch (err) {
      setCacheStatus({ kind: "err", msg: err instanceof Error ? err.message : "恢复默认失败" });
    } finally {
      setCacheBusy(false);
    }
  };

  const clearCache = async () => {
    if (!confirm("确定清空进程内全部缓存吗？（下次取数将重新拉取）")) return;
    setCacheBusy(true);
    setCacheStatus(null);
    try {
      const res = await fetch("/api/settings/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error("清空失败");
      setCacheStats(d.stats || null);
      setCacheStatus({ kind: "info", msg: "已清空全部缓存。" });
    } catch (err) {
      setCacheStatus({ kind: "err", msg: err instanceof Error ? err.message : "清空失败" });
    } finally {
      setCacheBusy(false);
    }
  };

  const clearLLMCache = async () => {
    if (!confirm("确定清空落盘的静态基本面缓存吗？（下次分析会重新全量推理，耗时与费用会上升）")) return;
    setCacheBusy(true);
    setCacheStatus(null);
    try {
      const res = await fetch("/api/settings/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearLLM" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error("清空失败");
      setCacheStatus({ kind: "info", msg: `已清空静态基本面缓存（${d.clearedLLM ?? 0} 条）。` });
      await fetchCache();
    } catch (err) {
      setCacheStatus({ kind: "err", msg: err instanceof Error ? err.message : "清空失败" });
    } finally {
      setCacheBusy(false);
    }
  };

  const fetchDbStatus = async () => {
    try {
      const res = await fetch("/api/knowledge/sync");
      const data = await res.json();
      setDbStatus(data);
    } catch {
      /* ignore */
    }
  };

  const handleSyncDb = async () => {
    setSyncingDb(true);
    setSyncStatus({ kind: "info", msg: "正在从 GitHub CDN 远程拉取并清洗最新的 Serenity 投研知识库..." });
    try {
      const res = await fetch("/api/knowledge/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");
      
      setSyncStatus({
        kind: "ok",
        msg: `同步完成！本次新增收录了 ${data.newCount} 条推特，知识库当前总计 ${data.totalCount} 条记录。`
      });
      await fetchDbStatus();
    } catch (err) {
      setSyncStatus({
        kind: "err",
        msg: err instanceof Error ? err.message : "同步失败，请稍后重试"
      });
    } finally {
      setSyncingDb(false);
    }
  };

  const clearForm = () => {
    setProvider("");
    setBaseURL("");
    setModel("");
    setApiKey("");
    setFilters("");
    setHasApiKey(false);
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const c = await res.json();
      setActiveProvider(c.provider || "");
      setProviderConfigs(c.providers || {});
      
      if (c.provider) {
        setEditingProvider(c.provider);
        setProvider(c.provider);
        setBaseURL(c.baseURL || "");
        setModel(c.model || "");
        setFilters(c.filters || "");
        setHasApiKey(Boolean(c.hasApiKey));
      } else {
        setEditingProvider(null);
        clearForm();
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchDbStatus();
    fetchCache();
    fetchMarket();
    fetchUniverse();
    fetchEmailConfig();
  }, []);

  const selectProviderCard = (name: string) => {
    const p = providerConfigs[name];
    if (!p) return;
    setEditingProvider(name);
    setProvider(name);
    setBaseURL(p.baseURL || "");
    setModel(p.model || "");
    setFilters(p.filters || "");
    setHasApiKey(Boolean(p.hasApiKey));
    setApiKey("");
    setStatus(null);
  };

  const startNewProvider = () => {
    setEditingProvider(null);
    clearForm();
    setStatus(null);
  };

  const applyPreset = (name: string) => {
    const p = PRESETS[name];
    if (!p) return;
    setProvider(name);
    setBaseURL(p.baseURL);
    setModel(p.model);
  };

  const deleteProvider = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确定要注销并删除 Provider "${name}" 的配置账号吗？`)) return;
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", provider: name }),
      });
      if (!res.ok) throw new Error("删除失败");
      
      await fetchConfig();
      window.dispatchEvent(new Event("llm-config-updated"));
      setStatus({ kind: "info", msg: `Provider "${name}" 的配置已注销删除` });
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : "注销失败" });
    }
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!provider.trim()) {
      setStatus({ kind: "err", msg: "Provider 标签名称不能为空" });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, baseURL, model, apiKey, filters }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      
      setStatus({ kind: "ok", msg: "配置保存成功。当前 Provider 已被激活为全局默认 AI 驱动源。" });
      setApiKey("");
      await fetchConfig();
      window.dispatchEvent(new Event("llm-config-updated"));
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3.5 py-2 text-sm outline-none focus:border-[var(--accent)] transition font-mono";

  const configuredList = Object.entries(providerConfigs).map(([name, p]) => ({
    name,
    baseURL: p.baseURL || "",
    hasApiKey: Boolean(p.hasApiKey),
    model: p.model || "",
    filters: p.filters || "",
    isActive: name === activeProvider,
  }));

  return (
    <div className="w-full space-y-8">
      <PageHeader
        title="设置 · 多账户 LLM 接入"
        subtitle={
          <>
            配置并保存多个 OpenAI 兼容账号，您可以在顶栏随时零感热切换。配置仅存在服务端本地 <code className="font-mono text-xs">.data/llm-config.json</code> 中。
          </>
        }
      />

      <div className="space-y-3">
        <span className="text-[11px] font-bold tracking-wider text-[var(--faint)] uppercase block px-0.5 select-none">
          已配置接入账号 (Registered Accounts)
        </span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {configuredList.map((p) => {
            const isEditing = editingProvider === p.name;
            return (
              <div
                key={p.name}
                onClick={() => selectProviderCard(p.name)}
                className={`flex flex-col justify-between border p-4 rounded-xl cursor-pointer transition relative group select-none ${
                  isEditing
                    ? "border-[var(--accent)] ring-1 ring-[var(--accent)] bg-[var(--hover)]"
                    : "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--accent-line)] hover:bg-[var(--hover)]"
                }`}
              >
                <button
                  onClick={(e) => deleteProvider(p.name, e)}
                  title="删除该配置"
                  className="absolute right-3.5 top-3.5 opacity-0 group-hover:opacity-100 hover:text-red-400 text-[var(--faint)] transition duration-200 cursor-pointer text-xs"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
                  </svg>
                </button>

                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 pr-4">
                    <span className="font-bold text-sm text-[var(--text)]">{p.name}</span>
                    
                    {p.isActive && (
                      <span className="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                        Active
                      </span>
                    )}

                    {p.hasApiKey && (
                      <span className="inline-flex items-center rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400 ring-1 ring-inset ring-blue-500/10">
                        Connected
                      </span>
                    )}
                  </div>

                  <div className="space-y-0.5 font-mono text-[10px] text-[var(--muted)]">
                    <div className="truncate" title={p.model}>模型: {p.model || "未设"}</div>
                    {p.filters && (
                      <div className="truncate text-amber-500" title={p.filters}>过滤: {p.filters}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div
            onClick={startNewProvider}
            className={`flex items-center justify-center border-2 border-dashed p-6 rounded-xl cursor-pointer transition select-none ${
              editingProvider === null
                ? "border-[var(--accent)] bg-[var(--hover)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--faint)] hover:border-[var(--accent-line)] hover:text-[var(--text)]"
            }`}
          >
            <div className="flex items-center gap-1.5 font-semibold text-sm">
              <span>+</span>
              <span>新增 LLM 账号</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)]" />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">
            {editingProvider ? `修改账户: ${editingProvider}` : "新增 LLM 接入账号"}
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            填入对应的 API 配置。快捷 presets 不会直接覆盖，只回填进下方表单供您调整。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 select-none">
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applyPreset(name)}
              className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-xs text-[var(--text)] hover:bg-[var(--hover)] cursor-pointer"
            >
              {name}
            </button>
          ))}
        </div>

        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-[var(--text)] select-none">Provider 标识名 (例如 SiliconFlow)</label>
            <input
              className={field}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="自定义提供商名称标签，例如 SiliconFlow"
              disabled={editingProvider !== null}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--text)] select-none">Base URL</label>
            <input className={field} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.siliconflow.cn/v1" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--text)] select-none">活跃模型 Model (默认启动)</label>
            <input className={field} value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-ai/DeepSeek-V3" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-[var(--text)] select-none">
              API Key {hasApiKey && <span className="ml-1 text-xs text-emerald-400">（已配置，留空保持不变）</span>}
            </label>
            <input
              className={field}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? "••••••••（已保存）" : "sk-..."}
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="mb-1 flex items-center justify-between text-xs font-semibold text-[var(--text)] select-none">
              <span>模型过滤关键字 (Filters)</span>
              <span className="text-[10px] text-[var(--faint)] normal-case font-normal">多组关键字用英文逗号分隔，留空则不过滤</span>
            </label>
            <input
              className={field}
              value={filters}
              onChange={(e) => setFilters(e.target.value)}
              placeholder="例如 deepseek,qwen (只展示名字中包含 deepseek 或 qwen 的模型)"
            />
          </div>

          <div className="md:col-span-2 pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 cursor-pointer select-none"
            >
              {saving ? "保存中…" : editingProvider ? "更新并激活账号" : "保存并激活账号"}
            </button>
            {status && (
              <p className={`text-xs ${status.kind === "ok" ? "text-emerald-400" : status.kind === "err" ? "text-red-400" : "text-[var(--muted)]"}`}>
                {status.msg}
              </p>
            )}
          </div>
        </form>
      </div>

      <div className="border-t border-[var(--border)]" />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)] select-none">Serenity 智能知识库治理</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            系统会每 6 小时在后台默默检测并自动追踪最新的 Serenity 推特消息及研究成果。您也可以在下方强制执行排重清洗并即时同步。
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-[var(--border)] bg-[var(--inset)] p-4 rounded-xl space-y-1 select-none">
              <span className="text-[10px] font-bold text-[var(--faint)] uppercase block tracking-wider">自动更新状态</span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-sm font-semibold text-emerald-400">自动追踪活跃中</span>
              </div>
            </div>

            <div className="border border-[var(--border)] bg-[var(--inset)] p-4 rounded-xl space-y-1 select-none">
              <span className="text-[10px] font-bold text-[var(--faint)] uppercase block tracking-wider">已收录精选推文</span>
              <div className="text-sm font-bold text-[var(--text)]">
                {dbStatus ? `${dbStatus.count.toLocaleString()} 条` : "加载中..."}
              </div>
            </div>

            <div className="border border-[var(--border)] bg-[var(--inset)] p-4 rounded-xl space-y-1 select-none">
              <span className="text-[10px] font-bold text-[var(--faint)] uppercase block tracking-wider">上次同步时间</span>
              <div className="text-sm font-medium text-[var(--muted)] truncate" title={dbStatus?.scrapedAt || ""}>
                {dbStatus?.scrapedAt ? new Date(dbStatus.scrapedAt).toLocaleString("zh-CN") : "暂未同步"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSyncDb}
              disabled={syncingDb}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 cursor-pointer select-none"
            >
              {syncingDb ? "正在拉取同步…" : "立即同步最新消息"}
            </button>
            {syncStatus && (
              <p className={`text-xs ${syncStatus.kind === "ok" ? "text-emerald-400" : syncStatus.kind === "err" ? "text-red-400" : "text-[var(--muted)]"}`}>
                {syncStatus.msg}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)]" />

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text)] select-none">数据缓存策略</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              所有股票数据接口统一缓存。每类按「盘中 / 休市」两套 TTL（单位：秒）：盘中要新鲜、休市可长存。配置存于服务端 <code className="font-mono text-xs">.data/cache-config.json</code>，保存后即时生效。
            </p>
          </div>
          {cacheStats && (
            <div className="shrink-0 text-right text-[10px] font-mono text-[var(--faint)] leading-relaxed select-none">
              <div>缓存条目: <span className="text-[var(--muted)]">{cacheStats.valid}</span> 有效 / {cacheStats.total} 总</div>
              <div>合并请求: {cacheStats.pending}</div>
              {llmStats && (
                <div>静态推理: <span className="text-[var(--muted)]">{llmStats.valid}</span> 有效 / {llmStats.total} 总</div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 items-center">
            <span className="text-[10px] font-bold tracking-wider text-[var(--faint)] uppercase">数据类别</span>
            <span className="text-[10px] font-bold tracking-wider text-[var(--faint)] uppercase text-center w-32">盘中 TTL (秒)</span>
            <span className="text-[10px] font-bold tracking-wider text-[var(--faint)] uppercase text-center w-32">休市 TTL (秒)</span>
            {cacheCats.map((c) => {
              const d = cacheDraft[c.category] ?? { active: "", inactive: "" };
              return (
                <div key={c.category} className="contents">
                  <div className="py-2 border-t border-[var(--border)]">
                    <div className="text-sm font-semibold text-[var(--text)]">{c.label}</div>
                    <div className="text-[11px] text-[var(--muted)]">{c.desc}</div>
                    <div className="text-[10px] text-[var(--faint)] font-mono mt-0.5">
                      默认 盘中 {fmtSec(c.default.active)} · 休市 {fmtSec(c.default.inactive)}
                    </div>
                  </div>
                  <div className="py-2 border-t border-[var(--border)]">
                    <input
                      type="number"
                      min={0}
                      className={`${field} text-center w-32`}
                      value={d.active}
                      onChange={(e) => setDraft(c.category, "active", e.target.value)}
                    />
                  </div>
                  <div className="py-2 border-t border-[var(--border)]">
                    <input
                      type="number"
                      min={0}
                      className={`${field} text-center w-32`}
                      value={d.inactive}
                      onChange={(e) => setDraft(c.category, "inactive", e.target.value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={saveCache}
              disabled={cacheBusy}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 cursor-pointer select-none"
            >
              {cacheBusy ? "处理中…" : "保存缓存策略"}
            </button>
            <button
              type="button"
              onClick={resetCache}
              disabled={cacheBusy}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50 cursor-pointer select-none"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={clearCache}
              disabled={cacheBusy}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-amber-500 hover:bg-[var(--hover)] disabled:opacity-50 cursor-pointer select-none"
            >
              清空当前缓存
            </button>
            <button
              type="button"
              onClick={clearLLMCache}
              disabled={cacheBusy}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-red-500 hover:bg-[var(--hover)] disabled:opacity-50 cursor-pointer select-none"
            >
              清空静态基本面缓存
            </button>
            {cacheStatus && (
              <p className={`text-xs ${cacheStatus.kind === "ok" ? "text-emerald-400" : cacheStatus.kind === "err" ? "text-red-400" : "text-[var(--muted)]"}`}>
                {cacheStatus.msg}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)]" />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)] select-none">行情历史起始日期</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            全量日线从该日期拉起（默认 <code className="font-mono text-xs">{defaultHistoryStart}</code>），用于更长的策略回测样本。若某数据源有更晚的硬性起点，则以该源能给的最早为准。配置存于 <code className="font-mono text-xs">.data/market-config.json</code>。
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold tracking-wider text-[var(--faint)] uppercase">起始日期 (YYYY-MM-DD)</span>
              <input
                type="date"
                className={`${field} w-44`}
                value={historyStartDraft}
                onChange={(e) => setHistoryStartDraft(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={saveMarket}
              disabled={marketBusy}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 cursor-pointer select-none"
            >
              {marketBusy ? "处理中…" : "保存起始日期"}
            </button>
            <button
              type="button"
              onClick={() => setHistoryStartDraft(defaultHistoryStart)}
              disabled={marketBusy}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50 cursor-pointer select-none"
            >
              恢复默认
            </button>
            {marketStatus && (
              <p className={`text-xs ${marketStatus.kind === "ok" ? "text-emerald-400" : marketStatus.kind === "err" ? "text-red-400" : "text-[var(--muted)]"}`}>
                {marketStatus.msg}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)]" />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)] select-none">股票池纯净化（全站统一口径）</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            智能挖掘（/mining）与套利雷达（/arb）构造候选股票池时统一走这里的过滤口径（不再硬编码）。默认聚焦 A 股主板个股，剔除科创板/北交所/ST/B 股，创业板默认保留。配置存于 <code className="font-mono text-xs">.data/universe-config.json</code>。
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {UNIVERSE_TOGGLES.map((t) => (
              <label key={t.key} className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={universe[t.key]}
                  disabled={universeBusy}
                  onChange={(e) => saveUniverse({ ...universe, [t.key]: e.target.checked })}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-[var(--text)]">{t.label}</span>
                  <span className="text-[11px] text-[var(--muted)]">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => saveUniverse(universeDefaults)}
              disabled={universeBusy}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50 cursor-pointer select-none"
            >
              恢复默认
            </button>
            {universeStatus && (
              <p className={`text-xs ${universeStatus.kind === "ok" ? "text-emerald-400" : universeStatus.kind === "err" ? "text-red-400" : "text-[var(--muted)]"}`}>
                {universeStatus.msg}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)]" />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)] select-none">晚间扫描邮件配置</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            配置晚间自动股票扫描报告的邮件发送功能。发件人需要先在 agent.qq.com 完成授权，收件人默认为空需手动配置。配置存于 <code className="font-mono text-xs">.data/email-config.json</code>。
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                发件人邮箱 <span className="text-[var(--muted)] font-normal">（agent.qq.com 别名）</span>
              </label>
              <input
                type="email"
                placeholder="例如：cadena@agent.qq.com"
                value={emailConfig.senderEmail}
                onChange={(e) => setEmailConfig({ ...emailConfig, senderEmail: e.target.value })}
                disabled={emailBusy}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
              />
              {!emailConfig.senderEmail && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  发件人邮箱为空时，请先前往 <a href="https://agent.qq.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">agent.qq.com</a> 注册并授权 Agent Mail CLI
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                收件人邮箱 <span className="text-[var(--muted)] font-normal">（您的个人邮箱）</span>
              </label>
              <input
                type="email"
                placeholder="例如：your@email.com"
                value={emailConfig.recipientEmail}
                onChange={(e) => setEmailConfig({ ...emailConfig, recipientEmail: e.target.value })}
                disabled={emailBusy}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
              />
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <h3 className="text-sm font-semibold text-[var(--text)] mb-3">筛选条件配置</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="requireUptrend"
                  checked={emailConfig.filters.requireUptrend}
                  onChange={(e) => setEmailConfig({ 
                    ...emailConfig, 
                    filters: { ...emailConfig.filters, requireUptrend: e.target.checked } 
                  })}
                  disabled={emailBusy}
                  className="rounded border-[var(--border)] bg-[var(--bg)]"
                />
                <label htmlFor="requireUptrend" className="text-sm text-[var(--text)]">
                  要求上升趋势
                </label>
              </div>

              <div>
                <label className="block text-sm text-[var(--text)] mb-1">
                  B信号最大天数（1-30天）
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={emailConfig.filters.maxBSignalAgeDays}
                  onChange={(e) => setEmailConfig({ 
                    ...emailConfig, 
                    filters: { ...emailConfig.filters, maxBSignalAgeDays: parseInt(e.target.value) || 5 } 
                  })}
                  disabled={emailBusy}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text)] mb-1">
                  最低预期涨幅（%）
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={emailConfig.filters.minExpectedReturn}
                  onChange={(e) => setEmailConfig({ 
                    ...emailConfig, 
                    filters: { ...emailConfig.filters, minExpectedReturn: parseInt(e.target.value) || 35 } 
                  })}
                  disabled={emailBusy}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text)] mb-1">
                  通道底部位置阈值（0-1，如0.15=底部15%）
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={emailConfig.filters.maxChannelPosition}
                  onChange={(e) => setEmailConfig({ 
                    ...emailConfig, 
                    filters: { ...emailConfig.filters, maxChannelPosition: parseFloat(e.target.value) || 0.15 } 
                  })}
                  disabled={emailBusy}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text)] mb-1">
                  最大返回股票数量（1-50）
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={emailConfig.filters.maxResults}
                  onChange={(e) => setEmailConfig({ 
                    ...emailConfig, 
                    filters: { ...emailConfig.filters, maxResults: parseInt(e.target.value) || 10 } 
                  })}
                  disabled={emailBusy}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enableAdaptiveRelaxation"
                  checked={emailConfig.filters.enableAdaptiveRelaxation}
                  onChange={(e) => setEmailConfig({ 
                    ...emailConfig, 
                    filters: { ...emailConfig.filters, enableAdaptiveRelaxation: e.target.checked } 
                  })}
                  disabled={emailBusy}
                  className="rounded border-[var(--border)] bg-[var(--bg)]"
                />
                <label htmlFor="enableAdaptiveRelaxation" className="text-sm text-[var(--text)]">
                  启用自适应放宽条件（当筛选结果为0时自动放宽条件）
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveEmailConfig}
              disabled={emailBusy || !emailConfig.senderEmail || !emailConfig.recipientEmail}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50 cursor-pointer select-none"
            >
              保存邮件配置
            </button>
            <button
              type="button"
              onClick={runEveningScanNow}
              disabled={emailBusy || !emailConfig.senderEmail || !emailConfig.recipientEmail}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 cursor-pointer select-none"
            >
              {emailBusy ? "执行中..." : "立即执行扫描并发送邮件"}
            </button>
            {emailStatus && (
              <p className={`text-xs ${emailStatus.kind === "ok" ? "text-emerald-400" : emailStatus.kind === "err" ? "text-red-400" : "text-[var(--muted)]"}`}>
                {emailStatus.msg}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
