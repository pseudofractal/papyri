export type SiteId = 'chatgpt' | 'wikipedia' | 'gemini';

export interface SiteDefinition {
  id: SiteId;
  label: string;
  url: string;
}

export const SITES: SiteDefinition[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
  },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/' },
];

export type RightTab = 'outline' | SiteId | 'notes';

export function isSiteTab(tab: RightTab): tab is SiteId {
  return SITES.some((site) => site.id === tab);
}

export function siteUrl(id: SiteId): string {
  return SITES.find((site) => site.id === id)?.url ?? 'https://chatgpt.com/';
}
