"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { markNotificationsReadAction } from "@/app/actions/notifications";
import { Icon } from "@/components/Icon";

export type BellItem = { id: string; title: string; body: string | null; href: string | null; at: string; read: boolean };

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export function NotificationBell({ items, unread, settingsHref }: { items: BellItem[]; unread: number; settingsHref: string }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const markAll = () => start(async () => { await markNotificationsReadAction(); router.refresh(); });

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button className="icon-btn" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
        {unread > 0 && <span className="dot-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="menu notif-menu" role="dialog" aria-label="Notifications">
          <div className="row" style={{ justifyContent: "space-between", padding: "6px 8px" }}>
            <b>Notifications</b>
            <span className="row" style={{ gap: 4 }}>
              {unread > 0 && <button className="btn sm ghost" onClick={markAll}>Mark all read</button>}
              <Link className="btn sm ghost" href={settingsHref} onClick={() => setOpen(false)} aria-label="Notification settings"><Icon name="gear" /></Link>
            </span>
          </div>
          <hr />
          {items.length === 0 && <p className="muted" style={{ padding: "12px 8px", fontSize: 13 }}>Nothing yet. Failed posts, channels that need attention and conversations assigned to you show up here.</p>}
          {items.map((n) => (
            <Link
              key={n.id}
              href={n.href ?? "#"}
              className="mi"
              style={{ color: "inherit", textDecoration: "none", alignItems: "flex-start" }}
              onClick={() => {
                setOpen(false);
                if (!n.read) start(async () => { await markNotificationsReadAction([n.id]); router.refresh(); });
              }}
            >
              <span className={n.read ? "" : "unread"} style={n.read ? { width: 8, flex: "none" } : undefined} />
              <span style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13, fontWeight: n.read ? 500 : 600 }}>{n.title}</b>
                {n.body && <span className="muted" style={{ display: "block", fontSize: 12, whiteSpace: "pre-line", overflow: "hidden", maxHeight: "3.2em" }}>{n.body}</span>}
                <span className="muted" style={{ fontSize: 11 }}>{ago(n.at)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
