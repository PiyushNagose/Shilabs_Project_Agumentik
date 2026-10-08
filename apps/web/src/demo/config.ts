export const isDemoMode =
  (import.meta.env as Readonly<Record<string, string | undefined>>).VITE_DEMO_MODE === "true";

export const demoAccessToken = "shilabs-read-only-preview";

