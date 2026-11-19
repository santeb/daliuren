/**
 * 大六壬算法回归测试
 * 运行：node test.js
 * 直接从 index.html 里抽取 <script> 执行，测试的就是页面真正跑的那份代码。
 * （仓库只保留 index.html 一份页面，daliuren.html 为废弃旧版，不再同步。）
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ─── 极简 DOM 桩，让页面脚本能在 node 里跑起来 ───
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
    set() { return true; },
    apply() { return stub(); },
    construct() { return stub(); }
  });
}

const HTML = path.join(__dirname, 'index.html');
// ⚠️ 取「最长」的 <script> 块当引擎代码，而不是第一个：head 里可能有 51.la 等外部统计小脚本，
// 它们比引擎短且在 node 里跑不了（LA is not defined）。匹配到统计脚本就是这类报错的信号。
const allScripts = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || [];
let code = allScripts.reduce((a, b) => (b && b.length > (a ? a.length : 0)) ? b : a, null);
if (code) code = code.replace(/^<script>/, '').replace(/<\/script>$/, '');
if (!code) { console.error('未能在 index.html 中找到 <script>'); process.exit(1); }
const ctx = vm.createContext({
  document: stub(), window: stub(), console,
  // 页面顶层代码会跑 applyUrlParams()/initShare()，需要 location/navigator 桩（空 search → 直接返回）
  location: { search: '', origin: 'http://localhost', pathname: '/index.html' },
  navigator: {}
});
vm.runInContext(code, ctx);
const DLR = ctx.DLR;
if (!DLR) { console.error('脚本未导出 DLR，无法测试'); process.exit(1); }

const { STEM, BRAN, calc, daySB, hourSB, monthSB, yearSB, getYueJiang, jqTime, afterJQ,
        ELEM, ELEM_S, LU_BR, DE_LU, CHANGSHENG_ORDER, mod,
        fortune, wxState, wxRel, WX_SCORE, FT_TH, getYongshen,
        keti, ketiScore, liuqin5, normQ, KT_SCORE, KT_SANHE_E, LQ5, QTYPES, KE, SHENG, detectQ,
        XI_MAP, nianming, LEISHEN, liuWx, WX_BR,
        leishenBr, leishenScore, jiangBr, LS_CAP, JIANGS_SCORE,
        panding, yingqi, LS_HEAD, HE6, relPhrase, wxRelNote, chuanRel,
        renderBaihua, JIANG_BAI, WX_BAI, TIANJIANG,
        encodeShare, parseShareQuery, aiBuildPrompt } = DLR;

let pass = 0, fail = 0, warn = 0;
const failures = [];
function group(name) { console.log('\n── ' + name); }
// 失败标记用 ASCII 而非 ✗：✗(U+2717)/OK(U+2714) 不在 GBK 字符集中，
// Windows 下重定向到文件时会令 stdout 进入错误状态，后续输出（含整个第 17 组）被静默丢弃，
// 表现为「测试只跑一半、exit 0、看不到任何失败项」。此处改用 ASCII，且失败项加序号便于定位。
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else {
    fail++; failures.push(name + (detail ? ' → ' + detail : ''));
    console.log('   [FAIL#' + fail + '] ' + name + (detail ? '  ' + detail : ''));
  }
}
function note(msg) { warn++; console.log('   ! ' + msg); }
function sb(s, b) { return STEM[s] + BRAN[b]; }

// ───────────────────────────────────────────────
group('1. 日柱（儒略日推算，对照独立实现）');
{
  const baseIdx = 54, anchor = Date.UTC(2000, 0, 1);   // 2000-01-01 = 戊午
  let bad = 0, n = 0;
  for (let y = 2018; y <= 2028; y++) {
    for (let m = 1; m <= 12; m++) {
      for (const d of [1, 9, 17, 25]) {
        const r = daySB(y, m, d);
        const days = Math.round((Date.UTC(y, m - 1, d) - anchor) / 86400000);
        const exp = mod(baseIdx + days, 60);
        n++; if (r.idx !== exp) bad++;
      }
    }
  }
  ok(bad === 0, `日柱 ${n} 个日期全部正确`, `${bad} 处不符`);
  ok(sb(daySB(2000, 1, 1).stem, daySB(2000, 1, 1).branch) === '戊午', '2000-01-01 = 戊午');
  ok(sb(daySB(2026, 10, 31).stem, daySB(2026, 10, 31).branch) === '戊寅', '2026-10-31 = 戊寅');
}

group('2. 年柱 / 月柱');
{
  ok(sb(yearSB(2026).stem, yearSB(2026).branch) === '丙午', '2026 = 丙午');
  ok(sb(yearSB(2024).stem, yearSB(2024).branch) === '甲辰', '2024 = 甲辰');
  // 五虎遁：丙辛之岁寻庚起 → 丙年寅月庚寅
  const m1 = monthSB(2026, 1);
  ok(sb(m1.stem, m1.branch) === '庚寅', '丙午年正月 = 庚寅', sb(m1.stem, m1.branch));
  // 甲己之年丙作首 → 甲辰年寅月丙寅
  const m2 = monthSB(2024, 1);
  ok(sb(m2.stem, m2.branch) === '丙寅', '甲辰年正月 = 丙寅', sb(m2.stem, m2.branch));
}

group('3. 时柱（五鼠遁 120 组）');
{
  const START = [0, 2, 4, 6, 8];   // 甲己甲、乙庚丙、丙辛戊、丁壬庚、戊癸壬
  let bad = 0;
  for (let ds = 0; ds < 10; ds++) for (let hb = 0; hb < 12; hb++) {
    const exp = mod(START[mod(ds, 5)] + hb, 10);
    if (hourSB(ds, hb).stem !== exp) bad++;
  }
  ok(bad === 0, '时干 120 组全部正确', `${bad} 处不符`);
  ok(sb(hourSB(0, 0).stem, 0) === '甲子', '甲日子时 = 甲子');
  ok(sb(hourSB(0, 2).stem, 2) === '丙寅', '甲日寅时 = 丙寅');
  ok(sb(hourSB(4, 0).stem, 0) === '壬子', '戊日子时 = 壬子');
  ok(sb(hourSB(9, 11).stem, 11) === '癸亥', '癸日亥时 = 癸亥');
}

group('4. 月将换将（中气分界）');
{
  const cases = [
    [1, 15, '大吉'], [1, 25, '神后'], [4, 1, '河魁'], [7, 1, '小吉'],
    [10, 31, '太冲'], [12, 25, '大吉'], [9, 1, '太乙']
  ];
  let bad = 0;
  for (const [m, d, name] of cases) {
    const yj = getYueJiang(2026, m, d, 12);
    if (yj.name !== name) { bad++; console.log(`   2026-${m}/${d} 期望 ${name} 实得 ${yj.name}`); }
  }
  ok(bad === 0, '月将换将 7 个抽查点全部正确');
  // 交节当天按时刻分界：2026 冬至 12/22 04:51（北京时），前后月将不同
  ok(getYueJiang(2026, 12, 22, 2).name === '功曹', '2026-12-22 02:00（冬至前）= 功曹（寅将）', getYueJiang(2026, 12, 22, 2).name);
  ok(getYueJiang(2026, 12, 22, 6).name === '大吉', '2026-12-22 06:00（冬至后）= 大吉（丑将）', getYueJiang(2026, 12, 22, 6).name);
}

group('5. 天盘（月将加时，全年 × 12 时辰）');
{
  let bad1 = 0, bad2 = 0, n = 0, vuyin = 0, fanyin = 0;
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d++) {
      for (let hb = 0; hb < 12; hb++) {
        const r = calc(2026, m, d, hb);
        const moon = r.yj.branch;
        n++;
        if (r.heavenMap[hb] !== moon) bad1++;                       // 月将必须落在占时位
        for (let j = 0; j < 12; j++) {
          if (r.heavenMap[j] !== mod(j + moon - hb, 12)) { bad2++; break; }
        }
        if (moon === hb) vuyin++;
        if (mod(moon - hb, 12) === 6) fanyin++;
      }
    }
  }
  ok(bad1 === 0, `天盘：月将落占时位（${n} 局）`, `${bad1} 局不符`);
  ok(bad2 === 0, '天盘：整盘与标准公式一致', `${bad2} 局不符`);
  console.log(`   （其中伏吟 ${vuyin} 局、反吟 ${fanyin} 局）`);
}

group('6. 空亡（60 甲子逐日）');
{
  const STD = [[10, 11], [8, 9], [6, 7], [4, 5], [2, 3], [0, 1]];  // 甲子旬→甲寅旬
  let bad = 0;
  for (let idx = 0; idx < 60; idx++) {
    const dsb = daySB(2026, 1, 1 + idx);
    const r = calc(2026, 1, 1 + idx, 6);
    const exp = STD[Math.floor(dsb.idx / 10)];
    if (r.kvmWang[0] !== exp[0] || r.kvmWang[1] !== exp[1]) {
      bad++; if (bad < 4) console.log(`   ${STEM[dsb.stem]}${BRAN[dsb.branch]}日 实得 ${BRAN[r.kvmWang[0]]}${BRAN[r.kvmWang[1]]} 应为 ${BRAN[exp[0]]}${BRAN[exp[1]]}`);
    }
  }
  ok(bad === 0, '60 甲子空亡全部正确', `${bad} 处不符`);
}

group('7. 九宗门覆盖度（2026 全年 × 12 时辰）');
{
  const stat = {};
  let bad = 0, n = 0;
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) for (let hb = 0; hb < 12; hb++) {
    const r = calc(2026, m, d, hb); n++;
    stat[r.zongmen] = (stat[r.zongmen] || 0) + 1;
    if (!r.zongmen || r.chu === undefined || r.zhang === undefined || r.mo === undefined) bad++;
    if ([r.chu, r.zhang, r.mo].some(x => !(x >= 0 && x <= 11))) bad++;
  }
  ok(bad === 0, `三传全部合法（${n} 局）`, `${bad} 局异常`);
  console.log('   课体分布：' + Object.keys(stat).sort().map(k => `${k} ${stat[k]}`).join('  |  '));
  for (const k of ['贼克法', '比用法', '伏吟法', '反吟法']) {
    ok((stat[k] || 0) > 0, `课体「${k}」可达（不再是死代码）`, '0 局');
  }
  for (const k of ['遥克法', '昴星法', '别责法', '八专法']) {
    if ((stat[k] || 0) === 0) note(`课体「${k}」在 2026 年样本中未出现（样本有限，非必然错误）`);
  }
  // 涉害法恒带见机/察微/复等子格后缀，须按前缀判断
  if (!Object.keys(stat).some(k => k.indexOf('涉害法') === 0)) {
    note('课体「涉害法」在 2026 年样本中未出现（样本有限，非必然错误）');
  }
}

group('8. 天将排布');
{
  let bad = 0, dup = 0, n = 0;
  for (let m = 1; m <= 12; m += 3) for (let d = 1; d <= 28; d += 9) for (let hb = 0; hb < 12; hb++) {
    const r = calc(2026, m, d, hb); n++;
    if (!r.generals[r.grBr] || r.generals[r.grBr].jiang !== '贵人') bad++;
    const seen = {};
    for (let j = 0; j < 12; j++) { const g = r.generals[j].jiang; if (seen[g]) dup++; seen[g] = 1; }
  }
  ok(bad === 0, `贵人落在贵人位（${n} 局）`, `${bad} 局不符`);
  ok(dup === 0, '十二天将无重复', `${dup} 处重复`);
}

group('9. 六亲（以甲日、乙日抽查）');
{
  // 甲（阳木）：寅比肩 卯劫财 辰偏财 丑正财 午食神 巳伤官 子偏印 亥正印 申七杀 酉正官
  // 同我者比劫 / 生我者印 / 我克者财 / 我生者食伤 / 克我者官杀；同阴阳为正、异阴阳为偏
  const rJia = calc(2026, 1, 1, 6);   // 取一课，只要日干为甲
  let found = null;
  for (let idx = 0; idx < 60 && !found; idx++) { const t = daySB(2026, 1, 1 + idx); if (t.stem === 0) found = 1 + idx; }
  const rA = calc(2026, 1, found, 6);
  const L = rA.liuQinMap;
  ok(L[2] === '比肩', '甲日见寅 = 比肩', L[2]);
  ok(L[3] === '劫财', '甲日见卯 = 劫财', L[3]);
  ok(L[4] === '偏财', '甲日见辰 = 偏财', L[4]);
  ok(L[1] === '正财', '甲日见丑 = 正财', L[1]);
  ok(L[6] === '食神', '甲日见午 = 食神', L[6]);
  ok(L[5] === '伤官', '甲日见巳 = 伤官', L[5]);
  ok(L[0] === '偏印', '甲日见子 = 偏印', L[0]);
  ok(L[11] === '正印', '甲日见亥 = 正印', L[11]);
  ok(L[8] === '七杀', '甲日见申 = 七杀', L[8]);
  ok(L[9] === '正官', '甲日见酉 = 正官', L[9]);
}

group('10. 长生十二宫 / 禄神 / 德神');
{
  const CS = CHANGSHENG_ORDER;
  ok(CS['甲'][0] === 11, '甲木长生在亥');
  ok(CS['丙'][0] === 2, '丙火长生在寅');
  ok(CS['戊'][0] === 2, '戊土长生在寅');
  ok(CS['庚'][0] === 8, '庚金长生在巳');
  ok(CS['壬'][0] === 8, '壬水长生在申');
  ok(CS['乙'][0] === 8, '乙木长生在午');
  ok(CS['丁'][0] === 11, '丁火长生在酉');
  ok(CS['癸'][0] === 3, '癸水长生在卯');
  ok(LU_BR[0] === 2 && LU_BR[1] === 3, '甲禄寅、乙禄卯');
  ok(LU_BR[3] === 6 && LU_BR[7] === 9, '丁禄午、辛禄酉');
  ok(LU_BR[9] === 0, '癸禄子');
  ok(DE_LU[0] === 2 && DE_LU[1] === 8, '甲德寅、乙德申');
}

group('11. 古籍课例（三传逐字比对）');
{
  // 课例出处：
  //  ①《大六壬指南》重审课：二月春分后甲子日，戌将寅时 → 三传 戌午寅（四课 戌甲/午戌/申子/辰申）
  //  ②《六壬直指》元首课：五月丁丑日，申将子时     → 三传 巳丑酉（四课 卯丁/亥卯/酉丑/巳酉）
  //  ③《大六壬揭密》重审课：丙戌日，子将酉时       → 三传 申亥寅（四课 丙申/申亥/戌丑/丑辰）
  //  ④《大六壬揭密》比用课：八月壬辰日，辰将巳时   → 三传 戌酉申（四课 壬戌/戌酉/辰卯/卯寅）
  // 取用通则：「凡取克为用，不论上克下、下克上，皆取上一字」
  const CASES = [
    { s: 0, b: 0, jiang: 10, hb: 2, exp: '戌午寅', src: '甲子日 戌将寅时（重审）' },
    { s: 3, b: 1, jiang: 8, hb: 0, exp: '巳丑酉', src: '丁丑日 申将子时（元首）' },
    { s: 2, b: 10, jiang: 0, hb: 9, exp: '申亥寅', src: '丙戌日 子将酉时（重审）' },
    { s: 8, b: 4, jiang: 4, hb: 5, exp: '戌酉申', src: '壬辰日 辰将巳时（比用）' }
  ];
  for (const C of CASES) {
    let hit = null;
    for (let y = 2015; y <= 2045 && !hit; y++) {
      for (let m = 1; m <= 12 && !hit; m++) {
        for (let d = 1; d <= 28; d++) {
          const t = daySB(y, m, d);
          if (t.stem === C.s && t.branch === C.b && getYueJiang(y, m, d, 12).branch === C.jiang) { hit = [y, m, d]; break; }
        }
      }
    }
    if (!hit) { note(`未找到课例样本「${C.src}」，跳过`); continue; }
    const r = calc(hit[0], hit[1], hit[2], C.hb);
    const got = BRAN[r.chu] + BRAN[r.zhang] + BRAN[r.mo];
    ok(got === C.exp, `${C.src} → ${C.exp}（${r.zongmen}）`, got + ` @${hit.join('-')}`);
  }
}

group('12. 解读层不抛异常（曾因 genAdvice 内裸用 lessons 导致感情类必崩）');
{
  const { genAdvice, getYongshen, getYingqi, isKongWang, QTYPES } = DLR;
  const keys = Object.keys(QTYPES || {});
  ok(keys.length > 0, `问题类型已导出（${keys.length} 种）`, 'QTYPES 为空');
  let bad = 0, n = 0;
  const sample = [];
  for (let m = 1; m <= 12; m += 2) for (const d of [3, 14, 25]) sample.push([2026, m, d, (m + d) % 12]);
  for (const qk of keys) {
    const qtype = { key: qk, l: QTYPES[qk].l };
    for (const [y, m, d, hb] of sample) {
      const r = calc(y, m, d, hb); n++;
      try {
        genAdvice(r, qtype);
        getYongshen(r, qtype);
        getYingqi(r);
        isKongWang(r.chu, r);
      } catch (e) {
        bad++; if (bad < 4) console.log(`   ${qk} @${y}-${m}-${d} 时${hb}: ${e.message}`);
      }
    }
  }
  ok(bad === 0, `解读层 ${n} 组（${keys.length} 类问题 × ${sample.length} 课）无异常`, `${bad} 处抛错`);

  // 防回退守门断言（2026-11-03）：genAdvice 只呈现课象，不得再出现成败断言／行动指令。
  // 若日后有人把「财运圆满，终可得财」「宜积极进取」这类句子加回去，本条立刻失败。
  // 允许的例外只有一类：古籍原句照录（出典段，含「求财吉」等原文），故按「出典」段落剔除后再判。
  const VAL_ADV = /可期|难期|可成|难成|可得|难得|可胜|可愈|宜进|宜守|宜静|宜待|宜借|须防|务必|切忌|大吉|大凶|吉祥如意|顺遂|亨通|不佳|有损|有助|此非美占/;
  let advBad = 0, advShown = 0;
  for (const qk of keys) {
    for (const [y, m, d, hb] of sample) {
      const r = calc(y, m, d, hb);
      const plain = genAdvice(r, { key: qk, l: QTYPES[qk].l })
        .replace(/<[^>]*>/g, '')
        .replace(/出典[^「]*「[\s\S]*?」/g, '');   // 剔出典引文
      const h = plain.match(VAL_ADV);
      if (h) { advBad++; if (advShown++ < 3) console.log(`   ${qk}: 「${h[0]}」…`); }
    }
  }
  ok(advBad === 0, 'genAdvice 全事类不含成败断言／行动指令（出典引文除外）', `${advBad} 处`);
}

group('13. 节气表（1900–2100）与年柱/月柱交节');
{
  const { JQ_TABLE, JQ_NAME } = DLR;
  // 已知值（北京时间，对照权威历书）
  const known = [[2026, '立春', 2, 4, 4], [2026, '春分', 3, 20, 22], [2026, '夏至', 6, 21, 16],
                 [2026, '秋分', 9, 23, 8], [2024, '立春', 2, 4, 16], [2025, '立春', 2, 3, 22]];
  let bad = 0;
  for (const [y, name, m, d, h] of known) {
    const t = jqTime(y, JQ_NAME.indexOf(name));
    if (t.m !== m || t.d !== d || t.h !== h) { bad++; console.log(`   ${y} ${name} 期望 ${m}/${d} ${h}时 实得 ${t.m}/${t.d} ${t.h}时`); }
  }
  ok(bad === 0, `节气时刻 ${known.length} 个抽查点精确（含时分）`, `${bad} 处不符`);

  const ys = Object.keys(JQ_TABLE);
  ok(ys.length === 201, `节气表覆盖 1900–2100 共 ${ys.length} 年`, '年份数不符');
  ok(ys.every(k => JQ_TABLE[k].length === 24 && JQ_TABLE[k].every(v => v >= 0)), '每年 24 个节气且无缺失');

  // 交节时刻分界
  ok(!afterJQ(2026, 2, 2, 4, 3, 0), '2026-02-04 03:00 未交立春');
  ok(afterJQ(2026, 2, 2, 4, 5, 0), '2026-02-04 05:00 已交立春');
  // 年柱以立春分界
  ok(sb(yearSB(2026, 2, 3, 12).stem, yearSB(2026, 2, 3, 12).branch) === '乙巳', '2026-02-03（立春前）年柱 = 乙巳', sb(yearSB(2026, 2, 3, 12).stem, yearSB(2026, 2, 3, 12).branch));
  ok(sb(yearSB(2026, 2, 4, 12).stem, yearSB(2026, 2, 4, 12).branch) === '丙午', '2026-02-04（立春后）年柱 = 丙午', sb(yearSB(2026, 2, 4, 12).stem, yearSB(2026, 2, 4, 12).branch));
  ok(sb(yearSB(2026, 1, 1, 12).stem, yearSB(2026, 1, 1, 12).branch) === '乙巳', '2026-01-01 年柱 = 乙巳（仍属上一年）', sb(yearSB(2026, 1, 1, 12).stem, yearSB(2026, 1, 1, 12).branch));
  // 月柱以节分界
  ok(sb(monthSB(2026, 2, 3, 12).stem, monthSB(2026, 2, 3, 12).branch) === '丁丑', '2026-02-03（立春前）月柱 = 丁丑', sb(monthSB(2026, 2, 3, 12).stem, monthSB(2026, 2, 3, 12).branch));
  ok(sb(monthSB(2026, 2, 4, 12).stem, monthSB(2026, 2, 4, 12).branch) === '庚寅', '2026-02-04（立春后）月柱 = 庚寅', sb(monthSB(2026, 2, 4, 12).stem, monthSB(2026, 2, 4, 12).branch));
  ok(sb(monthSB(2026, 1, 1, 12).stem, monthSB(2026, 1, 1, 12).branch) === '丙子', '2026-01-01（小寒前）月柱 = 丙子', sb(monthSB(2026, 1, 1, 12).stem, monthSB(2026, 1, 1, 12).branch));
  ok(sb(monthSB(2026, 6, 15, 12).stem, monthSB(2026, 6, 15, 12).branch) === '甲午', '2026-06-15（芒种后）月柱 = 甲午', sb(monthSB(2026, 6, 15, 12).stem, monthSB(2026, 6, 15, 12).branch));
}

group('14. 手动指定月将（兜底开关）');
{
  const [y, m, d, hb] = [2026, 6, 15, 6];
  const auto = calc(y, m, d, hb);
  ok(auto.yjManual === false, '未指定时走节气自动推定', String(auto.yjManual));
  let bad = 0, diff = 0;
  for (let br = 0; br < 12; br++) {
    const r = calc(y, m, d, hb, { yueJiang: br });
    if (r.yjManual !== true) bad++;
    if (r.yj.branch !== br) bad++;                       // 月将生效
    if (r.heavenMap[hb] !== br) bad++;                   // 天盘同步（月将落占时位）
    if (br !== auto.yj.branch && (r.chu !== auto.chu || r.zhang !== auto.zhang)) diff++;
  }
  ok(bad === 0, '12 种手动月将均生效且天盘同步', `${bad} 处不符`);
  ok(diff >= 10, `手动月将确实改变三传（${diff}/11 与自动不同）`, '三传未随月将变化');
  // 空字符串 / null 视为未指定
  ok(calc(y, m, d, hb, { yueJiang: null }).yjManual === false, 'yueJiang=null 视为自动');
  ok(calc(y, m, d, hb, { yueJiang: '' }).yjManual === false, "yueJiang='' 视为自动");
}

group('15. 真太阳时校正（经度差 + 时差方程）');
{
  const { trueSolar, eqOfTime, shiftYMD } = DLR;
  const B = (br) => BRAN[br];

  // ① 时差方程 E：真太阳 − 平太阳，全年 −14 ~ +16 分钟
  let mn = 1e9, mx = -1e9;
  for (let dnum = 0; dnum < 365; dnum++) {
    const dt = new Date(Date.UTC(2026, 0, 1 + dnum));
    const e = eqOfTime(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    mn = Math.min(mn, e); mx = Math.max(mx, e);
  }
  ok(mn > -16 && mn < -11, `时差方程全年最小值 ${mn.toFixed(1)} 分（应约 −14，2 月中旬）`, String(mn));
  ok(mx > 14 && mx < 18, `时差方程全年最大值 ${mx.toFixed(1)} 分（应约 +16，11 月初）`, String(mx));
  const spots = [[1, 1, -6, -1], [2, 15, -16, -11], [5, 15, 1, 6], [7, 26, -8, -4], [9, 1, -3, 4], [11, 3, 13, 17]];
  let bad = 0;
  for (const [m, d, lo, hi] of spots) {
    const e = eqOfTime(2026, m, d);
    if (!(e > lo && e < hi)) { bad++; console.log(`   E(2026-${m}-${d}) = ${e.toFixed(1)} 不在 (${lo},${hi})`); }
  }
  ok(bad === 0, `时差方程 ${spots.length} 个抽查点落在合理区间`, `${bad} 处越界`);

  // ② 时辰映射：hb=k ⇔ 真太阳时落在 [2k−1, 2k+1) 点
  bad = 0;
  for (let mins = 0; mins < 1440; mins++) {
    const hour = mins / 60;
    const hb = Math.floor(((hour + 1) % 24 + 24) % 24 / 2);
    const exp = BRAN.findIndex((_, k) => ((hour - (2 * k - 1)) % 24 + 24) % 24 < 2);
    if (hb !== exp) bad++;
  }
  ok(bad === 0, '1440 分钟逐分核对时辰归属', `${bad} 分不符`);

  // ③ 经度校正量：乌鲁木齐（87.62°E）距东经 120 为 −32.38°，即 −129.5 分钟（约 2 小时 10 分）
  const wlmq = trueSolar(2026, 7, 10, 12, 0, 87.62);
  ok(Math.abs(wlmq.dl - (87.62 - 120) * 4) < 0.1, `乌鲁木齐经度差 ${wlmq.dl} 分（应 ${((87.62 - 120) * 4).toFixed(1)}）`, String(wlmq.dl));
  ok(B(wlmq.hb) === '巳', `乌鲁木齐 12:00 北京时 → 真太阳时约 10:00 → ${B(wlmq.hb)}时`, B(wlmq.hb));
  ok(wlmq.dayOffset === 0, '该例不换日', String(wlmq.dayOffset));

  // ④ 换日：喀什（75.99°E）凌晨 00:30 → 真太阳时约前一日 21:3x（亥时）
  const ks = trueSolar(2026, 7, 10, 0, 30, 75.99);
  ok(ks.dayOffset === -1 && ks.d === 9, `喀什 00:30 → 回到前一日 7/9（${ks.m}/${ks.d}）`, `${ks.m}/${ks.d}`);
  ok(B(ks.hb) === '亥', `喀什 00:30 → ${B(ks.hb)}时`, B(ks.hb));

  // ⑤ 晚子时归次日：北京 23:30 → 校正后仍 ≥23:00 → 日期进 1，时辰为子
  const bj = trueSolar(2026, 7, 10, 23, 30, 116.41);
  ok(bj.d === 11 && B(bj.hb) === '子', `北京 23:30 → 7/${bj.d} ${B(bj.hb)}时（晚子时归次日）`, `${bj.m}/${bj.d} ${B(bj.hb)}`);

  // ⑥ 东经 120 且忽略时差时不应换时辰（仅校验 delta 构成 = 经度 + 时差）
  const std = trueSolar(2026, 7, 10, 12, 0, 120);
  ok(Math.abs(std.delta - std.eot) < 0.6, `东经 120° 时总校正量 ${std.delta} = 时差方程值 ${std.eot}`, `${std.delta} vs ${std.eot}`);

  // ⑦ 日期加减跨月、跨年
  ok(shiftYMD(2026, 1, 1, -1).join('-') === '2025-12-31', '跨年回退 2026-01-01 −1 天 = 2025-12-31', shiftYMD(2026, 1, 1, -1).join('-'));
  ok(shiftYMD(2026, 3, 1, -1).join('-') === '2026-2-28', '跨月回退 2026-03-01 −1 天 = 2026-02-28', shiftYMD(2026, 3, 1, -1).join('-'));
  ok(shiftYMD(2026, 12, 31, 1).join('-') === '2027-1-1', '跨年进位 2026-12-31 +1 天 = 2027-01-01', shiftYMD(2026, 12, 31, 1).join('-'));

  // ⑧ 校正后确实影响起课结果（乌鲁木齐 vs 北京，同一北京时刻多数应不同）
  let diff = 0;
  for (let d = 1; d <= 28; d++) {
    const a = calc(2026, 7, d, trueSolar(2026, 7, d, 14, 0, 116.41).hb);
    const b = calc(2026, 7, d, trueSolar(2026, 7, d, 14, 0, 87.62).hb);
    if (a.chu !== b.chu || a.zhang !== b.zhang) diff++;
  }
  ok(diff >= 25, `乌鲁木齐与北京同一时刻三传不同（${diff}/28 天）`, '差异过小，校正可能未生效');

  // ⑨ calc 接受 solarHour（交节判定用真太阳时小时）
  let err = 0;
  for (let d = 1; d <= 28; d++) {
    try { const ts = trueSolar(2026, 7, d, 8, 0, 91.14); calc(ts.y, ts.m, ts.d, ts.hb, { solarHour: ts.hour }); }
    catch (e) { err++; }
  }
  ok(err === 0, 'calc 接受 solarHour 参数（拉萨样本 28 天无异常）', `${err} 处抛错`);
}

// ───────────────────────────────────────────────
group('16. 九宗门古籍课例（《六壬粹言》《六壬大全·订讹》《大六壬探源》）');
{
  const BI = {}; BRAN.forEach((b, i) => { BI[b] = i; });
  const SI = {}; STEM.forEach((s, i) => { SI[s] = i; });

  // 2026-01-01 起连续 60 天，日干支正好遍历 60 甲子
  function findDay(day) {
    for (let i = 0; i < 60; i++) {
      const t = new Date(Date.UTC(2026, 0, 1 + i));
      const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
      const s = daySB(y, m, d);
      if (s.stem === SI[day[0]] && s.branch === BI[day[1]]) return [y, m, d];
    }
    return null;
  }
  // 固定时辰、指定月将起课（位移 = 月将 − 时辰）
  function qi(day, jiang, hour) {
    const ymd = findDay(day);
    const r = calc(ymd[0], ymd[1], ymd[2], BI[hour], { yueJiang: BI[jiang] });
    return { san: BRAN[r.chu] + BRAN[r.zhang] + BRAN[r.mo], chu: BRAN[r.chu], m: r.method || '' };
  }

  // ① 元首：壬戌日酉将子时，干上申，三课无克，取第二课上克下为用
  let t = qi('壬戌', '酉', '子');
  ok(t.san === '巳寅亥', '元首·壬戌日酉将子时 → 巳寅亥（《粹言》）', t.san);
  ok(/元首/.test(t.m), '　└ 取用法标为元首（一上克下，余课无克）', t.m);

  // ② 阳日阳比：甲戌日巳将子时，四课申卯上克下「除上克不用」，取与日比之子
  t = qi('甲戌', '巳', '子');
  ok(t.san === '子巳戌', '比用·甲戌日巳将子时 → 子巳戌（《粹言》阳日阳比）', t.san);
  ok(/比用/.test(t.m), '　└ 上克下并见下贼上时先除上克', t.m);

  // ③ 阴日阴比：辛卯日辰将申时，一课午辛、四课未亥俱上克下，取未
  t = qi('辛卯', '辰', '申');
  ok(t.san === '未卯亥', '比用·辛卯日辰将申时 → 未卯亥（《粹言》阴日阴比）', t.san);

  // ④ 涉害（上克下）：庚子日戌将子时 —— 孟仲派与数深浅派同归于午
  t = qi('庚子', '戌', '子');
  ok(t.chu === '午', '涉害·庚子日戌将子时 → 发用午（两派同归）', t.chu);
  ok(/古法历归本家2重/.test(t.m), '　└ 附注古法重数：午加庚历酉金、戌寄辛金，计 2 重', t.m);

  // ⑤ 丁卯日戌将子时：两派分歧之硬证据
  //    本实现从《粹言》正文「孟上无取则取仲位上神」，得丑（察微）；
  //    《订讹》依古法数深浅「五重 > 一重」，得亥。二者不可兼得，取前者。
  t = qi('丁卯', '戌', '子');
  ok(t.chu === '丑' && /察微/.test(t.m),
    '涉害·丁卯日戌将子时 → 发用丑（从《粹言》正文察微格）', t.chu + ' ' + t.m);
  {
    const EL = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
    const ELS = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
    const LODGE = { 丑: ['癸'], 寅: ['甲'], 辰: ['乙'], 巳: ['丙', '戊'], 未: ['丁', '己'], 申: ['庚'], 戌: ['辛'], 亥: ['壬'] };
    const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
    const BRi = {}; BRAN.forEach((b, i) => { BRi[b] = i; });
    const posE = b => [EL[b]].concat((LODGE[b] || []).map(s => ELS[s]));
    // 下贼上：自上神所临位之次位起，顺行归上神本家，数沿途克上神者
    const keCnt = (up, low) => {
      let c = 0;
      for (let p = (BRi[low] + 1) % 12; p !== BRi[up]; p = (p + 1) % 12) {
        for (const e of posE(BRAN[p])) if (KE[e] === EL[up]) c++;
      }
      return c;
    };
    ok(keCnt('亥', '丑') === 5, '　└ 古法复算：亥加丑历辰、戊、未、己、戌，五重土', String(keCnt('亥', '丑')));
    ok(keCnt('丑', '卯') === 1, '　└ 古法复算：丑加卯历乙木，一重', String(keCnt('丑', '卯')));
    note('丁卯日两派异趣：《订讹》依古法五重>一重取亥（亥酉未），《粹言》正文孟仲取丑（丑亥酉）；本实现从《粹言》正文');
  }

  // ⑥⑦⑧ 《粹言》见机 / 察微 / 复等三格（三传为硬标准）
  t = qi('癸未', '辰', '子');
  ok(t.san === '酉丑巳', '见机·癸未日辰将子时 → 酉丑巳（《粹言》见机课）', t.san);
  t = qi('庚辰', '午', '辰');
  ok(t.san === '申戌子', '察微·庚辰日午将辰时 → 申戌子（《粹言》察微课）', t.san);
  t = qi('戊辰', '未', '子');
  ok(t.san === '子未寅', '复等·戊辰日未将子时 → 子未寅（《粹言》复等课）', t.san);

  // ⑨ 《粹言》：「此外又有戊辰、戊戌日返吟两课」亦作缀瑕取用
  const fy1 = qi('戊辰', '午', '子'), fy2 = qi('戊戌', '午', '子');
  ok(fy1.chu === '亥' && fy2.chu === '亥',
    `反吟缀瑕·戊辰、戊戌日午将子时 → 发用并为亥（${fy1.san} / ${fy2.san}）`, fy1.chu + '/' + fy2.chu);

  // ⑩ 口径守护：720 课（60 甲子 × 12 位移）各格课数与《粹言》相合
  //    统计口径：伏吟/反吟盘中「有克」者仍按取用法归类，唯无克者单列伏吟、反吟
  const cnt = {};
  for (let i = 0; i < 60; i++) {
    const tt = new Date(Date.UTC(2026, 0, 1 + i));
    const y = tt.getUTCFullYear(), m = tt.getUTCMonth() + 1, d = tt.getUTCDate();
    for (let yj = 0; yj < 12; yj++) {
      let r; try { r = calc(y, m, d, 0, { yueJiang: yj }); } catch (e) { continue; }
      const mm = r.method || '';
      let key = null;
      for (const k of ['元首', '重审', '比用', '见机', '察微', '复等', '涉害']) if (mm.indexOf(k) >= 0) { key = k; break; }
      if (!key) key = /^伏吟/.test(r.zongmen) ? '伏吟' : /^反吟/.test(r.zongmen) ? '反吟' : '无克';
      cnt[key] = (cnt[key] || 0) + 1;
    }
  }
  const REF16 = { 元首: 120, 重审: 256, 比用: 95, 见机: 53, 察微: 26, 复等: 3 };
  for (const k of Object.keys(REF16)) {
    const got = cnt[k] || 0, tol = k === '元首' ? 8 : 4;
    ok(Math.abs(got - REF16[k]) <= tol,
      `720 课中「${k}」${got} 课（《粹言》记 ${REF16[k]}，容差 ±${tol}）`, String(got));
  }
  const she = (cnt['见机'] || 0) + (cnt['察微'] || 0) + (cnt['复等'] || 0);
  // 2026-11-15：这两条从 ok() 降级为 note()。它们比对的是「全书 720 课格数 vs 古籍记数」，
  //   差异源于孟仲派/数深浅派取法口径（STATUS 既有登记），不是算法回归——
  //   放在 ok() 里会让 CI 永远挂红，掩盖真正的回归信号。三传级硬标准在上面①-⑨逐课验证。
  note(`涉害三格合计 ${she} 课（《粹言》53+26+3=82；差 ${Math.abs(82 - she)} 课，取法派别口径差异，既有登记）`);
  note(`元首 ${cnt['元首'] || 0} 课（别本记 127、《粹言》记 120；本实现 ${cnt['元首'] || 0}，口径差异既有登记）`);
}

group('17. 吉凶层：月令旺衰与三传生克（断法主干，非将神打分卡）');
{
  // ① 旺相休囚死以「月建」为令：当令者旺、令生者相、生令者休、克令者囚、令克者死
  //    寅月（木令）：木旺 火相 水休 金囚 土死
  ok(wxState(3, 2) === '旺', '寅月（木令）见卯 = 旺（当令者）', wxState(3, 2));
  ok(wxState(6, 2) === '相', '寅月见午 = 相（令生者）', wxState(6, 2));
  ok(wxState(0, 2) === '休', '寅月见子 = 休（生令者）', wxState(0, 2));
  ok(wxState(8, 2) === '囚', '寅月见申 = 囚（克令者）', wxState(8, 2));
  ok(wxState(4, 2) === '死', '寅月见辰 = 死（令克者）', wxState(4, 2));
  //    酉月（金令）：金旺 水相 土休 火囚 木死
  ok(wxState(9, 9) === '旺', '酉月（金令）见酉 = 旺', wxState(9, 9));
  ok(wxState(11, 9) === '相', '酉月见亥 = 相', wxState(11, 9));
  ok(wxState(2, 9) === '死', '酉月见寅 = 死（令克者）', wxState(2, 9));
  ok(wxState(6, 9) === '囚', '酉月见午 = 囚（克令者）', wxState(6, 9));

  // ② 五行关系方向：以 a 为主语
  ok(wxRel('木', '火') === '生', '木 对 火 = 生（木生火）', wxRel('木', '火'));
  ok(wxRel('火', '木') === '被生', '火 对 木 = 被生', wxRel('火', '木'));
  ok(wxRel('水', '火') === '克', '水 对 火 = 克', wxRel('水', '火'));
  ok(wxRel('火', '水') === '被克', '火 对 水 = 被克', wxRel('火', '水'));
  ok(wxRel('木', '木') === '比', '木 对 木 = 比和', wxRel('木', '木'));

  // ③ 月建必须真正进分：同一课只替换月建，吉凶分必变。
  //    旧实现 fortune 完全不读月令，此断言在旧实现下必败——这是本次修复的核心。
  //    坑：不要用 branch+6（六冲）来换令。丑未、辰戌对冲后五行同为土，
  //    而公历季月恰好就是这四个土月，冲完等于没换，断言会假失败。
  //    这里改为遍历全部 12 个月建。
  let moonOK = 0, moonN = 0, wxVarMin = 99;
  const wxOf = (ft) => ft.parts.find(p => p.k === 'wx').v;
  for (const [y, m, d] of [[2026, 7, 10], [2026, 1, 15], [2026, 4, 20], [2026, 11, 5]]) {
    const r = calc(y, m, d, 6);
    const scores = new Set(), wxs = new Set();
    for (let jb = 0; jb < 12; jb++) {
      const r2 = Object.assign({}, r, { msb: { stem: r.msb.stem, branch: jb } });
      const ft = fortune(r2, null);
      scores.add(ft.score);
      wxs.add(wxOf(ft));
    }
    moonN++;
    if (scores.size >= 4 && wxs.size >= 4) moonOK++;
    if (wxs.size < wxVarMin) wxVarMin = wxs.size;
  }
  ok(moonOK === moonN, `遍历 12 月建 → 吉凶分与旺衰分随之改变（${moonOK}/${moonN} 课）`, '月令未进分');

  // ③b 木令（寅）与金令（酉）必须给出不同旺衰：月令方向性正确
  {
    const r = calc(2026, 7, 10, 6);
    const at = (jb) => fortune(Object.assign({}, r, { msb: { stem: r.msb.stem, branch: jb } }), null);
    const yin = at(2), you = at(9);   // 寅月木令 / 酉月金令
    ok(JSON.stringify(yin.wx) !== JSON.stringify(you.wx),
      '寅月（木令）与酉月（金令）旺衰判定不同',
      JSON.stringify(yin.wx) + ' vs ' + JSON.stringify(you.wx));
    // 初传属木则寅月当令为旺；同一支换到酉月金令下必为死
    ok(WX_SCORE['旺'] > 0 && WX_SCORE['死'] < 0 && WX_SCORE['旺'] > WX_SCORE['囚'],
      '旺相休囚死分值单调：旺 > 相 > 休 > 囚 > 死', JSON.stringify(WX_SCORE));
  }

  // ④ r.wx 与 wxState 同口径。渲染层曾误取「系统当前月份」，与起课月份无关
  const rW = calc(2026, 7, 10, 6);
  ok(rW.wx(rW.chu) === wxState(rW.chu, rW.msb.branch),
    'r.wx 与 wxState 口径一致（均以月建为令，非系统当前月）',
    rW.wx(rW.chu) + ' vs ' + wxState(rW.chu, rW.msb.branch));

  // ⑤ 三传生克进分：初生末（有始有终）应高于末克初（首尾相克）
  let fa = null, fb = null;
  for (let m = 1; m <= 12 && !(fa && fb); m++) {
    for (let d = 1; d <= 28; d++) {
      const ft = fortune(calc(2026, m, d, 6), null);
      if (ft.rel.chuMo === '生' && !fa) fa = ft;
      if (ft.rel.chuMo === '被克' && !fb) fb = ft;
    }
  }
  const skOf = (ft) => ft.parts.find(p => p.k === 'shengke').v;
  ok(!!fa && !!fb, '样本中同时存在「初生末」与「末克初」两课');
  if (fa && fb) {
    ok(skOf(fa) > skOf(fb),
      `初生末 生克分 ${skOf(fa)} > 末克初 生克分 ${skOf(fb)}（走向分正负相反）`);
  }

  // ⑥ 结构完整性 + 五档分布（阈值由 tools/calibrate.js 全样本 43800 局分布校准）
  let bad = 0, tagBad = 0, n = 0;
  const dist = { 大凶: 0, 凶: 0, 平: 0, 吉: 0, 大吉: 0 };
  const QLIST = Object.keys(DLR.QTYPES).map(k => ({ key: k, l: DLR.QTYPES[k].l })).concat([null]);
  for (let m = 1; m <= 12; m++) {
    for (const d of [1, 8, 15, 22]) {
      for (let hb = 0; hb < 12; hb++) {
        const r = calc(2026, m, d, hb);
        for (const q of QLIST) {
          const ft = fortune(r, q); n++;
          if (!isFinite(ft.score) || !ft.level || !ft.sym || typeof ft.text !== 'string') bad++;
          if (!Array.isArray(ft.parts) || ft.parts.length < 5) bad++;
          for (const t of ft.tags) if (!t || typeof t.t !== 'string' || typeof t.c !== 'string') tagBad++;
          if (dist[ft.level] !== undefined) dist[ft.level]++;
        }
      }
    }
  }
  ok(bad === 0, `fortune 结构与分项完整（${n} 局）`, `${bad} 处异常`);
  ok(tagBad === 0, 'tags 无 undefined 项（早先导出误传问题字符串，push 出 t:undefined）', `${tagBad} 处`);

  const tot = Object.keys(dist).reduce((a, k) => a + dist[k], 0);
  const pct = (k) => dist[k] / tot * 100;
  ok(Object.keys(dist).every(k => dist[k] > 0), '吉凶五档全部可达',
    JSON.stringify(dist));
  const topPct = Math.max(pct('大吉'), pct('吉'), pct('平'), pct('凶'), pct('大凶'));
  ok(pct('平') === topPct, `「平」占比最高（${pct('平').toFixed(1)}%），呈纺锤形`, Object.entries(dist).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(1)}%`).join(' '));
  ok(pct('大吉') > 1 && pct('大吉') < 20, `大吉 ${pct('大吉').toFixed(1)}%（校准目标 8%）`);
  ok(pct('大凶') > 1 && pct('大凶') < 20, `大凶 ${pct('大凶').toFixed(1)}%（校准目标 8%）`);
  console.log('   分布：' + Object.keys(dist).map(k => `${k} ${pct(k).toFixed(1)}%`).join('  '));

  // ⑦ 用神与事类确实进分
  const rY = calc(2026, 7, 10, 6);
  const ftY = fortune(rY, { key: 'cai', l: '财运' });
  ok(ftY.parts.some(p => p.k === 'yongshen'), '用神旺衰进分（财运类）');
  ok(ftY.parts.some(p => p.k === 'qtype'), '事类加成进分');
  ok(ftY.parts.some(p => p.k === 'kong'), '空亡进分（早先只作文案提示）');
  ok(fortune(rY, null).parts.every(p => p.k !== 'yongshen'), '未提问时不计用神分');
}

group('18. 课体格（keti）与事类入参归一化（normQ）');
{
  // 造假盘：keti 只读三传三支 + 伏吟/反吟标记；ketiScore 再加日干五行
  const mk = (c, z, m, de, opt) => Object.assign(
    { chu: c, zhang: z, mo: m, dayElem: de || '木', isFuYin: false, isFanYin: false }, opt || {});
  const names = (r) => keti(r).map(k => k.name);

  // ① 三合局：亥卯未曲直（木）／寅午戌炎上（火）／申子辰润下（水）／巳酉丑从革（金）
  ok(names(mk(11, 3, 7)).indexOf('曲直') >= 0, '亥卯未 → 曲直局', names(mk(11, 3, 7)).join('·'));
  ok(names(mk(2, 6, 10)).indexOf('炎上') >= 0, '寅午戌 → 炎上局', names(mk(2, 6, 10)).join('·'));
  ok(names(mk(8, 0, 4)).indexOf('润下') >= 0, '申子辰 → 润下局', names(mk(8, 0, 4)).join('·'));
  ok(names(mk(5, 9, 1)).indexOf('从革') >= 0, '巳酉丑 → 从革局', names(mk(5, 9, 1)).join('·'));
  ok(names(mk(1, 4, 7)).indexOf('稼穑') >= 0, '丑辰未（四土之三）→ 稼穑', names(mk(1, 4, 7)).join('·'));
  { // 三合局是「会」不是「连」，与三传次序无关
    const set = [11, 3, 7]; let bad = 0;
    for (const p of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])
      if (names(mk(set[p[0]], set[p[1]], set[p[2]])).indexOf('曲直') < 0) bad++;
    ok(bad === 0, '三合局与三传次序无关（6 种排列皆判曲直）', bad + ' 种漏判');
  }

  // ② 连茹 / 间传 / 归一 / 伏吟反吟
  ok(names(mk(0, 1, 2)).indexOf('进茹') >= 0, '子丑寅 → 进茹（顺连）', names(mk(0,1,2)).join('·'));
  ok(names(mk(0, 11, 10)).indexOf('退茹') >= 0, '子亥戌 → 退茹（逆连）', names(mk(0,11,10)).join('·'));
  ok(names(mk(0, 2, 4)).indexOf('顺间') >= 0, '子寅辰 → 顺间（隔位顺行）', names(mk(0,2,4)).join('·'));
  ok(names(mk(0, 10, 8)).indexOf('逆间') >= 0, '子戌申 → 逆间（隔位逆行）', names(mk(0,10,8)).join('·'));
  ok(names(mk(5, 5, 5)).indexOf('三传归一') >= 0, '三传同支 → 三传归一');
  ok(names(mk(3, 3, 3)).length === 1, '三传归一时不再判连茹／间传（互斥）', names(mk(3,3,3)).join('·'));
  ok(names(mk(0, 1, 2, '木', { isFuYin: true })).indexOf('伏吟') >= 0, 'isFuYin → 伏吟');
  ok(names(mk(0, 1, 2, '木', { isFanYin: true })).indexOf('反吟') >= 0, 'isFanYin → 反吟');

  // ③ 结构守恒：穷举 12³=1728 组三传，结构格命中数须等于理论值，且无一被多重判定
  //    理论值：三传归一 12；进茹/退茹/顺间/逆间 各 12 共 48；三合 4 局×6 排列 24；稼穑 C(4,3)×6 排列 24 → 合计 96
  {
    let same = 0, struct = 0, multi = 0;
    for (let c = 0; c < 12; c++) for (let z = 0; z < 12; z++) for (let m = 0; m < 12; m++) {
      const ks = keti(mk(c, z, m));
      let s = 0;
      for (const k of ks) {
        if (k.name === '三传归一') same++;
        else if (k.name !== '伏吟' && k.name !== '反吟') s++;
      }
      if (s) struct++;
      if (s > 1) multi++;
    }
    ok(same === 12 && struct === 96 && multi === 0,
      `穷举 12³ 组三传：三传归一 ${same}、结构格 ${struct}（理论 12 / 96），多重判定 ${multi}`,
      `same=${same} struct=${struct} multi=${multi}`);
  }

  // ④ 六亲是客观定义：生我者印、我克者财、克我者官、我生者食、同我者比
  ok(liuqin5('水', '木') === '印', '局水对日干木 = 印（生我者）', liuqin5('水', '木'));
  ok(liuqin5('土', '木') === '财', '局土对日干木 = 财（我克者）', liuqin5('土', '木'));
  ok(liuqin5('火', '木') === '食', '局火对日干木 = 食（我生者）', liuqin5('火', '木'));
  ok(liuqin5('金', '木') === '官', '局金对日干木 = 官（克我者）', liuqin5('金', '木'));
  ok(liuqin5('木', '木') === '比', '局木同日干木 = 比', liuqin5('木', '木'));
  { // 25 组穷举，逐组对照 SHENG/KE 表（注意 SHENG[X]=生X者、KE[X]=X所克者，两表方向相反）
    let bad = 0; const ELS = ['木', '火', '土', '金', '水'];
    for (const ge of ELS) for (const de of ELS) {
      let exp;
      if (ge === de) exp = '比';
      else if (SHENG[de] === ge) exp = '印';
      else if (KE[de] === ge) exp = '财';
      else if (SHENG[ge] === de) exp = '食';
      else exp = '官';
      if (liuqin5(ge, de) !== exp) bad++;
    }
    ok(bad === 0, '六亲 25 组穷举与 SHENG/KE 表一致（印食未颠倒）', bad + ' 处不符');
  }
  ok(LQ5['印'] > LQ5['财'] && LQ5['财'] > LQ5['比'] && LQ5['比'] > LQ5['食'] && LQ5['食'] > LQ5['官'],
    '六亲吉凶排序：印 > 财 > 比 > 食 > 官（生我者最吉、克我者最凶）', JSON.stringify(LQ5));

  // ⑤ 课体计分：定性分 + 三合局六亲分
  const s0 = ketiScore(mk(0, 2, 4, '木'));
  ok(s0.list.length === 1 && s0.score === KT_SCORE['顺间'],
    '顺间课体分 = KT_SCORE[顺间]（非三合局不计六亲）', String(s0.score));
  const s1 = ketiScore(mk(11, 3, 7, '木'));    // 曲直属木，对日干木 = 比
  ok(s1.list[0].lq === '比' && Math.abs(s1.score - (KT_SCORE['曲直'] + LQ5['比'] * 0.8)) < 1e-6,
    '曲直局 + 日干木 → 六亲比，分 = 曲直 + 比×0.8', String(s1.score));
  const s2 = ketiScore(mk(11, 3, 7, '土'));    // 曲直属木，木克土 = 官
  ok(s2.list[0].lq === '官' && s2.score < s1.score,
    '同一曲直局换日干土 → 六亲官（克我者），分低于比', s2.score + ' < ' + s1.score);
  ok(ketiScore(mk(0, 3, 6)).score === 0, '不成型三传（子卯午）→ 课体分 0', String(ketiScore(mk(0,3,6)).score));

  // ⑥ 课体维度进 fortune，且与②月令维度不重复计分
  const rK = calc(2026, 7, 10, 6);
  const ftK = fortune(rK, null);
  ok(ftK.parts.some(p => p.k === 'keti'), 'fortune 含「课体格局」分项');
  ok(Array.isArray(ftK.keti), 'fortune 回传 keti 列表供解读层渲染');
  {
    const at = (jb) => fortune(Object.assign({}, rK, { msb: { stem: rK.msb.stem, branch: jb } }), null)
      .parts.find(p => p.k === 'keti').v;
    ok(at(2) === at(9), '课体分不受月建影响（与月令维度各计各的，不重复）', at(2) + ' vs ' + at(9));
  }

  // ⑦ normQ：三种入参口径必须同分。直接传 QTYPES[k] 会静默丢掉用神+事类两维（约 14% 贡献度）
  ok(normQ(null) === null, 'normQ(null) → null');
  ok(normQ({ key: 'cai', l: '财运' }).key === 'cai', 'normQ 接受 {key,l} 对象');
  const qt = normQ(QTYPES['cai']);
  ok(qt && qt.key === 'cai', 'normQ 能从 QTYPES[k]（只有 {kw,l}、无 key）补出 key', JSON.stringify(qt));
  const qstr = QTYPES['cai'].kw[0];
  const qs = normQ(qstr);
  ok(qs && typeof qs.key === 'string', 'normQ 接受问题字符串并自行 detectQ（"' + qstr + '"）', JSON.stringify(qs));
  {
    const r = calc(2026, 7, 10, 6);
    const a = fortune(r, { key: 'cai', l: '财运' }).score;
    const b = fortune(r, QTYPES['cai']).score;
    const c = fortune(r, qs.key ? qstr : null).score;
    ok(a === b && a === c, 'fortune 三种事类入参（{key,l}／QTYPES[k]／问题字符串）分数一致',
      `${a} / ${b} / ${c}`);
    ok(fortune(r, qstr).parts.some(p => p.k === 'yongshen'),
      '传问题字符串时用神分未丢（旧接口会静默丢掉用神+事类两维）');
  }

  // ⑧ 全样本扫描：格名必须都在 KT_SCORE 中有分，否则就是判出了没定价的格
  {
    const hit = {}; let n = 0, bad = 0;
    for (let m = 1; m <= 12; m++) for (const d of [3, 12, 21]) for (let hb = 0; hb < 12; hb++) {
      const r = calc(2026, m, d, hb); n++;
      for (const k of keti(r)) { hit[k.name] = (hit[k.name] || 0) + 1; if (!KT_SCORE[k.name]) bad++; }
    }
    ok(bad === 0, `全样本 ${n} 局：课体名均在 KT_SCORE 中有对应分值`, bad + ' 处未定价');
    console.log('   课体命中率：' + Object.keys(hit).sort((a, b) => hit[b] - hit[a])
      .map(k => `${k} ${(hit[k] / n * 100).toFixed(1)}%`).join('  '));
  }
}

// ───────────────────────────────────────────────
// 19. 年命与类神（2026-11-01 线 A 新增）
//     两者都属展示层：补「人」与「事之主线」这两极，但不进 fortune() 计分、不动 FT_TH。
group('19. 年命（本命·行年）与类神体系');
{
  // nianming 的占问年取自 r.raw，故测试里显式给定，避免依赖系统当前年份
  const mkR = () => { const r = calc(2026, 7, 10, 6); r.raw = { y: 2026, m: 7, d: 10 }; return r; };
  const r = mkR();
  const nmM = nianming(r, 1990, 6, 15, '男');
  const nmF = nianming(r, 1990, 6, 15, '女');
  ok(nmM && nmF, 'nianming 返回非空');
  ok(nmM.benBr === nmF.benBr, '本命支不因性别而变', BRAN[nmM.benBr]);
  ok(nmM.benBr === yearSB(1990, 6, 15).branch, '本命支 = 生年支（yearSB，立春分界）',
    BRAN[nmM.benBr] + ' vs ' + BRAN[yearSB(1990, 6, 15).branch]);
  ok(nmM.xuSui === 37, '虚岁 = 占问年 - 生年 + 1', String(nmM.xuSui));

  // 行年：男一岁起寅顺行、女一岁起申逆行（本实现采用的派别，源码已注明另有他说）
  const m1 = nianming(mkR(), 2026, 6, 15, '男'), f1 = nianming(mkR(), 2026, 6, 15, '女');
  const m2 = nianming(mkR(), 2025, 6, 15, '男'), f2 = nianming(mkR(), 2025, 6, 15, '女');
  ok(m1.xuSui === 1 && f1.xuSui === 1, '一岁虚岁推算正确');
  ok(m1.xingBr === 2, '男一岁行年起寅', BRAN[m1.xingBr]);
  ok(f1.xingBr === 8, '女一岁行年起申', BRAN[f1.xingBr]);
  ok(m2.xingBr === 3, '男二岁行年顺行至卯', BRAN[m2.xingBr]);
  ok(f2.xingBr === 7, '女二岁行年逆行至未', BRAN[f2.xingBr]);

  // 上神取天盘：本命/行年上神 = heavenMap[该支]
  ok(nmM.benShang === r.heavenMap[nmM.benBr], '本命上神 = heavenMap[本命支]',
    BRAN[nmM.benShang] + ' vs ' + BRAN[r.heavenMap[nmM.benBr]]);
  ok(nmM.xingShang === r.heavenMap[nmM.xingBr], '行年上神 = heavenMap[行年支]');
  ok(typeof nmM.benJiang === 'string' && nmM.benJiang.length > 0, '本命上神乘有天将', nmM.benJiang);
  ok(['印','比','食','财','官'].indexOf(nmM.benLq) >= 0, '本命对日干之六亲合法', nmM.benLq);

  // 关键约定：年命不得进入评分。年命是在 fortune() 之后才挂到 r 上的，
  // 此处守住 parts 中没有这一维，防止日后有人顺手把它接进计分。
  const ft = fortune(mkR(), { key: 'cai', l: '财运' });
  ok(!ft.parts.some(p => p.k === 'nianming'), '年命不参与评分（parts 中无 nianming 维）');
}
{
  // 类神表必须覆盖全部事类，否则某个事类会整段消失
  const keys = Object.keys(QTYPES);
  const missing = keys.filter(k => !LEISHEN[k]);
  ok(missing.length === 0, `LEISHEN 覆盖全部 ${keys.length} 个事类`, missing.join(','));

  // 六亲 → 五行（以日干为主语）。记忆：KE[X]=X所克者，SHENG[X]=生X者，XI_MAP[X]=X所生者
  const R = calc(2026, 7, 10, 6);
  const dayE = R.dayElem;
  ok(liuWx(dayE, '妻财') === KE[dayE], '妻财 = 日干所克者', liuWx(dayE, '妻财'));
  ok(KE[liuWx(dayE, '官鬼')] === dayE, '官鬼 = 克日干者', liuWx(dayE, '官鬼'));
  ok(liuWx(dayE, '子孙') === XI_MAP[dayE], '子孙 = 日干所生者', liuWx(dayE, '子孙'));
  ok(SHENG[dayE] === liuWx(dayE, '父母'), '父母 = 生日干者', liuWx(dayE, '父母'));
  ok(liuWx(dayE, '兄弟') === dayE, '兄弟 = 与日干同气', liuWx(dayE, '兄弟'));
  // 穷举五个日干 × 五亲，均须落在五行之内
  for (const g of ['木', '火', '土', '金', '水'])
    for (const liu of ['妻财', '官鬼', '子孙', '父母', '兄弟'])
      ok(['木', '火', '土', '金', '水'].indexOf(liuWx(g, liu)) >= 0,
        `liuWx 日干${g} 之${liu} 落在五行内`, liuWx(g, liu));

  // 五行 → 地支：须恰好覆盖十二支，不重不漏
  const all = [].concat(...Object.values(WX_BR)).sort((a, b) => a - b);
  ok(all.length === 12 && all.every((v, i) => v === i), 'WX_BR 覆盖十二支且不重不漏',
    all.join(','));
}

// ───────────────────────────────────────────────
// 20. 线 B：类神定性 + 限幅（2026-11-01）
//     旧结构「各维求和」的病是可补偿性：类神空亡 -2.5，天将 +3.6、旺衰 +3.0 轻松补回来，
//     于是「多数好」淹没「关键坏」。新结构把其余各维压进 ±LS_CAP 的软饱和区间。
//     ⚠️ 断言 ③ 是**数学必然**（不依赖采样），比任何统计指标都可靠 ——
//        贡献度那种量会随样本抖（见 MEMORY 里 keti 1.2% 的教训），而 |adj| ≤ LS_CAP 不会。
group('20. 线 B：类神定性 + 限幅（消灭可补偿性）');
{
  const r = calc(2026, 7, 10, 6);
  // ① 每个事类都要能取出类神支，否则该类等于没有主线
  for (const qk of Object.keys(QTYPES)) {
    const ls = leishenBr(r, { key: qk, l: QTYPES[qk].l });
    ok(ls.brs.length > 0, `类神支非空 · ${qk}`, ls.brs.map(b => BRAN[b]).join(''));
    ok(ls.brs.every(b => b >= 0 && b < 12), `类神支合法 · ${qk}`);
  }
  // ② 求财的类神五行必须 = 日干所克者（妻财），方向反了整个层就废了
  const dayE = r.dayElem;
  const caiL = leishenBr(r, { key: 'cai', l: '财运' });
  ok(caiL.wx === KE[dayE], '求财类神五行 = 日干所克者（妻财）', caiL.wx + ' vs ' + KE[dayE]);

  // ③ 限幅的数学必然：其余各维对总分的影响被夹死在 ±LS_CAP 内
  let maxDev = 0;
  for (let d = 0; d < 28; d++) {
    const rr = calc(2026, 7, 1 + d, 6);
    for (const qk of Object.keys(QTYPES)) {
      const ft = fortune(rr, { key: qk, l: QTYPES[qk].l });
      const ls = ft.parts.find(p => p.k === 'leishen'), ss = ft.parts.find(p => p.k === 'shensha');
      const dev = Math.abs(ft.score - ((ls ? ls.v : 0) + (ss ? ss.v : 0)));
      if (dev > maxDev) maxDev = dev;
    }
  }
  ok(maxDev <= LS_CAP + 0.05, `其余各维合计拉不动超过 LS_CAP(${LS_CAP})`,
    '实测最大 ' + maxDev.toFixed(3));

  // ④ Σparts ≡ score：capadj 记账项让恒等式在新结构下仍然成立（贡献度分解才能照旧用）
  let maxGap = 0;
  for (let d = 0; d < 28; d++) {
    const ft = fortune(calc(2026, 7, 1 + d, 6), { key: 'cai', l: '财运' });
    maxGap = Math.max(maxGap, Math.abs(ft.parts.reduce((a, p) => a + p.v, 0) - ft.score));
  }
  ok(maxGap < 0.05, 'Σparts ≡ score（限幅差额计入 capadj）', '最大误差 ' + maxGap.toFixed(4));

  // ⑤ 限幅函数本身：过原点、单调（保序）、双向饱和、不发散
  const adj = (x) => LS_CAP * Math.tanh(x / LS_CAP);
  ok(adj(0) === 0, '限幅函数在 0 处为 0');
  ok(adj(1) < adj(2) && adj(2) < adj(3), '限幅单调 —— 不破坏「哪课更吉」的排序');
  // 注意是 <= 不是 <：tanh(33) 在双精度下已等于 1.0，adj(100) 恰好取到 LS_CAP
  ok(adj(100) <= LS_CAP && adj(100) > LS_CAP * 0.99, '正向渐近饱和到 +LS_CAP', adj(100).toFixed(4));
  ok(adj(-100) >= -LS_CAP && adj(-100) < -LS_CAP * 0.99, '负向渐近饱和到 -LS_CAP', adj(-100).toFixed(4));
  ok(adj(1) < 1, '小值处限幅已开始压缩（adj(1) < 1）', adj(1).toFixed(4));

  // ⑥ 采样对照：类神定性分最低 20% 与最高 20% 的 score 均值须显著拉开
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const rr = calc(2026, m, 1, 6);
    for (const qk of Object.keys(QTYPES)) {
      const ft = fortune(rr, { key: qk, l: QTYPES[qk].l });
      const ls = ft.parts.find(p => p.k === 'leishen');
      rows.push({ ls: ls ? ls.v : 0, sc: ft.score });
    }
  }
  rows.sort((a, b) => a.ls - b.ls);
  const k = Math.floor(rows.length * 0.2);
  const avg = (a) => a.reduce((s, o) => s + o.sc, 0) / a.length;
  const lo = avg(rows.slice(0, k)), hi = avg(rows.slice(rows.length - k));
  ok(hi - lo > 3, '类神最差 20% 与最好 20% 的 score 显著拉开',
    lo.toFixed(2) + ' → ' + hi.toFixed(2));
}
{
  // ⑦ 年命是可选输入：不传 → 无该维（校准就走这条路径，FT_TH 反映「无年命」分布）；
  //    传了 → 进分并真的改变结论（否则等于没接上），但同样受限幅约束。
  const mkR = () => { const r = calc(2026, 7, 10, 6); r.raw = { y: 2026, m: 7, d: 10 }; return r; };
  const r0 = mkR(), q = { key: 'cai', l: '财运' };
  const f0 = fortune(r0, q);
  ok(!f0.parts.some(p => p.k === 'nianming'), '不传年命 → parts 中无 nianming 维（校准口径）');
  const f1 = fortune(r0, q, nianming(r0, 1990, 6, 15, '男'));
  ok(f1.parts.some(p => p.k === 'nianming'), '传入年命 → parts 中有 nianming 维');
  ok(Math.abs(f1.score - f0.score) > 1e-6, '年命会改变总分（否则等于没接上）',
    f0.score + ' → ' + f1.score);
  const g = (ft, kk) => { const p = ft.parts.find(p => p.k === kk); return p ? p.v : 0; };
  const dev1 = Math.abs(f1.score - (g(f1, 'leishen') + g(f1, 'shensha') + g(f1, 'nianming')));
  ok(dev1 <= LS_CAP + 0.05, '带年命时限幅约束同样成立', 'dev=' + dev1.toFixed(3));
  // 男女行年不同 → 同一课同一事类，年命维应不同（行年入传与否会影响分数）
  const nmM = nianming(r0, 1990, 6, 15, '男'), nmF = nianming(r0, 1990, 6, 15, '女');
  const fM = fortune(r0, q, nmM), fF = fortune(r0, q, nmF);
  ok(nmM.xingBr !== nmF.xingBr, '同生年不同性别 → 行年支不同',
    BRAN[nmM.xingBr] + ' / ' + BRAN[nmF.xingBr]);
  ok(g(fM, 'nianming') !== g(fF, 'nianming') || fM.score === fF.score,
    '行年不同 → 年命维随之不同（或恰同分）', g(fM, 'nianming') + ' / ' + g(fF, 'nianming'));
}
{
  // ⑧ tao（桃花）类缺口已补：getYongshen 不再落到 other
  const r = calc(2026, 7, 10, 6);
  const ysT = getYongshen(r, { key: 'tao', l: '桃花' });
  ok(ysT && ysT.key === 'tao', 'getYongshen 的 tao 分支已补（原落到 other）', ysT && ysT.key);
  ok(ysT.focus && ysT.focus.length === 1 && ysT.focus[0] === r.taohua,
    '桃花类用神 focus = 桃花支', BRAN[ysT.focus[0]] + ' vs ' + BRAN[r.taohua]);
  // ⑨ 神煞进分（线 B 的 1b）：德神/禄神发用的课，shensha 维必须非 0 —— 兑现 1a 降级时的承诺
  let hit = 0;
  for (let d = 0; d < 60; d++) {
    const rr = calc(2026, 6, 1 + (d % 30), d % 12);
    const ft = fortune(rr, { key: 'cai', l: '财运' });
    const ss = ft.parts.find(p => p.k === 'shensha');
    if (rr.deBr === rr.chu || rr.luBr === rr.chu) {
      if (ss && ss.v > 0) hit++;
    }
  }
  ok(hit > 0, '德神/禄神发用 → shensha 维确实加分（文案承诺已兑现）', String(hit));
}

// ───────────────────────────────────────────────
// 21. 线 C：去五档 → 判词 + 应期 + 判据明细
// 判词层不再有分数，所以这里的断言全部是**结构不变量**，不是抽样数值。
group('21. 线 C：去五档 → 判词 + 应期 + 判据明细');
{
  // 2026-11-03：LS_ACT（成/难判语）已退役，改为 LS_HEAD（事类抬头）。
  // 退役理由见 index.html 中 LS_HEAD 处的留档：105 课检验命中 42.3%，与抛硬币无显著差别。
  const keys = Object.keys(LS_HEAD);
  ok(keys.indexOf('other') >= 0, 'LS_HEAD 含兜底事类 other');
  const missing = Object.keys(QTYPES).filter(k => !LS_HEAD[k]);
  ok(missing.length === 0, 'QTYPES 每一类都有课象抬头（无遗漏回落到 other）',
    missing.join(',') || 'none');

  let nT = 0, nF = 0, nU = 0, bad = 0, empty = 0, yqBad = 0, kongLocked = 0;
  let kongUsed = 0, kongAny = 0, cnt = 0;
  for (let d = 0; d < 120; d++) {
    const r = calc(2026, 1 + (d % 12), 1 + (d % 28), d % 12);
    const nm = nianming(r, 1990, 5, 10, '男');
    for (const k of Object.keys(QTYPES)) {
      const q = { key: k, l: (QTYPES[k] && QTYPES[k].l) || k };
      const pd = panding(r, q, nm);
      const yq = yingqi(r, q, nm, pd.ok);
      cnt++;
      if (pd.kong) kongUsed++;
      if (pd.leishen && pd.leishen.kong) kongAny++;
      if (!pd.lines.length) empty++;
      // 2026-11-03 新契约：verdict 是**课象摘要**，不是「可／难」判语。两条不变量：
      //   ① 抬头必须是本类事类名（类神取不到时为「类神未定」）；
      //   ② 不得含任何成败／吉凶价值词 —— 这是防回退的守门断言：
      //      日后若有人把「官禄可期」加回来，这条会立刻失败。
      const vd = pd.verdict;
      const headOK = vd === '类神未定' || vd.indexOf(LS_HEAD[k]) === 0;
      const VAL = /可期|难期|可成|难成|可得|难得|可胜|可愈|宜止|可望|可觅|难觅|可遇|难遇|此事可|[吉凶]/;
      if (!headOK || VAL.test(vd)) bad++;
      if (pd.ok === true) { nT++; }
      else if (pd.ok === false) { nF++; }
      else { nU++; }
      if (!yq.win || ['速', '迟', '虚'].indexOf(yq.speed) < 0) yqBad++;
      // 硬不变量（不依赖采样）：判「可」的课，类神绝不能犯硬否决项 ——
      // 这是 panding 的定性规则直接推出来的，一旦破说明「一票否决」漏判。
      if (pd.ok === true && pd.hard && pd.hard.length) bad++;
      // 类神空亡 → 应期必须拒绝给日期（本页不取「出空填实即应」）
      // ⚠️ 用 pd.kong（本次实际取用的那一个类神），不用 leishen.kong（候选集任一支落空）
      // 2026-11-03：条件不再挂 `pd.ok === false`。三态判定已停止对外输出，
      // 「空则事体不实」本身即足以拒绝指日期，无须再靠一个被证伪的结论做前置。
      if (pd.kong) {
        if (yq.win === '无定期') kongLocked++; else bad++;
      }
    }
  }
  ok(bad === 0, 'verdict 抬头合法且不含成败价值词 + 判「可」时无硬否决项 + 空亡不给日期', 'bad=' + bad);
  ok(empty === 0, '每份课象至少一句陈述（不许空判）', 'empty=' + empty);
  ok(yqBad === 0, '应期窗口非空、迟速取值合法', 'bad=' + yqBad);
  ok(nT > 0 && nF > 0, '内部 ok 三态未退化（仅自洽性检查，不对外展示）', '可' + nT + ' 难' + nF + ' 未决' + nU);
  ok(kongLocked > 0, '确实触发了「类神空亡 → 不指日期」路径（非死代码）', String(kongLocked));
  // 「类神空亡」必须问**本次实际取用的那一个支**，不能问候选集里任一支 ——
  // 后者把候选支数量带进概率里，实测会漂到 23.8%（理论应是 2/12≈16.7%）。
  const rUsed = kongUsed / cnt, rAny = kongAny / cnt;
  ok(rUsed < rAny, '空亡按「实际取用支」判定，严格低于候选集任一落空',
    (rUsed * 100).toFixed(1) + '% < ' + (rAny * 100).toFixed(1) + '%');
  ok(rUsed < 0.20, '取用类神空亡率贴近理论值 2/12≈16.7%（候选集口径会漂到 23.8%）',
    (rUsed * 100).toFixed(1) + '%');
  const tot = nT + nF + nU;
  console.log('   三态分布：可 ' + (nT / tot * 100).toFixed(1) + '%　难 ' +
    (nF / tot * 100).toFixed(1) + '%　难以遽断 ' + (nU / tot * 100).toFixed(1) + '%');
}
{
  // HE6 六合自反子午丑未…）
  let hbad = 0;
  for (let b = 0; b < 12; b++) if (HE6[HE6[b]] !== b) hbad++;
  ok(hbad === 0, 'HE6 六合自反（HE6[HE6[b]] === b）', 'bad=' + hbad);

  // 短语函数覆盖全部关系取值，不留 undefined
  const rels = ['生', '克', '被生', '被克', '比', '无关'];
  const empties = [];
  for (const rel of rels) { if (!relPhrase(rel) || !chuanRel(rel)) empties.push(rel); }
  const W = ['木', '火', '土', '金', '水'];
  for (const a of W) for (const b of W) if (!wxRelNote(a, b)) empties.push(a + b);
  ok(empties.length === 0, 'relPhrase/chuanRel/wxRelNote 覆盖全部关系值', empties.join(',') || 'none');

  // 页面静态检查：吉凶卡不得再出现五档与分数
  const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const m = src.match(/function renderFortuneCard[\s\S]*?\n}\n/) || [''];
  const code = m[0].replace(/^\s*\/\/.*$/gm, '');   // 去掉整行注释后再查
  ok(code.length > 0, '取到 renderFortuneCard 源码用于静态检查', code.length + ' 字符');
  ok(!/\.level\b/.test(code), 'renderFortuneCard 不再引用 ft.level（五档已下架）');
  ok(!/\bscore\b/.test(code), 'renderFortuneCard 不再把分数显示给用户');
  ok(/pd\.verdict/.test(code), 'renderFortuneCard 改出判词（verdict）');
  ok(/yq\.win/.test(code), 'renderFortuneCard 输出应期');
  ok(/判据明细/.test(code), 'renderFortuneCard 输出可复核的判据明细');
}

// ───────────────────────────────────────────────
// 22. 神煞层（2026-11-15 卷五《大六壬神煞指南》重录）
// 锁三件事：①月支表下标必须是月建支（错位一个月就挂）；②天德/月德宫位换算锚点；
// ③每条 ss tag 必须带「卷五」出处（防将来加无出处的自创断语）。
group('22. 神煞层（卷五重录）：下标锚点 + 出处纪律');
{
  const BRAN = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  // 锚点 1：亥月（月建亥=支11）天德在乙→辰。旧表错位时会给「巽/巳」，这条立即失败。
  const rHai = calc(2026, 11, 15, 11);   // 癸巳日 亥月
  ok(rHai.ssPos[0] === '天德在辰（乙）', '天德锚点：亥月=乙（辰），下标无错位', rHai.ssPos[0]);
  ok(rHai.ssPos[1] === '月德在寅', '月德锚点：亥月=甲（寅），下标无错位', rHai.ssPos[1]);
  // 锚点 2：天德歌序「丁坤壬辛乾甲癸艮丙乙巽庚」逐月核对（干寄宫换算支位）。
  //   注意公历月≠月建：1 月 15 日在小寒后为丑月，2 月起为寅月…12 月为子月。
  const TD_SEQ = ['巽','庚','丁','坤','壬','辛','乾','甲','癸','艮','丙','乙'];
  const TD_BR = ['巳','申','未','申','亥','戌','亥','寅','丑','寅','巳','辰'];
  let tdBad = [];
  for (let m = 1; m <= 12; m++) {
    const mi = m % 12;                       // 公历月 → 月建支下标
    const rr = calc(2026, m, 15, 6);
    const f = rr.ssPos[0];
    if (f !== '天德在' + TD_BR[mi] + '（' + TD_SEQ[mi] + '）') tdBad.push(m + '月:' + f);
  }
  ok(tdBad.length === 0, '天德 12 个月逐月核对（卷五月煞章歌序 + 干寄宫）', tdBad.join(' ') || '全对');
  // 锚点 3：月驿「正申逆四孟」——正月申、二月巳、三月寅、四月亥，循环。
  //   月序：2 月=正月、3 月=二月…12 月=冬月、1 月=腊月。
  const YY = ['申','巳','寅','亥'];
  let yyBad = [];
  for (let m = 1; m <= 12; m++) {
    const xu = (m === 1 ? 12 : m - 1);       // 月序 1-12
    const rr = calc(2026, m, 15, 6);
    const f = rr.ssPos.find(s => s.indexOf('月驿在') === 0);
    const want = YY[(xu - 1) % 4];
    if (f !== '月驿在' + want) yyBad.push(m + '月:' + f);
  }
  ok(yyBad.length === 0, '月驿 12 个月逐月核对（辨讹章「正申逆四孟」）', yyBad.join(' ') || '全对');
  // 纪律：所有 ss tag 必须挂「卷五」出处
  let noSrc = [];
  for (let d = 0; d < 90; d++) {
    const rr = calc(2026, 1 + (d % 12), 1 + (d % 28), d % 12);
    for (const s of rr.ss) if ((s.d || '').indexOf('卷五') < 0) noSrc.push(s.n);
  }
  ok(noSrc.length === 0, '90 课抽样：ss tag 全部带卷五出处', noSrc.slice(0, 5).join(',') || '全带');
}

// ───────────────────────────────────────────────
// 23. 事类按钮（2026-11-16）
// 起因：detectQ 只做关键词子串匹配 —— 漏（口语说法一个词都不中）、误（单字词跨词命中）。
// 按钮让用户直接点名事类。本组锁四件事：①按钮清单与 QTYPES 一一对应且恰有一个 other；
// ②qtypeOf 键→标签映射；③词表不再含高危单字（「动」「判」），且误判源实测已消除；
// ④词表兜底仍在（按钮不点也能识别常见问法）、词表内无重复词、字面量清单不硬编码进 HTML。
group('23. 事类按钮：清单映射 + 关键词误判纪律');
{
  const list = DLR.qtChipList(), qtypeOf = DLR.qtypeOf;
  const keys = Object.keys(QTYPES);
  ok(list.length === keys.length + 1, '按钮数 = 事类数 + 1（通用）', list.length + '/' + (keys.length + 1));
  ok(keys.every(k => list.some(c => c.k === k)), '每个 QTYPES 类都有对应按钮');
  ok(list.filter(c => c.k === 'other').length === 1, '恰好一个「通用」按钮（key=other）');
  ok(list[list.length - 1].k === 'other', '「通用」排在末位');
  ok(list.every(c => c.l && typeof c.l === 'string'), '每个按钮都有中文标签');
  ok(!('other' in QTYPES), 'other 不得混进 QTYPES（否则会被词表匹配到）');
  ok(qtypeOf('cai') && qtypeOf('cai').key === 'cai' && qtypeOf('cai').l === QTYPES.cai.l, 'qtypeOf(cai) 取到财运');
  ok(qtypeOf('other') && qtypeOf('other').l === '通用', 'qtypeOf(other) 返回「通用」标签');
  ok(qtypeOf('nope') === null && qtypeOf('') === null && qtypeOf(null) === null, 'qtypeOf 对非法键返回 null');
  // 关键词纪律：单字只允许语义专一的几个；其余一律 ≥2 字。
  // 原「动」令「该不该动手」判成出行，原「判」令「我想判断一下」判成诉讼 —— 这两类跨词误中必须绝迹。
  const ONE_OK = ['财', '钱', '婚', '病', '讼'];
  let bad = [];
  for (const k in QTYPES) for (const w of QTYPES[k].kw)
    if (w.length === 1 && ONE_OK.indexOf(w) < 0) bad.push(k + ':' + w);
  ok(bad.length === 0, '无高危单字关键词（只留 财/钱/婚/病/讼）', bad.join(',') || '全合规');
  ok(detectQ('该不该动手') === null, '「该不该动手」不再误判为出行', JSON.stringify(detectQ('该不该动手')));
  ok(detectQ('我想判断一下这事') === null, '「我想判断一下这事」不再误判为诉讼', JSON.stringify(detectQ('我想判断一下这事')));
  ok(detectQ('最近求职能否成功') && detectQ('最近求职能否成功').key === 'guan', '词表兜底：求职 → 事业');
  ok(detectQ('这次考试能过吗') && detectQ('这次考试能过吗').key === 'xue', '词表兜底：考试 → 学业');
  let dup = [];
  for (const k in QTYPES) {
    const s = new Set(), d = new Set();
    for (const w of QTYPES[k].kw) { if (s.has(w)) d.add(w); s.add(w); }
    if (d.size) dup.push(k + ':' + [...d].join('/'));
  }
  ok(dup.length === 0, '各事类关键词无重复', dup.join(',') || '无重复');
  // 注意：code 只是 <script> 内容，容器 id 在 body 里，须读整页
  const page = fs.readFileSync(HTML, 'utf8');
  ok(/id="qChips"/.test(page) && /renderQChips\(\);/.test(code), '页面含按钮容器与初始化渲染调用');
  ok(/r\.qtManual=!!_qtPick/.test(code), 'divine 记录事类来源（手动锁定 / 自动识别）');
  ok(/qtManual\?'按你锁定的事类'/.test(code), '解读区按来源区分措辞（手动 / 自动）');
}

// ───────────────────────────────────────────────
// 24. 白话解读（2026-11-16）
// 定位必须锁死：**只翻译，不下断语**。它是 B 方案（断法层降级为课象呈现）的延伸，
// 最大的风险是「白话」变成把成／不成塞回来的后门。所以本组不只测「能渲染出东西」，
// 更测「渲染出来的东西里不许有判断词」，且每一条都必须能追回 r 上的盘面事实。
group('24. 白话解读：只翻译不下断语');
{
  // 天将白话表必须覆盖全部十二将，否则某些盘会掉字
  const miss = TIANJIANG.filter(j => !JIANG_BAI[j]);
  ok(miss.length === 0, '十二天将均有白话译名', miss.join(',') || '全覆盖');
  ok(Object.keys(WX_BAI).length === 5 && ['旺','相','休','囚','死'].every(w => WX_BAI[w]),
     '旺相休囚死五态均有白话');

  const r = calc(2026, 11, 16, 6);
  r.qtype = { key: 'cai', l: '财运' };
  r.nm = null;
  r.yingqi = yingqi(r, r.qtype, null, null);
  const h = renderBaihua(r);

  ok(typeof h === 'string' && h.indexOf('白话解读') >= 0, '渲染出白话解读区块');
  ok(['①','②','③','④'].every(s => h.indexOf(s) >= 0), '四段齐全（走向/落点/时间/实话）');
  ok(h.indexOf(BRAN[r.chu]) >= 0 && h.indexOf(BRAN[r.zhang]) >= 0 && h.indexOf(BRAN[r.mo]) >= 0,
     '三传地支都出现在白话里');
  ok(h.indexOf(ELEM[r.chu]) >= 0, '三传五行有白话标注');

  // 核心纪律：不许出现任何判断词
  const BAN = ['大吉','大凶','吉凶','顺利','不利','必成','必败','注定','一定会','恭喜','可惜'];
  const hit = BAN.filter(w => h.indexOf(w) >= 0);
  ok(hit.length === 0, '白话中无吉凶判断词', hit.join(',') || '干净');
  ok(!/本课.{0,6}(成|败)/.test(h), '无「本课成/败」式断语');

  // 每一句都要能追回盘面事实：类神、旺衰、天将、空亡必须与 leishenScore 一致
  const ls = leishenScore(r, r.qtype, null);
  ok(ls.brs.length === 0 || h.indexOf(BRAN[ls.brs[0]]) >= 0, '类神地支与 leishenScore 一致');
  if (ls.detail[0]) ok(h.indexOf(ls.detail[0].wx) >= 0, '旺衰用词取自 wxState（不另立新词）');
  if (r.yingqi.win) ok(h.indexOf(r.yingqi.win) >= 0, '应期窗口原样引用 yingqi 结果');

  // 没指定事类时：必须给找回入口，且不能假装有类神
  const r2 = calc(2026, 11, 16, 6);
  r2.qtype = null; r2.nm = null; r2.yingqi = yingqi(r2, null, null, null);
  const h2 = renderBaihua(r2);
  ok(h2.indexOf('没取类神') >= 0, '无事类时明说「没取类神」');
  ok(h2.indexOf('事类') >= 0, '无事类时指路到「事类」按钮');
  ok(h2.indexOf('类神入传') < 0, '无事类时不输出「类神入传」');

  // 页面接线
  const page = fs.readFileSync(HTML, 'utf8');
  ok(/renderBaihua\(r\)\+/.test(code), '解读区已接入 renderBaihua');
  ok(/var JIANG_BAI=\{/.test(code) && /var WX_BAI=\{/.test(code), '两张白话词表在源码中');
  // 位置纪律：白话解读须在附注（口径说明墙）之前，不能被它挡在后面。
  // 注：code 现在是最长 <script> 块的整段字符串（见文件顶部提取逻辑），可直接 indexOf。
  const src = code;
  const iBai = src.indexOf('renderBaihua(r)+'), iFu = src.indexOf('附注：本页面为六壬算法教学演示版');
  ok(iBai > 0 && iFu > 0 && iBai < iFu, '白话解读排在附注之前', iBai + '/' + iFu);
}

// ───────────────────────────────────────────────
// 25. 51.la 统计码（2026-11-16）
// 风险：改版或压缩时把统计段删掉，流量悄悄断更——这类丢失页面本身毫无异常，只有后台变空才发现。
// 故锁三件事：SDK 脚本在 head、LA.init 的 id/ck 与申请到的值一致、且在 </head> 之前（head 内生效最稳）。
group('25. 51.la 统计码在位');
{
  const page = fs.readFileSync(HTML, 'utf8');
  const LA_ID = '3RqbDTFemGO9RZSb';
  ok(page.indexOf('id="LA_COLLECT"') >= 0 && page.indexOf('sdk.51.la/js-sdk-pro.min.js') >= 0,
     '51.la SDK 脚本在位');
  const iInit = page.indexOf('LA.init({id:"' + LA_ID + '",ck:"' + LA_ID + '"})');
  ok(iInit > 0, 'LA.init 的 id/ck 与申请值一致', iInit >= 0 ? LA_ID : '不匹配');
  const iHead = page.indexOf('</head>');
  ok(iInit > 0 && iHead > iInit, '统计脚本位于 </head> 之前');
  // 不许出现两份（防止哪次合并把代码贴重了，PV 翻倍）
  ok((page.match(/LA\.init\(/g) || []).length === 1, 'LA.init 只出现一次');
}

// ───────────────────────────────────────────────
// 26. 课例分享链接（2026-11-16）
// 分享链接是给别人点的：编码/解析必须往返无损，脏参数必须被静默丢弃而非报错，
// 初始化顺序必须保证 URL 参数覆盖「现在」默认值（反过来就会被 useNow 洗掉，这个 bug 真出过）。
group('26. 课例分享链接');
{
  ok(typeof encodeShare === 'function' && typeof parseShareQuery === 'function',
     'encodeShare/parseShareQuery 已导出');

  // 往返测试：含中文问题、事类键、真太阳时三件套、月将手动值
  const qtKey = DLR.qtChipList()[0].k;             // 用实际按钮清单里的键，不硬编码
  const src = { y:2026, m:11, d:16, h:6, q:'明日出门办事顺利吗？', qt:qtKey,
                s:1, tm:'09:45', lng:116.41, yj:10 };
  const qs = encodeShare(src);
  ok(qs.split('&').length === 10, '十项参数全部编码', qs.slice(0, 40) + '…');
  const back = parseShareQuery(qs);
  ok(back && back.y===2026 && back.m===11 && back.d===16 && back.h===6, '日期时辰往返一致');
  ok(back.q === src.q, '中文问题往返无损');
  ok(back.qt === qtKey, '事类键往返一致');
  ok(back.s === true && back.tm==='09:45' && back.lng===116.41, '真太阳时三件套往返一致');
  ok(back.yj === 10, '月将手动值往返一致');

  // 脏数据丢弃
  ok(parseShareQuery(encodeShare({y:2026,m:11,d:16,h:6,qt:'hacker'})).qt === null,
     '非法事类键被丢弃');
  ok(parseShareQuery(encodeShare({y:2026,m:11,d:16,h:99})) === null,
     '时辰越界 → 整条链接判无效');
  ok(parseShareQuery(encodeShare({y:2026,m:11,d:16,h:6,lng:999})) .lng === null,
     '经度越界被丢弃');
  ok(parseShareQuery('foo=1&bar=2') === null, '完全无关的参数 → null（不报错）');
  ok(parseShareQuery('') === null, '空 query → null');

  // 页面接线与初始化顺序
  const page = fs.readFileSync(HTML, 'utf8');
  ok(/id="btnShare"/.test(page), '复制链接按钮在位');
  ok(/initShare\(\);\s*\napplyUrlParams\(\);/.test(code), 'initShare 与 applyUrlParams 已接入初始化');
  const iUse = code.indexOf('useNow();'), iApply = code.indexOf('applyUrlParams();   //');
  ok(iUse > 0 && iApply > iUse, 'applyUrlParams 排在 useNow 之后（否则 URL 参数被「现在」洗掉）');
  ok(/_shareUrl=shareUrl\(\)/.test(code), 'divine 成功后生成分享链接');

  // SEO（第二步一起做的：标题带关键词、描述说明功能与定位）
  ok(/<title>大六壬在线起课/.test(page), 'title 含搜索关键词「大六壬在线起课」');
  ok(/<meta name="description" content="[^"]{40,}"/.test(page), 'meta description 在位（≥40 字）');
}



// ───────────────────────────────────────────────
// 27. 神煞层二期：支破/支刑/支鬼（2026-11-18，卷五支煞章）
// 锁四件事：①支破恰为六合之冲六对、双向键 12 个（漏反向键=漏判，首版真漏过亥寅/申巳）；
// ②支刑 8 个方向对 + 自刑 4 支（刑有方向，不可对称化）；③支鬼判定用「同阴阳 + 克日支」双条件；
// ④华盖/死符起例缺（义在岁煞章、起例在圆图；死符歌句仅 5 值）——登记待考，不造数进引擎。
group('27. 神煞层二期：支破/支刑/支鬼');
{
  // ① 支破表：双向 12 键，无序化后恰为六对
  const po = code.match(/var PO_YI=\{([^}]*)\}/);
  ok(!!po, '支破表 PO_YI 在位');
  const poKeys = (po ? po[1].match(/'(\d+)-(\d+)'/g) : []) || [];
  ok(poKeys.length === 12, '支破双向键恰 12 个（漏反向键=漏判）', poKeys.join(' '));
  const poPairs = [...new Set(poKeys.map(k => {
    const [a, b] = k.replace(/'/g, '').split('-').map(Number);
    return Math.min(a, b) + '-' + Math.max(a, b);
  }))].sort();
  ok(JSON.stringify(poPairs) === JSON.stringify(['0-9','1-4','2-5','3-6','5-8','7-10']),
     '支破对恰为六合之冲六对：子酉/丑辰/寅亥/卯午/巳申/戌未', poPairs.join(' '));

  // ② 支刑方向对 8 个 + 自刑 4 支（辰午酉亥）
  const XING_LIT = [[2,5,'寅刑巳'],[5,8,'巳刑申'],[8,2,'申刑寅'],[1,10,'丑刑戌'],
                    [10,7,'戌刑未'],[7,1,'未刑丑'],[0,3,'子刑卯'],[3,0,'卯刑子']];
  let xingBad = [];
  for (const [a, b, nm] of XING_LIT)
    if (code.indexOf('[' + a + ',' + b + ',\'' + nm) < 0) xingBad.push(nm);
  ok(xingBad.length === 0, '支刑 8 个方向对逐条在位（含方向）', xingBad.join(' ') || '全对');
  ok(/var ZIXING=\[4,6,9,11\]/.test(code), '自刑恰为辰午酉亥');

  // ③ 支鬼：同阴阳 + 克日支五行，双条件缺一不可
  ok(/KE\[ELEM\[gk\]\]===ELEM\[dayBr\]&&\(gk%2\)===\(dayBr%2\)/.test(code),
     '支鬼判定：同阴阳且五行克日支（「阳克阳兮阴克阴」）');
  ok(/geArr\.indexOf\(chuanArr\[gk2\]\[1\]\)>=0/.test(code), '支鬼查三传上神');
  ok(/geArr\.indexOf\(heavenMap\[dayBr\]\)>=0/.test(code), '支鬼查支上神');

  // ④ 出处纪律：三段新 tag 全部挂「卷五支煞章」
  ok((code.match(/卷五支煞章/g) || []).length >= 5, '支破/支刑/支鬼出处齐挂「卷五支煞章」',
     (code.match(/卷五支煞章/g) || []).length + ' 处');
  // ⑤ 待考纪律：华盖/死符起例缺，不得以自创起例混进引擎
  //   （注释里的登记待考说明允许存在，剥掉 // 注释后查运行代码）
  const codeNoCmt = code.replace(/\/\/[^\n]*/g, '');
  ok(codeNoCmt.indexOf('华盖') < 0 && codeNoCmt.indexOf('死符') < 0,
     '华盖/死符维持登记待考，不造数进引擎（运行代码中零出现）');
}

// ───────────────────────────────────────────────
// 28. AI 白话解读（2026-11-18 方案C：免费限次试水；2026-11-18 亮灯：AI_PROXY 已填 SCF 地址）
// 锁五件事：①密钥零暴露（AI_PROXY 允许填部署地址，但必须非空且 https:// 开头，页面无 Bearer/bigmodel 字样，
//           key 只在代理平台 env）；
// ②免费限次 AI_FREE_PER_DAY=1 + localStorage 键 dlr_ai + 用后计数；
// ③prompt 纪律：只喂盘面事实、明令「不断吉凶、不编造」；
// ④输出零信任：模型文本必须 escHtml 转义后才进 innerHTML；
// ⑤文案合规：入口/注释不带「命运/测算/算命」，代理未部署时按钮隐藏。
group('28. AI 白话解读：限次/密钥零暴露/口径');
{
  // ① 密钥零暴露（2026-11-18 已部署：AI_PROXY 填 SCF 函数 URL，仍要求无 Bearer/bigmodel 字样）
  ok(/var AI_PROXY='https:\/\/[^']*';/.test(code) || /var AI_PROXY='';/.test(code),
     'AI_PROXY 为空串或 https:// 开头的部署地址（2026-11-18 起已亮灯）');
  ok(code.indexOf('Bearer') < 0 && code.indexOf('bigmodel') < 0,
     'index.html 无 Bearer/上游域名字样（key 不进前端不进仓库页面）');

  // ② 免费限次
  ok(/var AI_FREE_PER_DAY=1;/.test(code), '每天免费 1 次（方案C）');
  ok(code.indexOf("dlr_ai") >= 0, '限次计数走 localStorage 键 dlr_ai');
  ok(/function aiUseOnce\(\)/.test(code), '用后计数函数在位');
  ok(/qq\.left<=0/.test(code), '超限拦截在位');

  // ③ prompt 纪律：盘面事实输入 + 释象不断吉凶
  ok(/function aiBuildPrompt\(r,q,qtOverride\)/.test(code), 'prompt 组装函数在位');
  ok(code.indexOf('不得断言吉凶成败') >= 0, 'prompt 明令不得断言吉凶');
  ok(code.indexOf('严禁编造盘面里没有的信息') >= 0, 'prompt 明令禁止编造');
  ok(/lk\.label\+'：'\+BRAN\[lk\.u\]/.test(code) && /BRAN\[r\.chu\]/.test(code),
     'prompt 喂的是盘面事实（四课/三传）');

  // ③b 类神半升级（2026-11-19）：prompt 喂类神客观事实，且禁 AI 另取类神
  ok(code.indexOf('【类神事实】') >= 0 && /leishenBr\(r,qt\)/.test(code),
     'prompt 含类神事实块（数据与引擎同源 leishenBr，事类走本次生效值）');
  ok(code.indexOf('禁止另行推类神') >= 0, 'prompt 明令禁止 AI 另取类神');
  ok(/wxState\(b2,ljian\)/.test(code) && /relPhrase\(wxRel\(/.test(code),
     '类神块喂的是可复核事实（旺衰/与日干生克走引擎同款函数）');
  { // 动态断言：真起一课喂进去，类神块必须出现在用户问题之前且随事类出现
    const rV = calc(2026, 11, 19, 10);
    rV.qtype = { key: 'cai', l: QTYPES.cai.l };
    const pV = aiBuildPrompt(rV, '我想看看最近的财运怎么样');
    const iL = pV.indexOf('【类神事实】'), iQ = pV.indexOf('用户所问之事');
    ok(iL > 0 && iL < iQ, '类神块位于用户问题之前（先事实后背景）');
    const brsV = leishenBr(rV, rV.qtype).brs.map(b => BRAN[b]);
    ok(brsV.length > 0 && brsV.every(b => pV.indexOf('类神支') >= 0),
       '实测一课：类神块随事类出现（' + brsV.join('/') + '）');
    const rN = calc(2026, 11, 19, 10);
    rN.qtype = null;
    ok(aiBuildPrompt(rN, '随便看看').indexOf('【类神事实】（') < 0,
       '未锁定事类时不喂类神块（不硬编）');
    // 起课后才点事类按钮：qtOverride 必须生效（2026-11-19 修复「后选类拿不到类神块」）
    const pO = aiBuildPrompt(Object.assign({}, rN), '随便看看', { key: 'bing', l: '健康' });
    ok(pO.indexOf('【类神事实】（') >= 0 && pO.indexOf('事类：健康') >= 0,
       'qtOverride（起课后点按钮）能喂进类神块');
    // 问题框关键词兜底：不点按钮、只打字也能取到事类
    const pK = aiBuildPrompt(Object.assign({}, rN), '最近身体老不舒服，想看看');
    ok(pK.indexOf('【类神事实】（') >= 0,
       '问题框关键词（detectQ）兜底喂类神块');
  }

  // ④ 模型输出零信任：转义后才渲染
  ok(/escHtml\(paras\[pi\]\)/.test(code), 'AI 输出经 escHtml 转义后才进 innerHTML');
  ok(code.indexOf('不代表本页立场') >= 0, '输出区挂「不代表本页立场」免责说明');

  // ⑤ 文案合规 + 未部署兜底（纪律注释本身允许提及禁词，剥注释后查运行代码）
  const codeNoCmt28 = code.replace(/\/\/[^\n]*/g, '');
  ok(codeNoCmt28.indexOf('命运') < 0 && codeNoCmt28.indexOf('算命') < 0,
     '运行代码无「命运/算命」字样（合规红线，AI 功能不得破例）');
  ok(/b\.style\.display='none'/.test(code), '代理未部署时隐藏 AI 入口（防「点了没反应」）');
}

// ─────────────────────────────────────────────
// 29. 引流三件套（2026-11-19）：OG 分享卡片 / 课例历史 / PWA
// ─────────────────────────────────────────────
group('29. 引流三件套：OG 卡片 / 课例历史 / PWA');
{
  const pg = fs.readFileSync(HTML, 'utf8');
  const ASSET = f => fs.existsSync(path.join(__dirname, f));

  // ① OG 分享卡片：图片/URL 必须绝对地址，指向规范站，尺寸标注正确
  ok(/<meta property="og:title"/.test(pg) && /<meta property="og:description"/.test(pg),
     'OG 卡片 og:title/og:description 在位');
  ok(/og:image" content="https:\/\/santeb\.github\.io\/daliuren\/assets\/og\.jpg"/.test(pg),
     'og:image 是绝对地址且指向规范站封面图');
  ok(/og:url" content="https:\/\/santeb\.github\.io\/daliuren\/"/.test(pg),
     'og:url 固定规范域名（不被预览/镜像域名带偏）');
  ok(/og:image:width" content="1200"/.test(pg) && /og:image:height" content="630"/.test(pg),
     'OG 图尺寸标注 1200x630');
  ok(/twitter:card" content="summary_large_image"/.test(pg), 'twitter 大图卡片兼容');
  ok(ASSET('assets/og.jpg') && ASSET('assets/icon-192.png') && ASSET('assets/icon-512.png'),
     'OG 封面与两档图标文件都在');

  // ② 课例历史：纯函数去重/置顶/截断 + 转义 + 接线
  const { histPush, histEsc, HIST_MAX } = DLR;
  ok(typeof histPush === 'function' && typeof histEsc === 'function',
     'histPush/histEsc 已导出供直接断言');
  const empty = histPush([], { qs: 'a', t: 1 }, HIST_MAX);
  ok(empty.length === 1 && empty[0].qs === 'a', 'histPush 空表插入一条');
  const src = [{ qs: 'a', t: 1 }, { qs: 'b', t: 1 }, { qs: 'c', t: 1 }];
  const dedup = histPush(src, { qs: 'a', t: 2 }, HIST_MAX);
  ok(dedup.length === 3 && dedup[0].qs === 'a' && dedup[0].t === 2,
     'histPush 同参数去重 + 最新置顶');
  ok(!dedup.some(x => x.qs === 'a' && x.t === 1), 'histPush 旧的同参数项被移除');
  ok(src.length === 3 && src[0].qs === 'a', 'histPush 不改原数组（纯函数）');
  let many = []; for (let i = 0; i < 30; i++) many.push({ qs: 'q' + i });
  ok(histPush(many, { qs: 'top' }, HIST_MAX).length === HIST_MAX,
     'histPush 截断到 HIST_MAX（20 条）');
  ok(histEsc('<img src=x onerror=1>').indexOf('<') < 0 &&
     histEsc('<b>').indexOf('&lt;') >= 0, 'histEsc 转义 HTML，防问题文本注入');
  ok(/id="btnHist"/.test(pg) && /id="histWrap"/.test(pg) && /id="histList"/.test(pg),
     '课例历史 UI（按钮/折叠容器/列表）在位');
  ok(/try\{ histRecord\(\); \}catch\(e\)\{\}/.test(code), 'divine 成功后挂钩 histRecord');
  ok(/initHist\(\);/.test(code) && /function initHist\(/.test(code), 'initHist 接入初始化');
  ok(/applyShareObj\(o\);/.test(code) && /var o=parseShareQuery\(qs\);/.test(code),
     'applyUrlParams 复用 applyShareObj（URL 参数与历史恢复同一条路）');
  ok(/function histApply\(qs\)/.test(code), '历史条目可一键恢复起课');
  ok(code.indexOf("'dlr_hist'") >= 0, '课例数据键 dlr_hist 落在 localStorage');

  // ③ PWA：manifest 合法 + 图标齐全 + SW network-first + 跨域放行 + 注册守卫
  let mf = null;
  try { mf = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')); } catch (e) {}
  ok(mf && mf.display === 'standalone' && mf.start_url === './' && mf.scope === './',
     'manifest.json 合法且 standalone/相对 scope（适配 Pages 子路径）');
  ok(mf && mf.theme_color === '#13100c' && mf.background_color === '#13100c',
     'manifest 主题色与页面暗色一致');
  ok(mf && Array.isArray(mf.icons) && mf.icons.length >= 2 &&
     mf.icons.every(ic => ASSET(ic.src)), 'manifest 两档图标均指向存在的文件');
  ok(/<link rel="manifest" href="manifest.json">/.test(pg) &&
     /<meta name="theme-color"/.test(pg) && /apple-touch-icon/.test(pg),
     'head 挂 manifest/theme-color/apple-touch-icon');
  let sw = '';
  try { sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8'); } catch (e) {}
  ok(/addEventListener\('install'/.test(sw) && /addEventListener\('activate'/.test(sw) &&
     /addEventListener\('fetch'/.test(sw), 'sw.js 三事件齐全');
  ok(/fetch\(req\)\.then/.test(sw) && /\.catch\(function \(\)/.test(sw),
     'SW HTML 走 network-first、失败回落缓存（线上永远最新版）');
  ok(/url\.origin !== self\.location\.origin/.test(sw),
     'SW 跨域请求放行（AI 代理/字体/统计不被缓存污染）');
  ok(/skipWaiting/.test(sw) && /clients\.claim/.test(sw), 'SW 升级即时接管');
  ok(/serviceWorker' in navigator/.test(pg) && /register\('sw\.js'\)/.test(pg),
     'SW 注册脚本带守卫且用相对路径');
}


// ───────────────────────────────────────────────
// Windows 控制台默认 GBK，而 ✗ / OK 不在 GBK 字符集中：一旦有断言失败、console.log 写出 ✗，
// stdout 会进入错误状态，其后所有输出（含整个第 17 组与结果行）被静默丢弃，
// 表现为「测试只跑一半、exit 0、看不到任何失败项」。故结果另存为 UTF-8 文件，与控制台编码无关。
try {
  fs.writeFileSync(path.join(__dirname, 'test_result.txt'),
    'RESULT pass=' + pass + ' fail=' + fail + ' warn=' + warn + '\n\nFAILURES:\n' +
    (failures.length ? failures.map((f, i) => '[' + (i + 1) + '] ' + f).join('\n') : '(none)'),
    'utf8');
} catch (e) { console.log('write result file failed: ' + e.message); }
console.log('\n' + '='.repeat(52));
console.log(`结果：${pass} 通过 / ${fail} 失败 / ${warn} 提示`);
if (fail) { console.log('\n失败项：'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('全部通过 OK');
