// Every language must use the same keys and placeholders as English.
const en = require('./locales/en.json');
const { LANGUAGES } = require('./index');
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
let bad = 0;
for (const { code } of LANGUAGES) {
  const m = require(`./locales/${code.toLowerCase()}.json`);
  const missing = Object.keys(en).filter((k) => !(k in m));
  const extra = Object.keys(m).filter((k) => !(k in en));
  const phMismatch = Object.keys(en).filter((k) => k in m && ph(en[k]) !== ph(m[k]));
  const ok = !missing.length && !extra.length && !phMismatch.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${code} keys=${Object.keys(m).length}/${Object.keys(en).length}${missing.length ? ' missing=' + missing.join(',') : ''}${extra.length ? ' extra=' + extra.join(',') : ''}${phMismatch.length ? ' placeholders=' + phMismatch.join(',') : ''}`);
}
process.exitCode = bad ? 1 : 0;
