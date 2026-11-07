import type { Metadata } from "next";
// Fonts are bundled with the app (no requests to Google at runtime or build time).
import "@fontsource-variable/outfit";
import "@fontsource-variable/figtree";
import "@fontsource/jetbrains-mono/500.css";
import { Suspense } from "react";
import { NavProgress } from "@/components/loading/NavProgress";
import { BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: "Plan, schedule and publish social media for every brand you manage.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
