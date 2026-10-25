/* =============================================================
 * .puppeteerrc.cjs —— 测试用的浏览器解析兜底
 *
 * 为什么需要这个文件：`test/*.js` 里的 `puppeteer.launch()` 默认去找
 * "与 puppeteer 版本配套的那个 Chrome"。这台机器的 workspace 被重建过一次，
 * 装上的 puppeteer 要 Chrome 156，而 `~/.cache/puppeteer` 里实际只有 148 / 154，
 * 于是 launch() 直接报 "Could not find Chrome (ver. 156…)"，所有浏览器测试都跑不了。
 *
 * 这里从缓存里挑**实际存在**的最高版本兜底；缓存里一个都没有就返回 undefined，
 * 交回 puppeteer 自己解析（等于没这个文件）。所以换机器 / 换缓存都不会跑偏。
 * ============================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function pickChrome() {
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  try {
    const dirs = fs.readdirSync(cache)
      .filter((d) => /^win64-|^linux-|^mac-/.test(d))
      .sort((a, b) => {
        const na = parseInt(a.split('-')[1], 10) || 0;
        const nb = parseInt(b.split('-')[1], 10) || 0;
        return nb - na;
      });
    for (const d of dirs) {
      const cands = [
        path.join(cache, d, 'chrome-win64', 'chrome.exe'),
        path.join(cache, d, 'chrome-linux64', 'chrome'),
        path.join(cache, d, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS',
          'Google Chrome for Testing')
      ];
      for (const exe of cands) if (fs.existsSync(exe)) return exe;
    }
  } catch (e) { /* 没有缓存目录 → 走 puppeteer 默认解析 */ }
  return undefined;
}

module.exports = { executablePath: pickChrome() };
