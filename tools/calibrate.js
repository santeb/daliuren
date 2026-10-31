/**
 * FT_TH 五档阈值重校 + 各维度量级体检
 *
 * 用法：node tools/calibrate.js   （输出写 tools/calibrate_out.txt，UTF-8）
 *
 * ⚠️ 任何时候改动以下东西，都必须重跑本脚本并用输出的建议值更新 index.html 里的 FT_TH，
 *    否则五档比例会漂（实测天将权重砍半即令 score 分位整体下移 P92 8.2→7.0）：
 *      · sMap（天将分值）
 *      · WX_SCORE（旺相休囚死量级）
 *      · fortune 内任一维度的权重系数（1.2/0.8/1.0、1.5/0.8/1.2 等）
 *      · KT_SCORE / LQ5（课体格分值）
 *      · 新增或删除维度
 *    阈值取的是全样本 score 的 P8/P30/P70/P92，目标是纺锤形 8/22/40/22/8。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');

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
const ctx = vm.createContext({ document: stub(), window: stub(), console });
vm.runInContext(SRC, ctx);
const D = ctx.DLR;
const OUT = [];

const QK = Object.keys(D.QTYPES);
const scores = [];
const partSum = {}, partSq = {}, ktCount = {};
let n = 0;

for (let i = 0; i < 365; i++) {
  const dt = new Date(2026, 0, 1 + i);
  for (let h = 0; h < 12; h++) {
    const r = D.calc(dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), h);
    for (const qk of QK) {
      // ⚠️ 必须传 {key,l}：QTYPES[k] 只有 {kw,l}，没有 key，会让用神+事类两维静默丢分
      const ft = D.fortune(r, { key: qk, l: D.QTYPES[qk].l });
      scores.push(ft.score);
      for (const p of ft.parts) {
        partSum[p.k] = (partSum[p.k] || 0) + p.v;
        partSq[p.k] = (partSq[p.k] || 0) + p.v * p.v;
      }
      if (ft.keti) for (const k of ft.keti) ktCount[k.name] = (ktCount[k.name] || 0) + 1;
      n++;
    }
  }
}
scores.sort((a, b) => a - b);
const q = (p) => scores[Math.floor(scores.length * p)];

OUT.push('样本 ' + n + ' 局');
OUT.push('score 分位：P5=' + q(0.05).toFixed(2) + ' P8=' + q(0.08).toFixed(2) + ' P30=' + q(0.30).toFixed(2) +
  ' P50=' + q(0.50).toFixed(2) + ' P70=' + q(0.70).toFixed(2) + ' P92=' + q(0.92).toFixed(2) + ' P95=' + q(0.95).toFixed(2));
OUT.push('');
OUT.push('建议 FT_TH = {dj:' + q(0.92).toFixed(1) + ', j:' + q(0.70).toFixed(1) +
  ', p:' + q(0.30).toFixed(1) + ', x:' + q(0.08).toFixed(1) + '}');
OUT.push('（当前 index.html 中的值：' + JSON.stringify(D.FT_TH) + '）');

const mean = {};
for (const k in partSum) mean[k] = partSum[k] / n;
const keys = ['jiang', 'wx', 'shengke', 'gan', 'kong', 'yongshen', 'qtype', 'keti'];
OUT.push('');
OUT.push('各维度均值与 σ（σ 大体决定该维话语权；精确贡献度见 tools/sensitivity.js 的 cov 分解）：');
for (const k of keys) {
  const v = (partSq[k] || 0) / n - (mean[k] || 0) * (mean[k] || 0);
  OUT.push('  ' + k.padEnd(9) + ' 均值 ' + (mean[k] || 0).toFixed(2).padStart(6) + '   σ=' + Math.sqrt(Math.max(v, 0)).toFixed(2));
}

OUT.push('');
OUT.push('课体命中次数（' + n + ' 局，一局可命中多格）：');
const ks = Object.keys(ktCount).sort((a, b) => ktCount[b] - ktCount[a]);
for (const k of ks) OUT.push('  ' + k.padEnd(8) + String(ktCount[k]).padStart(7) + '   ' + (ktCount[k] / n * 100).toFixed(2) + '%');

fs.writeFileSync(path.join(__dirname, 'calibrate_out.txt'), OUT.join('\n'), 'utf8');
console.log(OUT.join('\n'));
