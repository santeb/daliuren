/**
 * 吉凶层参数敏感性分析
 * 目的：回答「天将分值」与「各维度权重」这两组自定数字，究竟在多大程度上主导结论。
 *
 * 用法：node tools/sensitivity.js
 *       Windows 控制台默认 GBK，中文输出会乱码；请以 UTF-8 读 tools/sensitivity_out.txt。
 *
 * 方法：
 *  A. 方差/协方差贡献分解：contrib(k) = cov(part_k, total) / var(total)，Σcontrib ≡ 1（恒等式）
 *  B. 源码替换式扰动：直接改 index.html 里 <script> 的文本，跑的仍是页面那份代码路径
 *     - E1 只扰天将分值 sMap
 *     - E2 只扰维度权重（jiang 三传权重 / wx 三传权重 / WX_SCORE 量级）
 *     - E3 全部一起扰
 *     每种 R 次随机扰动，统计五档归类改变率与 score 排序相关（Spearman）
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const OUT = [];

function stub() {
  const f = function () { return stub(); };
  return new Proxy(f, {
    get(t, k) {
      if (k === 'value' || k === 'innerHTML' || k === 'textContent') return '';
      if (k === 'checked') return false;
      if (k === 'length') return 0;
      if (typeof k === 'symbol') return undefined;
      return stub();
    },
    set() { return true; }, apply() { return stub(); }, construct() { return stub(); }
  });
}

const HTML = path.join(__dirname, '..', 'index.html');
const SRC = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

// 原样片段，替换时按此定位（必须与 index.html 完全一致，否则抛错）
const FRAG = {
  sMap: "var sMap={'贵人':3,'青龙':3,'六合':2,'太阴':2,'太常':1,'天后':1,\n            '朱雀':0,'螣蛇':-1,'勾陈':-1,'玄武':-2,'天空':-2,'白虎':-3};",
  jiang: "total+=add('jiang',(sMap[chuJ]||0)*1.2+(sMap[zhongJ]||0)*0.8+(sMap[moJ]||0)*1.0,'十二天将');",
  wx: "total+=add('wx',WX_SCORE[sC]*1.5+WX_SCORE[sZ]*0.8+WX_SCORE[sM]*1.2,'月令旺衰');",
  wxScore: "var WX_SCORE={'旺':2.0,'相':1.2,'休':0.2,'囚':-0.9,'死':-1.8};"
};
for (const k in FRAG) if (SRC.indexOf(FRAG[k]) < 0) { console.error('定位失败: ' + k); process.exit(1); }

function load(src) {
  const ctx = vm.createContext({ document: stub(), window: stub(), console });
  vm.runInContext(src, ctx);
  return ctx.DLR;
}
const DLR0 = load(SRC);

// ─── 样本：2026 全年每月 5/15/25 日 × 12 时辰 = 432 局，事类轮转 ───
const QK = Object.keys(DLR0.QTYPES);
const CASES = [];
{
  let i = 0;
  for (let m = 1; m <= 12; m++) for (const d of [5, 15, 25]) for (let h = 0; h < 12; h++) {
    CASES.push({ y: 2026, m, d, h, qk: QK[i % QK.length] }); i++;
  }
}
const LV = ['大凶', '凶', '平', '吉', '大吉'];

function runAll(D) {
  const rows = [];
  for (const c of CASES) {
    const r = D.calc(c.y, c.m, c.d, c.h);
    // 注意：QTYPES[k] 只有 {kw,l}，没有 key 字段；key 是 detectQ() 补上的。
    // 直接传 QTYPES[k] 会让 fortune 静默跳过用神与事类两项（σ=0）。
    const q = { key: c.qk, l: D.QTYPES[c.qk].l };
    const ft = D.fortune(r, q);
    const parts = {};
    let sum = 0;
    for (const p of ft.parts) { parts[p.k] = p.v; sum += p.v; }
    rows.push({ score: ft.score, level: ft.level, parts, sum });
  }
  return rows;
}

// ─── A. 贡献度分解：cov(part_k, total)/var(total)，总和恒为 1 ───
const base = runAll(DLR0);
const keys = ['jiang', 'wx', 'shengke', 'gan', 'kong', 'yongshen', 'qtype', 'keti'];
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function cov(a, b) { const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / a.length; }

const tot = base.map(r => r.sum);
const vT = cov(tot, tot);
OUT.push('══ A. 各维度对总分的贡献度（432 局，cov 分解，合计恒为 100%）══');
const contrib = {};
for (const k of keys) {
  const a = base.map(r => r.parts[k] === undefined ? 0 : r.parts[k]);
  contrib[k] = cov(a, tot) / vT;
  OUT.push('  ' + k.padEnd(9) + (contrib[k] * 100).toFixed(1).padStart(6) + '%   分值标准差 σ=' + Math.sqrt(cov(a, a)).toFixed(2));
}
OUT.push('  合计      ' + (Object.values(contrib).reduce((x, y) => x + y, 0) * 100).toFixed(1) + '%');

// ─── B. 扰动 ───
function rnd(d) { return (Math.random() * 2 - 1) * d; }
// 乘性+加性混合，保证 0 值项（朱雀）也能被扰动
function jitter(v, d, range) { return v * (1 + rnd(d)) + rnd(d) * range * 0.35; }

function mkSMap(d) {
  const m = { '贵人': 3, '青龙': 3, '六合': 2, '太阴': 2, '太常': 1, '天后': 1, '朱雀': 0, '螣蛇': -1, '勾陈': -1, '玄武': -2, '天空': -2, '白虎': -3 };
  const e = Object.keys(m).map(k => "'" + k + "':" + (d ? Math.round(jitter(m[k], d, 3) * 100) / 100 : m[k]));
  return "var sMap={" + e.slice(0, 6).join(',') + ",\n            " + e.slice(6).join(',') + "};";
}
function mkWxScore(d) {
  const m = { '旺': 2.0, '相': 1.2, '休': 0.2, '囚': -0.9, '死': -1.8 };
  const e = Object.keys(m).map(k => "'" + k + "':" + (d ? Math.round(jitter(m[k], d, 2) * 100) / 100 : m[k]));
  return "var WX_SCORE={" + e.join(',') + "};";
}
function mkW(d, a, b, c) {
  const f = (x) => d ? Math.round(jitter(x, d, 1.5) * 100) / 100 : x;
  return "total+=add('jiang',(sMap[chuJ]||0)*" + f(a) + "+(sMap[zhongJ]||0)*" + f(b) + "+(sMap[moJ]||0)*" + f(c) + ",'十二天将');";
}
function mkWw(d, a, b, c) {
  const f = (x) => d ? Math.round(jitter(x, d, 1.5) * 100) / 100 : x;
  return "total+=add('wx',WX_SCORE[sC]*" + f(a) + "+WX_SCORE[sZ]*" + f(b) + "+WX_SCORE[sM]*" + f(c) + ",'月令旺衰');";
}

function variant(opts) {
  let s = SRC;
  if (opts.sMap !== undefined) s = s.replace(FRAG.sMap, mkSMap(opts.sMap));
  if (opts.wxScore !== undefined) s = s.replace(FRAG.wxScore, mkWxScore(opts.wxScore));
  if (opts.jw !== undefined) s = s.replace(FRAG.jiang, mkW(opts.jw, 1.2, 0.8, 1.0));
  if (opts.xw !== undefined) s = s.replace(FRAG.wx, mkWw(opts.xw, 1.5, 0.8, 1.2));
  return s;
}

function spearman(a, b) {
  const rk = (x) => { const idx = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(x.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let t = i; t <= j; t++) r[idx[t][1]] = avg; i = j + 1; } return r; };
  const ra = rk(a), rb = rk(b);
  const n = a.length; let sxy = 0, sxx = 0, syy = 0;
  const ma = mean(ra), mb = mean(rb);
  for (let i = 0; i < n; i++) { const dx = ra[i] - ma, dy = rb[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}

const R = 30;
const baseLv = base.map(r => r.level);
const baseSc = base.map(r => r.score);

OUT.push('');
OUT.push('══ B. 参数扰动 → 结论稳定性（每组 ' + R + ' 次随机扰动 × 432 局）══');
const EXP = [
  ['E1 只扰天将分值 sMap', (d) => ({ sMap: d })],
  ['E2 只扰维度权重(jiang/wx 权重 + 旺衰量级)', (d) => ({ jw: d, xw: d, wxScore: d })],
  ['E3 天将分值 + 权重一起扰', (d) => ({ sMap: d, jw: d, xw: d, wxScore: d })]
];
for (const [name, mk] of EXP) {
  for (const d of [0.2, 0.5]) {
    let chg = 0, chg2 = 0, sp = 0, n = 0;
    for (let t = 0; t < R; t++) {
      const rows = runAll(load(variant(mk(d))));
      let c = 0, c2 = 0;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].level !== baseLv[i]) { c++; if (Math.abs(LV.indexOf(rows[i].level) - LV.indexOf(baseLv[i])) >= 2) c2++; }
      }
      chg += c / rows.length; chg2 += c2 / rows.length;
      sp += spearman(rows.map(r => r.score), baseSc); n++;
    }
    OUT.push('  ' + name.padEnd(38) + '±' + (d * 100) + '%');
    OUT.push('      五档归类改变率 ' + (chg / n * 100).toFixed(1) + '%   跨两档以上 ' + (chg2 / n * 100).toFixed(1) + '%   score 排序相关 ρ=' + (sp / n).toFixed(3));
  }
}

// ─── C. 极端检验：把天将分值全部清零 / 全部等权，看还剩多少判别力 ───
OUT.push('');
OUT.push('══ C. 极端对照：删掉天将这一维，结论会塌掉吗 ══');
{
  const flat = "var sMap={'贵人':0,'青龙':0,'六合':0,'太阴':0,'太常':0,'天后':0,'朱雀':0,'螣蛇':0,'勾陈':0,'玄武':0,'天空':0,'白虎':0};";
  const rows = runAll(load(SRC.replace(FRAG.sMap, flat)));
  let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].level !== baseLv[i]) c++;
  OUT.push('  天将全部置 0（整个维度删除）→ 归类改变率 ' + (c / rows.length * 100).toFixed(1) + '%   ρ=' + spearman(rows.map(r => r.score), baseSc).toFixed(3));
}
{
  // 天将吉凶次序完全颠倒：最吉的贵人青龙给 -3，最凶的白虎给 +3
  const rev = "var sMap={'贵人':-3,'青龙':-3,'六合':-2,'太阴':-2,'太常':-1,'天后':-1,'朱雀':0,'螣蛇':1,'勾陈':1,'玄武':2,'天空':2,'白虎':3};";
  const rows = runAll(load(SRC.replace(FRAG.sMap, rev)));
  let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].level !== baseLv[i]) c++;
  OUT.push('  天将吉凶首尾颠倒（贵人-3 / 白虎+3）→ 归类改变率 ' + (c / rows.length * 100).toFixed(1) + '%   ρ=' + spearman(rows.map(r => r.score), baseSc).toFixed(3));
}

// ─── D. 若把天将权重砍半（jiang 1.2/0.8/1.0 → 0.6/0.4/0.5）会怎样 ───
OUT.push('');
OUT.push('══ D. 对照：天将权重砍半后，结论会变多少 ══');
{
  const half = "total+=add('jiang',(sMap[chuJ]||0)*0.6+(sMap[zhongJ]||0)*0.4+(sMap[moJ]||0)*0.5,'十二天将');";
  const D2 = load(SRC.replace(FRAG.jiang, half));
  const rows = runAll(D2);
  let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].level !== baseLv[i]) c++;
  OUT.push('  天将权重 ×0.5 → 归类改变率 ' + (c / rows.length * 100).toFixed(1) + '%   ρ=' + spearman(rows.map(r => r.score), baseSc).toFixed(3));
  // 降权后重新校准阈值，看是否还能维持纺锤形
  const sc = rows.map(r => r.score).sort((a, b) => a - b);
  const q = (p) => sc[Math.floor(sc.length * p)];
  OUT.push('  降权后 score 分位 P8/P30/P70/P92 = ' + q(0.08).toFixed(1) + ' / ' + q(0.30).toFixed(1) + ' / ' + q(0.70).toFixed(1) + ' / ' + q(0.92).toFixed(1));
  OUT.push('  （原阈值 ' + DLR0.FT_TH.dj + ' / ' + DLR0.FT_TH.j + ' / ' + DLR0.FT_TH.p + ' / ' + DLR0.FT_TH.x + ' —— 若分位整体下移，说明阈值需随权重一起重校）');
}

fs.writeFileSync(path.join(__dirname, 'sensitivity_out.txt'), OUT.join('\n'), 'utf8');
console.log(OUT.join('\n'));
