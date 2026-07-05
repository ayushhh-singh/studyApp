export const SUPPORTED_LOCALES = ["hi", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function switchLocale(
  pathname: string,
  search: string,
  next: Locale,
  hash = "",
): string {
  const segments = pathname.split("/");
  segments[1] = next;
  return `${segments.join("/")}${search}${hash}`;
}
