// Shared UI translations for Delivez web apps. English (en.json) is the source of truth for keys;
// other languages may lag behind and fall back to English per key.
const { createHash } = require('node:crypto');

/** Browser-safe list (the web apps import languages.json directly). */
const LANGUAGES = require('./languages.json');

const cache = new Map();
/** Messages for a language code (EN, HI…) with a content version for caching. */
function load(code) {
  const lang = LANGUAGES.find((l) => l.code === String(code).toUpperCase());
  if (!lang) return null;
  if (!cache.has(lang.code)) {
    const messages = require(`./locales/${lang.code.toLowerCase()}.json`);
    const english = require('./locales/en.json');
    const total = Object.keys(english).length;
    const translated = Object.keys(english).filter((k) => typeof messages[k] === 'string' && messages[k].length > 0).length;
    const version = createHash('sha1').update(JSON.stringify(messages)).digest('hex').slice(0, 12);
    cache.set(lang.code, { ...lang, version, coverage: Math.round((translated / total) * 100), messages });
  }
  return cache.get(lang.code);
}

module.exports = { LANGUAGES, load };
