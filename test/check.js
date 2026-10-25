/* 跑完整验收自检 */
'use strict';
const AO = require('./load').load(['12-selftest']);

const seed = process.argv[2] || 'aoh-2026';
const opts = { seed, provinces: 1100, countries: 64 };
const t = Date.now();
const w = AO.generate(opts);
console.log('生成耗时', Date.now() - t, 'ms\n');

const r = AO.selfTest(w, opts);
for (const c of r.checks) {
  console.log((c.ok ? '  PASS  ' : '> FAIL <') + '  ' + c.name + '  —  ' + c.detail);
}
console.log('\n总体:', r.pass ? '全部通过' : '存在失败项');
