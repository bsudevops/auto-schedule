import Link from "next/link";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui";
import { db } from "@/db";
import { mediaAssets, mediaFolders, mediaVariants } from "@/db/schema";
import { publicUrl } from "@/lib/media/storage";
import { thumbKey } from "@/lib/media/service";
import { can } from "@/lib/permissions";
import { requireWorkspace } from "@/lib/session";
import { AssetPanel, NewFolder, UploadButton } from "./MediaControls";

export const metadata = { title: "Media library" };

const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ folder?: string; asset?: string }> }) {
  const { workspaceId } = await params;
  const { folder, asset: assetParam } = await searchParams;
  const { member, workspace } = await requireWorkspace(workspaceId);
  const base = `/w/${workspaceId}/media`;

  const folders = await db.select({ id: mediaFolders.id, name: mediaFolders.name, n: count(mediaAssets.id) })
    .from(mediaFolders).leftJoin(mediaAssets, eq(mediaAssets.folderId, mediaFolders.id))
    .where(eq(mediaFolders.workspaceId, workspaceId)).groupBy(mediaFolders.id).orderBy(asc(mediaFolders.name));
  const activeFolder = folders.find((f) => f.id === folder);
  const where: SQL[] = [eq(mediaAssets.workspaceId, workspaceId)];
  if (activeFolder) where.push(eq(mediaAssets.folderId, activeFolder.id));
  const [assets, [total]] = await Promise.all([
    db.select().from(mediaAssets).where(and(...where)).orderBy(desc(mediaAssets.createdAt)).limit(200),
    db.select({ n: count() }).from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId)),
  ]);
  const selected = assets.find((a) => a.id === assetParam) ?? assets[0];
  const variants = selected ? await db.select().from(mediaVariants).where(eq(mediaVariants.assetId, selected.id)) : [];
  const qs = (o: { folder?: string; asset?: string }) => {
    const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]);
    return p.size ? `${base}?${p}` : base;
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Media library</h1><p>Photos and videos for {workspace.name}. Images get a version sized for each channel automatically.</p></div>
        {can(member, "upload_media") && <UploadButton workspaceId={workspaceId} folderId={activeFolder?.id} />}
      </div>
      <div className="grid media-layout" style={{ alignItems: "start" }}>
        <nav className="card card-b tree" aria-label="Folders">
          <div className="label" style={{ margin: "0 0 8px 10px" }}>Folders</div>
          <Link className={!activeFolder ? "on" : ""} href={qs({})}><Icon name="grid" size={16} /> All media<span className="c">{total?.n ?? 0}</span></Link>
          {folders.map((f) => (
            <Link key={f.id} className={activeFolder?.id === f.id ? "on" : ""} href={qs({ folder: f.id })}><Icon name="folder" size={16} /> {f.name}<span className="c">{f.n}</span></Link>
          ))}
          {can(member, "upload_media") && <NewFolder workspaceId={workspaceId} />}
        </nav>
        {assets.length ? (
          <div className="media-grid">
            {assets.map((a) => (
              <Link key={a.id} href={qs({ folder: activeFolder?.id, asset: a.id })} className={`asset${selected?.id === a.id ? " on" : ""}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="img">
                  {a.kind === "image"
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={publicUrl(thumbKey(a.storageKey, a.kind))} alt={a.altText} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
                    : <video src={publicUrl(a.storageKey)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  <span className="kind">{a.kind === "image" ? "Image" : "Video"}</span>
                </div>
                <div className="meta"><b>{a.filename}</b><span>{fmtSize(a.sizeBytes)}{a.width ? ` · ${a.width}×${a.height}` : ""}</span></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card"><EmptyState title={activeFolder ? "This folder is empty" : "No media yet"} body="Upload photos and videos to use them in posts. JPEG, PNG, WebP, GIF, MP4, MOV and WebM are supported." /></div>
        )}
        {selected && (
          <AssetPanel
            workspaceId={workspaceId}
            asset={{ id: selected.id, filename: selected.filename, kind: selected.kind, altText: selected.altText, size: fmtSize(selected.sizeBytes), dims: selected.width ? `${selected.width}×${selected.height}` : "", url: publicUrl(selected.storageKey) }}
            variants={variants.map((v) => `${v.preset} ${v.width}×${v.height}`)}
            canEdit={can(member, "upload_media")}
            canDelete={can(member, "delete_media")}
          />
        )}
      </div>
    </>
  );
}
