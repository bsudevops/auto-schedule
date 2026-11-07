/** A workspace's brand mark: its logo when one is set, otherwise its first letter on its colour. */
export function WorkspaceIcon({ name, color, logoUrl, className = "ws-ico" }: { name: string; color: string; logoUrl?: string | null; className?: string }) {
  if (logoUrl) {
    return (
      <span className={`${className} has-logo`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" />
      </span>
    );
  }
  return <span className={className} style={{ background: color }} aria-hidden="true">{name.trim()[0]?.toUpperCase()}</span>;
}
