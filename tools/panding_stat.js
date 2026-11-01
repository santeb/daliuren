// 诊断：三态比例从哪里来 —— 统计硬否决命中率、不入传率、net 分布
const fs=require('fs'),vm=require('vm'),path=require('path');
function stub(){ const f=function(){return stub();}; return new Proxy(f,{
  get(t,k){ if(k==='value'||k==='innerHTML'||k==='textContent') return '';
            if(k==='checked') return false; if(k==='length') return 0;
            if(typeof k==='symbol') return undefined; return stub(); },
  set(){return true;},apply(){return stub();},construct(){return stub();}});}
const code=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/);
const ctx=vm.createContext({document:stub(),window:stub(),console});
vm.runInContext(code[1],ctx);
const {calc,panding,nianming,QTYPES,BRAN}=ctx.DLR;

const H={},N=[0,0,0]; let noC=0,tot=0,netSum=0;
let hardTot=0;
for(let d=0;d<120;d++){
  const r=calc(2026,1+(d%12),1+(d%28),d%12);
  const nm=nianming(r,1990,5,10,'男');
  for(const k of Object.keys(QTYPES)){
    const q={key:k,l:(QTYPES[k]&&QTYPES[k].l)||k};
    const pd=panding(r,q,nm);
    tot++; netSum+=pd.net||0;
    if(pd.ok===true)N[0]++; else if(pd.ok===false)N[1]++; else N[2]++;
    if(!pd.leishen.inC.length) noC++;
    (pd.hard||[]).forEach(h=>{H[h]=(H[h]||0)+1;});
    if((pd.hard||[]).length) hardTot++;
  }
}
const pc=n=>(n/tot*100).toFixed(1)+'%';
console.log('样本 '+tot+' 局（120 日 × '+Object.keys(QTYPES).length+' 事类）');
console.log('三态：可 '+pc(N[0])+'　难 '+pc(N[1])+'　难以遽断 '+pc(N[2]));
console.log('net 均值 '+(netSum/tot).toFixed(3));
console.log('类神不入三传 '+pc(noC)+'　硬否决命中率 '+pc(hardTot));
console.log('硬否决分项：');
Object.keys(H).forEach(h=>console.log('   '+h+'  '+pc(H[h])));
