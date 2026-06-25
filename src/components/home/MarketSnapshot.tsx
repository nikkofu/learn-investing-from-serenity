"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight } from "lucide-react";
import { Card, SectionTitle, KPIStat, EmptyState, Skeleton } from "@/components/ui";
import { toneOf, pctStr } from "./format";

type Sector = { code: string; name: string; changePct: number };

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rise: number; fall: number; flat: number; avg: number };

/** 市场快照：按行业板块聚合的涨跌家数与情绪（复用 /api/market/sectors）。 */
export default function MarketSnapshot() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/market/sectors");
        if (!r.ok) throw new Error(String(r.status));
        const data: { list?: Sector[] } = await r.json();
        const list = data.list ?? [];
        if (list.length === 0) throw new Error("empty");
        let rise = 0;
        let fall = 0;
        let flat = 0;
        let sum = 0;
        for (const s of list) {
          const p = Number(s.changePct) || 0;
          sum += p;
          if (p > 0) rise++;
          else if (p < 0) fall++;
          else flat++;
        }
        if (alive) setState({ status: "ready", rise, fall, flat, avg: sum / list.length });
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const total = state.status === "ready" ? state.rise + state.fall + state.flat : 0;
  const risePct = total > 0 && state.status === "ready" ? (state.rise / total) * 100 : 0;
  const fallPct = total > 0 && state.status === "ready" ? (state.fall / total) * 100 : 0;

  return (
    <Card className="flex h-full flex-col gap-3">
      <SectionTitle
        title="市场快照"
        desc="行业板块涨跌家数 / 情绪"
        action={
          <Link
            href="/sectors"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[var(--text-sm)] text-[var(--accent)] hover:underline"
          >
            板块热力 <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {state.status === "loading" && <Skeleton lines={3} className="mt-1" />}
      {state.status === "error" && (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="行情暂不可用"
          desc="板块行情源未就绪，稍后再试。"
          className="flex-1 border-none py-6"
        />
      )}
      {state.status === "ready" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <KPIStat label="上涨板块" value={state.rise} tone="up" />
            <KPIStat label="下跌板块" value={state.fall} tone="down" />
            <KPIStat label="平均涨跌" value={pctStr(state.avg)} tone={toneOf(state.avg)} />
          </div>
          <div className="mt-auto">
            <div className="flex h-2 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--hover)]">
              <span className="heat-up-3 block h-full" style={{ width: `${risePct}%` }} />
              <span className="heat-dn-3 block h-full" style={{ width: `${fallPct}%` }} />
            </div>
            <p className="mt-1.5 text-[var(--text-xs)] text-[var(--faint)]">
              共 {total} 个行业板块 · 上涨 {state.rise} / 下跌 {state.fall}
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
