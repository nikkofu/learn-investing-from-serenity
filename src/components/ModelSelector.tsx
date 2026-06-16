"use client";

import { useEffect, useRef, useState } from "react";

export default function ModelSelector() {
  const [model, setModel] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [groupedModels, setGroupedModels] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (data && data.model) {
        setModel(data.model);
        setProvider(data.provider || "");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchModels = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config/models");
      const data = await res.json();
      if (data && data.models && typeof data.models === "object") {
        setGroupedModels(data.models);
      } else {
        setGroupedModels({
          [provider || "LLM"]: [
            "gpt-4o-mini",
            "gpt-4o",
            "deepseek-chat",
            "deepseek-reasoner"
          ]
        });
      }
    } catch (err) {
      setGroupedModels({
        [provider || "LLM"]: [
          "gpt-4o-mini",
          "deepseek-chat"
        ]
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    window.addEventListener("llm-config-updated", fetchConfig);
    return () => {
      window.removeEventListener("llm-config-updated", fetchConfig);
    };
  }, []);

  useEffect(() => {
    if (open) {
      fetchModels();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectModel = async (pName: string, mName: string) => {
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: pName, model: mName }),
      });
      if (res.ok) {
        setModel(mName);
        setProvider(pName);
        window.dispatchEvent(new Event("llm-config-updated"));
      }
    } catch (err) {
      console.error("Failed to switch model:", err);
    } finally {
      setOpen(false);
    }
  };

  if (!model) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="选择LLM模型"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-mono text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer select-none"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
        <span className="max-w-[140px] truncate" title={`${provider} / ${model}`}>
          {model}
        </span>
        <svg width="8" height="8" viewBox="0 0 10 6" className="opacity-60 shrink-0" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] p-2.5 shadow-xl">
          <div className="space-y-2.5">
            <span className="text-[10px] font-bold tracking-wider text-[var(--faint)] uppercase block px-1.5 select-none">
              切换 AI 模型
            </span>
            <div className="max-h-60 overflow-y-auto space-y-3 pr-0.5 scrollbar-thin">
              {loading && Object.keys(groupedModels).length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-[var(--faint)] font-mono animate-pulse">
                  载入多账户模型中...
                </div>
              ) : (
                Object.entries(groupedModels).map(([pName, mList]) => {
                  if (!mList || mList.length === 0) return null;
                  return (
                    <div key={pName} className="space-y-1">
                      <div className="flex items-center gap-1.5 px-2 py-0.5">
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--accent)] select-none">
                          {pName}
                        </span>
                        <div className="h-[1px] flex-1 bg-[var(--border)] opacity-60" />
                      </div>
                      <div className="space-y-0.5 pl-1">
                        {mList.map((m) => {
                          const sel = m === model && pName === provider;
                          return (
                            <button
                              key={m}
                              onClick={() => selectModel(pName, m)}
                              className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[10px] font-mono transition hover:bg-[var(--hover)] cursor-pointer select-none ${
                                sel ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold" : "text-[var(--muted)]"
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate" title={m}>
                                {m}
                              </span>
                              {sel && (
                                <svg width="8" height="8" viewBox="0 0 14 14" className="shrink-0 text-[var(--accent)]" aria-hidden>
                                  <path d="M2 7.5l3.2 3.2L12 4" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
