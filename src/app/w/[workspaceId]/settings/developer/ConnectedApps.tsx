"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { disconnectAppAction } from "@/app/actions/developer";

type App = { id: string; app: string; by: string; allWorkspaces: boolean; scopes: string[]; createdAt: string; lastUsedAt: string | null };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");

/** Apps such as Claude that someone connected to this workspace by signing in. */
export function ConnectedApps({ workspaceId, apps }: { workspaceId: string; apps: App[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!apps.length) return null;
  return (
    <section className="card">
      <div className="card-h"><h2>Connected AI apps</h2></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>App</th><th>Permissions</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td><b style={{ fontSize: 13.5 }}>{a.app}</b><div className="muted" style={{ fontSize: 11.5 }}>Connected by {a.by}, {when(a.createdAt)}{a.allWorkspaces ? " · all their workspaces" : ""}</div></td>
                <td style={{ fontSize: 12.5 }}>{a.scopes.join(", ")}</td>
                <td style={{ fontSize: 12.5 }}>{when(a.lastUsedAt)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn sm ghost danger" disabled={pending} onClick={() => confirm(a.allWorkspaces ? `Disconnect “${a.app}”? It stops working straight away in every workspace it can use.` : `Disconnect “${a.app}”? It stops working straight away.`) && start(async () => { await disconnectAppAction(workspaceId, a.id); router.refresh(); })}>Disconnect</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
