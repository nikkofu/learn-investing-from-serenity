"use client";

import { useEffect, useState } from "react";

const PRESETS: Record<string, { baseURL: string; model: string }> = {
  OpenAI: { baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  OpenRouter: {
    baseURL: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat-v3-0324:free",
  },
  DeepSeek: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  Moonshot: { baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  通义千问: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
};

export default function SettingsPage() {
  const [provider, setProvider] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        setProvider(c.provider || "");
        setBaseURL(c.baseURL || "");
        setModel(c.model || "");
        setHasApiKey(Boolean(c.hasApiKey));
      })
      .catch(() => {});
  }, []);

  function applyPreset(name: string) {
    const p = PRESETS[name];
    if (!p) return;
    setProvider(name);
    setBaseURL(p.baseURL);
    setModel(p.model);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, baseURL, model, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setStatus({ kind: "ok", msg: "已保存。API key 仅存储在服务端本地文件，不会回传浏览器。" });
      setHasApiKey(true);
      setApiKey("");
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-emerald-500/60";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">设置 · LLM 接入</h1>
        <p className="mt-1 text-sm text-zinc-400">
          填写任意 OpenAI 兼容的服务。配置保存在服务端 <code className="font-mono text-xs">.data/llm-config.json</code>（已 gitignore）。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => applyPreset(name)}
            className="rounded-md border border-white/15 px-3 py-1 text-xs text-zinc-300 hover:bg-white/5"
          >
            {name}
          </button>
        ))}
      </div>

      <form onSubmit={save} className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div>
          <label className="mb-1 block text-sm text-zinc-300">Provider（标签）</label>
          <input className={field} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="deepseek / openai ..." />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-300">Base URL</label>
          <input className={field} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.deepseek.com/v1" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-300">Model</label>
          <input className={field} value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
          {baseURL.includes("openrouter.ai") && (
            <p className="mt-1 text-xs text-zinc-500">
              OpenRouter 免费模型需带 <code className="font-mono">:free</code> 后缀，例如{" "}
              <code className="font-mono">deepseek/deepseek-chat-v3-0324:free</code>、
              <code className="font-mono">meta-llama/llama-3.3-70b-instruct:free</code>。
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-300">
            API Key {hasApiKey && <span className="ml-1 text-xs text-emerald-400">（已配置，留空则保持不变）</span>}
          </label>
          <input
            className={field}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasApiKey ? "••••••••（已保存）" : "sk-..."}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
        {status && (
          <p className={`text-sm ${status.kind === "ok" ? "text-emerald-400" : status.kind === "err" ? "text-red-400" : "text-zinc-400"}`}>
            {status.msg}
          </p>
        )}
      </form>
    </div>
  );
}
