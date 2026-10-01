/**
 * Fetching rules (see README "Import limitations"):
 *  - we never try to defeat anti-bot protection: challenge pages, CAPTCHAs, logins,
 *    rate limits and robots.txt rules are reported to the user, not circumvented;
 *  - browsers can only read pages that send CORS headers, so most shops cannot be
 *    imported from the web app — use the CLI (`npm run import`), paste the HTML,
 *    or enter the data manually.
 */
import { ImportFetchError, type Fetcher } from './types';

const CHALLENGE =
  /(just a moment|cf-chl|cf-browser-verification|attention required|captcha|are you a (human|robot)|access denied|verify you are human|enable javascript and cookies|px-captcha|datadome)/i;

export function looksLikeChallenge(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  return body.length < 20_000 && CHALLENGE.test(body);
}

/** Query parameters that only carry tracking / ranking context, never identify the page. */
const TRACKING_PARAM = /^(utm_|fbclid|gclid|msclkid|mc_|_ga|ref$|ref_$|spm$|algo_|pdp_|curPageLogUid$|utparam|scm|aff_|sk$|aem_p4p|gatewayAdapt|pvid$)/i;

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ImportFetchError('invalid-url', 'Empty URL.');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new ImportFetchError('invalid-url', `"${input}" is not a valid URL.`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ImportFetchError('invalid-url', 'Only http(s) URLs can be imported.');
  }
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  }
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

/** Turns a Response into HTML text or a typed failure. Shared by browser and CLI fetchers. */
export async function readHtmlResponse(res: Response): Promise<string> {
  const body = await res.text();
  if (looksLikeChallenge(res.status, body)) {
    throw new ImportFetchError(
      'blocked',
      `The site answered with an access challenge or block (HTTP ${res.status}). KeyboardShapes does not bypass protections.`,
      res.status,
    );
  }
  if (res.status === 404 || res.status === 410) throw new ImportFetchError('not-found', 'Page not found.', res.status);
  if (!res.ok) throw new ImportFetchError('http-error', `HTTP ${res.status}.`, res.status);
  const type = res.headers.get('content-type') ?? '';
  if (type && !/html|xml|text/i.test(type)) throw new ImportFetchError('not-html', `The URL returned ${type}, not a web page.`);
  return body;
}

/** Browser fetcher: works only when the target allows cross-origin reads. */
export const browserFetcher: Fetcher = async (url) => {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' });
  } catch {
    throw new ImportFetchError(
      'network-or-cors',
      'The browser could not read this page (the site does not allow cross-origin requests, or the network failed).',
    );
  }
  return readHtmlResponse(res);
};
