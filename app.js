const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = { user:null, csrf:null, authMode:"login", adminOrders:[], statuses:[
 ["order_placed","Order placed"],["confirmed","Confirmed"],["packed","Packed"],["shipped","Shipped"],["in_transit","In transit"],["out_for_delivery","Out for delivery"],["delivered","Delivered"],["exception","Exception"],["cancelled","Cancelled"],["returned","Returned"]
]};
const views = {home:$("#homeView"),signin:$("#signinView"),dashboard:$("#dashboardView")};
let toastTimer;
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3000)}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function prettyStatus(s=""){return s.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase())}
function dateTime(v){if(!v)return "Not available";const d=new Date(v);return Number.isNaN(d.getTime())?"Not available":d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}
function dateOnly(v){if(!v)return "Not set";const d=new Date(v+"T00:00:00");return Number.isNaN(d.getTime())?"Not set":d.toLocaleDateString([], {day:"numeric",month:"short",year:"numeric"})}
function money(cents,currency="INR"){return new Intl.NumberFormat("en-IN",{style:"currency",currency}).format((Number(cents)||0)/100)}
async function api(url, options={}) {
  const headers = {"Content-Type":"application/json",...(options.headers||{})};
  if(options.method && !["GET","HEAD"].includes(options.method.toUpperCase())) {
    if(!state.csrf) await refreshCsrf();
    headers["x-csrf-token"]=state.csrf;
  }
  const res=await fetch(url,{credentials:"same-origin",...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) {if(res.status===403 && /token/i.test(data.error||"")){await refreshCsrf()} throw new Error(data.error||`Request failed (${res.status})`)}
  if(data.csrfToken)state.csrf=data.csrfToken;
  return data;
}
async function refreshCsrf(){const r=await fetch("/api/csrf",{credentials:"same-origin"});const d=await r.json();state.csrf=d.token}
function showView(name){
  Object.entries(views).forEach(([key,el])=>el.classList.toggle("hidden",key!==name));
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="dashboard")loadDashboard();
  window.scrollTo({top:0,behavior:"smooth"});
}
$$("[data-view]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();const v=b.dataset.view;if(v==="dashboard"&&!state.user)return showView("signin");showView(v)}));
function setAuthMode(mode){state.authMode=mode;$$("[data-auth]").forEach(b=>b.classList.toggle("active",b.dataset.auth===mode));$("#nameField").classList.toggle("hidden",mode!=="register");$("#nameField input").required=mode==="register";$("#authSubmit").innerHTML=(mode==="login"?"Sign in securely":"Create account")+" <span>→</span>";$("#passwordHint").textContent=mode==="login"?"Use your registered email and password.":"Use at least 12 characters for a stronger password.";$("#authMessage").textContent=""}
$$("[data-auth]").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.auth)));
$("#authForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget);const body={email:f.get("email"),password:f.get("password")};if(state.authMode==="register")body.name=f.get("name");
 $("#authSubmit").disabled=true;$("#authMessage").textContent="";
 try{const d=await api("/api/auth/"+(state.authMode==="login"?"login":"register"),{method:"POST",body:JSON.stringify(body)});state.user=d.user;state.csrf=d.csrfToken;toast("Welcome, "+state.user.name);$("#dashboardNav").classList.remove("hidden");showView("dashboard")}
 catch(err){$("#authMessage").textContent=err.message}finally{$("#authSubmit").disabled=false}
});
$("#logoutBtn").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST",body:"{}"})}catch(e){}state.user=null;state.csrf=null;$("#dashboardNav").classList.add("hidden");toast("You have signed out.");showView("home")});
$("#trackForm").addEventListener("submit",async e=>{e.preventDefault();const n=$("#trackingInput").value.trim();const wrap=$("#trackingResult");wrap.classList.remove("hidden");wrap.innerHTML='<div class="tracking-panel">Looking up your shipment…</div>';try{const d=await api("/api/track/"+encodeURIComponent(n));renderTracking(d.order,wrap);wrap.scrollIntoView({behavior:"smooth",block:"start"})}catch(err){wrap.innerHTML=`<div class="tracking-panel"><h2>We couldn't find that shipment</h2><p class="muted">${escapeHtml(err.message)}</p><p class="hint">Double-check the tracking number and try again.</p></div>`}});
function renderTracking(o,container){
 const events=[...(o.events||[])].reverse();const eventHtml=events.length?events.map((ev,i)=>`<div class="timeline-event"><span class="timeline-dot"></span><div><h4>${escapeHtml(ev.title)} <span class="source-tag">${escapeHtml(ev.source)}</span></h4><p>${escapeHtml(ev.description||"")}${ev.location?" · "+escapeHtml(ev.location):""}</p><small>${escapeHtml(dateTime(ev.eventTime))}</small></div></div>`).join(""):'<p class="muted">No tracking events yet.</p>';
 container.innerHTML=`<div class="tracking-panel"><div class="track-top"><div><div class="eyebrow">SHIPMENT OVERVIEW</div><h2>${escapeHtml(o.itemSummary)}</h2><div class="track-number">Order ${escapeHtml(o.orderNumber)} · Tracking ${escapeHtml(o.trackingNumber)}</div></div><span class="status-badge">${escapeHtml(prettyStatus(o.status))}</span></div><div class="track-meta"><div><small>ESTIMATED DELIVERY</small><strong>${escapeHtml(dateOnly(o.estimatedDelivery))}</strong></div><div><small>COURIER</small><strong>${escapeHtml(o.carrier||"Store delivery")}</strong></div><div><small>LAST UPDATE</small><strong>${escapeHtml(dateTime(o.updatedAt))}</strong></div></div><div class="timeline">${eventHtml}</div></div>`;
}
function metric(label,value,icon){return `<div class="metric"><span class="metric-icon">${icon}</span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`}
async function loadDashboard(){
 if(!state.user){showView("signin");return}
 $("#dashTitle").textContent=state.user.role==="admin"||state.user.role==="staff"?"Operations dashboard":"Your dashboard";
 $("#dashSubtitle").textContent="Signed in as "+state.user.email;
 const isAdmin=["admin","staff"].includes(state.user.role);
 $("#adminDash").classList.toggle("hidden",!isAdmin);$("#customerDash").classList.toggle("hidden",isAdmin);
 if(isAdmin){try{const d=await api("/api/admin/summary");const s=d.summary;$("#adminMetrics").innerHTML=metric("TOTAL ORDERS",s.total,"▤")+metric("ACTIVE SHIPMENTS",s.active,"↗")+metric("DELIVERED",s.delivered,"✓")+metric("DELIVERY EXCEPTIONS",s.exceptions,"!");await loadAdminOrders()}catch(e){toast(e.message)}}
 else{try{const d=await api("/api/customer/orders");const orders=d.orders;const active=orders.filter(o=>!["delivered","cancelled","returned"].includes(o.status)).length;$("#customerMetrics").innerHTML=metric("TOTAL ORDERS",orders.length,"▤")+metric("IN PROGRESS",active,"↗")+metric("DELIVERED",orders.filter(o=>o.status==="delivered").length,"✓")+metric("NEEDS ATTENTION",orders.filter(o=>o.status==="exception").length,"!");$("#customerOrders").innerHTML=orders.length?orders.map(o=>`<div class="order-row"><div><strong>${escapeHtml(o.itemSummary)}</strong><small>${escapeHtml(o.orderNumber)} · ${escapeHtml(o.trackingNumber)}</small></div><div class="order-col-secondary"><p>${escapeHtml(o.carrier||"Store delivery")}</p><small>ETA ${escapeHtml(dateOnly(o.estimatedDelivery))}</small></div><span class="status-badge">${escapeHtml(prettyStatus(o.status))}</span><div class="order-action"><button class="tiny-btn" data-customer-track="${escapeHtml(o.trackingNumber)}">View tracking →</button></div></div>`).join(""):'<div class="empty-state">No orders are linked to your account yet.</div>'}catch(e){toast(e.message)}}
}
$("#customerOrders").addEventListener("click",e=>{const b=e.target.closest("[data-customer-track]");if(!b)return;$("#trackingInput").value=b.dataset.customerTrack;showView("home");$("#trackForm").requestSubmit()});
$("#newOrderBtn").addEventListener("click",()=>{$("#orderMessage").textContent="";$("#orderDialog").showModal()});
$("#closeOrder").addEventListener("click",()=>$("#orderDialog").close());
$("#orderForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const amount=Math.round(Number(f.get("amount"))*100);const body={customerEmail:f.get("customerEmail"),customerName:f.get("customerName"),itemSummary:f.get("itemSummary"),amountCents:amount,carrier:f.get("carrier"),carrierTrackingId:f.get("carrierTrackingId"),estimatedDelivery:f.get("estimatedDelivery"),destination:f.get("destination"),notes:f.get("notes")};try{const d=await api("/api/admin/orders",{method:"POST",body:JSON.stringify(body)});$("#orderDialog").close();e.currentTarget.reset();toast("Order created: "+d.order.orderNumber);alert("Order created successfully.\nOrder: "+d.order.orderNumber+"\nTracking: "+d.order.trackingNumber);await loadDashboard()}catch(err){$("#orderMessage").textContent=err.message}});
function fillStatusSelect(){const s=$("#statusForm select");s.innerHTML=state.statuses.map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}fillStatusSelect();
$("#closeStatus").addEventListener("click",()=>$("#statusDialog").close());
$("#statusForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/orders/${encodeURIComponent(f.get("id"))}/status`,{method:"PATCH",body:JSON.stringify({status:f.get("status"),description:f.get("description"),location:f.get("location")})});$("#statusDialog").close();toast("Tracking timeline updated.");await loadDashboard()}catch(err){$("#statusMessage").textContent=err.message}});
async function loadAdminOrders(){
 const q=$("#adminSearch").value.trim();const d=await api("/api/admin/orders"+(q?"?q="+encodeURIComponent(q):""));state.adminOrders=d.orders;
 $("#adminEmpty").classList.toggle("hidden",d.orders.length>0);
 $("#adminOrders").innerHTML=d.orders.map(o=>`<tr><td><strong>${escapeHtml(o.orderNumber)}</strong><small>${escapeHtml(o.trackingNumber)}</small></td><td><strong>${escapeHtml(o.customerName)}</strong><small>${escapeHtml(o.customerEmail)}</small></td><td>${escapeHtml(o.itemSummary)}<small>${escapeHtml(money(o.amountCents,o.currency))}</small></td><td><span class="status-badge">${escapeHtml(prettyStatus(o.status))}</span></td><td>${escapeHtml(dateOnly(o.estimatedDelivery))}<small>${escapeHtml(o.carrier||"No courier")}</small></td><td><div class="row-actions"><button class="tiny-btn" data-status-id="${o.id}">Update</button><button class="tiny-btn" data-sync-id="${o.id}">Sync</button></div></td></tr>`).join("");
}
let searchTimer;$("#adminSearch").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadAdminOrders().catch(e=>toast(e.message)),250)});$("#refreshAdmin").addEventListener("click",()=>loadDashboard());
$("#adminOrders").addEventListener("click",async e=>{
 const statusBtn=e.target.closest("[data-status-id]");const syncBtn=e.target.closest("[data-sync-id]");
 if(statusBtn){const o=state.adminOrders.find(x=>String(x.id)===statusBtn.dataset.statusId);if(!o)return;const f=$("#statusForm");f.elements.id.value=o.id;f.elements.status.value=o.status;f.elements.description.value="";f.elements.location.value="";$("#statusMessage").textContent="";$("#statusDialog").showModal()}
 if(syncBtn){syncBtn.disabled=true;try{const d=await api(`/api/admin/orders/${syncBtn.dataset.syncId}/sync`,{method:"POST",body:"{}"});toast("Courier sync completed: "+prettyStatus(d.status));await loadDashboard()}catch(err){toast(err.message)}finally{syncBtn.disabled=false}}
});
$("#loadCustomers").addEventListener("click",async()=>{const el=$("#customersList");el.textContent="Loading…";try{const d=await api("/api/admin/customers");el.innerHTML=d.customers.map(c=>`<div class="customer-entry"><span><strong>${escapeHtml(c.name)}</strong><br><span class="muted">${escapeHtml(c.email)}</span></span><span>${c.orders_count} orders · ${escapeHtml(c.role)}</span></div>`).join("")||"No customers yet."}catch(e){el.textContent=e.message}});
async function init(){try{await refreshCsrf();const d=await api("/api/auth/me");state.user=d.user;state.csrf=d.csrfToken||state.csrf;if(state.user){$("#dashboardNav").classList.remove("hidden");showView("dashboard")}else showView("home")}catch(e){showView("home")}}
init();
