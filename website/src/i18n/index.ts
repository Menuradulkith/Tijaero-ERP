// The site is English-only, written for Sri Lankan businesses.
// All copy lives in en.ts so wording can be changed in one place.
import en from './en';

export type Lang = 'en';
export type Dict = typeof en;

export function t(_lang: Lang = 'en'): Dict {
  return en;
}

/** Path for a page. `page` is '' (home), 'pricing' or 'demo'. */
export function pathFor(_lang: Lang, page: '' | 'pricing' | 'demo', hash = ''): string {
  return `/${page ? `${page}/` : ''}${hash}`;
}

export const htmlLang: Record<Lang, string> = { en: 'en-LK' };

export const contact = {
  phone: import.meta.env.PUBLIC_PHONE || '+94 7X XXX XXXX',
  email: import.meta.env.PUBLIC_EMAIL || 'hello@example.lk',
};

/** Digits-only phone for tel: and wa.me links. */
export const phoneDigits = contact.phone.replace(/\D/g, '');
