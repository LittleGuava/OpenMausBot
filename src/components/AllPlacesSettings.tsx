// Settings → Servers, Advanced mode only: All places' switch, how the other places are checked and whether to be told
// about one that is not on screen. This desktop's own choices (desktop-prefs.json): no server is told about them. Off,
// or back in Simple mode, the app is as it was: no entry on the rail and no request to another place.
import type { AllPlacesCheck, AllPlacesSettings as Settings } from "../../electron/all-places.mjs";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { SettingRow, SettingsRows, Switch } from "./SettingsPrimitives";

const INTERVALS = [["15", "allPlaces.check.15"], ["30", "allPlaces.check.30"], ["60", "allPlaces.check.60"], ["120", "allPlaces.check.120"]] as const;

function Choice({ value, checked, onChoose, children }: { value: string; checked: boolean; onChoose: () => void; children: React.ReactNode }) {
  return <div role="radio" aria-checked={checked} tabIndex={0} data-all-places-check={value} onClick={onChoose}
    onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onChoose(); } }}
    className="flex min-h-7 cursor-pointer items-center gap-2 rounded-md text-[13px] leading-5 text-ink focus-visible:outline-2 focus-visible:outline-focus">
    <span aria-hidden="true" className={cn("grid size-4 shrink-0 place-items-center rounded-full border", checked ? "border-accent" : "border-ink/30")}>
      {checked && <span className="size-2 rounded-full bg-accent" />}
    </span>
    {children}
  </div>;
}

export function AllPlacesSettings({ settings, change }: { settings: Settings; change: (changes: { enabled?: boolean; check?: AllPlacesCheck; notify?: boolean }) => void }) {
  const every = INTERVALS.some(([interval]) => interval === settings.check);
  return <div data-all-places-settings>
    <SettingsRows>
      <SettingRow title={t("allPlaces.settings.title")} tag={t("settings.simple.advanced")} subtitle={t("allPlaces.settings.sub")}>
        <Switch checked={settings.enabled} data-all-places-enable="" aria-label={t("allPlaces.settings.title")} onClick={() => change({ enabled: !settings.enabled })} />
      </SettingRow>
      {settings.enabled && <div className="flex flex-col gap-1 px-4 py-3">
        <div className="text-[14px] leading-5 text-ink">{t("allPlaces.settings.check")}</div>
        <div className="pb-1 text-[13px] leading-[18px] text-ink-secondary">{t("allPlaces.settings.checkSub")}</div>
        <div role="radiogroup" aria-label={t("allPlaces.settings.check")} className="flex flex-col gap-0.5">
          <Choice value="live" checked={settings.check === "live"} onChoose={() => change({ check: "live" })}>
            <span><b className="font-semibold">{t("allPlaces.check.live")}</b><span className="text-ink-secondary"> · {t("allPlaces.check.liveSub")}</span></span>
          </Choice>
          <Choice value="every" checked={every} onChoose={() => { if (!every) change({ check: "120" }); }}>
            <span>{t("allPlaces.check.every")}</span>
            <span className="inline-flex rounded-lg bg-control p-0.5 text-[12px]">
              {INTERVALS.map(([interval, label]) => <button key={interval} type="button" data-all-places-interval={interval} aria-pressed={settings.check === interval}
                onClick={(event) => { event.stopPropagation(); change({ check: interval }); }}
                className={cn("rounded-md px-2 py-0.5 text-ink-secondary", settings.check === interval && "bg-card text-ink shadow-sm")}>{t(label)}</button>)}
            </span>
          </Choice>
          <Choice value="open" checked={settings.check === "open"} onChoose={() => change({ check: "open" })}>{t("allPlaces.check.open")}</Choice>
          <Choice value="never" checked={settings.check === "never"} onChoose={() => change({ check: "never" })}>{t("allPlaces.check.never")}</Choice>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink-secondary">{t("allPlaces.settings.notify")}</span>
          <Switch checked={settings.notify} data-all-places-notify="" aria-label={t("allPlaces.settings.notify")} onClick={() => change({ notify: !settings.notify })} />
        </div>
      </div>}
    </SettingsRows>
  </div>;
}
