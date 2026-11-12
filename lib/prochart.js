// Pro analytics chart for the admin: metric tiles (views / orders / revenue / conversion / AOV),
// range switch (today by hour, 7 / 14 / 30 days), comparison with the previous period,
// hover tooltip with every metric of that day, peak + average markers and a day-by-day table.
const TZ = 'Europe/Helsinki';

function series(stock, S, visits) {
  const byDay = {};
  for (const o of S.all.filter(S.good)) { const k = stock.day(o.paidAt || o.created); const b = (byDay[k] = byDay[k] || { n: 0, r: 0 }); b.n++; b.r += o.total; }
  const top = (d, p) => Object.entries(d).filter(([k]) => k.startsWith(p)).map(([k, n]) => [k.slice(p.length), n]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const days = visits.map((d) => ({ k: d.day, v: d.views || 0, o: (byDay[d.day] || {}).n || 0, r: (byDay[d.day] || {}).r || 0, src: top(d, 'ref:'), ct: top(d, 'c:') }));
  const hours = (d = {}) => Array.from({ length: 24 }, (_, h) => d[`h:${String(h).padStart(2, '0')}`] || 0);
  const hourOf = (t) => Number(new Date(t).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })) % 24;
  const oh = (list) => { const o = Array(24).fill(0), r = Array(24).fill(0); for (const x of list.filter(S.good)) { const h = hourOf(x.paidAt || x.created); o[h]++; r[h] += x.total; } return { o, r }; };
  const t = visits[visits.length - 1] || {}, y = visits[visits.length - 2] || {};
  const start = days.findIndex((d) => d.v > 0 || d.o > 0);
  return {
    days, start, hourNow: hourOf(Date.now()),
    hourly: Object.keys(t).some((k) => k.startsWith('h:')),
    today: { v: hours(t), ...oh(S.today) }, yesterday: { v: hours(y), ...oh(S.yesterday) },
  };
}

const CSS = `
.pc-tabs{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--line);border-radius:14px;overflow:hidden;background:rgba(0,0,0,.25)}
.pc-tab{background:transparent;border:0;border-right:1px solid var(--line);padding:13px 15px 12px;text-align:left;cursor:pointer;font:inherit;color:var(--text);position:relative;transition:background .15s}
.pc-tab:last-child{border-right:0}.pc-tab:hover{background:rgba(255,255,255,.05)}
.pc-tab .l{font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);font-weight:800}
.pc-tab .v{font-size:21px;font-weight:800;letter-spacing:-.5px;margin-top:5px;line-height:1.1;font-variant-numeric:tabular-nums}
.pc-tab .d{font-size:11.5px;margin-top:4px;color:var(--muted);display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.pc-tab.on{background:linear-gradient(180deg,rgba(255,214,10,.2),rgba(255,214,10,.05));color:#fff;box-shadow:inset 0 -2px 0 var(--gold)}.pc-tab.on .l,.pc-tab.on .d{color:#C9CFDD}
.pc-tab.on::after{content:'';position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--gold)}
.pc-up{color:#34D399;font-weight:800}.pc-dn{color:#F87171;font-weight:800}.pc-fl{color:var(--muted);font-weight:700}
.pc-tab.on .pc-up{color:#4ADE80}.pc-tab.on .pc-dn{color:#F87171}
.pc-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0 4px;flex-wrap:wrap}
.pc-range{display:inline-flex;background:var(--line2);border-radius:10px;padding:3px;gap:2px}
.pc-range button{border:0;background:none;padding:6px 13px;border-radius:8px;font:inherit;font-size:12.5px;font-weight:800;color:var(--muted);cursor:pointer}
.pc-range button.on{background:var(--gold);color:var(--ink);box-shadow:0 4px 14px -4px rgba(255,214,10,.7)}
.pc-stats{display:flex;gap:6px 20px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}.pc-stats b{color:var(--text);font-variant-numeric:tabular-nums}
.pc-key{display:flex;gap:14px;font-size:11.5px;color:var(--muted);margin-top:10px;flex-wrap:wrap}.pc-key i{display:inline-block;width:14px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.pc-key i.p{height:0;border-top:2px dashed #9CA3AF;border-radius:0;vertical-align:3px}.pc-key i.a{height:0;border-top:1.5px dotted #C9CFDD;border-radius:0;vertical-align:3px}
.pc-plot{position:relative;margin-top:6px;touch-action:pan-y}
.pc svg{display:block;width:100%;overflow:visible}
.pc .gl{stroke:var(--line2)}.pc .gl0{stroke:var(--line)}.pc .ax{font-size:10.5px;fill:var(--muted);font-variant-numeric:tabular-nums}
.pc .b{fill:var(--gold);transition:opacity .12s}.pc .b.pk{fill:var(--gold2)}.pc.hov .b{opacity:.32}.pc.hov .b.h{opacity:1}
.pc .bz{fill:var(--line)}
.pc .pv{fill:none;stroke:#9CA3AF;stroke-width:1.6;stroke-dasharray:5 4}
.pc .avg{stroke:#C9CFDD;stroke-width:1.2;stroke-dasharray:2 3;opacity:.55}.pc .avgt{font-size:10px;font-weight:800;fill:#C9CFDD;paint-order:stroke;stroke:#10141F;stroke-width:3px}
.pc .nt{fill:rgba(255,255,255,.04)}.pc .ntt{font-size:10.5px;fill:#6F778B;font-weight:700}
.pc .vl{paint-order:stroke;stroke:#10141F;stroke-width:3px;font-size:10px;font-weight:800;fill:var(--text);font-variant-numeric:tabular-nums}
.pc .cur{stroke:#fff;stroke-width:1;opacity:.3}
.pc-tip{position:absolute;top:4px;left:0;pointer-events:none;background:#1A2030;color:#fff;border-radius:12px;padding:11px 13px;font-size:12px;min-width:210px;box-shadow:0 14px 40px rgba(0,0,0,.7),0 0 0 1px rgba(255,214,10,.25);opacity:0;z-index:5}
.pc-tip.on{opacity:1}.pc-tip h4{margin:0 0 7px;font-size:12.5px;color:var(--gold);letter-spacing:.2px}
.pc-tip .r{display:flex;justify-content:space-between;gap:16px;padding:1.5px 0;font-variant-numeric:tabular-nums}.pc-tip .r span{color:#9AA2B4}.pc-tip .r.s b{color:var(--gold)}
.pc-tip .x{border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;color:#C7CCD8;font-size:11.5px;line-height:1.5}
.pc-tbl{margin-top:16px;border-top:1px solid var(--line);max-height:340px;overflow:auto}
.pc-tbl table{width:100%;white-space:nowrap;border-collapse:collapse;font-size:12.5px}.pc-tbl th{position:sticky;top:0;background:#141926;text-align:left;font-size:10.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);padding:9px 8px;border-bottom:1px solid var(--line)}
.pc-tbl td{padding:7px 8px;border-bottom:1px solid var(--line2);font-variant-numeric:tabular-nums}.pc-tbl .r{text-align:right}.pc-tbl tr.z td{color:#5F6779}
.pc-tbl .mb{display:inline-block;height:6px;border-radius:3px;background:var(--gold);vertical-align:1px;margin-right:6px}
.pc-tbl tr.best td:first-child::after{content:' ★';color:var(--gold2)}
.pc-sum{cursor:pointer;font-size:12.5px;font-weight:800;color:var(--gold);margin-top:12px;display:inline-block}
.pc-note{font-size:12px;color:var(--muted);margin-top:8px}
@media(max-width:1100px){.pc-tabs{grid-template-columns:repeat(3,1fr)}.pc-tab:nth-child(3){border-right:0}.pc-tab:nth-child(-n+3){border-bottom:1px solid var(--line)}}
@media(max-width:600px){.pc-tabs{grid-template-columns:repeat(2,1fr)}.pc-tab{border-bottom:1px solid var(--line)}.pc-tab:nth-child(3){border-right:1px solid var(--line)}.pc-tab:nth-child(2n){border-right:0}.pc-tab .v{font-size:18px}}
`;

// client renderer (runs once per page, then window.TWChart(el, data, opts))
const JS = `(function(){if(window.TWChart)return;
var fi=function(n){return Math.round(n).toLocaleString('en-US')};
var fm=function(c){return '€'+(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})};
var fmc=function(c){var e=c/100;return '€'+(e>=1e6?(e/1e6).toFixed(1).replace('.0','')+'M':e>=1e4?Math.round(e/1e3)+'k':e>=1e3?(e/1e3).toFixed(1).replace('.0','')+'k':Math.round(e))};
var fic=function(n){return n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1).replace('.0','')+'k':fi(n)};
var fp=function(n){return n.toFixed(2)+'%'};
var M={v:{l:'Page views',f:fi,a:fic,sum:1},o:{l:'Orders',f:fi,a:fi,sum:1},r:{l:'Revenue',f:fm,a:fmc,sum:1},c:{l:'Conversion',f:fp,a:function(n){return n.toFixed(1)+'%'}},q:{l:'Avg. order',f:fm,a:fmc}};
var ORDER=['v','o','r','c','q'];
function val(m,x){return m==='c'?(x.v?x.o/x.v*100:0):m==='q'?(x.o?x.r/x.o:0):x[m]||0}
function agg(m,rows){var s={v:0,o:0,r:0};rows.forEach(function(x){s.v+=x.v;s.o+=x.o;s.r+=x.r});return val(m,s)}
function nice(x){if(x<=0)return 1;var p=Math.pow(10,Math.floor(Math.log10(x))),k=[1,1.2,1.5,2,2.5,3,4,5,6,8,10];for(var i=0;i<k.length;i++)if(k[i]*p>=x)return k[i]*p;return 10*p}
function dl(k,o){return new Date(k+'T12:00:00Z').toLocaleDateString('en-GB',Object.assign({timeZone:'UTC'},o))}
function dlt(c,p){if(!p&&!c)return '<span class="pc-fl">–</span>';if(!p)return '<span class="pc-up">new</span>';var d=(c-p)/p*100;return '<span class="'+(d>0.5?'pc-up':d<-0.5?'pc-dn':'pc-fl')+'">'+(d>0.5?'▲':d<-0.5?'▼':'•')+' '+Math.abs(d).toFixed(0)+'%</span>'}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
window.TWChart=function(el,D,opt){
 var st={m:opt.metric||'v',r:opt.range||30};try{var sv=JSON.parse(localStorage.getItem('tw-pc-'+opt.id)||'null');if(sv){st.m=sv.m||st.m;st.r=sv.r||st.r}}catch(e){}
 var tabs=el.querySelector('.pc-tabs'),rng=el.querySelector('.pc-range'),stats=el.querySelector('.pc-stats'),plot=el.querySelector('.pc-plot'),tip=el.querySelector('.pc-tip'),tbl=el.querySelector('.pc-tbl'),note=el.querySelector('.pc-note'),key=el.querySelector('.pc-key');
 var cur,prev,hourly;
 function build(){
  hourly=st.r==='h';
  if(hourly){var hn=D.hourNow;cur=[];prev=[];for(var h=0;h<24;h++){cur.push({k:(h<10?'0':'')+h+':00',h:h,v:D.today.v[h],o:D.today.o[h],r:D.today.r[h],fut:h>hn});prev.push({v:D.yesterday.v[h],o:D.yesterday.o[h],r:D.yesterday.r[h]})}}
  else{var n=st.r,d=D.days;cur=d.slice(-n).map(function(x,i){var gi=d.length-n+i;return Object.assign({nt:D.start<0||gi<D.start},x)});prev=d.slice(Math.max(0,d.length-2*n),d.length-n);while(prev.length<n)prev.unshift({v:0,o:0,r:0})}
 }
 function save(){try{localStorage.setItem('tw-pc-'+opt.id,JSON.stringify(st))}catch(e){}}
 function tiles(){
  var cmpPrev=hourly?prev.slice(0,D.hourNow+1):prev,cc=hourly?cur.slice(0,D.hourNow+1):cur;
  tabs.innerHTML=ORDER.map(function(m){return '<button type="button" class="pc-tab'+(m===st.m?' on':'')+'" data-m="'+m+'"><div class="l">'+M[m].l+'</div><div class="v">'+M[m].f(agg(m,cc))+'</div><div class="d">'+dlt(agg(m,cc),agg(m,cmpPrev))+' <span>vs '+(hourly?'yesterday same time':'prev. '+st.r+' days')+'</span></div></button>'}).join('');
 }
 function ranges(){rng.innerHTML=[['h','Today'],[7,'7D'],[14,'14D'],[30,'30D']].map(function(r){return '<button type="button" data-r="'+r[0]+'" class="'+(String(r[0])===String(st.r)?'on':'')+'">'+r[1]+'</button>'}).join('')}
 function lab(x,long){return hourly?x.k+(long?' – '+(x.h<9?'0':'')+(x.h+1)+':00':''):dl(x.k,long?{weekday:'short',day:'2-digit',month:'short',year:'numeric'}:{day:'2-digit',month:'short'})}
 function summary(){
  var m=st.m,f=M[m].f,live=cur.filter(function(x){return !x.fut&&!x.nt}),vals=live.map(function(x){return val(m,x)});
  if(!live.length){stats.innerHTML='';return}
  var bi=0,lo=0;vals.forEach(function(v,i){if(v>vals[bi])bi=i;if(v<vals[lo])lo=i});
  var unit=hourly?'hour':'day',zero=live.filter(function(x){return !val(m,x)}).length,ord=live.filter(function(x){return x.o}).length;
  var s=[];
  if(M[m].sum)s.push('Avg / '+unit+' <b>'+f(vals.reduce(function(a,b){return a+b},0)/live.length)+'</b>');
  s.push('Best '+unit+' <b>'+f(vals[bi])+'</b> · '+lab(live[bi]));
  s.push('Lowest <b>'+f(vals[lo])+'</b> · '+lab(live[lo]));
  s.push((hourly?'Hours':'Days')+' with orders <b>'+ord+' / '+live.length+'</b>');
  if(zero&&M[m].sum)s.push('Zero '+unit+'s <b>'+zero+'</b>');
  stats.innerHTML=s.map(function(x){return '<span>'+x+'</span>'}).join('');
 }
 function draw(){
  var m=st.m,w=Math.max(300,plot.clientWidth||760),H=opt.h||250,L=50,R=12,T=24,B=30,n=cur.length;
  var vals=cur.map(function(x){return x.fut?0:val(m,x)}),pv=prev.map(function(x){return val(m,x)});
  var mx=nice(Math.max.apply(null,vals.concat(pv,[0]))*1.08),bw=(w-L-R)/n,ih=H-T-B;
  var Y=function(v){return T+ih*(1-v/mx)},X=function(i){return L+i*bw+bw/2};
  var o='';
  // untracked area
  var nt=cur.map(function(x){return x.nt}).lastIndexOf(true);
  if(nt>=0&&!hourly){o+='<rect class="nt" x="'+L+'" y="'+T+'" width="'+(bw*(nt+1))+'" height="'+ih+'" rx="6"/>';if(bw*(nt+1)>90)o+='<text class="ntt" x="'+(L+bw*(nt+1)/2)+'" y="'+(T+ih/2)+'" text-anchor="middle">no tracking yet</text>'}
  for(var g=0;g<=4;g++){var gv=mx*g/4;o+='<line class="'+(g?'gl':'gl0')+'" x1="'+L+'" x2="'+(w-R)+'" y1="'+Y(gv)+'" y2="'+Y(gv)+'"/><text class="ax" x="'+(L-8)+'" y="'+(Y(gv)+3.5)+'" text-anchor="end">'+M[m].a(gv)+'</text>'}
  var bi=-1;vals.forEach(function(v,i){if(v>0&&(bi<0||v>vals[bi]))bi=i});
  var showVal=n<=14&&bw>26;
  vals.forEach(function(v,i){if(cur[i].fut||cur[i].nt)return;var bx=L+i*bw+bw*0.17,bW=bw*0.66,y=Y(v),h=Math.max(0,Y(0)-y);
   if(v<=0){o+='<rect class="b bz" data-i="'+i+'" x="'+bx+'" y="'+(Y(0)-2)+'" width="'+bW+'" height="2" rx="1"/>';return}
   o+='<rect class="b'+(i===bi?' pk':'')+'" data-i="'+i+'" x="'+bx+'" y="'+y+'" width="'+bW+'" height="'+h+'" rx="'+Math.min(5,bW/4)+'"/>';
   if(showVal||i===bi)o+='<text class="vl" x="'+X(i)+'" y="'+(y-6)+'" text-anchor="middle">'+(i===bi&&!showVal?'▲ ':'')+M[m].a(v)+'</text>'});
  if(pv.some(function(v){return v>0}))o+='<polyline class="pv" points="'+pv.map(function(v,i){return X(i)+','+Y(v)}).join(' ')+'"/>';
  var live=cur.filter(function(x){return !x.fut&&!x.nt});
  if(M[m].sum&&live.length){var av=live.reduce(function(a,x){return a+val(m,x)},0)/live.length;if(av>0){o+='<line class="avg" x1="'+L+'" x2="'+(w-R)+'" y1="'+Y(av)+'" y2="'+Y(av)+'"/><text class="avgt" x="'+(L+6)+'" y="'+(Y(av)-5)+'" text-anchor="start">avg '+M[m].a(av)+'</text>'}}
  var every=hourly?3:Math.ceil(n/(w<520?5:10));
  cur.forEach(function(x,i){if(i%every===0||i===n-1&&!hourly&&n<=31&&(n-1)%every>every/2)o+='<text class="ax" x="'+X(i)+'" y="'+(H-9)+'" text-anchor="middle">'+lab(x)+'</text>'});
  o+='<line class="cur" id="'+opt.id+'-cur" x1="-10" x2="-10" y1="'+T+'" y2="'+(T+ih)+'" style="display:none"/>';
  cur.forEach(function(x,i){o+='<rect data-i="'+i+'" x="'+(L+i*bw)+'" y="0" width="'+bw+'" height="'+H+'" fill="transparent"/>'});
  plot.querySelector('svg').setAttribute('viewBox','0 0 '+w+' '+H);plot.querySelector('svg').setAttribute('height',H);plot.querySelector('svg').innerHTML=o;
  plot._g={X:X,bw:bw,w:w};
  key.innerHTML='<span><i style="background:var(--gold)"></i>'+M[m].l+(hourly?' · today':' · last '+st.r+' days')+'</span><span><i class="p"></i>'+(hourly?'Yesterday':'Previous '+st.r+' days')+'</span>'+(M[m].sum?'<span><i class="a"></i>Average</span>':'');
 }
 function showTip(i){
  var x=cur[i];if(!x)return;var p=prev[i]||{v:0,o:0,r:0},m=st.m;
  el.classList.add('hov');plot.querySelectorAll('.b').forEach(function(b){b.classList.toggle('h',b.getAttribute('data-i')==String(i))});
  var c=plot.querySelector('.cur');var g=plot._g;c.setAttribute('x1',g.X(i));c.setAttribute('x2',g.X(i));c.style.display='';
  var h='<h4>'+lab(x,1)+'</h4>';
  if(x.nt)h+='<div class="x" style="border:0;margin:0;padding:0">Analytics was not tracking yet on this day.</div>';
  else if(x.fut)h+='<div class="x" style="border:0;margin:0;padding:0">Still to come today.</div>';
  else{ORDER.forEach(function(k){h+='<div class="r'+(k===m?' s':'')+'"><span>'+M[k].l+'</span><b>'+M[k].f(val(k,x))+'</b></div>'});
   h+='<div class="r"><span>'+(hourly?'Yesterday':'Prev. period')+' · '+M[m].l.toLowerCase()+'</span><b>'+M[m].f(val(m,p))+' '+dlt(val(m,x),val(m,p))+'</b></div>';
   var ex=[];if(x.src&&x.src.length)ex.push('Sources: '+x.src.map(function(s){return esc(s[0])+' '+fi(s[1])}).join(' · '));if(x.ct&&x.ct.length)ex.push('Countries: '+x.ct.map(function(s){return esc(s[0])+' '+fi(s[1])}).join(' · '));
   if(ex.length)h+='<div class="x">'+ex.join('<br>')+'</div>'}
  tip.innerHTML=h;tip.classList.add('on');
  var pw=plot.clientWidth,tw=tip.offsetWidth,px=g.X(i)*(pw/g.w);var left=px+14;if(left+tw>pw)left=px-tw-14;if(left<0)left=Math.max(0,Math.min(pw-tw,px-tw/2));tip.style.left=left+'px';
 }
 function hideTip(){el.classList.remove('hov');tip.classList.remove('on');var c=plot.querySelector('.cur');if(c)c.style.display='none'}
 function table(){
  var m=st.m,rows=cur.map(function(x,i){return {x:x,i:i}}).filter(function(r){return !r.x.fut&&!r.x.nt}).reverse();
  var mxv=Math.max.apply(null,rows.map(function(r){return r.x.v}).concat([1])),bv=Math.max.apply(null,rows.map(function(r){return val(m,r.x)}).concat([0]));
  tbl.innerHTML='<table><thead><tr><th>'+(hourly?'Hour':'Date')+'</th><th>Page views</th><th class="r">Orders</th><th class="r">Revenue</th><th class="r">Conv.</th><th class="r">AOV</th>'+(hourly?'':'<th>Top source</th><th>Top country</th>')+'</tr></thead><tbody>'+
  (rows.map(function(r){var x=r.x;return '<tr class="'+(!x.v&&!x.o?'z':'')+(bv&&val(m,x)===bv?' best':'')+'"><td>'+lab(x,0)+(hourly?'':' <span style="color:var(--muted)">'+dl(x.k,{weekday:'short'})+'</span>')+'</td><td><span class="mb" style="width:'+Math.round(x.v/mxv*70)+'px"></span>'+fi(x.v)+'</td><td class="r">'+(x.o||'–')+'</td><td class="r">'+(x.r?fm(x.r):'–')+'</td><td class="r">'+(x.v?fp(val('c',x)):'–')+'</td><td class="r">'+(x.o?fm(val('q',x)):'–')+'</td>'+(hourly?'':'<td>'+(x.src&&x.src[0]?esc(x.src[0][0])+' <span style="color:var(--muted)">'+fi(x.src[0][1])+'</span>':'–')+'</td><td>'+(x.ct&&x.ct[0]?esc(x.ct[0][0])+' <span style="color:var(--muted)">'+fi(x.ct[0][1])+'</span>':'–')+'</td>')+'</tr>'}).join('')||'<tr><td colspan="8" style="color:var(--muted)">No data in this range.</td></tr>')+'</tbody></table>';
 }
 function notes(){var t=[];if(hourly&&!D.hourly)t.push('Hourly page views are recorded from now on — the hours fill in as visitors arrive.');else if(!hourly&&cur.some(function(x){return x.nt}))t.push('Analytics started on '+(D.start>=0?dl(D.days[D.start].k,{day:'2-digit',month:'long'}):'—')+' — earlier days have no data, so they are greyed out and left out of averages.');note.innerHTML=t.join(' ');note.style.display=t.length?'':'none'}
 function all(){hideTip();build();tiles();ranges();summary();draw();table();notes();save()}
 tabs.addEventListener('click',function(e){var b=e.target.closest('[data-m]');if(b){st.m=b.getAttribute('data-m');all()}});
 rng.addEventListener('click',function(e){var b=e.target.closest('[data-r]');if(b){var r=b.getAttribute('data-r');st.r=r==='h'?'h':Number(r);all()}});
 var svg=plot.querySelector('svg');
 svg.addEventListener('mousemove',function(e){var t=e.target.getAttribute&&e.target.getAttribute('data-i');if(t!==null&&t!==undefined)showTip(Number(t))});
 svg.addEventListener('mouseleave',hideTip);
 svg.addEventListener('click',function(e){var t=e.target.getAttribute&&e.target.getAttribute('data-i');if(t!==null)showTip(Number(t))});
 var rt;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(draw,120)});
 all();
};})();`;

function render(id, data, { metric = 'v', range, h = 250, open = false } = {}) {
  // default to the range that actually holds data
  const tracked = data.start < 0 ? 0 : data.days.length - data.start;
  const r = range || (tracked <= 8 ? 7 : tracked <= 15 ? 14 : 30);
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<style>${CSS}</style><div class="pc" id="${id}">
<div class="pc-tabs"></div>
<div class="pc-bar"><div class="pc-stats"></div><div class="pc-range"></div></div>
<div class="pc-plot"><svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"></svg><div class="pc-tip"></div></div>
<div class="pc-key"></div>
<div class="pc-note"></div>
<details class="pc-det"${open ? ' open' : ''}><summary class="pc-sum">Day-by-day breakdown</summary><div class="pc-tbl"></div></details>
</div><script>${JS}</script><script>TWChart(document.getElementById(${JSON.stringify(id)}),${json},${JSON.stringify({ id, metric, range: r, h })});</script>`;
}

module.exports = { series, render };
