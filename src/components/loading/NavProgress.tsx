"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A thin bar along the top of the window that starts the moment someone clicks a link inside the app
 * and finishes when the new page arrives, so a click always gets an answer straight away.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new URL means the page arrived.
  useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
  }, [pathname, search]);

  useEffect(() => {
    if (state !== "done") return;
    timer.current = setTimeout(() => setState("idle"), 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      // Same page (or only the #hash changes): nothing will load.
      if (url.pathname === location.pathname && url.search === location.search) return;
      setState("loading");
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      // GET forms (like search) navigate; server-action forms show their own pending state.
      if (!e.defaultPrevented && (form.method || "get").toLowerCase() === "get" && !form.getAttribute("action")?.startsWith("javascript:")) setState("loading");
    };
    const onPop = () => setState("loading");
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return <div className={`nav-progress ${state}`} aria-hidden="true" />;
}
