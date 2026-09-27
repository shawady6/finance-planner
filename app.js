
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
let state={settings:{id:null,currency:"EGP",monthly_salary:0,month_start_day:1},categories:[],goals:[],contribs:[],transactions:[],rollover:{},vaults:{piggy:{id:null,balance:0},emergency:{id:null,balance:0}},vaultTx:[],closedTransfers:JSON.parse(localStorage.getItem("fp_closed_transfers")||"{}")};
let page="home", selectedMonth=null, deferredPrompt=null, syncing=false, showLastMonthReview=false;
const DB_NAME="finance-planner-v2", DB_VERSION=2;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const uid=()=>crypto.randomUUID?crypto.randomUUID():"id"+Date.now()+Math.random().toString(36).slice(2);
function money(n){return (Number(n)||0).toLocaleString("en-US",{maximumFractionDigits:2})+" "+(state.settings.currency||"EGP")}
function monthKey(date=new Date()){const d=new Date(date),start=Number(state.settings.month_start_day)||1;let y=d.getFullYear(),m=d.getMonth();if(d.getDate()<start){m--;if(m<0){m=11;y--}}return `${y}-${String(m+1).padStart(2,"0")}`}
function monthName(k){const n=["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];let [y,m]=k.split("-");return `${n[+m-1]} ${y}`}
function activeCats(){return state.categories.filter(c=>c.active)}
function totalPct(){return activeCats().reduce((s,c)=>s+Number(c.percentage||0),0)}
function allocated(c){return Number(state.settings.monthly_salary||0)*Number(c.percentage||0)/100+(c.type==="rollover"?(state.rollover[c.id]||0):0)}
function spent(catId,m=monthKey()){return state.transactions.filter(t=>t.category_id===catId&&t.month===m&&["expense","saving"].includes(t.type)).reduce((s,t)=>s+Number(t.amount||0),0)}
function totalSpent(m=monthKey()){return state.transactions.filter(t=>t.month===m&&["expense","saving"].includes(t.type)).reduce((s,t)=>s+Number(t.amount||0),0)}
function totalIncome(m=monthKey()){return state.transactions.filter(t=>t.month===m&&t.type==="income").reduce((s,t)=>s+Number(t.amount||0),0)+Number(state.settings.monthly_salary||0)}
function pct(a,b){return b>0?Math.min(100,Math.max(0,a/b*100)):0}
function prevMonthKey(mk){let [y,m]=mk.split("-").map(Number);m--;if(m<1){m=12;y--}return `${y}-${String(m).padStart(2,"0")}`}
function markClosed(catId,mk){state.closedTransfers[catId+":"+mk]=true;localStorage.setItem("fp_closed_transfers",JSON.stringify(state.closedTransfers))}
function toast(msg){const x=document.createElement("div");x.className="toast";x.textContent=msg;document.body.appendChild(x);setTimeout(()=>x.remove(),2300)}
function setSync(ok){$("#sync").innerHTML=`<i class="sync-dot ${ok?"":"off"}"></i>${ok?"متزامن":"محلي"}`}

/* ---- emergency fund rollover close ---- */
function closeMonthRollover(prevKey){
  activeCats().forEach(c=>{
    if(c.type==="rollover"){
      const a=allocated(c), s=spent(c.id,prevKey);
      state.rollover[c.id]=Math.max(0,a-s);
    }
  });
}
function checkMonthRollover(){
  const last=localStorage.getItem("fp_last_month"), now=monthKey();
  if(last && last!==now){ closeMonthRollover(last); }
  localStorage.setItem("fp_last_month", now);
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
async function flushQueue(){if(syncing||!navigator.onLine)return;syncing=true;try{for(const q of await queueAll()){const ok=await remote(q.op,q.table,q.payload,q.id);if(!ok)break;await queueDelete(q.qid)}setSync((await queueAll()).length===0)}finally{syncing=false}}
async function pullRemote(){
 const [s,c,g,co,t,vl,vt]=await Promise.all([sb.from("settings").select("*").limit(1),sb.from("categories").select("*").order("created_at"),sb.from("goals").select("*").order("created_at"),sb.from("goal_contributions").select("*").order("date"),sb.from("transactions").select("*").order("date",{ascending:false}),sb.from("vaults").select("*"),sb.from("vault_transactions").select("*").order("date",{ascending:false})]);
 const er=[s,c,g,co,t,vl,vt].find(x=>x.error);if(er)throw er.error;
 if(s.data?.length)state.settings=s.data[0];
 else{const {data}=await sb.from("settings").insert({currency:"EGP",monthly_salary:0,month_start_day:1}).select().single();if(data)state.settings=data;}
 if(c.data?.length)state.categories=c.data;
 else{const {data}=await sb.from("categories").insert(DEFAULT_CATS).select();if(data)state.categories=data;}
 if(g.data)state.goals=g.data;
 if(co.data)state.contribs=co.data;
 if(t.data)state.transactions=t.data;
 if(vl.data?.length){
   vl.data.forEach(row=>{state.vaults[row.type]={id:row.id,balance:Number(row.balance)}});
 }else{
   const {data}=await sb.from("vaults").insert([{type:"piggy",balance:0},{type:"emergency",balance:0}]).select();
   if(data)data.forEach(row=>{state.vaults[row.type]={id:row.id,balance:Number(row.balance)}});
 }
 if(vt.data)state.vaultTx=vt.data;
 await localPut();
}
async function syncNow(){if(!navigator.onLine){toast("مفيش إنترنت دلوقتي");return}if(syncing)return;syncing=true;try{await flushQueue();if((await queueAll()).length===0)await pullRemote();render();toast("تمت المزامنة")}catch(e){console.warn(e);setSync(false);toast("تعذر المزامنة — بياناتك المحلية محفوظة")}finally{syncing=false}}
async function bootstrap(){const cached=await localGet().catch(()=>null);if(cached){state=cached;checkMonthRollover();render();setSync(false)}try{await flushQueue();if((await queueAll()).length===0){await pullRemote();checkMonthRollover();render();setSync(true)}}catch(e){console.warn(e);toast("اشتغلنا من البيانات المحلية");setSync(false)}}
window.addEventListener("online",()=>{toast("رجع الإنترنت — جاري المزامنة");syncNow()});

async function saveInsert(table,obj,localApply){localApply();await mutate({op:"insert",table,payload:obj});render()}
async function saveUpdate(table,id,patch,localApply){localApply();await mutate({op:"update",table,payload:patch,id});render()}
async function saveDelete(table,id,localApply){localApply();await mutate({op:"delete",table,id,payload:null});render()}

function render(){
 $("#title").textContent={home:"Finance Planner",budget:"الميزانية",goals:"الأهداف",tx:"العمليات",settings:"الإعدادات"}[page];
 const mk=selectedMonth||monthKey();$("#month").textContent=monthName(mk);$$("nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
 $("#fab").classList.toggle("hidden",!['goals','tx'].includes(page));$("#fab").onclick=()=>{page==='goals'?openGoal():openTx()};
 $("#main").innerHTML={home:home,budget:budget,goals:goals,tx:transactions,settings:settings}[page]();
 if(page==='settings')queueAll().then(q=>{const el=$('#pendingCount');if(el)el.textContent=q.length});
}
function renderVaultCard(type){
 const v=state.vaults[type]||{balance:0};
 const label=type==='piggy'?'🐷 الحصالة':'🆘 صندوق الطوارئ';
 const sub=type==='piggy'?'باقي الأساسيات والادخار':'تراكمي';
 return `<div class="card" style="border-color:var(--green)"><div class="row"><b>${label}</b><span class="pill">${sub}</span></div><div class="big positive">${money(v.balance)}</div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn small" onclick="withdrawVault('${type}')">سحب</button><button class="btn small secondary" onclick="openVaultGoalTransfer('${type}')">تحويل لهدف</button><button class="btn small secondary" onclick="showVaultLog('${type}')">السجل</button></div></div>`;
}
function home(){
 const m=monthKey(),income=totalIncome(m),s=totalSpent(m),remaining=income-s,total=totalPct();
 const box=renderVaultCard('piggy')+renderVaultCard('emergency');
 return `<div class="card"><div class="muted">💰 المتاح للشهر</div><div class="big">${money(remaining)}</div><div class="hint">الدخل ${money(income)} · المصروف ${money(s)}</div></div><div class="grid"><div class="stat"><div class="muted">المُنفق</div><b>${money(s)}</b></div><div class="stat"><div class="muted">نسبة الصرف</div><b>${pct(s,income).toFixed(0)}%</b></div></div>${box}<div class="card"><div class="row"><b>📊 استهلاك الدخل</b><b>${pct(s,income).toFixed(0)}%</b></div><div class="bar-bg"><div class="bar-fill ${s>income?'over':''}" style="width:${pct(s,income)}%"></div></div></div><div class="card"><div class="row"><b>🎯 أهدافك</b><button class="btn secondary small" onclick="go('goals')">كل الأهداف</button></div>${state.goals.length?state.goals.slice(0,3).map(goalCard).join(""):'<div class="empty">مفيش أهداف لسه.</div>'}</div><div class="card"><div class="row"><b>📐 توزيع الراتب</b><span class="${total===100?'positive':total>100?'negative':'accent'}">${total}%</span></div><div class="hint">يفضل إن مجموع النسب يكون 100%.</div></div>`;
}
function goalCard(g){const p=pct(g.current_amount,g.target_amount),rem=Math.max(0,Number(g.target_amount)-Number(g.current_amount));return `<div class="item"><div class="row"><b>${esc(g.icon||'🎯')} ${esc(g.name)}</b><span class="muted">${p.toFixed(0)}%</span></div><div class="bar-bg"><div class="bar-fill" style="width:${p}%"></div></div><div class="row muted"><span>${money(g.current_amount)} / ${money(g.target_amount)}</span><span>${money(rem)} متبقي</span></div></div>`}
function renderLastMonthReview(){
 const lm=prevMonthKey(monthKey());
 const rows=activeCats().map(c=>{
   const alloc=Number(state.settings.monthly_salary||0)*Number(c.percentage||0)/100;
   const sp=spent(c.id,lm);
   const left=alloc-sp;
   return {c,left};
 }).filter(x=>x.left>0.009 && !state.closedTransfers[x.c.id+":"+lm]);
 if(!rows.length) return `<div class="card"><b>📅 مراجعة ${monthName(lm)}</b><div class="empty">مفيش باقي محتاج تحويل من الشهر ده.</div></div>`;
 return `<div class="card"><b>📅 مراجعة ${monthName(lm)}</b><div class="hint">حوّل الباقي من كل فئة للحصالة أو لصندوق الطوارئ</div></div>`+rows.map(({c,left})=>`<div class="item"><div class="row"><b>${esc(c.icon)} ${esc(c.name)}</b><span class="positive">${money(left)}</span></div><div style="display:flex;gap:6px;margin-top:7px"><button class="btn small" onclick="transferLeftover('${c.id}','piggy','${lm}')">🐷 للحصالة</button><button class="btn small secondary" onclick="transferLeftover('${c.id}','emergency','${lm}')">🆘 لصندوق الطوارئ</button></div></div>`).join("");
}
function toggleLastMonthReview(){showLastMonthReview=!showLastMonthReview;render()}
function budget(){const m=selectedMonth||monthKey(),total=totalPct();
 const review=showLastMonthReview?renderLastMonthReview():'';
 return `<div class="card"><div class="row"><b>ميزانية ${monthName(m)}</b><b class="${total===100?'positive':total>100?'negative':'accent'}">${total}%</b></div><div class="hint">الراتب الأساسي ${money(state.settings.monthly_salary)} · <button class="btn secondary small" onclick="changeMonth('${m}')">تغيير الشهر</button></div></div><button class="btn secondary" style="width:100%;margin-bottom:12px" onclick="toggleLastMonthReview()">📅 ${showLastMonthReview?'إخفاء':'عرض'} الشهر اللي فات</button>${review}${activeCats().map(c=>{const a=allocated(c),s=spent(c.id,m),remaining=Math.max(0,a-s),remPct=pct(remaining,a),over=s>=a,warn=!over&&remPct<=20;return `<div class="item"><div class="row"><b>${esc(c.icon||'🏷️')} ${esc(c.name)}</b><span>${c.percentage}%</span></div><div class="bar-bg"><div class="bar-fill ${over?'over':warn?'warn':''}" style="width:${remPct}%"></div></div><div class="row muted"><span>${money(s)} مستخدم</span><span>باقي ${money(remaining)}</span></div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn small" onclick="quickSpend('${c.id}')">+ مصروف</button><button class="btn secondary small" onclick="openCat('${c.id}')">تعديل</button></div></div>`}).join("")}<button class="btn secondary" style="width:100%" onclick="openCat()">+ إضافة فئة</button>`}
function promptMonth(current){const v=prompt("اكتب الشهر بصيغة YYYY-MM",current);return /^\d{4}-(0[1-9]|1[0-2])$/.test(v||"")?v:current}
function changeMonth(current){selectedMonth=promptMonth(current);render()}
function goals(){return `<div class="card"><div class="row"><b>🎯 أهدافي</b><span class="muted">${state.goals.length} أهداف</span></div></div>${state.goals.length?state.goals.map(g=>`<div class="item">${goalCard(g)}<div style="display:flex;gap:6px;margin-top:7px"><button class="btn small" onclick="contribute('${g.id}')">+ إضافة مبلغ</button><button class="btn secondary small" onclick="openGoal('${g.id}')">تعديل</button><button class="btn danger small" onclick="deleteGoal('${g.id}')">حذف</button></div></div>`).join(""):'<div class="empty">اعمل أول هدف ليك: موبايل، لابتوب، سفر...</div>'}`}
function transactions(){const m=selectedMonth||monthKey(),arr=state.transactions.filter(t=>t.month===m).sort((a,b)=>String(b.date).localeCompare(String(a.date)));return `<div class="card"><div class="row"><b>عمليات ${monthName(m)}</b><button class="btn secondary small" onclick="changeMonth('${m}')">تغيير الشهر</button></div></div>${arr.length?arr.map(t=>{const c=state.categories.find(x=>x.id===t.category_id);const cls=t.type==='income'?'positive':t.type==='saving'?'accent':'negative';return `<div class="item row"><div><b>${esc(c?.icon||'💸')} ${esc(c?.name||'عملية')}</b><div class="muted">${esc(t.date)}${t.note?' · '+esc(t.note):''}</div></div><div style="text-align:left"><b class="${cls}">${t.type==='income'?'+':'-'}${money(t.amount)}</b><div><button class="btn secondary small" onclick="openTx('${t.id}')">تعديل</button></div></div></div>`}).join(""):'<div class="empty">مفيش عمليات في الشهر ده.</div>'}`}
function settings(){return `<div class="card"><b>⚙️ إعدادات الخطة</b><label>الراتب الشهري</label><input id="salary" type="number" value="${Number(state.settings.monthly_salary||0)}"><label>العملة</label><input id="currency" value="${esc(state.settings.currency||'EGP')}"><label>بداية الشهر المالي</label><input id="startDay" type="number" min="1" max="28" value="${Number(state.settings.month_start_day||1)}"><button class="btn" style="width:100%" onclick="saveSettings()">حفظ</button></div><div class="card"><b>☁️ المزامنة</b><div class="hint" style="margin-top:7px">عدد العمليات المنتظرة للمزامنة: <b id="pendingCount">...</b></div><button class="btn secondary" style="width:100%;margin-top:9px" onclick="syncNow()">مزامنة الآن</button></div><div class="card"><b>💾 نسخة احتياطية</b><div class="hint">صدّر كل بيانات التطبيق إلى JSON أو استورد نسخة محفوظة.</div><div style="display:flex;gap:7px;margin-top:9px"><button class="btn secondary" onclick="exportData()">تصدير</button><button class="btn secondary" onclick="$('#importFile').click()">استيراد</button><input id="importFile" type="file" accept="application/json" class="hidden" onchange="importData(event)"></div></div>`}

async function transferLeftover(catId,dest,mk){
 const cat=state.categories.find(x=>x.id===catId);if(!cat)return;
 const alloc=Number(state.settings.monthly_salary||0)*Number(cat.percentage||0)/100;
 const left=alloc-spent(catId,mk);
 if(left<=0)return;
 const v=state.vaults[dest];
 v.balance=Number(v.balance)+left;
 markClosed(catId,mk);
 render();
 await localPut();
 if(v.id)await mutate({op:'update',table:'vaults',id:v.id,payload:{balance:v.balance,updated_at:new Date().toISOString()}});
 const tx={id:uid(),vault_type:dest,direction:'deposit',amount:left,reason:`ترحيل من ${cat.name} - ${monthName(mk)}`,date:new Date().toISOString().slice(0,10)};
 state.vaultTx.unshift(tx);
 await mutate({op:'insert',table:'vault_transactions',payload:tx});
 toast('تم التحويل لـ '+(dest==='piggy'?'الحصالة':'صندوق الطوارئ'));
}
async function withdrawVault(type){
 const v=state.vaults[type];
 const amount=Number(prompt('المبلغ المسحوب؟'));
 if(!amount||amount<=0)return;
 if(amount>Number(v.balance)){toast('المبلغ أكبر من الرصيد المتاح');return}
 const reason=prompt('سبب السحب؟')||'';
 v.balance=Number(v.balance)-amount;
 render();
 await localPut();
 if(v.id)await mutate({op:'update',table:'vaults',id:v.id,payload:{balance:v.balance,updated_at:new Date().toISOString()}});
 const tx={id:uid(),vault_type:type,direction:'withdrawal',amount,reason,date:new Date().toISOString().slice(0,10)};
 state.vaultTx.unshift(tx);
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
 const v=state.vaults[type];
 if(amount>Number(v.balance)){toast('المبلغ أكبر من الرصيد المتاح');return}
 const g=state.goals.find(x=>x.id===goalId);if(!g)return;
 v.balance=Number(v.balance)-amount;
 g.current_amount=Number(g.current_amount)+amount;
 const reachedGoal=g.current_amount>=Number(g.target_amount);
 if(reachedGoal)g.status='completed';
 closeModal();render();
 await localPut();
 if(v.id)await mutate({op:'update',table:'vaults',id:v.id,payload:{balance:v.balance,updated_at:new Date().toISOString()}});
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
function modal(title,body){$("#modalRoot").innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="row"><h3>${title}</h3><button class="btn secondary small" onclick="closeModal()">إغلاق</button></div>${body}</div></div>`}
function closeModal(){$("#modalRoot").innerHTML=""}
function openTx(id){const old=id?state.transactions.find(x=>x.id===id):null,opts=activeCats().map(c=>`<option value="${c.id}" ${old?.category_id===c.id?'selected':''}>${esc(c.icon)} ${esc(c.name)}</option>`).join("");modal(old?'تعديل العملية':'إضافة عملية',`<label>النوع</label><select id="tt"><option value="expense" ${old?.type==='expense'?'selected':''}>مصروف</option><option value="income" ${old?.type==='income'?'selected':''}>دخل</option><option value="saving" ${old?.type==='saving'?'selected':''}>ادخار</option></select><label>الفئة</label><select id="tc">${opts}</select><label>المبلغ</label><input id="ta" type="number" value="${old?.amount||''}"><label>التاريخ</label><input id="td" type="date" value="${old?.date||new Date().toISOString().slice(0,10)}"><label>ملاحظة</label><input id="tn" value="${esc(old?.note||'')}"><button class="btn" style="width:100%" onclick="saveTx('${id||''}')">${old?'حفظ':'إضافة'}</button>${old?`<button class="btn danger" style="width:100%;margin-top:7px" onclick="deleteTx('${id}')">حذف العملية</button>`:''}`)}
async function saveTx(id){const amount=Number($("#ta").value);if(amount<=0)return;const date=$("#td").value||new Date().toISOString().slice(0,10);const obj={id:id||uid(),type:$("#tt").value,category_id:$("#tc").value,amount,date,month:monthKey(date),note:$("#tn").value||""};closeModal();if(id)await saveUpdate("transactions",id,obj,()=>{const i=state.transactions.findIndex(x=>x.id===id);if(i>=0)state.transactions[i]=obj});else await saveInsert("transactions",obj,()=>state.transactions.unshift(obj));toast("تم حفظ العملية")}
async function deleteTx(id){if(!confirm('تحذف العملية؟'))return;closeModal();await saveDelete('transactions',id,()=>{state.transactions=state.transactions.filter(x=>x.id!==id)});toast('اتحذفت العملية')}
async function quickSpend(catId){const amount=Number(prompt('المبلغ؟'));if(!amount||amount<=0)return;const obj={id:uid(),type:'expense',category_id:catId,amount,date:new Date().toISOString().slice(0,10),month:monthKey(),note:''};await saveInsert('transactions',obj,()=>state.transactions.unshift(obj));toast('اتسجل المصروف')}
function openGoal(id){const old=id?state.goals.find(x=>x.id===id):null;modal(old?'تعديل الهدف':'هدف مالي جديد',`<label>الاسم</label><input id="gn" value="${esc(old?.name||'')}" placeholder="مثال: iPhone"><label>الرمز</label><input id="gi" value="${esc(old?.icon||'🎯')}"><label>المبلغ المستهدف</label><input id="gt" type="number" value="${old?.target_amount||''}"><label>المساهمة الشهرية</label><input id="gm" type="number" value="${old?.monthly_target||''}"><label>الحالة</label><select id="gs"><option value="active" ${old?.status!=='completed'?'selected':''}>نشط</option><option value="completed" ${old?.status==='completed'?'selected':''}>مكتمل</option></select><button class="btn" style="width:100%" onclick="saveGoal('${id||''}')">${old?'حفظ':'إنشاء الهدف'}</button>`)}
async function saveGoal(id){const name=$("#gn").value.trim(),target=Number($("#gt").value);if(!name||target<=0)return;const obj={id:id||uid(),name,icon:$("#gi").value||'🎯',target_amount:target,current_amount:id?Number(state.goals.find(g=>g.id===id)?.current_amount||0):0,monthly_target:Number($("#gm").value)||0,status:$("#gs").value};closeModal();if(id)await saveUpdate('goals',id,obj,()=>Object.assign(state.goals.find(g=>g.id===id),obj));else await saveInsert('goals',obj,()=>state.goals.push(obj));toast('تم حفظ الهدف')}
async function deleteGoal(id){if(!confirm('تحذف الهدف وكل مساهماته؟'))return;await saveDelete('goals',id,()=>{state.goals=state.goals.filter(g=>g.id!==id);state.contribs=state.contribs.filter(c=>c.goal_id!==id)});for(const c of state.contribs.filter(c=>c.goal_id===id))await remote('delete','goal_contributions',null,c.id);toast('اتحذف الهدف')}
async function contribute(id){const amount=Number(prompt('هتضيف كام؟'));if(!amount||amount<=0)return;const g=state.goals.find(x=>x.id===id);if(!g)return;const c={id:uid(),goal_id:id,amount,date:new Date().toISOString().slice(0,10)};g.current_amount=Number(g.current_amount)+amount;await localPut();await mutate({op:'insert',table:'goal_contributions',payload:c});await mutate({op:'update',table:'goals',id,payload:{current_amount:g.current_amount}});render();toast('تمت إضافة المساهمة')}
function openCat(id){const old=id?state.categories.find(x=>x.id===id):null;modal(old?'تعديل الفئة':'إضافة فئة',`<label>الاسم</label><input id="cn" value="${esc(old?.name||'')}"><label>الرمز</label><input id="ci" value="${esc(old?.icon||'🏷️')}"><label>النسبة %</label><input id="cp" type="number" value="${old?.percentage??''}"><label>النوع</label><select id="ct"><option value="fixed" ${old?.type==='fixed'?'selected':''}>ثابتة</option><option value="flexible" ${old?.type==='flexible'?'selected':''}>مرنة</option><option value="rollover" ${old?.type==='rollover'?'selected':''}>تراكمية</option><option value="goal-linked" ${old?.type==='goal-linked'?'selected':''}>مرتبطة بهدف</option></select><button class="btn" style="width:100%" onclick="saveCat('${id||''}')">${old?'حفظ':'إضافة'}</button>${old?`<button class="btn secondary" style="width:100%;margin-top:7px" onclick="toggleCat('${id}')">${old.active?'تعطيل':'تفعيل'} الفئة</button>`:''}`)}
async function saveCat(id){const name=$("#cn").value.trim(),p=Number($("#cp").value);if(!name||p<0||p>100)return;const obj={id:id||uid(),name,icon:$("#ci").value||'🏷️',percentage:p,type:$("#ct").value,active:id?state.categories.find(x=>x.id===id).active:true};closeModal();if(id)await saveUpdate('categories',id,obj,()=>Object.assign(state.categories.find(c=>c.id===id),obj));else await saveInsert('categories',obj,()=>state.categories.push(obj));toast('تم حفظ الفئة')}
async function toggleCat(id){const c=state.categories.find(x=>x.id===id);if(!c)return;closeModal();await saveUpdate('categories',id,{active:!c.active},()=>c.active=!c.active);toast('تم تحديث الفئة')}
async function saveSettings(){const patch={monthly_salary:Number($("#salary").value)||0,currency:$("#currency").value||'EGP',month_start_day:Math.min(28,Math.max(1,Number($("#startDay").value)||1)),updated_at:new Date().toISOString()};await saveUpdate('settings',state.settings.id,patch,()=>Object.assign(state.settings,patch));toast('اتحفظت الإعدادات')}
async function exportData(){const data={version:2,exported_at:new Date().toISOString(),state};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`finance-planner-${monthKey()}.json`;a.click();URL.revokeObjectURL(a.href)}
async function importData(e){const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!data.state)throw Error('ملف غير صالح');state=data.state;await localPut();render();toast('تم استيراد النسخة محليًا — اعمل مزامنة بعد المراجعة')}catch(err){toast('ملف النسخة الاحتياطية غير صالح')}}
function go(p){selectedMonth=null;page=p;render()}
$$('nav button').forEach(b=>b.onclick=()=>go(b.dataset.page));
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;if(!localStorage.getItem('fp_install_dismissed'))$('#installBanner').classList.remove('hidden')});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}$('#installBanner').classList.add('hidden')};
$('#dismissInstall').onclick=()=>{localStorage.setItem('fp_install_dismissed','1');$('#installBanner').classList.add('hidden')};
bootstrap().catch(console.error);

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
