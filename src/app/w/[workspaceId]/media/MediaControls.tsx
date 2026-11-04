"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createFolder, deleteMedia, updateAltText } from "@/app/actions/media";
import { Icon } from "@/components/Icon";

export async function uploadFiles(workspaceId: string, files: FileList | File[], folderId?: string) {
  const errors: string[] = [];
  const ids: string[] = [];
  for (const file of Array.from(files)) {
    const body = new FormData();
    body.set("file", file);
    if (folderId) body.set("folderId", folderId);
    const res = await fetch(`/api/w/${workspaceId}/media`, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (res.ok && json.id) ids.push(json.id);
    else errors.push(`${file.name}: ${json.error ?? "upload failed"}`);
  }
  return { ids, errors };
}

export function UploadButton({ workspaceId, folderId }: { workspaceId: string; folderId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <div className="stack" style={{ alignItems: "flex-end", gap: 6 }}>
      <label className="btn primary" style={{ cursor: "pointer" }}>
        <Icon name="upload" /> {busy ? "Uploading…" : "Upload"}
        <input type="file" id="media-upload" accept="image/*,video/mp4,video/quicktime,video/webm" multiple hidden disabled={busy}
          onChange={async (e) => {
            if (!e.target.files?.length) return;
            setBusy(true);
            const r = await uploadFiles(workspaceId, e.target.files, folderId);
            setErrors(r.errors);
            setBusy(false);
            e.target.value = "";
            router.refresh();
          }} />
      </label>
      {errors.map((m) => <p key={m} className="err" role="alert">{m}</p>)}
    </div>
  );
}

export function NewFolder({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  if (!open) return <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}><Icon name="plus" /> New folder</button>;
  return (
    <form className="row" style={{ marginTop: 8, gap: 6 }} onSubmit={(e) => { e.preventDefault(); start(async () => { await createFolder(workspaceId, ref.current?.value ?? ""); setOpen(false); }); }}>
      <input ref={ref} className="input" id="folder-name" placeholder="Folder name" autoFocus maxLength={60} style={{ padding: "6px 9px" }} />
      <button className="btn sm" disabled={pending}>Add</button>
    </form>
  );
}

type Asset = { id: string; filename: string; kind: string; altText: string; size: string; dims: string; url: string };

export function AssetPanel({ workspaceId, asset, variants, canEdit, canDelete }: { workspaceId: string; asset: Asset; variants: string[]; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const alt = useRef<HTMLTextAreaElement>(null);
  return (
    <aside className="card" key={asset.id}>
      <div style={{ aspectRatio: "1.3", background: "var(--sky-50)", borderRadius: "14px 14px 0 0", overflow: "hidden" }}>
        {asset.kind === "image"
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={asset.url} alt={asset.altText} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          : <video src={asset.url} controls style={{ width: "100%", height: "100%" }} />}
      </div>
      <div className="card-b stack">
        <div><b style={{ wordBreak: "break-all" }}>{asset.filename}</b><div className="muted" style={{ fontSize: 12 }}>{asset.kind === "image" ? "Image" : "Video"} · {asset.size}{asset.dims && ` · ${asset.dims}`}</div></div>
        {asset.kind === "image" && (
          <label className="field"><span>Alt text</span>
            <textarea ref={alt} className="input" id="alt-text" defaultValue={asset.altText} maxLength={1000} disabled={!canEdit} placeholder="Describe the image for people using screen readers" style={{ minHeight: 70 }} />
          </label>
        )}
        {variants.length > 0 && (
          <div><div className="label" style={{ marginBottom: 6 }}>Channel sizes</div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{variants.map((v) => <span key={v} className="chip mono" style={{ fontSize: 11 }}>{v}</span>)}</div></div>
        )}
        {msg && <p className="up" role="status">{msg}</p>}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <a className="btn sm primary" href={`/w/${workspaceId}/compose?media=${asset.id}`}>Use in post</a>
          {canEdit && asset.kind === "image" && <button className="btn sm" disabled={pending} onClick={() => start(async () => { const r = await updateAltText(workspaceId, asset.id, alt.current?.value ?? ""); setMsg(r.ok); })}>Save</button>}
          {canDelete && (confirming
            ? <><button className="btn sm danger" style={{ marginLeft: "auto" }} disabled={pending} onClick={() => start(async () => { await deleteMedia(workspaceId, asset.id); router.replace(`/w/${workspaceId}/media`); })}>Delete for good</button><button className="btn sm ghost" onClick={() => setConfirming(false)}>Cancel</button></>
            : <button className="btn sm ghost danger" style={{ marginLeft: "auto" }} onClick={() => setConfirming(true)} aria-label="Delete file"><Icon name="trash" /></button>)}
        </div>
      </div>
    </aside>
  );
}
