"use client";
import { useEffect, useState } from "react";
import { importDriveAction } from "@/app/actions/composer";
import { Icon } from "@/components/Icon";
import type { DriveConfig } from "@/lib/drive";

type Media = { id: string; kind: "image" | "video"; filename: string; thumb: string; url: string };

/* Google's browser libraries have no bundled types; only the few calls used here are described. */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

// Only files the person picks are shared with the app. Nothing else in their Drive is visible to it.
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/avif", "video/mp4", "video/quicktime", "video/webm"].join(",");

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        reject(new Error("Couldn't load Google Drive. Check your connection, or turn off a blocker for google.com."));
      };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src)!;
}

async function loadGoogle() {
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  await new Promise<void>((resolve, reject) => window.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Couldn't load Google Drive.")) }));
}

// The access token lasts about an hour; it stays in this tab's memory only.
let cached: { token: string; expires: number } | null = null;

function getToken(clientId: string): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return Promise.resolve(cached.token);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!r.access_token) return reject(new Error(r.error === "access_denied" ? "Google Drive access wasn't allowed." : "Google sign-in didn't finish. Try again."));
        cached = { token: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e: { type?: string }) => reject(new Error(e.type === "popup_closed" ? "The Google sign-in window was closed." : "Google sign-in was blocked. Allow pop-ups for this site and try again.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

function openPicker(cfg: DriveConfig, token: string, max: number): Promise<string[]> {
  const p = window.google.picker;
  return new Promise((resolve) => {
    const mine = new p.DocsView(p.ViewId.DOCS).setMimeTypes(MIME_TYPES).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(p.DocsViewMode.GRID);
    const shared = new p.DocsView(p.ViewId.DOCS).setMimeTypes(MIME_TYPES).setEnableDrives(true).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(p.DocsViewMode.GRID);
    const builder = new p.PickerBuilder()
      .addView(mine)
      .addView(shared)
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setOrigin(window.location.origin)
      .setTitle("Choose photos or videos")
      .enableFeature(p.Feature.SUPPORT_DRIVES)
      .setCallback((data: any) => {
        if (data[p.Response.ACTION] === p.Action.PICKED) resolve((data[p.Response.DOCUMENTS] as any[]).map((d) => d[p.Document.ID] as string));
        else if (data[p.Response.ACTION] === p.Action.CANCEL) resolve([]);
      });
    if (max > 1) builder.enableFeature(p.Feature.MULTISELECT_ENABLED).setMaxItems(max);
    builder.build().setVisible(true);
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Picks photos and videos in Google Drive and copies them in for this post. */
export function DrivePicker({ workspaceId, config, max, onAdded }: { workspaceId: string; config: DriveConfig; max: number; onAdded: (m: Media[]) => void }) {
  const [status, setStatus] = useState<"idle" | "picking" | "copying">("idle");
  const [count, setCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  // Load Google's scripts as soon as the tab shows, so the sign-in pop-up opens straight from the click and isn't blocked.
  useEffect(() => void loadGoogle().catch(() => undefined), []);

  async function choose() {
    setErrors([]);
    setStatus("picking");
    try {
      await loadGoogle();
      const token = await getToken(config.clientId);
      const ids = await openPicker(config, token, max);
      if (!ids.length) return setStatus("idle");
      setCount(ids.length);
      setStatus("copying");
      const r = await importDriveAction(workspaceId, ids, token);
      if ("error" in r && r.error) {
        if (r.error.includes("sign-in expired")) cached = null;
        setErrors([r.error]);
      } else setErrors(r.errors);
      if (r.media.length) onAdded(r.media);
    } catch (e) {
      setErrors([(e as Error).message || "Google Drive didn't open. Try again."]);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="stack" style={{ gap: 12, alignItems: "flex-start" }}>
      <p className="muted" style={{ margin: 0 }}>Pick photos and videos straight from your Google Drive, including shared drives. We keep a copy so the platforms can post it.</p>
      <button type="button" className="btn primary" disabled={status !== "idle" || max < 1} onClick={choose}>
        <Icon name="folder" /> {status === "picking" ? "Opening Google Drive…" : status === "copying" ? `Copying ${count} file${count === 1 ? "" : "s"} from Drive…` : "Choose from Google Drive"}
      </button>
      {max < 1 && <small className="muted">This post already has 10 files, the most it can hold.</small>}
      {status === "copying" && <small className="muted">Large videos can take a minute.</small>}
      {errors.map((m) => <p key={m} className="err" role="alert">{m}</p>)}
    </div>
  );
}
