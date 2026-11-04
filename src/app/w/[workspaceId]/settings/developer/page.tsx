import { EmptyState } from "@/components/ui";

export const metadata = { title: "API & webhooks" };

export default function Page() {
  return <div className="card"><EmptyState title="Arrives in milestone 5" body="API keys (stored only as hashes) and webhook endpoints." /></div>;
}
