import { EmptyState } from "./ui";

export function ComingSoon({ title, milestone, what }: { title: string; milestone: number; what: string }) {
  return (
    <>
      <div className="page-head"><div><h1>{title}</h1></div></div>
      <div className="card">
        <EmptyState title={`Arrives in milestone ${milestone}`} body={what} />
      </div>
    </>
  );
}
