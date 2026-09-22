/* ============================================================
   index.html 的 PWA 资源引用补丁（图标）
   ------------------------------------------------------------
   为什么写成脚本而不是手工编辑：
   本仓库的 index.html 会被外部编辑器**持续**注入 data-page-node-id 属性
   （清干净后几秒内就会重新出现）。手工 Edit 时常因这些额外属性匹配失败，
   所以这里把「清除注入」与「应用改动」放进同一次原子写入。

   幂等性 —— 这里踩过一次坑：
   最早的版本用 `s.includes(from)` 判断是否已应用，那是**错的**。
   因为替换方式是「在 from 之后插一行」，from 本身仍留在文件里，
   于是每跑一次就多插一行，最终漏出 3 行重复的 `<link rel="icon" href="icon-192.png">`
   和 3 行重复的 `<meta name="mobile-web-app-capable">`。
   现在改用**替换结果里的新增行**（marker）来判断，重复运行不会再插。
   并且兜底折叠「连续重复的非空行」，可修掉早期版本留下的重复。

   跑法：node tools/patch-index-mobile.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'index.html');
let s = fs.readFileSync(P, 'utf8');

/* ① 清除编辑器注入的临时属性 */
const injected = (s.match(/data-page-node-id=/g) || []).length;
s = s.replace(/\s+data-page-node-id="[^"]*"/g, '');

/* ② 应用改动：[匹配片段, 替换后, 说明]
     替换用函数形式，避免 `$` 被解释成替换模式。
     幂等判断看 `to` 的最后一行（新增的那行），不看 `from` —— 见文件头说明。 */
const EDITS = [
  [
    '<link rel="apple-touch-icon" href="icon.svg">',
    '<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">',
    'apple-touch-icon 换成 PNG（iOS 不认 SVG，会显示白块）',
  ],
  [
    '<link rel="icon" href="icon.svg" type="image/svg+xml">',
    '<link rel="icon" href="icon.svg" type="image/svg+xml">\n<link rel="icon" href="icon-192.png" sizes="192x192" type="image/png">',
    '补 PNG favicon（SVG 图标支持面不全）',
  ],
  [
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">',
    '补安卓的 mobile-web-app-capable',
  ],
];

let applied = 0;
const notes = [];
let skipped = 0;
for (const [from, to, label] of EDITS) {
  const marker = to.split('\n').pop();
  if (s.includes(marker)) { skipped++; continue; }        // 已应用过 → 跳过（这才是真正的幂等）
  if (s.includes(from)) { s = s.replace(from, () => to); applied++; notes.push('已应用  ' + label); }
  else notes.push('未匹配  ' + label + '（人工确认）');
}

/* ③ 兜底：折叠「连续重复的非空行」，修掉早期非幂等版本留下的重复。
     只折叠相邻且完全相同的行，且不碰空行 —— 避免误伤排版。 */
const total = s.split('\n').length;
const lines = [];
for (const line of s.split('\n')) {
  if (line !== '' && lines[lines.length - 1] === line) continue;
  lines.push(line);
}
const collapsed = total - lines.length;
s = lines.join('\n');

fs.writeFileSync(P, s, 'utf8');

console.log('清除注入          ' + injected + ' 处');
console.log('应用改动          ' + applied + ' 项' + (skipped ? '（另有 ' + skipped + ' 项早已应用，跳过）' : ''));
notes.forEach((n) => console.log('  · ' + n));
if (collapsed) console.log('折叠重复行        ' + collapsed + ' 行（早期非幂等版本遗留）');

/* 回读校验：注入必须为 0 */
const t = fs.readFileSync(P, 'utf8');
const after = (t.match(/data-page-node-id=/g) || []).length;
const dup = (re) => (t.match(re) || []).length;
console.log('复查注入残留      ' + after + ' 处');
console.log('关键行计数        icon-192 ' + dup(/icon-192\.png/g) + ' · mobile-web-app-capable '
  + dup(/mobile-web-app-capable/g) + ' · apple-touch-icon ' + dup(/apple-touch-icon/g));

process.exit(after === 0 ? 0 : 1);
