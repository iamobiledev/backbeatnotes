/**
 * Centralized product naming and branding.
 * Replace values here to rebrand the application without hunting through the codebase.
 */
export const brand = {
  name: "BackBeat Notes",
  shortName: "BackBeat",
  slug: "backbeat-notes",
  slackHandle: "backbeat-notes",
  /** Short tagline used in marketing and metadata */
  tagline: "Keep your team's knowledge in rhythm.",
  /** Combined title for browser tabs and OG tags */
  get title() {
    return `${this.name} | Collaborative docs and team knowledge`;
  },
  socialTitle: "Your team's knowledge, in rhythm.",
  siteUrl: (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, ""),
  themeColor: "#2383e2",
  backgroundColor: "#ffffff",
  /** Support / from-name for transactional email */
  emailFromName: "BackBeat Notes",
  /** Default workspace name for seeded / first workspace */
  defaultWorkspaceName: "My Workspace",
  /** Public marketing description */
  description:
    "BackBeat Notes brings your team's docs, wikis, decisions, and playbooks into one fast, searchable workspace.",
  keywords: [
    "team knowledge base",
    "collaborative documentation",
    "team wiki",
    "knowledge management",
    "workspace notes",
    "team playbooks",
  ],
  logoText: "BackBeat Notes",
} as const;

export type Brand = typeof brand;
