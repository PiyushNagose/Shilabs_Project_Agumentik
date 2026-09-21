export interface SEODataResult {
  provider: "SEMRUSH";
  targetUrl: string;
  database: string;
  organicKeywords: number | null;
  organicTraffic: number | null;
  backlinks: number | null;
  raw: unknown;
}

export interface SEODataProvider {
  analyzeDomain(input: { targetUrl: string }): Promise<SEODataResult>;
}
