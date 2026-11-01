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
  // ⚠️ 2026-11-01 线 B：sMap 从 fortune() 内提到模块级并改名 JIANGS_SCORE（类神层也要用同一张表）。
  //    片段文本必须随之更新，否则 replace 静默返回原文、整张扰动结果表跑的都是基线（见下方 assertChanged）。
  sMap: "var JIANGS_SCORE={'贵人':3,'青龙':3,'六合':2,'太阴':2,'太常':1,'天后':1,\n                  '朱雀':0,'螣蛇':-1,'勾陈':-1,'玄武':-2,'天空':-2,'白虎':-3};",
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
// 线 B 起多了三个：⑨leishen（类神定性·主线）、⑩shensha（神煞类象）、⑫capadj（其余各维的限幅差额）。
// capadj 恒与 rest 各维负相关，是「限幅正在起作用」的直接证据，不是维度重复。
const keys = ['leishen', 'shensha', 'capadj', 'jiang', 'wx', 'shengke', 'gan', 'kong', 'yongshen', 'qtype', 'keti'];
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function cov(a, b) { const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / a.length; }
function sdv(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); }

// ⚠️ 样本量教训（2026-11-01 实测）：贡献度是「小量」，用几百局估不稳。
//    曾用 432 局（每月 5/15/25 × 12 时辰）估出 keti=1.2%，全样本 43800 局实为 4.3%；
//    换六组日期得到的 keti 分别是 1.2 / 5.9 / 3.7 / 4.4 / 3.0 / 4.7%——那 1.2% 是六组里最低的一组，
//    纯属欠采样。越小的维度相对误差越大（bootstrap ±：kong 36% / gan 26% / keti 20% / qtype 15%，
//    而 jiang 只有 5%）。所以贡献度一律用全样本估，并附 bootstrap 95% 区间。
const FULL_ROWS = [];
{
  const dt0 = Date.now();
  for (let i = 0; i < 365; i++) {
    const dt = new Date(2026, 0, 1 + i);
    for (let h = 0; h < 12; h++) {
      const r = DLR0.calc(dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), h);
      for (const qk of QK) {
        const ft = DLR0.fortune(r, { key: qk, l: DLR0.QTYPES[qk].l });
        const row = { score: ft.score, sum: 0 };
        for (const p of ft.parts) { row[p.k] = p.v; row.sum += p.v; }
        FULL_ROWS.push(row);
      }
    }
  }
  OUT.push('（全样本 ' + FULL_ROWS.length + ' 局，耗时 ' + ((Date.now() - dt0) / 1000).toFixed(1) + 's）');
}
function contribOf(rows, field) {
  const tot = rows.map(r => r[field]), vT = cov(tot, tot);
  const o = {};
  for (const k of keys) o[k] = cov(rows.map(r => r[k] === undefined ? 0 : r[k]), tot) / vT;
  return o;
}
const contrib = contribOf(FULL_ROWS, 'sum');

// bootstrap：重复随机抽 200 组（每组 432 局，与扰动实验同规模），给出各维贡献度的抽样区间
const BOOT = {}; for (const k of keys) BOOT[k] = [];
{
  let seed = 20261101;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let b = 0; b < 200; b++) {
    const s = [];
    for (let i = 0; i < 432; i++) s.push(FULL_ROWS[Math.floor(rnd() * FULL_ROWS.length)]);
    const c = contribOf(s, 'sum');
    for (const k of keys) BOOT[k].push(c[k]);
  }
}
OUT.push('══ A. 各维度对总分的贡献度（全样本 cov 分解，合计恒为 100%）══');
OUT.push('  注：附 bootstrap 95% 区间（按 432 局重抽 200 次），区间宽 = 该维估计本身不稳，别只看点估计');
for (const k of keys) {
  const s = BOOT[k].slice().sort((a, b) => a - b);
  const lo = s[Math.floor(200 * 0.025)], hi = s[Math.floor(200 * 0.975)];
  const a = FULL_ROWS.map(r => r[k] === undefined ? 0 : r[k]);
  OUT.push('  ' + k.padEnd(9) + (contrib[k] * 100).toFixed(1).padStart(6) + '%' +
    '   σ=' + sdv(a).toFixed(2) +
    '   95%区间[' + (lo * 100).toFixed(1) + '%, ' + (hi * 100).toFixed(1) + '%]' +
    '   相对误差±' + (sdv(BOOT[k]) / Math.abs(contrib[k]) * 100).toFixed(0) + '%');
}
OUT.push('  合计      ' + (Object.values(contrib).reduce((x, y) => x + y, 0) * 100).toFixed(1) + '%');
OUT.push('');
OUT.push('  σ 是怎么来的：σ_dim ≈ σ(分值表) × ||权重向量|| —— 即分值表内离散度乘权重模，');
OUT.push('  再经样本中各状态的实际出现频率修正。sMap σ=1.963、天将权重模=1.755 → 预测 3.45，实测 3.32。');
OUT.push('  所以 σ 不是拟合出来的，是「分值表 + 权重」这两个自定输入的下游结果。');

// ─── A2. 系统抽样稳健性：bootstrap 只覆盖「随机抽样」的误差，覆盖不了「每月固定几天」这类
//         系统抽样的结构偏差。而 1.2% 那个错误正是后者。故保留多日期组对照。───
OUT.push('');
OUT.push('══ A2. 换日期组的稳健性（每组 12 月 × 3 天 × 12 时辰 = 432 局，事类轮转）══');
OUT.push('  用途：检验结论是否依赖某一组特定日期。bootstrap 只反映随机抽样误差，');
OUT.push('        查不出系统抽样的结构偏差——keti 被误报为 1.2% 就是这么来的。');
{
  const groups = [[5, 15, 25], [1, 11, 21], [8, 18, 28], [2, 12, 22], [7, 17, 27], [3, 13, 23]];
  const res = [];
  for (const days of groups) {
    const S = []; let i = 0;
    for (let m = 1; m <= 12; m++) for (const d of days) for (let h = 0; h < 12; h++) {
      const r = DLR0.calc(2026, m, d, h);
      const qk = QK[i % QK.length]; i++;
      const ft = DLR0.fortune(r, { key: qk, l: DLR0.QTYPES[qk].l });
      const row = { score: ft.score, sum: 0 };
      for (const p of ft.parts) { row[p.k] = p.v; row.sum += p.v; }
      S.push(row);
    }
    res.push({ days: days.join('/'), c: contribOf(S, 'sum') });
  }
  OUT.push('  ' + '日期组'.padEnd(12) + keys.map(k => k.padStart(9)).join(''));
  for (const g of res) OUT.push('  ' + g.days.padEnd(12) + keys.map(k => ((g.c[k] * 100).toFixed(1) + '%').padStart(9)).join(''));
  OUT.push('  ' + '全样本'.padEnd(12) + keys.map(k => ((contrib[k] * 100).toFixed(1) + '%').padStart(9)).join(''));
  for (const k of keys) {
    const vs = res.map(g => g.c[k] * 100);
    const spread = Math.max(...vs) - Math.min(...vs);
    if (spread > 3) OUT.push('  ⚠ ' + k + '：六组间极差 ' + spread.toFixed(1) + 'pp（' +
      Math.min(...vs).toFixed(1) + '%~' + Math.max(...vs).toFixed(1) + '%）——小样本下该维估计不可信，以全样本为准');
  }
}

// ─── A3. 维度独立性：贡献度按「各维可加」分解，但若两维在算同一件事（同源），
//         份额会被拆成两笔记账，掩盖真正的主导维度。ρ 明显偏离 0 就是信号。───
OUT.push('');
OUT.push('══ A3. 维度独立性：相关性矩阵 ρ（全样本）══');
OUT.push('  用途：ρ 明显偏离 0 = 两个维度在算同一件事。阈值 |ρ| > 0.25 视为同源嫌疑。');
{
  const corr = (a, b) => cov(a, b) / (sdv(a) * sdv(b));
  const V = {}; for (const k of keys) V[k] = FULL_ROWS.map(r => r[k] === undefined ? 0 : r[k]);
  OUT.push('       ' + keys.map(k => k.slice(0, 6).padStart(8)).join(''));
  for (const a of keys) OUT.push('    ' + a.slice(0, 6).padEnd(7) + keys.map(b => corr(V[a], V[b]).toFixed(2).padStart(8)).join(''));
  let warned = 0;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const r = corr(V[keys[i]], V[keys[j]]);
    if (Math.abs(r) > 0.25) { OUT.push('  ⚠ ρ(' + keys[i] + ',' + keys[j] + ')=' + r.toFixed(2) + ' —— 同源嫌疑'); warned++; }
  }
  if (!warned) OUT.push('  （无 |ρ|>0.25 的组合）');
  // ⚠️ capadj 与各维的强负相关是**设计使然**，不是维度重复，别当 bug 查：
  //    capadj = 限幅后 − 限幅前 = LS_CAP·tanh(rest/LS_CAP) − rest，rest 越大被削得越多，
  //    故必然与 rest 各组成维负相关。ρ(capadj,jiang)=−0.64 只是因为 jiang 是 rest 的最大分量。
  //    它不是新维度，而是「其余各维被限幅掉的那部分」——记账项，用来维持 Σparts ≡ total。
  //    要看限幅后的净话语权，看 leishen 那一行的份额即可（全样本 54.9%）。
  // 已知案例：qtype 的 qScore 直接查初/末传天将（源码 ⑦ 事类加成），与①天将同源
  const jq = FULL_ROWS.map(r => (r.jiang || 0) + (r.qtype || 0));
  const tot = FULL_ROWS.map(r => r.sum), vT = cov(tot, tot);
  OUT.push('  已知案例：qtype 的 qScore 直接查初/末传天将（源码 ⑦ 事类加成），与①同源。');
  OUT.push('    合并为「天将系」(jiang+qtype)：' + (cov(jq, tot) / vT * 100).toFixed(1) +
    '%（= jiang ' + (contrib.jiang * 100).toFixed(1) + '% + qtype ' + (contrib.qtype * 100).toFixed(1) + '%）');
  OUT.push('    → 天将的真实话语权高于单独看 jiang 的 ' + (contrib.jiang * 100).toFixed(1) + '%。');
  OUT.push('    当初的「降权」只缩量级、没解掉同源。要提升其他维度话语权应先解重复，');
  OUT.push('    光调权重无效——Σ份额≡100%，调权重是零和，只是把拍数换个地方拍。');
}

// ─── B. 扰动 ───
function rnd(d) { return (Math.random() * 2 - 1) * d; }
// 乘性+加性混合，保证 0 值项（朱雀）也能被扰动
function jitter(v, d, range) { return v * (1 + rnd(d)) + rnd(d) * range * 0.35; }

function mkSMap(d) {
  const m = { '贵人': 3, '青龙': 3, '六合': 2, '太阴': 2, '太常': 1, '天后': 1, '朱雀': 0, '螣蛇': -1, '勾陈': -1, '玄武': -2, '天空': -2, '白虎': -3 };
  const e = Object.keys(m).map(k => "'" + k + "':" + (d ? Math.round(jitter(m[k], d, 3) * 100) / 100 : m[k]));
  return "var JIANGS_SCORE={" + e.slice(0, 6).join(',') + ",\n                  " + e.slice(6).join(',') + "};";
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
  // ⚠️ String.replace 在正则/字符串不匹配时**静默返回原文**，不报错不提示 ——
  //    结果就是「以为跑了 N 个变体，其实每一行跑的都是基线」，整张结果表是假的。
  //    2026-11-01 就踩过一次：sMap 改名后片段失配，B/C/D 三段全是基线却毫无征兆。
  //    故每次替换都必须断言「文本确实变了」（d=0 时新文本等于原文本，属合法的无变化）。
  const rep = (tag, frag, nxt) => {
    const before = s;
    s = s.replace(frag, nxt);
    if (s === before && frag !== nxt)
      throw new Error('片段替换失败，源码文本可能已变：' + tag);
  };
  if (opts.sMap !== undefined) rep('sMap', FRAG.sMap, mkSMap(opts.sMap));
  if (opts.wxScore !== undefined) rep('wxScore', FRAG.wxScore, mkWxScore(opts.wxScore));
  if (opts.jw !== undefined) rep('jiang权重', FRAG.jiang, mkW(opts.jw, 1.2, 0.8, 1.0));
  if (opts.xw !== undefined) rep('wx权重', FRAG.wx, mkWw(opts.xw, 1.5, 0.8, 1.2));
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
  // ⚠️ 必须与 FRAG.sMap 同格式（var JIANGS_SCORE + 第二行 18 空格缩进）。写成旧格式 var sMap= 会把
  //    JIANGS_SCORE 声明整个改名成 sMap，后面类神层引用它时 ReferenceError（2026-11-01 实际踩到）。
  const flat = "var JIANGS_SCORE={'贵人':0,'青龙':0,'六合':0,'太阴':0,'太常':0,'天后':0,\n                  '朱雀':0,'螣蛇':0,'勾陈':0,'玄武':0,'天空':0,'白虎':0};";
  const rows = runAll(load(SRC.replace(FRAG.sMap, flat)));
  let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].level !== baseLv[i]) c++;
  OUT.push('  天将全部置 0（整个维度删除）→ 归类改变率 ' + (c / rows.length * 100).toFixed(1) + '%   ρ=' + spearman(rows.map(r => r.score), baseSc).toFixed(3));
}
{
  // 天将吉凶次序完全颠倒：最吉的贵人青龙给 -3，最凶的白虎给 +3
  const rev = "var JIANGS_SCORE={'贵人':-3,'青龙':-3,'六合':-2,'太阴':-2,'太常':-1,'天后':-1,\n                  '朱雀':0,'螣蛇':1,'勾陈':1,'玄武':2,'天空':2,'白虎':3};";
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
