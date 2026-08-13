//  Created by Deepak Sharma on 13/08/2026.

export interface BuildSettingsEntry {
  target?: string;
  buildSettings: Record<string, string>;
}

const APPLICATION_PRODUCT_TYPE = "com.apple.product-type.application";

function isRunnableApplication(entry: BuildSettingsEntry): boolean {
  const settings = entry.buildSettings;
  return (
    settings.PRODUCT_TYPE === APPLICATION_PRODUCT_TYPE ||
    settings.WRAPPER_EXTENSION === "app" ||
    settings.FULL_PRODUCT_NAME?.endsWith(".app") === true
  );
}

function runnableScore(entry: BuildSettingsEntry, scheme: string): number {
  const settings = entry.buildSettings;
  let score = 0;

  if (settings.PRODUCT_TYPE === APPLICATION_PRODUCT_TYPE) {
    score += 100;
  }
  if (settings.WRAPPER_EXTENSION === "app" || settings.FULL_PRODUCT_NAME?.endsWith(".app")) {
    score += 50;
  }
  if (settings.MACH_O_TYPE === "mh_execute") {
    score += 25;
  }
  if (entry.target === scheme || settings.TARGET_NAME === scheme) {
    score += 20;
  }
  if (/test|framework|extension|bundle/i.test(settings.PRODUCT_TYPE ?? "")) {
    score -= 100;
  }

  return score;
}

/** Selects the application product represented by an Xcode scheme's build settings. */
export function selectRunnableBuildSettings(
  entries: BuildSettingsEntry[],
  scheme: string
): BuildSettingsEntry | undefined {
  const applications = entries.filter(isRunnableApplication);
  if (applications.length === 0) {
    return undefined;
  }

  return applications
    .map((entry, index) => ({ entry, index, score: runnableScore(entry, scheme) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0].entry;
}
