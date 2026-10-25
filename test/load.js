/* 共享载入器：在主上下文里 eval 各模块（vm 沙箱会让热循环慢 30 倍，不能用来测性能） */
'use strict';
const fs = require('fs');
const path = require('path');

const CORE = ['00-core', '01-noise', '02-terrain', '03-seeds', '04-partition',
  '04b-rivers', '05-geometry', '06-adjacency', '07-politics', '08-names',
  '08b-society', '09-export', '15-resources', '13-main'];

function load(extra) {
  const files = CORE.concat(extra || []);
  const dir = path.join(__dirname, '..', 'js');
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f + '.js'), 'utf8');
    (0, eval)(src);
  }
  return globalThis.AO;
}

module.exports = { load, CORE };
