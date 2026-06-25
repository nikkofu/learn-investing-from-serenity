"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, ArrowUpRight } from "lucide-react";
import { Card, SectionTitle, EmptyState, Skeleton } from "@/components/ui";
import { heatClass, pctStr } from "./format";

type Sector = { code: string; name: string; changePct: number };

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; top: Sector[]; bottom: Sector[] };

const N = 5;

/** 板块热力 mini：领涨 / 领跌行业板块色块（复用 /api/market/sectors）。 */
export default function SectorMini() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/market/sectors");
        if (!r.ok) throw new Error(String(r.status));
        const data: { list?: Sector[] } = await r.json();
        const list = (data.list ?? []).filter((s) => Number.isFinite(s.changePct));
        if (list.length === 0) throw new Error("empty");
        const sorted = [...list].sort((a, b) => b.changePct - a.changePct);
        if (alive)
          setState({
            status: "ready",
            top: sorted.slice(0, N),
            bottom: sorted.slice(-N).reverse(),
          });
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card className="flex h-full flex-col gap-3">
      <SectionTitle
        title="板块热力"
        desc="领涨 / 领跌行业板块"
        action={
          <Link
            href="/sectors"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[var(--text-sm)] text-[var(--accent)] hover:underline"
          >
            全部 <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {state.status === "loading" && <Skeleton lines={4} className="mt-1" />}
      {state.status === "error" && (
        <EmptyState
          icon={<LayoutGrid className="h-6 w-6" />}
          title="板块行情暂不可用"
          desc="数据源未就绪，稍后再试。"
          className="flex-1 border-none py-6"
        />
      )}
      {state.status === "ready" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SectorColumn title="领涨" rows={state.top} />
          <SectorColumn title="领跌" rows={state.bottom} />
        </div>
      )}
    </Card>
  );
}

function SectorColumn({ title, rows }: { title: string; rows: Sector[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[var(--text-xs)] text-[var(--faint)]">{title}</p>
      {rows.map((s) => (
        <Link
          key={s.code}
          href="/sectors"
          target="_blank"
          rel="noopener noreferrer"
          className={`${heatClass(s.changePct)} flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-2 py-1`}
        >
          <span className="truncate text-[var(--text-sm)]">{s.name}</span>
          <span className="tnum shrink-0 text-[var(--text-sm)]">{pctStr(s.changePct)}</span>
        </Link>
      ))}
    </div>
  );
}
