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
const code = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/);
if (!code) { console.error('未能在 index.html 中找到 <script>'); process.exit(1); }
const ctx = vm.createContext({ document: stub(), window: stub(), console });
vm.runInContext(code[1], ctx);
const DLR = ctx.DLR;
if (!DLR) { console.error('脚本未导出 DLR，无法测试'); process.exit(1); }

const { STEM, BRAN, calc, daySB, hourSB, monthSB, yearSB, getYueJiang, jqTime, afterJQ,
        ELEM, ELEM_S, LU_BR, DE_LU, CHANGSHENG_ORDER, mod,
        fortune, wxState, wxRel, WX_SCORE, FT_TH, getYongshen,
        keti, ketiScore, liuqin5, normQ, KT_SCORE, KT_SANHE_E, LQ5, QTYPES, KE, SHENG,
        XI_MAP, nianming, LEISHEN, liuWx, WX_BR } = DLR;

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
  ok(she === 82, `涉害三格合计 ${she} 课，恰合《粹言》53+26+3=82（涉害课总数守恒）`, String(she));
  ok((cnt['元首'] || 0) === 127,
    `元首 ${cnt['元首'] || 0} 课，与别本「一上克下名元首，计一百二十七」合（《粹言》则记 120）`, String(cnt['元首'] || 0));
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
