"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, ArrowUpRight } from "lucide-react";
import { Card, SectionTitle, EmptyState, Skeleton } from "@/components/ui";
import StockLink from "@/components/StockLink";
import { pctStr, changeColor } from "./format";

type HotItem = { rank: number; code: string; name: string; changePct: number };

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: HotItem[] };

const TOP_N = 10;

/** 今日热门：东财人气榜 Top N + 一键 图 / 分析（复用 /api/market/hot-rank）。 */
export default function HotList() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/market/hot-rank");
        if (!r.ok) throw new Error(String(r.status));
        const data: { list?: HotItem[] } = await r.json();
        const items = (data.list ?? []).slice(0, TOP_N);
        if (items.length === 0) throw new Error("empty");
        if (alive) setState({ status: "ready", items });
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const codes = state.status === "ready" ? state.items.map((it) => it.code).join(",") : "";

  return (
    <Card className="flex h-full flex-col gap-3">
      <SectionTitle
        title="今日热门"
        desc="东财人气榜 Top 10"
        action={
          state.status === "ready" ? (
            <Link
              href={`/scanner?codes=${codes}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[var(--text-sm)] text-[var(--accent)] hover:underline"
            >
              扫描全部 <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : undefined
        }
      />
      {state.status === "loading" && <Skeleton lines={5} className="mt-1" />}
      {state.status === "error" && (
        <EmptyState
          icon={<Flame className="h-6 w-6" />}
          title="人气榜暂不可用"
          desc="榜单数据源未就绪，稍后再试。"
          className="flex-1 border-none py-6"
        />
      )}
      {state.status === "ready" && (
        <ol className="flex flex-col gap-1">
          {state.items.map((it) => (
            <li key={it.code} className="flex items-center gap-2 text-[var(--text-sm)]">
              <span className="tnum w-5 shrink-0 text-right text-[var(--faint)]">{it.rank}</span>
              <span className="min-w-0 flex-1 truncate">
                <StockLink code={it.code} name={it.name} newTab />
              </span>
              <span className="tnum shrink-0" style={{ color: changeColor(it.changePct) }}>
                {pctStr(it.changePct)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
