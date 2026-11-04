"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes server data on an interval while something is in progress. */
export function AutoRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), every);
    return () => clearInterval(id);
  }, [router, every]);
  return null;
}
