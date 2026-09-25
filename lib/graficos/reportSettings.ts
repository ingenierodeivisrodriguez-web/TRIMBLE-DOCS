/** Branding for the PDF report, remembered in this browser for every project. */
export interface ReportSettings {
  title: string;
  company: string;
  preparedBy: string;
  /** Downscaled PNG data URL of the company logo. */
  logo: { dataUrl: string; width: number; height: number } | null;
}

export const DEFAULT_REPORT_TITLE = "Informe ejecutivo de modelos BIM";

const STORAGE_KEY = "graficos-modelos:informe";

export function defaultReportSettings(preparedBy = ""): ReportSettings {
  return { title: DEFAULT_REPORT_TITLE, company: "", preparedBy, logo: null };
}

export function parseReportSettings(json: string | null, preparedBy = ""): ReportSettings {
  const fallback = defaultReportSettings(preparedBy);
  if (!json) return fallback;
  try {
    const raw = JSON.parse(json) as Partial<ReportSettings> | null;
    if (!raw || typeof raw !== "object") return fallback;
    const logo = raw.logo;
    const validLogo =
      logo &&
      typeof logo.dataUrl === "string" &&
      /^data:image\/(png|jpeg);base64,/.test(logo.dataUrl) &&
      typeof logo.width === "number" &&
      typeof logo.height === "number"
        ? logo
        : null;
    return {
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title : fallback.title,
      company: typeof raw.company === "string" ? raw.company : "",
      preparedBy: typeof raw.preparedBy === "string" && raw.preparedBy.trim() ? raw.preparedBy : preparedBy,
      logo: validLogo,
    };
  } catch {
    return fallback;
  }
}

export function loadReportSettings(preparedBy = ""): ReportSettings {
  try {
    return parseReportSettings(window.localStorage.getItem(STORAGE_KEY), preparedBy);
  } catch {
    return defaultReportSettings(preparedBy);
  }
}

export function storeReportSettings(settings: ReportSettings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
