import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { cancelConnectAction, finishConnectAction } from "@/app/actions/channels";
import { PlatformBadge } from "@/components/ui";
import { accountKey, loadPending } from "@/lib/channels";
import { PLATFORMS } from "@/lib/platforms";
import { PROVIDERS } from "@/lib/publishing";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Choose accounts" };

/** After OAuth: the user picks which of the returned accounts to add to this workspace. Tokens never reach the browser. */
export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ pending?: string }> }) {
  const { workspaceId } = await params;
  const { pending: pendingId = "" } = await searchParams;
  const { user, workspace } = await requireWorkspace(workspaceId, "manage_channels");
  const pending = await loadPending(pendingId, workspaceId, user.id);
  if (!pending) notFound();
  const existing = await db.select({ platform: channels.platform, externalId: channels.externalId, status: channels.status }).from(channels).where(and(eq(channels.workspaceId, workspaceId)));
  const already = new Map(existing.map((c) => [accountKey(c), c.status]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Choose accounts</h1>
          <p>{PROVIDERS[pending.provider].name} returned {pending.accounts.length} account{pending.accounts.length === 1 ? "" : "s"}. Pick the ones to add to {workspace.name}.</p>
        </div>
      </div>
      <form action={finishConnectAction.bind(null, workspaceId, pending.id)} className="card card-b stack">
        {pending.accounts.map((a) => {
          const key = accountKey(a);
          const state = already.get(key);
          return (
            <label key={key} className="row" style={{ gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line)", cursor: "pointer" }}>
              <input type="checkbox" name="account" value={key} defaultChecked={!state || state !== "connected"} />
              <PlatformBadge platform={a.platform} large />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{a.displayName}</b>
                <span className="muted" style={{ display: "block", fontSize: 12.5 }}>
                  {PLATFORMS[a.platform].name}
                  {a.platform !== "facebook" ? ` · @${a.handle}` : ""}
                  {a.followers != null ? ` · ${a.followers.toLocaleString("en-US")} followers` : ""}
                  {state ? (state === "connected" ? " · Already connected (renews the connection)" : " · Reconnects this channel") : ""}
                </span>
              </span>
            </label>
          );
        })}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, paddingTop: 8 }}>
          <button className="btn" formAction={cancelConnectAction.bind(null, workspaceId, pending.id)}>Cancel</button>
          <button className="btn primary" type="submit">Add selected</button>
        </div>
      </form>
    </>
  );
}
