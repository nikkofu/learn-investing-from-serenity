"use client";

import { useEffect, useState } from "react";

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
  }, []);

  const clearForm = () => {
    setProvider("");
    setBaseURL("");
    setModel("");
    setApiKey("");
    setFilters("");
    setHasApiKey(false);
  };

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
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">设置 · 多账户 LLM 接入</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          配置并保存多个 OpenAI 兼容账号，您可以在顶栏随时零感热切换。配置仅存在服务端本地 <code className="font-mono text-xs">.data/llm-config.json</code> 中。
        </p>
      </div>

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
    </div>
  );
}
