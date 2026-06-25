"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ArrowUpRight } from "lucide-react";
import { Card, SectionTitle, EmptyState, Skeleton, Badge, Button } from "@/components/ui";

type AlertEvent = {
  id: string;
  ruleName: string;
  level: "info" | "warn";
  title: string;
  triggeredAt: string;
};

type State =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; events: AlertEvent[] };

const TOP_N = 5;

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso;
  }
}

/** 最近告警：盯盘最新命中事件（复用 /api/alerts/events）。 */
export default function RecentAlerts() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/alerts/events");
        if (!r.ok) throw new Error(String(r.status));
        const data: { events?: AlertEvent[] } = await r.json();
        const events = (data.events ?? []).slice(0, TOP_N);
        if (alive) setState(events.length === 0 ? { status: "empty" } : { status: "ready", events });
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
        title="最近告警"
        desc="盯盘命中的最新事件"
        action={
          <Link
            href="/alerts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[var(--text-sm)] text-[var(--accent)] hover:underline"
          >
            盯盘台 <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {state.status === "loading" && <Skeleton lines={4} className="mt-1" />}
      {state.status === "error" && (
        <EmptyState
          icon={<Bell className="h-6 w-6" />}
          title="读取失败"
          desc="告警箱暂不可用，稍后再试。"
          className="flex-1 border-none py-6"
        />
      )}
      {state.status === "empty" && (
        <EmptyState
          icon={<Bell className="h-6 w-6" />}
          title="暂无告警"
          desc="去盯盘台配置价格 / 套利规则，命中后会在这里汇总最新事件。"
          action={
            <Link href="/alerts" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm">
                <Bell className="h-3.5 w-3.5" /> 配置盯盘规则
              </Button>
            </Link>
          }
          className="flex-1 border-none py-6"
        />
      )}
      {state.status === "ready" && (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {state.events.map((e) => (
            <li key={e.id} className="flex items-start gap-2 py-2 first:pt-0">
              <Badge tone={e.level === "warn" ? "warn" : "info"}>{e.level === "warn" ? "警告" : "提示"}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[var(--text-sm)] text-[var(--text)]">{e.title}</p>
                <p className="truncate text-[var(--text-xs)] text-[var(--faint)]">
                  {e.ruleName} · {fmtTime(e.triggeredAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
