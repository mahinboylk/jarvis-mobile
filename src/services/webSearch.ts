import { fetch } from 'expo/fetch';
import { TIMEOUTS } from '../config/models';
import { SearchResult, WebSearchResponse } from '../types';
import { withTimeout } from '../utils/async';
import { connectivity, isNetworkError } from './connectivity';

const DDG_IA = 'https://api.duckduckgo.com/';
const DDG_HTML = 'https://html.duckduckgo.com/html/';
const WIKI_SEARCH_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_SUMMARY_API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

const truncate = (text: string, max = 320): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const decodeEntities = (text: string): string =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ')
    .trim();

/** DuckDuckGo wraps outbound links in a redirect — unwrap when present. */
export const decodeDdgUrl = (href: string): string => {
  const raw = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(raw);
    const uddg = url.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : raw;
  } catch {
    return raw;
  }
};

/** Pull titled results out of the DuckDuckGo HTML SERP. */
export function extractDdgResults(html: string, limit = 5): SearchResult[] {
  const results: SearchResult[] = [];
  const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetRe.exec(html)) !== null) {
    const text = decodeEntities(snippetMatch[1] ?? '');
    if (text.length > 40) snippets.push(text);
  }

  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = linkRe.exec(html)) !== null && results.length < limit) {
    const url = decodeDdgUrl(match[1] ?? '');
    const title = decodeEntities(match[2] ?? '');
    if (!title || !url) {
      index += 1;
      continue;
    }
    results.push({ title, url, snippet: truncate(snippets[index] ?? '') });
    index += 1;
  }
  return results;
}

/** Numeric prefix used when quoting results back to the model. */
export function formatForContext(response: WebSearchResponse): string {
  if (response.results.length === 0) return '';
  const lines = response.results.map((r, i) => `[${i + 1}] ${r.title} — ${r.snippet}`);
  return `Search results for "${response.query}" (source: ${response.source}):\n${lines.join('\n')}`;
}

/**
 * Search the live web and return citable results plus flat snippet lines.
 *
 * Three best-effort stages in order: DuckDuckGo Instant Answer, DuckDuckGo HTML
 * SERP, then Wikipedia title resolution + summary. Each stage has its own
 * deadline so one slow provider cannot consume the whole budget.
 */
export async function webSearch(
  query: string,
  signal?: AbortSignal
): Promise<WebSearchResponse> {
  const q = query.trim();
  if (!q) {
    return { query, results: [], snippets: [], source: 'none' };
  }

  const results: SearchResult[] = [];

  // 1) DuckDuckGo Instant Answer (keyless JSON)
  try {
    const iaUrl =
      `${DDG_IA}?q=${encodeURIComponent(q)}&format=json&no_html=1&no_redirect=1` +
      '&skip_disambig=1&t=jarvis-mobile';
    const iaRes = await withTimeout(fetch(iaUrl, { signal }), TIMEOUTS.SEARCH_TIMEOUT_MS, 'Search');
    if (iaRes.ok) {
      const data = await iaRes.json();
      const answer = typeof data?.Answer === 'string' ? data.Answer : '';
      const abstract = typeof data?.AbstractText === 'string' ? data.AbstractText : '';
      const abstractSource = typeof data?.AbstractSource === 'string' ? data.AbstractSource : '';
      const abstractUrl = typeof data?.AbstractURL === 'string' ? data.AbstractURL : '';
      const heading = typeof data?.Heading === 'string' ? data.Heading : '';

      if (answer) {
        results.push({
          title: heading || 'Direct answer',
          url: abstractUrl,
          snippet: truncate(decodeEntities(answer)),
        });
      }
      if (abstract) {
        results.push({
          title: heading || abstractSource || 'Overview',
          url: abstractUrl,
          snippet: truncate(decodeEntities(abstract)),
        });
      }
      if (Array.isArray(data?.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 3)) {
          if (results.length >= 5) break;
          const text = typeof topic?.Text === 'string' ? topic.Text : '';
          const firstUrl = typeof topic?.FirstURL === 'string' ? topic.FirstURL : '';
          if (text) {
            results.push({
              title: text.split(' - ')[0] || 'Related',
              url: firstUrl,
              snippet: truncate(decodeEntities(text), 200),
            });
          }
        }
      }
    }
  } catch (e) {
    if (isNetworkError(e)) connectivity.reportFailure(e);
  }

  // 2) DuckDuckGo HTML SERP via POST (GET is frequently challenged with 202)
  if (results.length === 0) {
    try {
      const htmlRes = await withTimeout(
        fetch(DDG_HTML, {
          method: 'POST',
          signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `q=${encodeURIComponent(q)}`,
        }),
        TIMEOUTS.SEARCH_TIMEOUT_MS,
        'Search'
      );
      if (htmlRes.ok) {
        results.push(...extractDdgResults(await htmlRes.text()));
      }
    } catch (e) {
      if (isNetworkError(e)) connectivity.reportFailure(e);
    }
  }

  // 3) Wikipedia fallback — resolve the best article title first, then read it.
  // (Questions like "who won the match last night" are not article titles, so
  // hitting page/summary with the raw query 404s.)
  if (results.length === 0) {
    try {
      const searchQuery = q.split(/\s+/).slice(0, 8).join(' ');
      const searchUrl =
        `${WIKI_SEARCH_API}?action=query&list=search&srlimit=1&format=json&origin=*` +
        `&srsearch=${encodeURIComponent(searchQuery)}`;
      const searchRes = await withTimeout(
        fetch(searchUrl, { signal, headers: { 'User-Agent': 'jarvis-mobile/1.0 (Expo Go)' } }),
        TIMEOUTS.SEARCH_TIMEOUT_MS,
        'Wikipedia search'
      );
      if (searchRes.ok) {
        const title = (await searchRes.json())?.query?.search?.[0]?.title;
        if (typeof title === 'string' && title.trim()) {
          const summaryRes = await withTimeout(
            fetch(`${WIKI_SUMMARY_API}${encodeURIComponent(title)}`, { signal }),
            TIMEOUTS.SEARCH_TIMEOUT_MS,
            'Wikipedia summary'
          );
          if (summaryRes.ok) {
            const data = await summaryRes.json();
            const extract = typeof data?.extract === 'string' ? data.extract : '';
            if (extract) {
              results.push({
                title: typeof data?.title === 'string' ? data.title : title,
                url:
                  data?.content_urls?.desktop?.page ||
                  `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
                snippet: truncate(decodeEntities(extract)),
              });
            }
          }
        }
      }
    } catch (e) {
      if (isNetworkError(e)) connectivity.reportFailure(e);
    }
  }

  if (results.length > 0) connectivity.reportSuccess();

  const capped = results.slice(0, 8);
  const source: WebSearchResponse['source'] =
    capped.length === 0
      ? 'none'
      : (capped[0]?.url ?? '').includes('wikipedia.org')
        ? 'wikipedia'
        : 'duckduckgo';

  return {
    query: q,
    results: capped,
    snippets: capped.map((r) => (r.title ? `${r.title}: ${r.snippet}` : r.snippet)),
    source,
  };
}

