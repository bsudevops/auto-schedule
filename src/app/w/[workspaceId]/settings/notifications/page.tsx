import { EmptyState } from "@/components/ui";

export const metadata = { title: "Notifications" };

export default function Page() {
  return <div className="card"><EmptyState title="Arrives in milestone 5" body="Choose in-app, email and webhook alerts for each kind of event." /></div>;
}
