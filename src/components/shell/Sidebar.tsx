"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/Icon";
import { Avatar } from "@/components/ui";

type Ws = { id: string; name: string; color: string; orgName: string };

const MAIN: Array<[string, IconName, string]> = [
  ["", "home", "Overview"],
  ["/compose", "pen", "Create post"],
  ["/calendar", "cal", "Calendar"],
  ["/ideas", "bulb", "Ideas"],
  ["/inbox", "inbox", "Inbox"],
  ["/analytics", "chart", "Analytics"],
  ["/media", "img", "Media library"],
];
const WORKSPACE: Array<[string, IconName, string]> = [
  ["/channels", "link", "Channels"],
  ["/settings", "gear", "Settings"],
];

export function Sidebar(props: { brand: string; tagline: string; current: Ws; workspaces: Ws[]; user: { name: string }; roleLabel: string; unread: number }) {
  const { brand, tagline, current, workspaces, user, roleLabel, unread } = props;
  const path = usePathname();
  const base = `/w/${current.id}`;
  const [open, setOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpen(false);
    setWsOpen(false);
    setUserOpen(false);
  }, [path]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".ws-switch")) setWsOpen(false);
      if (!(e.target as HTMLElement).closest(".rail-foot")) setUserOpen(false);
    };
    const onToggle = () => setOpen((o) => !o);
    document.addEventListener("click", onDoc);
    window.addEventListener("toggle-rail", onToggle);
    return () => {
      document.removeEventListener("click", onDoc);
      window.removeEventListener("toggle-rail", onToggle);
    };
  }, []);

  const link = ([href, icon, label]: [string, IconName, string]) => {
    const full = base + href;
    const on = href === "" ? path === base : path.startsWith(full);
    const count = href === "/inbox" ? unread : 0;
    return (
      <Link key={href} href={full} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
        <Icon name={icon} />
        <span>{label}</span>
        {count > 0 && <span className="count">{count}</span>}
      </Link>
    );
  };

  return (
    <aside className={`rail${open ? " open" : ""}`} ref={ref}>
      <div className="brand">
        <div className="logo">{brand[0]}</div>
        <div>
          <div className="brand-name">{brand}</div>
          <div className="brand-sub">{tagline}</div>
        </div>
      </div>
      <div className="ws-switch">
        <button className="ws-btn" aria-haspopup="true" aria-expanded={wsOpen} onClick={() => setWsOpen((o) => !o)}>
          <span className="ws-ico" style={{ background: current.color }}>{current.name[0]}</span>
          <span className="ws-meta"><b>{current.name}</b><span>{current.orgName}</span></span>
          <Icon name="chev" size={16} />
        </button>
        {wsOpen && (
          <div className="menu">
            <div className="label" style={{ padding: "6px 8px" }}>Your workspaces</div>
            {workspaces.map((w) => (
              <Link key={w.id} className="mi" href={`/w/${w.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <span className="ws-ico" style={{ background: w.color }}>{w.name[0]}</span>
                <span style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{w.name}</b><br /><span className="muted" style={{ fontSize: 11 }}>{w.orgName}</span></span>
                {w.id === current.id && <Icon name="check" size={16} />}
              </Link>
            ))}
            <hr />
            <Link className="mi" href={`${base}/settings/organization`} style={{ textDecoration: "none", color: "inherit" }}>
              <Icon name="plus" size={16} /> New workspace
            </Link>
          </div>
        )}
      </div>
      <nav className="nav" aria-label="Main">
        {MAIN.map(link)}
        <div className="grp label">Workspace</div>
        {WORKSPACE.map(link)}
      </nav>
      <div className="rail-foot">
        <Avatar name={user.name} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 13, display: "block" }}>{user.name}</b>
          <span className="muted" style={{ fontSize: 11.5 }}>{roleLabel} · {current.orgName}</span>
        </div>
        <button className="icon-btn" aria-label="Account menu" style={{ width: 30, height: 30, border: 0 }} onClick={() => setUserOpen((o) => !o)}>
          <Icon name="chev" />
        </button>
        {userOpen && (
          <div className="menu" style={{ top: "auto", bottom: "calc(100% + 4px)", left: 10, right: 10 }}>
            <Link className="mi" href={`${base}/settings/notifications`} style={{ textDecoration: "none", color: "inherit" }}>
              <Icon name="bell" size={16} /> Notification preferences
            </Link>
            <hr />
            <form action={signOut}>
              <button className="mi" type="submit"><Icon name="logout" size={16} /> Sign out</button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}

export function MenuButton() {
  return (
    <button className="icon-btn burger" aria-label="Open menu" onClick={() => window.dispatchEvent(new Event("toggle-rail"))}>
      <Icon name="menu" />
    </button>
  );
}
