import { useEffect } from "react";
import { reportAdvancedMode } from "@/lib/all-places";
import { useAdvancedMode } from "@/lib/interface-mode";
import { effectiveLanguage, useLanguageChoice, usePageLanguage } from "@/lib/language-preference";
import { wearSkin } from "@/lib/skins";
import { AccountsSheet, useAccountsSheet } from "./AccountMenu";
import { DesktopCapabilitiesProvider } from "./DesktopCapabilities";
import { PlacesRail } from "./PlacesRail";

/** The window's own rail of places (main's chrome-rail.mjs): this app's page in a narrow view at the window's left edge,
 * beside whichever place's page the window shows, in the skin and language of the app. Its sheets cover the window
 * while open (main widens the view for them). */
export function ChromeRail() {
  usePageLanguage(effectiveLanguage(useLanguageChoice(), undefined));
  // The page beside the rail chose its skin: the rail wears the same one.
  useEffect(() => window.ogb?.rail?.onSkin?.(wearSkin), []);
  // Main cannot read a page's Advanced mode, and All places is offered only in it: this page, served from this computer's
  // own origin, says so, and says again whenever the mode changes on any page of that origin.
  const advanced = useAdvancedMode();
  useEffect(() => reportAdvancedMode(advanced), [advanced]);
  const accounts = useAccountsSheet();
  return <DesktopCapabilitiesProvider><div data-chrome-rail className="h-full"><PlacesRail chrome /></div>{accounts.open && <AccountsSheet onClose={accounts.close} />}</DesktopCapabilitiesProvider>;
}
