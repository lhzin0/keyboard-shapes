import { tokenize } from './ImageExtractor';
import { hostOf } from './parsers/common';
import type { ProductData } from './types';

export interface BrandModel {
  brand: string;
  model: string;
  /** Human-readable remarks (shown to the user, never silent). */
  notes: string[];
}

const meaningful = (s: string | undefined): s is string => !!s && /[a-z0-9]{2,}/i.test(s);

/**
 * Brand / model of the *product*. Shop pages often declare the retailer as the brand
 * ("MKB.MY" for a Madlions keyboard sold on mkb.gg) and junk SKUs ("-"), so:
 *  - a declared brand that resembles the shop's own host name is treated as the retailer;
 *  - the model is whatever remains of the product name after the brand.
 */
export function deriveBrandModel(p: Pick<ProductData, 'name' | 'brand' | 'url'>): BrandModel {
  const notes: string[] = [];
  const name = (p.name ?? '').trim();
  const words = name.split(/\s+/).filter(Boolean);
  const hostTokens = new Set(tokenize(hostOf(p.url)).filter((t) => t.length > 2));
  const declared = meaningful(p.brand) ? p.brand.trim() : undefined;
  const declaredIsShop = !!declared && tokenize(declared).some((t) => hostTokens.has(t));
  const nameHasDeclared = !!declared && name.toLowerCase().includes(declared.toLowerCase());

  let brand: string;
  if (declared && !declaredIsShop) brand = declared;
  else if (declared && nameHasDeclared) brand = declared;
  else {
    brand = words[0] ?? declared ?? '';
    if (declaredIsShop) notes.push(`The page declares "${declared}" as brand, which looks like the shop itself; "${brand}" (first word of the name) was used instead — please confirm.`);
  }

  let model = name;
  const lower = name.toLowerCase();
  if (brand && lower.startsWith(brand.toLowerCase())) model = name.slice(brand.length).replace(/^[\s\-–—:|]+/, '');
  return { brand, model: model || name, notes };
}
