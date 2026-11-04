"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [["workspace", "Workspace"], ["members", "Members & roles"], ["notifications", "Notifications"], ["developer", "API & webhooks"], ["organization", "Organization"]];

export function SettingsTabs({ base }: { base: string }) {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Settings">
      {TABS.map(([slug, label]) => (
        <Link key={slug} href={`${base}/${slug}`} className={path.startsWith(`${base}/${slug}`) ? "on" : ""}>{label}</Link>
      ))}
    </nav>
  );
}
