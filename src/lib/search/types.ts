/**
 * Search service interface — Neon Postgres today, Typesense/Meilisearch later.
 * UI and route handlers depend only on this contract.
 */

export type SearchHit = {
  documentId: string;
  workspaceId: string;
  title: string;
  breadcrumbPath: string;
  /**
   * Plain-text snippet with matches wrapped in ⟪…⟫ markers.
   * Render by splitting on the markers — never as raw HTML.
   */
  snippet: string;
  score: number;
  updatedAt: Date;
  workspaceName?: string;
  creatorName?: string;
  creatorId?: string;
};

export type SearchQuery = {
  query: string;
  userId: string;
  workspaceId?: string;
  /** Only documents created by this user. */
  ownerId?: string;
  /** Only documents inside this page's subtree (folder filter). */
  parentId?: string;
  /** Only documents updated at/after this time. */
  updatedAfter?: Date;
  limit?: number;
  offset?: number;
};

export type SearchResult = {
  hits: SearchHit[];
  total: number;
  query: string;
};

/** Markers used to highlight matches inside snippets. */
export const HIGHLIGHT_START = "⟪";
export const HIGHLIGHT_END = "⟫";

export interface SearchService {
  search(input: SearchQuery): Promise<SearchResult>;
}
