"use client";
import { useRef, useState, useTransition } from "react";
import { removeWorkspaceLogo, setWorkspaceLogo } from "@/app/actions/workspace";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";

const SIZE = 512;

/** Shrinks the picked image in the browser so the upload stays small; the server re-encodes it to the final size. */
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif" || file.size < 300 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, SIZE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.92));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function LogoField({ workspaceId, name, color, logoUrl, disabled }: { workspaceId: string; name: string; color: string; logoUrl: string | null; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>();
  const [preview, setPreview] = useState<string | null>(logoUrl);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMsg({ error: "Choose an image file (PNG, JPG or WebP)." }); return; }
    start(async () => {
      setMsg(undefined);
      const fd = new FormData();
      fd.append("logo", await shrink(file), "logo");
      const r = await setWorkspaceLogo(workspaceId, fd);
      if (r?.ok) setPreview(URL.createObjectURL(file));
      setMsg(r ?? undefined);
      if (input.current) input.current.value = "";
    });
  };

  const remove = () => start(async () => {
    setMsg(undefined);
    const r = await removeWorkspaceLogo(workspaceId);
    if (r?.ok) setPreview(null);
    setMsg(r ?? undefined);
  });

  return (
    <div className="field">
      <span>Brand logo</span>
      <div className="logo-field">
        <WorkspaceIcon name={name} color={color} logoUrl={preview} className="ws-logo-lg" />
        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" disabled={disabled || pending} onClick={() => input.current?.click()}>{pending ? "Saving…" : preview ? "Change logo" : "Upload logo"}</button>
            {preview && <button type="button" className="btn ghost sm" disabled={disabled || pending} onClick={remove}>Remove</button>}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>Square PNG, JPG or WebP, up to 2 MB. Shown beside the workspace name.</span>
          {msg?.error && <span className="err" role="alert">{msg.error}</span>}
          {msg?.ok && <span className="up" role="status">{msg.ok}</span>}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} disabled={disabled} />
      </div>
    </div>
  );
}
