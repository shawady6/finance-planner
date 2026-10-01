
const SUPABASE_URL="https://tkuxfnpcjpykjjvvcgxf.supabase.co";
const SUPABASE_KEY="sb_publishable_v1eylrPBF0AQ2LZSbxXTfw__53ih_eb";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const DEFAULT_CATS=[
{name:"الأساسيات",icon:"🏠",percentage:30,type:"fixed",active:true},
{name:"الأكل والخروجات",icon:"🍔",percentage:10,type:"flexible",active:true},
{name:"المواصلات",icon:"🚗",percentage:10,type:"fixed",active:true},
{name:"الادخار",icon:"💰",percentage:20,type:"goal-linked",active:true},
{name:"الأهداف",icon:"🎯",percentage:20,type:"goal-linked",active:true},
{name:"الطوارئ",icon:"🆘",percentage:10,type:"rollover",active:true}
];
let state={settings:{id:null,currency:"EGP",monthly_salary:0,month_start_day:1},categories:[],goals:[],contribs:[],transactions:[],vaultTx:[],snapshots:[],commitments:[],debts:[],debtPayments:[]};
let page="home", selectedMonth=null, deferredPrompt=null, syncing=false, showLastMonthReview=false;
const DB_NAME="finance-planner-v2", DB_VERSION=2;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const uid=()=>crypto.randomUUID?crypto.randomUUID():"id"+Date.now()+Math.random().toString(36).slice(2);
function money(n){return (Number(n)||0).toLocaleString("en-US",{maximumFractionDigits:2})+" "+(state.settings.currency||"EGP")}
function monthKey(date=new Date()){const d=new Date(date),start=Number(state.settings.month_start_day)||1;let y=d.getFullYear(),m=d.getMonth();if(d.getDate()<start){m--;if(m<0){m=11;y--}}return `${y}-${String(m+1).padStart(2,"0")}`}
function monthName(k){const n=["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];let [y,m]=k.split("-");return `${n[+m-1]} ${y}`}
function activeCats(){return state.categories.filter(c=>c.active)}
function totalPct(){return topLevelCats().reduce((s,c)=>s+Number(c.percentage||0),0)}
function allocated(c,mk=monthKey()){
 const snap=state.snapshots.find(s=>s.month===mk);
 if(snap){const sc=(snap.categories||[]).find(x=>x.id===c.id);if(sc)return Number(snap.monthly_salary||0)*Number(sc.percentage||0)/100}
 return Number(state.settings.monthly_salary||0)*Number(c.percentage||0)/100;
}
function topLevelCats(){return activeCats().filter(c=>!c.parent_id)}
function childCats(catId){return activeCats().filter(c=>c.parent_id===catId)}
function spentIncludingChildren(catId,mk=monthKey()){return spent(catId,mk)+childCats(catId).reduce((s,ch)=>s+spent(ch.id,mk),0)}
function vaultBalance(type){return state.vaultTx.filter(t=>t.vault_type===type).reduce((s,t)=>s+(t.direction==='deposit'?Number(t.amount):-Number(t.amount)),0)}
function isTransferred(catId,mk){return state.vaultTx.some(t=>t.category_id===catId&&t.month===mk&&t.direction==='deposit')}
function unpaidTotal(catId,mk=monthKey()){return state.commitments.filter(cm=>cm.category_id===catId&&cm.active&&!isCommitmentChecked(cm.id,mk)).reduce((s,cm)=>s+Number(cm.expected_amount||0),0)}
function isCommitmentChecked(commitmentId,mk=monthKey()){return state.transactions.some(t=>t.commitment_id===commitmentId&&t.month===mk)}
function spent(catId,m=monthKey()){return state.transactions.filter(t=>t.category_id===catId&&t.month===m&&["expense","saving"].includes(t.type)).reduce((s,t)=>s+Number(t.amount||0),0)}
function totalSpent(m=monthKey()){return state.transactions.filter(t=>t.month===m&&["expense","saving"].includes(t.type)).reduce((s,t)=>s+Number(t.amount||0),0)}
function totalIncome(m=monthKey()){return state.transactions.filter(t=>t.month===m&&t.type==="income").reduce((s,t)=>s+Number(t.amount||0),0)+Number(state.settings.monthly_salary||0)}
function pct(a,b){return b>0?Math.min(100,Math.max(0,a/b*100)):0}
function prevMonthKey(mk){let [y,m]=mk.split("-").map(Number);m--;if(m<1){m=12;y--}return `${y}-${String(m).padStart(2,"0")}`}
function markClosed(catId,mk){state.closedTransfers[catId+":"+mk]=true;localStorage.setItem("fp_closed_transfers",JSON.stringify(state.closedTransfers))}
function toast(msg){const x=document.createElement("div");x.className="toast";x.textContent=msg;document.body.appendChild(x);setTimeout(()=>x.remove(),2300)}
function setSync(ok){$("#sync").innerHTML=`<i class="sync-dot ${ok?"":"off"}"></i>${ok?"متزامن":"محلي"}`}

/* ---- monthly snapshot + auto emergency transfer ---- */
async function upsertSnapshot(mk=monthKey()){
 const catsSnap=activeCats().map(c=>({id:c.id,name:c.name,percentage:c.percentage,type:c.type}));
 const existing=state.snapshots.find(s=>s.month===mk);
 if(existing){
   existing.monthly_salary=state.settings.monthly_salary;existing.categories=catsSnap;
   await localPut();
   if(existing.id)await mutate({op:'update',table:'monthly_budgets',id:existing.id,payload:{monthly_salary:existing.monthly_salary,categories:catsSnap,updated_at:new Date().toISOString()}});
 }else{
   const row={id:uid(),month:mk,monthly_salary:state.settings.monthly_salary,categories:catsSnap};
   state.snapshots.push(row);
   await localPut();
   await mutate({op:'insert',table:'monthly_budgets',payload:row});
 }
}
async function autoTransferEmergency(prevKey){
 for(const c of activeCats().filter(x=>x.type==='rollover')){
   if(isTransferred(c.id,prevKey))continue;
   const left=allocated(c,prevKey)-spent(c.id,prevKey);
   if(left<=0.009)continue;
   const tx={id:uid(),vault_type:'emergency',direction:'deposit',amount:left,reason:`ترحيل تلقائي من ${c.name} - ${monthName(prevKey)}`,category_id:c.id,month:prevKey,date:new Date().toISOString().slice(0,10)};
   state.vaultTx.unshift(tx);
   await localPut();
   await mutate({op:'insert',table:'vault_transactions',payload:tx});
 }
}
async function checkMonthRollover(){
 const last=localStorage.getItem("fp_last_month"), now=monthKey();
 if(last && last!==now){ await autoTransferEmergency(last); }
 localStorage.setItem("fp_last_month", now);
 await upsertSnapshot(now);
}

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("state"))d.createObjectStore("state");if(!d.objectStoreNames.contains("queue")){const q=d.createObjectStore("queue",{keyPath:"qid",autoIncrement:true});q.createIndex("created_at","created_at")}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function localGet(){const d=await openDB();return new Promise((res,rej)=>{const r=d.transaction("state","readonly").objectStore("state").get("app");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function localPut(){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction("state","readwrite");t.objectStore("state").put(state,"app");t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function queueAdd(op){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction("queue","readwrite");t.objectStore("queue").add({...op,created_at:Date.now()});t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function queueAll(){const d=await openDB();return new Promise((res,rej)=>{const r=d.transaction("queue","readonly").objectStore("queue").getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function queueDelete(qid){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction("queue","readwrite");t.objectStore("queue").delete(qid);t.oncomplete=res;t.onerror=()=>rej(t.error)})}

async function remote(op,table,payload,id){
 if(!navigator.onLine)return false;
 try{let q;if(op==="insert")q=sb.from(table).insert(payload);if(op==="update")q=sb.from(table).update(payload).eq("id",id);if(op==="delete")q=sb.from(table).delete().eq("id",id);const {error}=await q;if(error)throw error;return true}catch(e){console.warn("remote",op,table,e);return false}
}
async function mutate(op){await localPut();const ok=await remote(op.op,op.table,op.payload,op.id);if(ok)setSync(true);else{await queueAdd(op);setSync(false)}}
async function flushQueue(){if(syncing||!navigator.onLine)return;syncing=true;try{for(const q of await queueAll()){if(!navigator.onLine)break;const ok=await remote(q.op,q.table,q.payload,q.id);if(ok)await queueDelete(q.qid)}setSync((await queueAll()).length===0)}finally{syncing=false}}
async function pullRemote(){
 const [s,c,g,co,t,vt,mb,cm,db,dp]=await Promise.all([
  sb.from("settings").select("*").limit(1),
  sb.from("categories").select("*").order("created_at"),
  sb.from("goals").select("*").order("created_at"),
  sb.from("goal_contributions").select("*").order("date"),
  sb.from("transactions").select("*").order("date",{ascending:false}),
  sb.from("vault_transactions").select("*").order("date",{ascending:false}),
  sb.from("monthly_budgets").select("*"),
  sb.from("commitments").select("*").order("created_at"),
  sb.from("debts").select("*").order("created_at"),
  sb.from("debt_payments").select("*").order("date",{ascending:false})
 ]);
 const er=[s,c,g,co,t,vt,mb,cm,db,dp].find(x=>x.error);if(er)throw er.error;
 if(s.data?.length)state.settings=s.data[0];
 else{const {data}=await sb.from("settings").insert({currency:"EGP",monthly_salary:0,month_start_day:1}).select().single();if(data)state.settings=data;}
 if(c.data?.length)state.categories=c.data;
 else{const {data}=await sb.from("categories").insert(DEFAULT_CATS).select();if(data)state.categories=data;}
 if(g.data)state.goals=g.data;
 if(co.data)state.contribs=co.data;
 if(t.data)state.transactions=t.data;
 if(vt.data)state.vaultTx=vt.data;
 if(mb.data)state.snapshots=mb.data;
 if(cm.data)state.commitments=cm.data;
 if(db.data)state.debts=db.data;
 if(dp.data)state.debtPayments=dp.data;
 await localPut();
}
async function syncNow(){if(!navigator.onLine){toast("مفيش إنترنت دلوقتي");return}if(syncing)return;syncing=true;try{await flushQueue();await pullRemote();render();toast("تمت المزامنة")}catch(e){console.warn(e);setSync(false);toast("تعذر المزامنة — بياناتك المحلية محفوظة")}finally{syncing=false}}
async function bootstrap(){const cached=await localGet().catch(()=>null);if(cached){state=cached;await checkMonthRollover();render();setSync(false)}try{await flushQueue();if(navigator.onLine){await pullRemote();await checkMonthRollover();render();setSync((await queueAll()).length===0)}}catch(e){console.warn(e);toast("اشتغلنا من البيانات المحلية");setSync(false)}}
async function autoSync(){
 if(syncing||!navigator.onLine)return;
 syncing=true;
 try{
   await flushQueue();
   await pullRemote(); render();
 }catch(e){console.warn('autoSync',e)}
 finally{syncing=false}
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') autoSync(); });
window.addEventListener('focus',autoSync);
setInterval(()=>{ if(navigator.onLine) autoSync(); }, 45000);
window.addEventListener("online",()=>{toast("رجع الإنترنت — جاري المزامنة");syncNow()});

async function saveInsert(table,obj,localApply){localApply();await mutate({op:"insert",table,payload:obj});render()}
async function saveUpdate(table,id,patch,localApply){localApply();await mutate({op:"update",table,payload:patch,id});render()}
async function saveDelete(table,id,localApply){localApply();await mutate({op:"delete",table,id,payload:null});render()}

function render(){
 $("#title").textContent={home:"Finance Planner",budget:"الميزانية",goals:"الأهداف",tx:"العمليات",debts:"الديون",settings:"الإعدادات"}[page];
 const mk=selectedMonth||monthKey();$("#month").textContent=monthName(mk);$$("nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
 $("#fab").classList.toggle("hidden",!['goals','tx'].includes(page));$("#fab").onclick=()=>{page==='goals'?openGoal():openTx()};
 $("#main").innerHTML={home:home,budget:budget,goals:goals,tx:transactions,debts:debts,settings:settings}[page]();
 if(page==='settings')queueAll().then(q=>{const el=$('#pendingCount');if(el)el.textContent=q.length});
}
function renderVaultCard(type){
 const bal=vaultBalance(type);
 const label=type==='piggy'?'💰 الحصالة':'🆘 صندوق الطوارئ';
 const sub=type==='piggy'?'باقي الأساسيات والادخار':'تلقائي من الطوارئ';
 return `<div class="card" style="border-color:var(--green)"><div class="row"><b>${label}</b><span class="pill">${sub}</span></div><div class="big positive">${money(bal)}</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" onclick="withdrawVault('${type}')">سحب</button><button class="btn small secondary" onclick="openVaultGoalTransfer('${type}')">تحويل لهدف</button><button class="btn small secondary" onclick="showVaultLog('${type}')">السجل</button></div></div>`;
}
function home(){
 const m=monthKey(),income=totalIncome(m),s=totalSpent(m);
 const unpaid=activeCats().reduce((sum,c)=>sum+unpaidTotal(c.id,m),0);
 const remaining=income-s-unpaid,total=totalPct();
 const box=renderVaultCard('piggy')+renderVaultCard('emergency');
 const lentOpen=state.debts.filter(d=>d.direction==='lent'&&d.status!=='closed').reduce((sum,d)=>sum+Number(d.remaining_amount),0);
 const owedOpen=state.debts.filter(d=>d.direction==='owed'&&d.status!=='closed').reduce((sum,d)=>sum+Number(d.remaining_amount),0);
 const debtsCard=(lentOpen||owedOpen)?`<div class="card"><div class="row"><b>🤝 الديون</b><button class="btn secondary small" onclick="go('debts')">التفاصيل</button></div><div class="grid" style="margin-top:8px;margin-bottom:0"><div class="stat"><div class="muted">ليا عند الناس</div><b class="positive">${money(lentOpen)}</b></div><div class="stat"><div class="muted">عليّ للناس</div><b class="negative">${money(owedOpen)}</b></div></div></div>`:'';
 return `<div class="card"><div class="muted">💰 المتاح الفعلي للشهر</div><div class="big">${money(remaining)}</div><div class="hint">الدخل ${money(income)} · المصروف ${money(s)}${unpaid>0.009?' · التزامات لسه '+money(unpaid):''}</div></div><div class="grid"><div class="stat"><div class="muted">المُنفق</div><b>${money(s)}</b></div><div class="stat"><div class="muted">نسبة الصرف</div><b>${pct(s,income).toFixed(0)}%</b></div></div>${box}${debtsCard}<div class="card"><div class="row"><b>📊 استهلاك الدخل</b><b>${pct(s,income).toFixed(0)}%</b></div><div class="bar-bg"><div class="bar-fill ${s>income?'over':''}" style="width:${pct(s,income)}%"></div></div></div><div class="card"><div class="row"><b>🎯 أهدافك</b><button class="btn secondary small" onclick="go('goals')">كل الأهداف</button></div>${state.goals.length?state.goals.slice(0,3).map(goalCard).join(""):'<div class="empty">مفيش أهداف لسه.</div>'}</div><div class="card"><div class="row"><b>📐 توزيع الراتب</b><span class="${total===100?'positive':total>100?'negative':'accent'}">${total}%</span></div><div class="hint">يفضل إن مجموع النسب يكون 100%.</div></div>`;
}
function goalCard(g){const p=pct(g.current_amount,g.target_amount),rem=Math.max(0,Number(g.target_amount)-Number(g.current_amount));return `<div class="item"><div class="row"><b>${esc(g.icon||'🎯')} ${esc(g.name)}</b><span class="muted">${p.toFixed(0)}%</span></div><div class="bar-bg"><div class="bar-fill" style="width:${p}%"></div></div><div class="row muted"><span>${money(g.current_amount)} / ${money(g.target_amount)}</span><span>${money(rem)} متبقي</span></div></div>`}
function renderLastMonthReview(){
 const lm=prevMonthKey(monthKey());
 const rows=activeCats().map(c=>{
   const left=allocated(c,lm)-spent(c.id,lm);
   return {c,left};
 }).filter(x=>x.left>0.009 && !isTransferred(x.c.id,lm));
 if(!rows.length) return `<div class="card"><b>📅 مراجعة ${monthName(lm)}</b><div class="empty">مفيش باقي محتاج تحويل من الشهر ده.</div></div>`;
 return `<div class="card"><b>📅 مراجعة ${monthName(lm)}</b><div class="hint">حوّل الباقي من كل فئة للحصالة أو لصندوق الطوارئ</div></div>`+rows.map(({c,left})=>`<div class="item"><div class="row"><b>${esc(c.icon)} ${esc(c.name)}</b><span class="positive">${money(left)}</span></div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" onclick="transferLeftover('${c.id}','piggy','${lm}')">💰 للحصالة</button><button class="btn small secondary" onclick="transferLeftover('${c.id}','emergency','${lm}')">🆘 لصندوق الطوارئ</button></div></div>`).join("");
}
function toggleLastMonthReview(){showLastMonthReview=!showLastMonthReview;render()}
function renderCommitments(catId,mk){
 const list=state.commitments.filter(cm=>cm.category_id===catId&&cm.active);
 if(!list.length)return '';
 return `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">`+list.map(cm=>{
   const checked=isCommitmentChecked(cm.id,mk);
   return `<div class="row" style="margin-bottom:6px"><label style="display:flex;align-items:center;gap:8px;margin:0;flex:1;cursor:pointer"><input type="checkbox" style="width:auto;margin:0" ${checked?'checked':''} onchange="toggleCommitment('${cm.id}',this.checked)"><span style="${checked?'text-decoration:line-through;color:var(--muted)':''}">${esc(cm.name)}</span></label><span class="muted">${money(cm.expected_amount)}</span><button class="btn secondary small" style="padding:4px 8px;margin-right:4px" onclick="deleteCommitment('${cm.id}')">✕</button></div>`;
 }).join("")+`</div>`;
}
function renderSubCats(catId,mk){
 const kids=childCats(catId);
 if(!kids.length)return '';
 return `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">`+kids.map(k=>{
   const sp=spent(k.id,mk);
   return `<div class="row" style="margin-bottom:6px"><span class="muted">↳ ${esc(k.icon||'▫️')} ${esc(k.name)}</span><span>${money(sp)}</span><button class="btn secondary small" style="padding:4px 8px" onclick="quickSpend('${k.id}')">+</button><button class="btn secondary small" style="padding:4px 8px" onclick="showCatLog('${k.id}')">📋</button><button class="btn secondary small" style="padding:4px 8px" onclick="deleteSubCat('${k.id}')">✕</button></div>`;
 }).join("")+`</div>`;
}
function budget(){const m=selectedMonth||monthKey(),total=totalPct();
 const review=showLastMonthReview?renderLastMonthReview():'';
 return `<div class="card"><div class="row"><b>ميزانية ${monthName(m)}</b><b class="${total===100?'positive':total>100?'negative':'accent'}">${total}%</b></div><div class="hint">الراتب الأساسي ${money(state.settings.monthly_salary)} · <button class="btn secondary small" onclick="changeMonth('${m}')">تغيير الشهر</button></div></div><button class="btn secondary" style="width:100%;margin-bottom:12px" onclick="toggleLastMonthReview()">📅 ${showLastMonthReview?'إخفاء':'عرض'} الشهر اللي فات</button>${review}${topLevelCats().map(c=>{
   const a=allocated(c,m),s=spentIncludingChildren(c.id,m),unpaid=unpaidTotal(c.id,m),remaining=Math.max(0,a-s-unpaid),remPct=pct(remaining,a),over=(s+unpaid)>=a,warn=!over&&remPct<=20;
   const hasCommits=state.commitments.some(cm=>cm.category_id===c.id&&cm.active);
   const hasSubs=childCats(c.id).length>0;
   const isSuper=hasCommits||hasSubs;
   return `<div class="item ${isSuper?'super':''}"><div class="row"><b>${esc(c.icon||'🏷️')} ${esc(c.name)}${isSuper?'<span class="super-badge">تفاصيل</span>':''}</b><b class="${over?'negative':warn?'accent':'positive'}">${money(remaining)}</b></div><div class="bar-bg"><div class="bar-fill ${over?'over':warn?'warn':''}" style="width:${remPct}%"></div></div><div class="row muted"><span>${c.percentage}% من الراتب</span><span>مستخدم ${money(s)}${unpaid>0.009?' + '+money(unpaid)+' التزامات':''}</span></div>${renderCommitments(c.id,m)}${renderSubCats(c.id,m)}<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn small" onclick="quickSpend('${c.id}')">+ مصروف</button><button class="btn secondary small" onclick="openCat('${c.id}')">تعديل</button>${isSuper?`<button class="btn secondary small" onclick="openCommitmentModal('${c.id}')">+ التزام</button><button class="btn secondary small" onclick="openSubCatModal('${c.id}')">+ فئة فرعية</button>`:''}</div></div>`;
 }).join("")}<button class="btn secondary" style="width:100%" onclick="openCat()">+ إضافة فئة</button>`}
function promptMonth(current){const v=prompt("اكتب الشهر بصيغة YYYY-MM",current);return /^\d{4}-(0[1-9]|1[0-2])$/.test(v||"")?v:current}
function changeMonth(current){selectedMonth=promptMonth(current);render()}
function goals(){return `<div class="card"><div class="row"><b>🎯 أهدافي</b><span class="muted">${state.goals.length} أهداف</span></div></div>${state.goals.length?state.goals.map(g=>`<div class="item">${goalCard(g)}<div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" onclick="contribute('${g.id}')">+ إضافة مبلغ</button><button class="btn secondary small" onclick="openGoal('${g.id}')">تعديل</button><button class="btn danger small" onclick="deleteGoal('${g.id}')">حذف</button></div></div>`).join(""):'<div class="empty">اعمل أول هدف ليك: موبايل، لابتوب، سفر...</div>'}`}
function transactions(){const m=selectedMonth||monthKey(),arr=state.transactions.filter(t=>t.month===m).sort((a,b)=>String(b.date).localeCompare(String(a.date)));return `<div class="card"><div class="row"><b>عمليات ${monthName(m)}</b><button class="btn secondary small" onclick="changeMonth('${m}')">تغيير الشهر</button></div></div>${arr.length?arr.map(t=>{const c=state.categories.find(x=>x.id===t.category_id);const cls=t.type==='income'?'positive':t.type==='saving'?'accent':'negative';return `<div class="item row"><div><b>${esc(c?.icon||'💸')} ${esc(c?.name||'عملية')}</b><div class="muted">${esc(t.date)}${t.note?' · '+esc(t.note):''}</div></div><div style="text-align:left"><b class="${cls}">${t.type==='income'?'+':'-'}${money(t.amount)}</b><div><button class="btn secondary small" onclick="openTx('${t.id}')">تعديل</button></div></div></div>`}).join(""):'<div class="empty">مفيش عمليات في الشهر ده.</div>'}`}
function settings(){return `<div class="card"><b>⚙️ إعدادات الخطة</b><label>الراتب الشهري</label><input id="salary" type="number" value="${Number(state.settings.monthly_salary||0)}"><label>العملة</label><input id="currency" value="${esc(state.settings.currency||'EGP')}"><label>بداية الشهر المالي</label><input id="startDay" type="number" min="1" max="28" value="${Number(state.settings.month_start_day||1)}"><button class="btn" style="width:100%" onclick="saveSettings()">حفظ</button></div><div class="card"><b>☁️ المزامنة</b><div class="hint" style="margin-top:8px">عدد العمليات المنتظرة للمزامنة: <b id="pendingCount">...</b></div><button class="btn secondary" style="width:100%;margin-top:9px" onclick="syncNow()">مزامنة الآن</button></div><div class="card"><b>🔐 الحساب</b><button class="btn danger" style="width:100%;margin-top:9px" onclick="doLogout()">تسجيل خروج</button></div><div class="card"><b>💾 نسخة احتياطية</b><div class="hint">صدّر كل بيانات التطبيق إلى JSON أو استورد نسخة محفوظة.</div><div style="display:flex;gap:7px;margin-top:9px"><button class="btn secondary" onclick="exportData()">تصدير</button><button class="btn secondary" onclick="$('#importFile').click()">استيراد</button><input id="importFile" type="file" accept="application/json" class="hidden" onchange="importData(event)"></div></div>`}

async function transferLeftover(catId,dest,mk){
 const cat=state.categories.find(x=>x.id===catId);if(!cat)return;
 const left=allocated(cat,mk)-spent(catId,mk);
 if(left<=0)return;
 const tx={id:uid(),vault_type:dest,direction:'deposit',amount:left,reason:`ترحيل من ${cat.name} - ${monthName(mk)}`,category_id:catId,month:mk,date:new Date().toISOString().slice(0,10)};
 state.vaultTx.unshift(tx);
 render();
 await localPut();
 await mutate({op:'insert',table:'vault_transactions',payload:tx});
 toast('تم التحويل لـ '+(dest==='piggy'?'الحصالة':'صندوق الطوارئ'));
}
async function withdrawVault(type){
 const bal=vaultBalance(type);
 const amount=Number(prompt('المبلغ المسحوب؟'));
 if(!amount||amount<=0)return;
 if(amount>bal){toast('المبلغ أكبر من الرصيد المتاح');return}
 const reason=prompt('سبب السحب؟')||'';
 const tx={id:uid(),vault_type:type,direction:'withdrawal',amount,reason,date:new Date().toISOString().slice(0,10)};
 state.vaultTx.unshift(tx);
 render();
 await localPut();
 await mutate({op:'insert',table:'vault_transactions',payload:tx});
 toast('تم تسجيل السحب');
}
function openVaultGoalTransfer(type){
 const active=state.goals.filter(g=>g.status!=='completed');
 if(!active.length){toast('مفيش أهداف نشطة تحول ليها');return}
 const opts=active.map(g=>`<option value="${g.id}">${esc(g.icon)} ${esc(g.name)}</option>`).join("");
 modal('تحويل لهدف',`<label>الهدف</label><select id="vgGoal">${opts}</select><label>المبلغ</label><input id="vgAmount" type="number"><button class="btn" style="width:100%" onclick="confirmVaultGoalTransfer('${type}')">تأكيد</button>`);
}
async function confirmVaultGoalTransfer(type){
 const goalId=$("#vgGoal").value,amount=Number($("#vgAmount").value);
 if(!amount||amount<=0)return;
 const bal=vaultBalance(type);
 if(amount>bal){toast('المبلغ أكبر من الرصيد المتاح');return}
 const g=state.goals.find(x=>x.id===goalId);if(!g)return;
 g.current_amount=Number(g.current_amount)+amount;
 const reachedGoal=g.current_amount>=Number(g.target_amount);
 if(reachedGoal)g.status='completed';
 closeModal();render();
 await localPut();
 await mutate({op:'update',table:'goals',id:g.id,payload:{current_amount:g.current_amount,status:g.status}});
 const contrib={id:uid(),goal_id:g.id,amount,date:new Date().toISOString().slice(0,10)};
 state.contribs.push(contrib);
 await mutate({op:'insert',table:'goal_contributions',payload:contrib});
 const tx={id:uid(),vault_type:type,direction:'goal_transfer',amount,reason:`تحويل لهدف: ${g.name}`,goal_id:g.id,date:new Date().toISOString().slice(0,10)};
 state.vaultTx.unshift(tx);
 await mutate({op:'insert',table:'vault_transactions',payload:tx});
 toast(reachedGoal?'وصل الهدف 100%! 🎉':'تم التحويل');
}
function showVaultLog(type){
 const logs=state.vaultTx.filter(t=>t.vault_type===type).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 const label=type==='piggy'?'سجل الحصالة':'سجل صندوق الطوارئ';
 const body=logs.length?logs.map(t=>{const lbl=t.direction==='withdrawal'?'سحب':t.direction==='goal_transfer'?'تحويل لهدف':'إيداع';const cls=t.direction==='deposit'?'positive':'negative';return `<div class="item row"><div><b>${lbl}</b><div class="muted">${esc(t.date)}${t.reason?' · '+esc(t.reason):''}</div></div><b class="${cls}">${t.direction==='deposit'?'+':'-'}${money(t.amount)}</b></div>`}).join(""):'<div class="empty">مفيش عمليات بعد.</div>';
 modal(label,body);
}
function debtCard(d){
 const p=pct(Number(d.amount)-Number(d.remaining_amount),d.amount);
 const closed=d.status==='closed';
 const overdue=d.due_date&&!closed&&d.due_date<new Date().toISOString().slice(0,10);
 return `<div class="item"><div class="row"><b>${esc(d.person_name)}</b><span class="${closed?'positive':overdue?'negative':'muted'}">${closed?'مقفول':overdue?'متأخر':money(d.remaining_amount)+' متبقي'}</span></div>${d.purpose?`<div class="muted" style="font-size:12px">${esc(d.purpose)}</div>`:''}${!closed?`<div class="bar-bg"><div class="bar-fill" style="width:${p}%"></div></div>`:''}<div class="row muted" style="font-size:12px"><span>الأصل ${money(d.amount)}</span>${d.due_date?`<span>يستحق ${esc(d.due_date)}</span>`:''}</div>${!closed?`<div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" onclick="${d.direction==='lent'?'collectPayment':'payDebt'}('${d.id}')">${d.direction==='lent'?'تحصيل':'دفع قسط'}</button><button class="btn secondary small" onclick="showDebtLog('${d.id}')">السجل</button></div>`:''}</div>`;
}
function debts(){
 const lent=state.debts.filter(d=>d.direction==='lent'),owed=state.debts.filter(d=>d.direction==='owed');
 return `<div class="card"><div class="row"><b>🟢 ليا عند الناس</b><button class="btn small" onclick="openLendModal()">+ سلفة جديدة</button></div></div>${lent.length?lent.map(debtCard).join(""):'<div class="empty">مفيش سلف لسه.</div>'}<div class="card"><div class="row"><b>🔴 عليّ للناس</b><button class="btn small" onclick="openBorrowModal()">+ دين جديد</button></div></div>${owed.length?owed.map(debtCard).join(""):'<div class="empty">مفيش ديون عليك.</div>'}`;
}
function openLendModal(){
 modal('سلفة لحد',`<label>اسم الشخص</label><input id="dPerson"><label>المبلغ</label><input id="dAmount" type="number"><label>الغرض (اختياري)</label><input id="dPurpose"><label>تاريخ السداد المتوقع (اختياري)</label><input id="dDue" type="date"><label>المصدر</label><select id="dSource"><option value="piggy">💰 الحصالة</option><option value="emergency">🆘 صندوق الطوارئ</option><option value="outside">من برة الميزانية</option></select><button class="btn" style="width:100%" onclick="confirmLend()">تأكيد</button>`);
}
async function confirmLend(){
 const person=$("#dPerson").value.trim(),amount=Number($("#dAmount").value),source=$("#dSource").value;
 if(!person||amount<=0)return;
 if(source!=='outside'&&amount>vaultBalance(source)){toast('المبلغ أكبر من رصيد المصدر');return}
 const d={id:uid(),direction:'lent',person_name:person,amount,remaining_amount:amount,purpose:$("#dPurpose").value||null,due_date:$("#dDue").value||null,source,status:'open'};
 closeModal();
 await saveInsert('debts',d,()=>state.debts.push(d));
 if(source!=='outside'){
   const tx={id:uid(),vault_type:source,direction:'withdrawal',amount,reason:`سلفة لـ ${person}`,date:new Date().toISOString().slice(0,10)};
   state.vaultTx.unshift(tx);await localPut();await mutate({op:'insert',table:'vault_transactions',payload:tx});render();
 }
}
function openBorrowModal(){
 modal('دين جديد (عليّ)',`<label>اسم الشخص</label><input id="dPerson"><label>المبلغ</label><input id="dAmount" type="number"><label>الغرض (اختياري)</label><input id="dPurpose"><label>تاريخ السداد المتوقع (اختياري)</label><input id="dDue" type="date"><button class="btn" style="width:100%" onclick="confirmBorrow()">تأكيد</button>`);
}
async function confirmBorrow(){
 const person=$("#dPerson").value.trim(),amount=Number($("#dAmount").value);
 if(!person||amount<=0)return;
 const d={id:uid(),direction:'owed',person_name:person,amount,remaining_amount:amount,purpose:$("#dPurpose").value||null,due_date:$("#dDue").value||null,source:null,status:'open'};
 closeModal();
 await saveInsert('debts',d,()=>state.debts.push(d));
}
async function collectPayment(id){
 const d=state.debts.find(x=>x.id===id);if(!d)return;
 const amount=Number(prompt('المبلغ المحصّل؟'));
 if(!amount||amount<=0)return;
 d.remaining_amount=Math.max(0,Number(d.remaining_amount)-amount);
 if(d.remaining_amount<=0.009)d.status='closed';
 render();
 await localPut();
 await mutate({op:'update',table:'debts',id:d.id,payload:{remaining_amount:d.remaining_amount,status:d.status}});
 const pay={id:uid(),debt_id:d.id,amount,source:d.source,date:new Date().toISOString().slice(0,10)};
 state.debtPayments.unshift(pay);
 await mutate({op:'insert',table:'debt_payments',payload:pay});
 if(d.source&&d.source!=='outside'){
   const tx={id:uid(),vault_type:d.source,direction:'deposit',amount,reason:`تحصيل من ${d.person_name}`,date:new Date().toISOString().slice(0,10)};
   state.vaultTx.unshift(tx);await localPut();await mutate({op:'insert',table:'vault_transactions',payload:tx});
 }
 toast(d.status==='closed'?'اتقفل الدين 🎉':'تم التحصيل');
}
async function payDebt(id){
 const d=state.debts.find(x=>x.id===id);if(!d)return;
 const amount=Number(prompt('المبلغ اللي هتدفعه؟'));
 if(!amount||amount<=0)return;
 const opts=activeCats().map(c=>`فئة:${c.id}=${c.name}`).concat(['حصالة:piggy=الحصالة','طوارئ:emergency=صندوق الطوارئ']).map(o=>o.split('=')[1]).join(' / ');
 const choice=prompt('ادفع من إيه؟ اختار بالظبط: '+opts);
 if(!choice)return;
 const cat=activeCats().find(c=>c.name===choice);
 const vaultType=choice==='الحصالة'?'piggy':choice==='صندوق الطوارئ'?'emergency':null;
 if(!cat&&!vaultType){toast('اختيار مش مفهوم، جرب تاني');return}
 d.remaining_amount=Math.max(0,Number(d.remaining_amount)-amount);
 if(d.remaining_amount<=0.009)d.status='closed';
 render();
 await localPut();
 await mutate({op:'update',table:'debts',id:d.id,payload:{remaining_amount:d.remaining_amount,status:d.status}});
 const pay={id:uid(),debt_id:d.id,amount,source:cat?cat.name:vaultType,date:new Date().toISOString().slice(0,10)};
 state.debtPayments.unshift(pay);
 await mutate({op:'insert',table:'debt_payments',payload:pay});
 if(cat){
   const tx={id:uid(),type:'expense',category_id:cat.id,amount,date:new Date().toISOString().slice(0,10),month:monthKey(),note:`سداد دين: ${d.person_name}`};
   state.transactions.unshift(tx);await localPut();await mutate({op:'insert',table:'transactions',payload:tx});
 }else{
   const tx={id:uid(),vault_type:vaultType,direction:'withdrawal',amount,reason:`سداد دين: ${d.person_name}`,date:new Date().toISOString().slice(0,10)};
   state.vaultTx.unshift(tx);await localPut();await mutate({op:'insert',table:'vault_transactions',payload:tx});
 }
 toast(d.status==='closed'?'اتسدد الدين بالكامل 🎉':'تم تسجيل الدفعة');
}
function showDebtLog(id){
 const logs=state.debtPayments.filter(p=>p.debt_id===id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 const body=logs.length?logs.map(p=>`<div class="item row"><div><b>${esc(p.source||'')}</b><div class="muted">${esc(p.date)}</div></div><b class="positive">${money(p.amount)}</b></div>`).join(""):'<div class="empty">مفيش دفعات بعد.</div>';
 modal('سجل الدفعات',body);
}
function modal(title,body){$("#modalRoot").innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="row"><h3>${title}</h3><button class="btn secondary small" onclick="closeModal()">إغلاق</button></div>${body}</div></div>`}
function closeModal(){$("#modalRoot").innerHTML=""}
function catOptionsHtml(selectedId){
 return topLevelCats().map(c=>{
   let html=`<option value="${c.id}" ${selectedId===c.id?'selected':''}>${esc(c.icon)} ${esc(c.name)}</option>`;
   childCats(c.id).forEach(k=>{html+=`<option value="${k.id}" ${selectedId===k.id?'selected':''}>&nbsp;&nbsp;↳ ${esc(k.icon)} ${esc(k.name)}</option>`});
   return html;
 }).join("");
}
function openTx(id){const old=id?state.transactions.find(x=>x.id===id):null,opts=catOptionsHtml(old?.category_id);modal(old?'تعديل العملية':'إضافة عملية',`<label>النوع</label><select id="tt"><option value="expense" ${old?.type==='expense'?'selected':''}>مصروف</option><option value="income" ${old?.type==='income'?'selected':''}>دخل</option><option value="saving" ${old?.type==='saving'?'selected':''}>ادخار</option></select><label>الفئة</label><select id="tc">${opts}</select><label>المبلغ</label><input id="ta" type="number" value="${old?.amount||''}"><label>التاريخ</label><input id="td" type="date" value="${old?.date||new Date().toISOString().slice(0,10)}"><label>ملاحظة</label><input id="tn" value="${esc(old?.note||'')}"><button class="btn" style="width:100%" onclick="saveTx('${id||''}')">${old?'حفظ':'إضافة'}</button>${old?`<button class="btn danger" style="width:100%;margin-top:8px" onclick="deleteTx('${id}')">حذف العملية</button>`:''}`)}
async function saveTx(id){const amount=Number($("#ta").value);if(amount<=0)return;const date=$("#td").value||new Date().toISOString().slice(0,10);const obj={id:id||uid(),type:$("#tt").value,category_id:$("#tc").value,amount,date,month:monthKey(date),note:$("#tn").value||""};closeModal();if(id)await saveUpdate("transactions",id,obj,()=>{const i=state.transactions.findIndex(x=>x.id===id);if(i>=0)state.transactions[i]=obj});else await saveInsert("transactions",obj,()=>state.transactions.unshift(obj));toast("تم حفظ العملية")}
async function deleteTx(id){if(!confirm('تحذف العملية؟'))return;closeModal();await saveDelete('transactions',id,()=>{state.transactions=state.transactions.filter(x=>x.id!==id)});toast('اتحذفت العملية')}
async function quickSpend(catId){
 const name=prompt('اسم الحاجة اللي اتصرفت عليها؟ (اختياري)')||'';
 const amount=Number(prompt('المبلغ؟'));
 if(!amount||amount<=0)return;
 const obj={id:uid(),type:'expense',category_id:catId,amount,date:new Date().toISOString().slice(0,10),month:monthKey(),note:name};
 await saveInsert('transactions',obj,()=>state.transactions.unshift(obj));
 toast('اتسجل المصروف');
}
function showCatLog(catId){
 const mk=monthKey();
 const cat=state.categories.find(x=>x.id===catId);
 const items=state.transactions.filter(t=>t.category_id===catId&&t.month===mk&&t.type==='expense').sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 const body=items.length?items.map(t=>`<div class="item row"><div><b>${esc(t.note||'بدون اسم')}</b><div class="muted">${esc(t.date)}</div></div><b class="negative">${money(t.amount)}</b></div>`).join(""):'<div class="empty">مفيش عمليات مسجلة الشهر ده.</div>';
 modal('سجل '+(cat?.name||''),body);
}
function openGoal(id){const old=id?state.goals.find(x=>x.id===id):null;modal(old?'تعديل الهدف':'هدف مالي جديد',`<label>الاسم</label><input id="gn" value="${esc(old?.name||'')}" placeholder="مثال: iPhone"><label>الرمز</label><input id="gi" value="${esc(old?.icon||'🎯')}"><label>المبلغ المستهدف</label><input id="gt" type="number" value="${old?.target_amount||''}"><label>المساهمة الشهرية</label><input id="gm" type="number" value="${old?.monthly_target||''}"><label>الحالة</label><select id="gs"><option value="active" ${old?.status!=='completed'?'selected':''}>نشط</option><option value="completed" ${old?.status==='completed'?'selected':''}>مكتمل</option></select><button class="btn" style="width:100%" onclick="saveGoal('${id||''}')">${old?'حفظ':'إنشاء الهدف'}</button>`)}
async function saveGoal(id){const name=$("#gn").value.trim(),target=Number($("#gt").value);if(!name||target<=0)return;const obj={id:id||uid(),name,icon:$("#gi").value||'🎯',target_amount:target,current_amount:id?Number(state.goals.find(g=>g.id===id)?.current_amount||0):0,monthly_target:Number($("#gm").value)||0,status:$("#gs").value};closeModal();if(id)await saveUpdate('goals',id,obj,()=>Object.assign(state.goals.find(g=>g.id===id),obj));else await saveInsert('goals',obj,()=>state.goals.push(obj));toast('تم حفظ الهدف')}
async function deleteGoal(id){if(!confirm('تحذف الهدف وكل مساهماته؟'))return;await saveDelete('goals',id,()=>{state.goals=state.goals.filter(g=>g.id!==id);state.contribs=state.contribs.filter(c=>c.goal_id!==id)});for(const c of state.contribs.filter(c=>c.goal_id===id))await remote('delete','goal_contributions',null,c.id);toast('اتحذف الهدف')}
async function contribute(id){const amount=Number(prompt('هتضيف كام؟'));if(!amount||amount<=0)return;const g=state.goals.find(x=>x.id===id);if(!g)return;const c={id:uid(),goal_id:id,amount,date:new Date().toISOString().slice(0,10)};g.current_amount=Number(g.current_amount)+amount;await localPut();await mutate({op:'insert',table:'goal_contributions',payload:c});await mutate({op:'update',table:'goals',id,payload:{current_amount:g.current_amount}});render();toast('تمت إضافة المساهمة')}
function openCommitmentModal(catId){
 modal('التزام جديد',`<label>الاسم</label><input id="cmName" placeholder="مثال: إنترنت"><label>المبلغ المتوقع (أسوأ حالة)</label><input id="cmAmount" type="number"><label>يوم الاستحقاق (اختياري)</label><input id="cmDay" type="number" min="1" max="31"><button class="btn" style="width:100%" onclick="saveCommitment('${catId}')">إضافة</button>`);
}
async function saveCommitment(catId){
 const name=$("#cmName").value.trim(),amount=Number($("#cmAmount").value);
 if(!name||amount<=0)return;
 const day=Number($("#cmDay").value)||null;
 const obj={id:uid(),name,category_id:catId,expected_amount:amount,due_day:day,active:true};
 closeModal();
 await saveInsert('commitments',obj,()=>state.commitments.push(obj));
}
async function deleteCommitment(id){
 if(!confirm('تحذف الالتزام ده؟'))return;
 await saveDelete('commitments',id,()=>{state.commitments=state.commitments.filter(c=>c.id!==id)});
}
async function toggleCommitment(id,checked){
 const cm=state.commitments.find(x=>x.id===id);if(!cm)return;
 const mk=monthKey();
 if(checked){
   let amount=Number(prompt('المبلغ الفعلي المدفوع؟',cm.expected_amount));
   if(!amount||amount<=0){render();return}
   const obj={id:uid(),type:'expense',category_id:cm.category_id,amount,date:new Date().toISOString().slice(0,10),month:mk,note:cm.name,commitment_id:cm.id};
   await saveInsert('transactions',obj,()=>state.transactions.unshift(obj));
   if(amount>Number(cm.expected_amount)){
     await saveUpdate('commitments',cm.id,{expected_amount:amount},()=>cm.expected_amount=amount);
   }
 }else{
   const tx=state.transactions.find(t=>t.commitment_id===id&&t.month===mk);
   if(tx)await saveDelete('transactions',tx.id,()=>{state.transactions=state.transactions.filter(x=>x.id!==tx.id)});
   else render();
 }
}
function openSubCatModal(parentId){
 modal('فئة فرعية جديدة',`<label>الاسم</label><input id="scName" placeholder="مثال: الأكل والشرب"><label>الرمز</label><input id="scIcon" placeholder="🍔"><button class="btn" style="width:100%" onclick="saveSubCat('${parentId}')">إضافة</button>`);
}
async function saveSubCat(parentId){
 const name=$("#scName").value.trim();
 if(!name)return;
 const obj={id:uid(),name,icon:$("#scIcon").value||'▫️',percentage:0,type:'flexible',active:true,parent_id:parentId};
 closeModal();
 await saveInsert('categories',obj,()=>state.categories.push(obj));
}
async function deleteSubCat(id){
 if(!confirm('تحذف الفئة الفرعية دي؟ العمليات المسجلة عليها هتفضل موجودة بس من غير تصنيف.'))return;
 await saveUpdate('categories',id,{active:false},()=>{const c=state.categories.find(x=>x.id===id);if(c)c.active=false});
}
function openCat(id){const old=id?state.categories.find(x=>x.id===id):null;modal(old?'تعديل الفئة':'إضافة فئة',`<label>الاسم</label><input id="cn" value="${esc(old?.name||'')}"><label>الرمز</label><input id="ci" value="${esc(old?.icon||'🏷️')}"><label>النسبة %</label><input id="cp" type="number" value="${old?.percentage??''}"><label>النوع</label><select id="ct"><option value="fixed" ${old?.type==='fixed'?'selected':''}>ثابتة</option><option value="flexible" ${old?.type==='flexible'?'selected':''}>مرنة</option><option value="rollover" ${old?.type==='rollover'?'selected':''}>تراكمية</option><option value="goal-linked" ${old?.type==='goal-linked'?'selected':''}>مرتبطة بهدف</option></select>${old?'':`<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="cbSubs" style="width:auto;margin:0" onchange="$('#subsBox').classList.toggle('hidden',!this.checked)"> ليها فئات فرعية؟</label><div id="subsBox" class="hidden" style="margin-top:8px"><label>فئات فرعية — افصل بفاصلة</label><input id="cSubs" placeholder="الأكل والشرب, المواصلات"></div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:4px"><input type="checkbox" id="cbCommits" style="width:auto;margin:0" onchange="$('#commitsBox').classList.toggle('hidden',!this.checked)"> ليها التزامات شهرية؟</label><div id="commitsBox" class="hidden" style="margin-top:8px"><label>التزامات — الاسم:المبلغ، افصل بفاصلة</label><input id="cCommits" placeholder="إنترنت:300, موبايل:100"></div>`}<button class="btn" style="width:100%;margin-top:8px" onclick="saveCat('${id||''}')">${old?'حفظ':'إضافة'}</button>${old?`<button class="btn secondary" style="width:100%;margin-top:8px" onclick="toggleCat('${id}')">${old.active?'تعطيل':'تفعيل'} الفئة</button>`:''}`)}
async function saveCat(id){
 const name=$("#cn").value.trim(),p=Number($("#cp").value);if(!name||p<0||p>100)return;
 const obj={id:id||uid(),name,icon:$("#ci").value||'🏷️',percentage:p,type:$("#ct").value,active:id?state.categories.find(x=>x.id===id).active:true};
 closeModal();
 if(id){await saveUpdate('categories',id,obj,()=>Object.assign(state.categories.find(c=>c.id===id),obj));await upsertSnapshot();toast('تم حفظ الفئة');return}
 await saveInsert('categories',obj,()=>state.categories.push(obj));
 const subsRaw=$("#cSubs")?.value.trim();
 if(subsRaw){for(const subName of subsRaw.split(',').map(s=>s.trim()).filter(Boolean)){const sub={id:uid(),name:subName,icon:'▫️',percentage:0,type:'flexible',active:true,parent_id:obj.id};await saveInsert('categories',sub,()=>state.categories.push(sub))}}
 const commitsRaw=$("#cCommits")?.value.trim();
 if(commitsRaw){for(const part of commitsRaw.split(',').map(s=>s.trim()).filter(Boolean)){const [cname,camount]=part.split(':').map(s=>s.trim());const amt=Number(camount);if(cname&&amt>0){const cm={id:uid(),name:cname,category_id:obj.id,expected_amount:amt,due_day:null,active:true};await saveInsert('commitments',cm,()=>state.commitments.push(cm))}}}
 await upsertSnapshot();
 toast('تم حفظ الفئة');
}
async function toggleCat(id){const c=state.categories.find(x=>x.id===id);if(!c)return;closeModal();await saveUpdate('categories',id,{active:!c.active},()=>c.active=!c.active);await upsertSnapshot();toast('تم تحديث الفئة')}
async function saveSettings(){const patch={monthly_salary:Number($("#salary").value)||0,currency:$("#currency").value||'EGP',month_start_day:Math.min(28,Math.max(1,Number($("#startDay").value)||1)),updated_at:new Date().toISOString()};await saveUpdate('settings',state.settings.id,patch,()=>Object.assign(state.settings,patch));await upsertSnapshot();toast('اتحفظت الإعدادات')}
async function exportData(){const data={version:2,exported_at:new Date().toISOString(),state};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`finance-planner-${monthKey()}.json`;a.click();URL.revokeObjectURL(a.href)}
async function importData(e){const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!data.state)throw Error('ملف غير صالح');state=data.state;await localPut();render();toast('تم استيراد النسخة محليًا — اعمل مزامنة بعد المراجعة')}catch(err){toast('ملف النسخة الاحتياطية غير صالح')}}
function go(p){selectedMonth=null;page=p;render()}
$$('nav button').forEach(b=>b.onclick=()=>go(b.dataset.page));
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;if(!localStorage.getItem('fp_install_dismissed'))$('#installBanner').classList.remove('hidden')});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}$('#installBanner').classList.add('hidden')};
$('#dismissInstall').onclick=()=>{localStorage.setItem('fp_install_dismissed','1');$('#installBanner').classList.add('hidden')};
function showLogin(msg){$('#login').classList.remove('hidden');$('#loginMsg').textContent=msg||''}
async function doLogin(){
 const email=$('#loginEmail').value.trim(),password=$('#loginPass').value;
 if(!email||!password)return;
 $('#loginMsg').textContent='جاري الدخول...';
 const {error}=await sb.auth.signInWithPassword({email,password});
 if(error){$('#loginMsg').textContent='بيانات الدخول غلط أو مفيش إنترنت';return}
 $('#loginPass').value='';$('#login').classList.add('hidden');
 bootstrap().catch(console.error);
}
async function doLogout(){
 const pending=(await queueAll()).length;
 const msg=pending?`فيه ${pending} عمليات لسه ما اتزامنتش وهتضيع لو خرجت. تكمل؟`:'تسجيل خروج؟ هتتمسح النسخة المحلية من الجهاز.';
 if(!confirm(msg))return;
 await sb.auth.signOut();
 const d=await openDB();
 await new Promise(r=>{const t=d.transaction(['state','queue'],'readwrite');t.objectStore('state').clear();t.objectStore('queue').clear();t.oncomplete=r;t.onerror=r});
 location.reload();
}
bootstrap().catch(console.error);

if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(console.warn)}
