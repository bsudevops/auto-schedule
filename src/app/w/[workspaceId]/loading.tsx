import { FloatingLoader } from "@/components/loading/FloatingLoader";

// Shown inside the workspace frame (sidebar and top bar stay put) while a page fetches its data.
export default function Loading() {
  return <FloatingLoader />;
}
