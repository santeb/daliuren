// 人工检读：打印若干课的判词与应期，看措辞是否通顺、判据是否自洽
const fs=require('fs'),vm=require('vm'),path=require('path');
function stub(){ const f=function(){return stub();}; return new Proxy(f,{
  get(t,k){ if(k==='value'||k==='innerHTML'||k==='textContent') return '';
            if(k==='checked') return false; if(k==='length') return 0;
            if(typeof k==='symbol') return undefined; return stub(); },
  set(){return true;},apply(){return stub();},construct(){return stub();}});}
const code=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/);
const ctx=vm.createContext({document:stub(),window:stub(),console});
vm.runInContext(code[1],ctx);
const DLR=ctx.DLR;
const {calc,panding,yingqi,nianming,BRAN,QTYPES}=DLR;

const cases=[
  [2026,7,10,6,'cai'],[2026,3,15,4,'hun'],[2026,11,5,8,'chu'],
  [2026,1,20,2,'song'],[2026,5,8,10,'bing'],[2026,9,12,0,'xue']
];
for(const [y,m,d,hb,k] of cases){
  const r=calc(y,m,d,hb);
  const qt={key:k,l:(QTYPES&&QTYPES[k]&&QTYPES[k].l)||k};
  const nm=nianming(r,1990,5,10,'男');
  const pd=panding(r,qt,nm);
  const yq=yingqi(r,qt,nm,pd.ok);
  console.log('── '+y+'-'+m+'-'+d+' '+hb+'时 · '+qt.l+'　三传 '+
    BRAN[r.chu]+BRAN[r.zhang]+BRAN[r.mo]+'　'+r.zongmen);
  console.log('   【'+pd.verdict+'】');
  pd.lines.forEach(l=>console.log('     · '+l));
  console.log('   应期：'+yq.win+'　迟速：'+yq.speed);
  yq.lines.forEach(l=>console.log('     · '+l));
  console.log('');
}
