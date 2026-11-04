import { TIMEZONES } from "@/lib/validation";

export const WS_COLORS = ["#2B86F5", "#0F9D6B", "#6C5BD8", "#E07A2E", "#D6336C", "#0EA5D8"];

export function WorkspaceFields({ name = "", timezone = "UTC", color = WS_COLORS[0]!, disabled }: { name?: string; timezone?: string; color?: string; disabled?: boolean }) {
  return (
    <>
      <label className="field"><span>Workspace name</span><input className="input" name="name" id="ws-name" defaultValue={name} required maxLength={80} placeholder="e.g. Your brand or client name" disabled={disabled} /></label>
      <label className="field"><span>Time zone</span>
        <select className="input" name="timezone" id="ws-tz" defaultValue={timezone} disabled={disabled}>
          {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
        </select>
      </label>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} disabled={disabled}>
        <span>Colour</span>
        <div className="swatches">
          {WS_COLORS.map((c) => (
            <label key={c} style={{ cursor: "pointer" }}>
              <input type="radio" name="color" value={c} defaultChecked={c.toLowerCase() === color.toLowerCase()} className="sr-only peer" />
              <span className="sw block peer-checked:ring-2 peer-checked:ring-[var(--ink)]" style={{ background: c }} aria-label={c} />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
