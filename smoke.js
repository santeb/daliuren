/**
 * DOM 冒烟测试：在最小 DOM 桩上真实跑一遍 divine()，验证交互层不抛异常。
 *
 * test.js 只测算法层（页面脚本抽出来跑，但不触发任何 UI 流程），
 * 而 genAdvice() 曾因裸用未定义变量导致「问感情类问题必崩」——那类问题
 * 只有真正走一遍起课流程才能发现。本文件补的就是这一层。
 *
 * 运行：node smoke.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ─── 最小 DOM 桩 ───────────────────────────────────────────
const INIT = {
  iy: '2026', im: '7', id: '10', ih: '6', iyj: '', iq: '我和他的感情发展如何',
  itm: '12:00', icity: '', ilng: '116.41',
  cbSolar: { checked: true }, cbMingpan: { checked: false }
};

// canvas 2d 上下文桩：让天地盘绘制代码真正跑一遍（而不是走 getContext 失败的跳过分支）
function ctxStub() {
  return new Proxy(function () {}, {
    get(t, k) {
      if (k === 'canvas') return { width: 420, height: 420 };
      if (k === 'width' || k === 'height') return 10;
      if (typeof k === 'symbol') return undefined;
      return ctxStub();
    },
    set() { return true; },
    apply() { return ctxStub(); }
  });
}

function makeEl(id) {
  const init = INIT[id] || {};
  const el = {
    id: id,
    value: typeof init === 'string' ? init : '',
    checked: init.checked === true,
    disabled: false,
    innerHTML: '', textContent: '', className: '',
    style: {}, dataset: {},
    _h: {},
    addEventListener(t, f) { this._h[t] = f; },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl('_q'); },
    querySelectorAll() { return []; },
    getContext() { return ctxStub(); },     // canvas 上下文桩
    getBoundingClientRect() { return { width: 420, height: 420 }; },
    focus() {}, click() {}, blur() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    scrollIntoView() {}, insertAdjacentHTML() {}
  };
  return el;
}

const els = {};
const document = {
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement() { return makeEl('_new'); },
  querySelector() { return makeEl('_q'); },
  querySelectorAll() { return []; },
  addEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html')
};

const HTML = path.join(__dirname, 'index.html');
const code = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/);
if (!code) { console.error('未能在 index.html 中找到 <script>'); process.exit(1); }

const ctx = vm.createContext({
  document: document,
  window: {},
  console: console,
  alert: function (m) { throw new Error('页面弹出了 alert：' + m); },
  Date: Date, Math: Math, JSON: JSON, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: function () {}, clearTimeout: function () {}, speechSynthesis: undefined
});
vm.runInContext(code[1], ctx);

// ─── 冒烟 ─────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

console.log('大六壬 DOM 冒烟测试（真正跑一遍起课流程）\n');

const DLR = ctx.DLR;
if (!DLR) { console.error('脚本未导出 DLR，无法冒烟'); process.exit(1); }
const BR = DLR.BRAN, ST = DLR.STEM;
const DLRBR = (r) => ST[r.dsb.stem] + BR[r.dsb.branch];
const DLRCH = (r) => BR[r.chu] + BR[r.zhang] + BR[r.mo];

// 配置输入框 → 跑一遍 divine() → 返回结果对象
function run(label, setup) {
  setup();
  try {
    DLR.divine();
    const r = ctx.window._lastR;
    if (!r) throw new Error('未产出结果');
    const s = r.solar;
    console.log(`  ✓ ${label} → 日柱 ${DLRBR(r)}　三传 ${DLRCH(r)}　${r.zongmen}` +
      (s ? `\n      真太阳时 ${s.m}/${s.d} ${s.hh}:${s.mm}（delta=${s.delta} dl=${s.dl} eot=${s.eot}）→ ${BR[s.hb]}时` : ''));
    pass++;
    return r;
  } catch (e) {
    fail++;
    console.log(`  ✗ ${label}：${e.message}`);
    return null;
  }
}

const g = (id) => els[id] || document.getElementById(id);

// 页面初始化会调用 useNow() 把输入框刷成当前时刻，故每个用例都要显式预设
function preset(o) {
  g('iy').value = o.y || '2026';
  g('im').value = o.m || '7';
  g('id').value = o.d || '10';
  g('itm').value = o.t || '12:00';
  g('ih').value = o.hb || '6';
  g('iyj').value = o.yj || '';
  g('ilng').value = String(o.lng === undefined ? 116.41 : o.lng);
  g('cbSolar').checked = o.solar !== false;
  g('cbMingpan').checked = !!o.mingpan;
  g('iq').value = o.q || '我和他的感情发展如何';
}

console.log('\n── 起课流程');
// 北京·真太阳时开
const r1 = run('北京 116.41°E · 真太阳时开 · 感情类问题', () => preset({}));
ok(!!r1 && !!r1.solar, '结果带真太阳时明细', r1 ? JSON.stringify(r1.solar) : '');
ok(!!r1 && Math.abs(r1.solar.dl - (116.41 - 120) * 4) < 0.1, '北京经度校正约 −14 分', r1 ? String(r1.solar.dl) : '');
ok(!!r1 && BR[r1.solar.hb] === '午', '北京 12:00 → 仍为午时', r1 ? BR[r1.solar.hb] : '');

// 乌鲁木齐：应换时辰（12:00 北京时 → 约 09:45 真太阳时）
const r2 = run('乌鲁木齐 87.62°E · 真太阳时开', () => preset({ lng: 87.62 }));
ok(!!r2 && BR[r2.solar.hb] === '巳', '乌鲁木齐 12:00 → 巳时（非午时）', r2 ? BR[r2.solar.hb] : '');

// 喀什凌晨：应换日
const r2b = run('喀什 75.99°E · 00:30', () => preset({ lng: 75.99, t: '00:30' }));
ok(!!r2b && r2b.solar.dayOffset === -1 && r2b.solar.d === 9, '喀什 00:30 → 回到前一日 7/9', r2b ? `${r2b.solar.m}/${r2b.solar.d}` : '');

// 关闭真太阳时：应直接用时辰下拉
const r3 = run('真太阳时关 · 直接用时辰下拉', () => preset({ solar: false, hb: '6' }));
ok(!!r3 && r3.solar === null, '关闭时 solar 为 null', String(r3 && r3.solar));

// 手动指定月将
const r4 = run('手动指定月将（戌将）', () => preset({ solar: false, yj: '10' }));
ok(!!r4 && r4.yjManual === true, '月将标记手动', String(r4 && r4.yjManual));

// 终身命盘开启
const r5 = run('终身命盘开启', () => {
  preset({ solar: false, mingpan: true });
  g('iby').value = '1990'; g('ibm').value = '3'; g('ibd').value = '15';
});
ok(!!r5, '命盘流程不抛异常');

// 各类问题类型都能走完（曾因 genAdvice 裸用 lessons 必崩）
console.log('\n── 问题类型遍历');
const QT = ctx.DLR.QTYPES;
const keys = Object.keys(QT || {});
let bad = 0;
for (const k of keys) {
  const txt = (QT[k].l || '') + '这件事会怎样？';
  preset({ solar: false, q: txt });
  try { DLR.divine(); }
  catch (e) { bad++; console.log(`  ✗ ${k}（${txt}）：${e.message}`); }
}
ok(bad === 0, `${keys.length} 类问题全部走完起课流程无异常`, `${bad} 类抛错`);

console.log('\n' + '='.repeat(52));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('\n失败项需修复'); process.exit(1); }
console.log('冒烟通过 ✔');
