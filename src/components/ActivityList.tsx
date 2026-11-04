import Link from "next/link";
import { BRAND } from "@/lib/brand";

type Entry = { id: string; summary: string; href: string | null; at: Date; actor: string | null; actorImage: string | null };

function ago(d: Date, now: Date, timeZone: string) {
  const mins = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

/** One line per change: who did it, what, and when. Entries without a person came from the publisher. */
export function ActivityList({ entries, timeZone }: { entries: Entry[]; timeZone: string }) {
  const now = new Date();
  return (
    <ul className="activity">
      {entries.map((e) => {
        const who = e.actor ?? BRAND.name;
        return (
          <li key={e.id}>
            <span className="who" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {e.actorImage ? <img src={e.actorImage} alt="" width={28} height={28} /> : who.slice(0, 1).toUpperCase()}
            </span>
            <div className="what">
              <b>{e.actor ?? "Publishing"}</b>{" "}
              {e.href ? <Link href={e.href}>{e.summary}</Link> : e.summary}
              <time dateTime={e.at.toISOString()}>{ago(e.at, now, timeZone)}</time>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
