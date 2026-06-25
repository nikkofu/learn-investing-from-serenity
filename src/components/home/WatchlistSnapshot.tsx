"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, ArrowUpRight, ScanSearch } from "lucide-react";
import { Card, SectionTitle, KPIStat, EmptyState, Skeleton, Button } from "@/components/ui";
import StockLink from "@/components/StockLink";
import { pctStr, changeColor } from "./format";

type Favorite = { code: string; name: string };
type Quote = { code: string; name: string; changePct: number };

type State =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; quotes: Quote[] };

/** 我的自选快照：收藏数 + 今日涨跌分布 + Top 异动（favorites + 批量行情）。 */
export default function WatchlistSnapshot() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/watchlist/favorites");
        if (!r.ok) throw new Error(String(r.status));
        const data: { favorites?: Favorite[] } = await r.json();
        const favs = (data.favorites ?? []).filter((f) => /^\d{6}$/.test(f.code));
        if (favs.length === 0) {
          if (alive) setState({ status: "empty" });
          return;
        }
        const codes = favs.map((f) => f.code).join(",");
        const q = await fetch(`/api/market/batch?codes=${codes}`);
        const qd: { list?: Quote[] } = q.ok ? await q.json() : { list: [] };
        const quotes = (qd.list ?? []).length > 0 ? qd.list! : favs.map((f) => ({ code: f.code, name: f.name, changePct: 0 }));
        if (alive) setState({ status: "ready", quotes });
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const up = state.status === "ready" ? state.quotes.filter((q) => q.changePct > 0).length : 0;
  const down = state.status === "ready" ? state.quotes.filter((q) => q.changePct < 0).length : 0;
  const total = state.status === "ready" ? state.quotes.length : 0;
  const flat = total - up - down;
  const movers =
    state.status === "ready"
      ? [...state.quotes].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 3)
      : [];

  return (
    <Card className="flex h-full flex-col gap-3">
      <SectionTitle
        title="我的自选"
        desc="收藏个股今日表现"
        action={
          <Link
            href="/watchlist"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[var(--text-sm)] text-[var(--accent)] hover:underline"
          >
            全部 <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {state.status === "loading" && <Skeleton lines={3} className="mt-1" />}
      {state.status === "error" && (
        <EmptyState
          icon={<Star className="h-6 w-6" />}
          title="读取失败"
          desc="自选数据暂不可用，稍后再试。"
          className="flex-1 border-none py-6"
        />
      )}
      {state.status === "empty" && (
        <EmptyState
          icon={<Star className="h-6 w-6" />}
          title="还没有收藏"
          desc="去热门股扫描挑几只加入自选，这里会显示它们的今日表现。"
          action={
            <Link href="/scanner" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm">
                <ScanSearch className="h-3.5 w-3.5" /> 去扫描添加
              </Button>
            </Link>
          }
          className="flex-1 border-none py-6"
        />
      )}
      {state.status === "ready" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <KPIStat label="收藏" value={total} hint="只" />
            <KPIStat label="上涨" value={up} tone="up" />
            <KPIStat label="下跌" value={down} tone="down" />
          </div>
          <div className="flex h-2 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--hover)]">
            {up > 0 && <span className="heat-up-3 block h-full" style={{ width: `${(up / total) * 100}%` }} />}
            {flat > 0 && <span className="block h-full bg-[var(--border)]" style={{ width: `${(flat / total) * 100}%` }} />}
            {down > 0 && <span className="heat-dn-3 block h-full" style={{ width: `${(down / total) * 100}%` }} />}
          </div>
          <div className="mt-auto space-y-1.5">
            <p className="text-[var(--text-xs)] text-[var(--faint)]">今日异动</p>
            {movers.map((m) => (
              <div key={m.code} className="flex items-center justify-between gap-2 text-[var(--text-sm)]">
                <StockLink code={m.code} name={m.name} newTab className="truncate" />
                <span className="tnum shrink-0" style={{ color: changeColor(m.changePct) }}>
                  {pctStr(m.changePct)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
