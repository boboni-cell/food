import { matchesFilters } from '/filters.js';
import { startSpace } from '/space.js';
import { avatarSVG, avatarTint, randomAvatarSeed } from '/avatar.js';
startSpace();
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => n === null || n === undefined ? '待补充人均' : `₩${Number(n).toLocaleString('ko-KR')}`;
const avatarHTML = (seed, name = '匿名饭友', size = 'sm') => `<span class="avatar avatar-${size}" style="--avatar-tint:${avatarTint(seed || name)}" aria-hidden="true">${avatarSVG(seed || name)}</span>`;
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const dietNames = {unknown:'饮食类型待确认',meat:'荤食',veg:'已确认素食',mixed:'荤素都有'};
const url = new URL(location.href);
let room = url.searchParams.get('room');
if (!room || !/^[a-zA-Z0-9_-]{8,80}$/.test(room)) {
  room = localStorage.getItem('lunch-room') || crypto.randomUUID();
  url.searchParams.set('room',room); history.replaceState(null,'',url);
}
localStorage.setItem('lunch-room',room);
const apiURL = route => `/api/${route}?room=${encodeURIComponent(room)}`;
async function kakaoSearch(kind, params) { const res=await fetch(apiURL('search')+'&'+new URLSearchParams({kind,...params})); const result=await res.json();if(!res.ok)throw new Error(result.error||'搜索失败');return result; }
let state = { places:[],reviews:[],messages:[],user:{},pick:null,location:null };
let diet = 'all', map, centerMarker, markers = [], searching = false, searchVersion = 0, mapLoading = false, refreshPending = null, refreshAgain = false;
let currentLocation = {lat:37.508492,lng:127.023015,label:'서울특별시 서초구 강남대로89길 19'};
let activeView = 'discover', editorHandler, toastTimer;
let dietHints=new Set();
let lastBubbleSignature='';
async function api(route, data) {
  const res = await fetch(apiURL(route), data === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result = await res.json(); if (!res.ok) throw new Error(result.error || '请求失败，请重试'); return result;
}
function toast(message) { $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4000); }
function run(fn) { return async event => { try { await fn(event); } catch(e) { toast(e.message || '操作失败，请重试'); } }; }
async function refresh() {
  if (refreshPending) { refreshAgain=true; return refreshPending; }
  refreshPending=(async()=>{
    do {
      refreshAgain=false;
      const data=await api('state');
      const changed=data.location && JSON.stringify(data.location)!==JSON.stringify(state.location);
      state=data;if(data.location)currentLocation=data.location;render();
      if(changed){if(map)moveMap();searchNearby();}
    } while(refreshAgain);
  })().finally(()=>{refreshPending=null;});
  return refreshPending;
}
async function save(route,data) { await api(route,data); await refresh(); }
function distance(p) {
  const radians = n => n * Math.PI / 180;
  const a = Math.sin(radians(p.lat-currentLocation.lat)/2)**2 + Math.cos(radians(currentLocation.lat))*Math.cos(radians(p.lat))*Math.sin(radians(p.lng-currentLocation.lng)/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function eligible() {
  const budget=Number($('budget').value), radius=Number($('radius').value);
  return state.places.filter(p => matchesFilters(p,{distance:distance(p),radius,budget,diet,includeUnknownPrice:$('include-unknown-price').checked,includeUnknownDiet:$('include-unknown-diet').checked})).sort((a,b)=>distance(a)-distance(b));
}
function placeReviews(id) { return state.reviews.filter(r=>r.place===id); }
function average(list, key) { return list.length ? list.reduce((sum,r)=>sum+r[key],0)/list.length : 0; }
function emoji(p) { return {veg:'◌',meat:'✦',mixed:'◈'}[p.diet] || '⌖'; }
function mapLink(p) { return /^\d+$/.test(p.id) ? `https://place.map.kakao.com/${p.id}` : `https://map.kakao.com/link/search/${encodeURIComponent(p.name+' '+p.address)}`; }
function renderPlaces() {
  const places=eligible();
  $('place-count').textContent=`${places.length} 家可选`;
  $('eligible-count').textContent = searching ? '正在发现附近的餐厅…' : `${places.length} 家可选 · ${places.filter(p=>p.price===null||p.diet==='unknown').length} 家资料待确认`;
  $('random').disabled = !places.length || searching;
  const nearby=state.places.filter(p=>distance(p)<=Number($('radius').value));
  const budget=Number($('budget').value);
  $('include-unknown-diet').disabled=diet==='veg';
  const unknownPrices=nearby.filter(p=>p.price===null).length;
  $('filter-summary').textContent=budget
    ? `ⓘ 附近 ${nearby.length} 家，${unknownPrices} 家尚无人均价格。${$('include-unknown-price').checked?'待确认价格已纳入随机，出发前请核对菜单。':'严格预算仅抽取已确认价格的餐厅。'}素食选项仍需饭友确认。`
    : `ⓘ 附近 ${nearby.length} 家。价格与饮食类型由饭友确认；素食仅抽取已确认提供素食的餐厅。`;
  if(diet==='meat'||diet==='mixed')$('filter-summary').textContent+= $('include-unknown-diet').checked?' 饮食类型待确认也已纳入，不保证满足所选荤素条件；出发前请核实。':' 饮食类型按已确认资料严格筛选。';
  const pending=nearby.filter(p=>!places.some(q=>q.id===p.id) && (p.diet==='unknown'||(diet==='all'&&p.price===null))).sort((a,b)=>Number(dietHints.has(b.id))-Number(dietHints.has(a.id))||distance(a)-distance(b));
  $('pending-section').classList.toggle('hidden',!pending.length);
  $('pending-title').textContent=diet==='veg'?'素食线索与待确认餐厅':`还有 ${pending.length} 家资料待确认`;
  $('pending-help').textContent=diet==='veg'?'优先展示 비건 / 채식 / 샐러드 搜索线索；沙拉不等于素食。请向店家确认食材和高汤后补充资料，这些餐厅暂不参与素食随机。':'这些餐厅因价格或饮食类型未知暂未参与随机。可补充资料；只因价格未知被排除时，也可勾选上方开关。';
  $('pending-places').innerHTML=pending.slice(0,12).map(p=>`<article class="restaurant-card"><div class="restaurant-top"><div class="restaurant-emoji">${emoji(p)}</div><div><h4>${escapeHTML(p.name)}</h4><small>${escapeHTML(p.category.split(' > ').pop())} · ${Math.round(distance(p))}m</small></div></div><div class="tags"><span class="tag neutral">${dietHints.has(p.id)&&diet==='veg'?'素食搜索线索 · 未确认':dietNames[p.diet]}</span><span class="tag neutral">${won(p.price)}</span></div><div class="restaurant-bottom"><button class="text-button" data-edit="${escapeHTML(p.id)}">确认饮食 / 补充人均 ↗</button><a class="text-button" href="${mapLink(p)}" target="_blank" rel="noopener">查看菜单 ↗</a></div></article>`).join('');
  $('places').innerHTML=places.length ? places.map(p=>{ 
    const reviews=placeReviews(p.id);
    return `<article class="restaurant-card"><div class="restaurant-top"><div class="restaurant-emoji">${emoji(p)}</div><div><h4>${escapeHTML(p.name)}</h4><small>${escapeHTML(p.category.split(' > ').pop())} · ${Math.round(distance(p))}m</small></div></div><div class="tags"><span class="tag ${p.diet==='unknown'?'neutral':''}">${dietNames[p.diet]}</span><span class="tag neutral">${reviews.length?`★ ${average(reviews,'rating').toFixed(1)} · ${reviews.length}条评价`:'还没有评价'}</span></div><div class="restaurant-bottom"><strong>${won(p.price)}${p.price!==null?'<small> /人</small>':''}</strong><button class="text-button" data-edit="${escapeHTML(p.id)}">补充资料 ↗</button></div><div class="pick-controls"><button class="text-button" data-review="${escapeHTML(p.id)}">＋ 用餐记录</button><button class="text-button" data-pick="${escapeHTML(p.id)}">就吃这家</button><a class="text-button" href="${mapLink(p)}" target="_blank" rel="noopener">地图 ↗</a></div></article>`;
  }).join('') : `<div class="empty">${searching?'正在搜索，请稍候…':nearby.length?'附近有餐厅，但缺少符合当前筛选的已确认资料':'当前范围暂未找到餐厅'}<p>${nearby.length?'可在下方补充餐厅资料，或调整预算、饮食偏好；不会把未确认的餐厅当成素食推荐。':'试试扩大到 1km / 2km，或搜索其他聚餐地点。'}</p><button class="button small" data-add>＋ 添加熟悉的餐厅</button></div>`;
  $('location-label').textContent=currentLocation.label;
  document.querySelector('.planet-coordinate').textContent=`${currentLocation.lat.toFixed(4)}° N / ${currentLocation.lng.toFixed(4)}° E`;
}
function renderPick() {
  const p=state.pick;
  $('hero-destination').textContent=p?.name||'等待发射';
  $('today-pick').className=p?'':'empty-pick';
  const current = p && new Date(p.time).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}) === new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  $('today-pick').innerHTML=p ? `<span class="tag">${current?'✦ 今日选择':'上一次的选择'}</span><h4 class="picked-name">${escapeHTML(p.name)}</h4><div class="tags"><span class="tag">${dietNames[p.diet]}</span><span class="tag neutral">${won(p.price)}${p.price!==null?' /人':''}</span></div><p class="picked-detail">${escapeHTML(p.address)}<br>${escapeHTML(p.by)} 选于 ${new Date(p.time).toLocaleString('zh-CN',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p><div class="pick-controls"><a class="button small" href="${mapLink(p)}" target="_blank" rel="noopener">Kakao 导航 ↗</a><button class="text-button" id="reroll">换一家 ↻</button></div><button class="button primary full" data-review="${escapeHTML(p.id)}">吃过啦，记录这一餐</button>` : '<div class="empty-icon">⌖</div><h4>等待目的地</h4><p>设置筛选条件，<br>点击随机跃迁。</p>';
}
function renderDiary() {
  const list=state.reviews.filter(r=>($('diary-scope').value==='all'||r.user===state.user.id)&&(!$('diary-date').value||r.date===$('diary-date').value));
  $('diary-list').innerHTML=list.length ? list.map(r=>{
    const p=state.places.find(p=>p.id===r.place);
    return `<article class="diary-card">${r.photo?`<img class="diary-photo" src="${r.photo}" alt="${escapeHTML(p?.name||'用餐')}的照片" loading="lazy">`:`<div class="diary-no-photo">${p?emoji(p):'🍚'}</div>`}<div class="diary-body"><div class="diary-meta"><span>${r.date}</span><span class="diary-author">${avatarHTML(r.avatar,r.name,'xs')}${escapeHTML(r.name)}</span></div><h3>${escapeHTML(p?.name||'餐厅')}</h3><div class="diary-meta"><span class="stars" aria-label="${r.rating}星">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span><span>实际人均 ${won(r.price)}</span></div>${r.note?`<p>${escapeHTML(r.note)}</p>`:''}${r.user===state.user.id?`<button class="text-button" data-review="${escapeHTML(r.place)}" data-date="${r.date}">编辑这顿饭 ↗</button>`:''}</div></article>`;
  }).join('') : '<div class="empty">把今天的美味，留在这里。<p>选择一家餐厅，记录实际人均、口味评价和照片。每天的记录都会保存在团队空间里。</p></div>';
}
function renderStats() {
  const list=state.reviews.filter(r=>$('stats-scope').value==='all'||r.user===state.user.id);
  if (!list.length) { $('statistics').innerHTML='<div class="empty">口味偏好，从第一条记录开始。<p>用餐后留下评分和实际人均，就能看到菜系喜好、常去餐厅和花费统计。</p></div>'; return; }
  const days=new Set(list.map(r=>r.date)).size;
  const places=new Map(state.places.map(p=>[p.id,p]));
  const cuisines=new Map(), restaurants=new Map(), diets=new Map();
  for (const r of list) {
    const p=places.get(r.place), category=p?.category.split(' > ').pop() || '其他';
    if(!cuisines.has(category)) cuisines.set(category,[]); cuisines.get(category).push(r);
    const name=p?.name||'餐厅'; if(!restaurants.has(name)) restaurants.set(name,[]); restaurants.get(name).push(r);
    const d=dietNames[p?.diet||'unknown']; diets.set(d,(diets.get(d)||0)+1);
  }
  const bars = (entries, rating=false) => entries.slice(0,8).map(([name,rs])=>`<div class="bar-row"><span title="${escapeHTML(name)}">${escapeHTML(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${rating?average(rs,'rating')/5*100:rs.length/list.length*100}%"></div></div><small>${rating?`★ ${average(rs,'rating').toFixed(1)} · ${rs.length}次`:`${rs.length} 次`}</small></div>`).join('');
  $('statistics').innerHTML=`<div class="summary-grid"><div class="summary-box"><small>用餐记录 / 覆盖天数</small><b>${list.length}<small> / ${days} 天</small></b></div><div class="summary-box"><small>平均实际人均</small><b>${won(Math.round(average(list,'price')))}</b></div><div class="summary-box"><small>平均口味评分</small><b>${average(list,'rating').toFixed(1)}<small> / 5</small></b></div><div class="summary-box"><small>记录消费合计</small><b>${won(list.reduce((n,r)=>n+r.price,0))}</b></div></div><div class="chart-grid"><section class="panel"><div class="section-heading"><h3>大家最常吃什么</h3><small>按用餐记录次数</small></div>${bars([...cuisines].sort((a,b)=>b[1].length-a[1].length))}</section><section class="panel"><div class="section-heading"><h3>口味好评榜</h3><small>各饭友评分的平均值</small></div>${bars([...restaurants].sort((a,b)=>average(b[1],'rating')-average(a[1],'rating')),true)}</section><section class="panel"><div class="section-heading"><h3>饮食选择分布</h3></div>${[...diets].map(([name,n])=>`<div class="bar-row"><span>${name}</span><div class="bar-track"><div class="bar-fill" style="width:${n/list.length*100}%"></div></div><small>${Math.round(n/list.length*100)}%</small></div>`).join('')}<p class="muted">根据餐厅已确认类型统计；荤素都有的餐厅不代表用餐者本人为素食者。</p></section><section class="panel"><div class="section-heading"><h3>饭友口味档案</h3></div>${[...new Set(list.map(r=>r.user))].map(id=>{const rs=list.filter(r=>r.user===id);const counts={};for(const r of rs){const c=places.get(r.place)?.category.split(' > ').pop()||'其他';counts[c]=(counts[c]||0)+1;}const best=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];return `<div class="choice"><span class="choice-head">${avatarHTML(rs[0].avatar,rs[0].name,'sm')}<strong>${escapeHTML(rs[0].name)}</strong></span><p class="muted">常吃 ${escapeHTML(best)} · ${rs.length} 条记录 · 人均 ${won(Math.round(average(rs,'price')))} · ★ ${average(rs,'rating').toFixed(1)}</p></div>`;}).join('')}</section></div><p class="muted">统计来自已保存的真实记录。消费合计按每位饭友填写的人均相加；同一天同一家餐厅的多人评价会分别计入，覆盖天数不重复。</p>`;
}
function renderChat() {
  const box=$('messages'), atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
  box.innerHTML=state.messages.length ? state.messages.map(m=>`<div class="message ${m.user===state.user.id?'own':''}">${avatarHTML(m.avatar,m.name,'md')}<div class="message-body"><small>${escapeHTML(m.name)} · ${new Date(m.time).toLocaleTimeString('zh-CN',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}</small><p>${escapeHTML(m.text)}</p></div></div>`).join('') : '<div class="empty">暂无消息<p>在这里或首页发送，所有同事都能看到。</p></div>';
  if(atBottom) box.scrollTop=box.scrollHeight;
  $('chat-preview-text').textContent=state.messages.at(-1)?.text||'有什么想吃的？告诉饭搭子。';
  $('chat-count').textContent=state.messages.length||'';
  $('home-message-count').textContent=String(state.messages.length).padStart(2,'0');
  const recent=state.messages.slice(-6);
  const signature=JSON.stringify(recent.map(m=>[m.id,m.name,m.text]));
  if(signature!==lastBubbleSignature){
    const previous=lastBubbleSignature;lastBubbleSignature=signature;
    const slots=[[0,9,0],[61,2,54],[8,40,4],[58,48,52],[1,73,0],[62,79,53]];
    $('home-bubbles').innerHTML=recent.length?recent.map((m,i)=>{const [x,y,mx]=slots[i];return `<button class="orbit-message ${m.user===state.user.id?'own':''} ${previous&&i===recent.length-1?'new':''}" data-go="chat" style="--x:${x}%;--y:${y}%;--mobile-x:${mx}%;--duration:${7+i*.7}s" title="${escapeHTML(m.name+': '+m.text)}" aria-label="查看匿名消息：${escapeHTML(m.text)}">${avatarHTML(m.avatar,m.name,'xs')}<small>${escapeHTML(m.name)}</small><p>${escapeHTML(m.text)}</p></button>`;}).join(''):'<div class="channel-empty">这里还没有信号。<br>发句话，让它飘起来。<small>CHANNEL OPEN / ANONYMOUS</small></div>';
  }
}
function render() {
  $('profile-name').innerHTML=`${escapeHTML(state.user.name)}<small>点击修改昵称与头像</small>`;
  const avatar=state.user.avatar||state.user.name, profileAvatar=$('profile-avatar');
  profileAvatar.style.setProperty('--avatar-tint',avatarTint(avatar));
  profileAvatar.innerHTML=avatarSVG(avatar);
  $('mobile-profile').innerHTML=avatarHTML(state.user.avatar,state.user.name,'sm');
  $('meal-count').textContent=state.reviews.length;
  $('avg-rating').textContent=state.reviews.length?average(state.reviews,'rating').toFixed(1):'—';
  renderPlaces(); renderPick(); renderDiary(); renderStats(); renderChat();
}
function switchView(view) {
  activeView=view;window.scrollTo(0,0);document.body.classList.toggle('is-discover',view==='discover');
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  const headings={discover:['午餐控制台','选择坐标，寻找今天的目的地。'],diary:['用餐记录','日期、人均、评分和照片。'],stats:['偏好统计','来自团队保存的用餐记录。'],chat:['匿名频道','所有同事的消息，实时同步。']};
  $('page-title').innerHTML=headings[view][0]; $('page-subtitle').textContent=headings[view][1];
  if(view==='discover'&&map) setTimeout(()=>{map.relayout();map.setCenter(centerMarker.getPosition());},0);
  if(view==='chat') $('messages').scrollTop=$('messages').scrollHeight;
}
function openEditor(title,fields,handler) { $('editor-title').textContent=title;$('editor-fields').innerHTML=fields;$('editor-error').textContent='';$('editor-save').disabled=false;editorHandler=handler;$('editor').showModal(); }
function inputField(id,label,value='',type='text',attrs='') { return `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${escapeHTML(value)}" ${attrs}>`; }
function editPlace(id) {
  const p=state.places.find(p=>p.id===id);
  const base=p||{id:`manual-${crypto.randomUUID()}`,lat:currentLocation.lat,lng:currentLocation.lng,price:null,diet:'unknown'};
  openEditor(p?'补充餐厅资料':'添加一家餐厅',`${inputField('p-name','餐厅名称',p?.name||'','text','required maxlength="100"')}${inputField('p-address','地址',p?.address||currentLocation.label,'text','required maxlength="200"')}${inputField('p-category','菜系 / 分类',p?.category||'其他','text','required maxlength="150"')}<div class="field-row"><div>${inputField('p-price','参考人均（₩）',p?.price??'','number','min="0" max="1000000" step="1" placeholder="暂不确定可留空"')}</div><div><label for="p-diet">已确认饮食类型</label><select id="p-diet">${Object.entries(dietNames).map(([key,name])=>`<option value="${key}" ${base.diet===key?'selected':''}>${name}</option>`).join('')}</select></div></div><small>请按菜单填写人均。素食需确认无肉、鱼、海鲜及动物高汤；“荤素都有”表示有经确认的素食菜品。未知请保持待确认。手动添加的餐厅将通过韩国地址查询实际位置，请输入完整的道路名地址。</small>`, async()=>{
    let coordinates={lat:base.lat,lng:base.lng};
    if (!p || $('p-address').value.trim()!==p.address) {
      const resolved=await geocode($('p-address').value.trim());coordinates={lat:Number(resolved.y),lng:Number(resolved.x)};
    }
    await save('place',{...base,...coordinates,name:$('p-name').value,category:$('p-category').value,address:$('p-address').value,price:$('p-price').value===''?null:Number($('p-price').value),diet:$('p-diet').value});toast('餐厅资料已保存，团队成员均可查看');
  });
}
async function compressPhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 照片');
  if(file.size>20*1024*1024) throw new Error('原始图片请小于20MB');
  const bitmap=await createImageBitmap(file);
  const ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  return canvas.toDataURL('image/jpeg',.8);
}
function editReview(id,date=today()) {
  if(!state.places.length) { toast('请先搜索或添加一家餐厅');switchView('discover');return; }
  const p=state.places.find(p=>p.id===id)||state.places[0];
  let old,photo='', photoWork=Promise.resolve();
  openEditor('记录这一餐',`<label for="r-place">在哪家吃的？</label><select id="r-place">${state.places.map(q=>`<option value="${escapeHTML(q.id)}" ${q.id===p.id?'selected':''}>${escapeHTML(q.name)}</option>`).join('')}</select><div class="field-row"><div>${inputField('r-date','用餐日期',date,'date',`required max="${today()}"`)}</div><div>${inputField('r-price','实际人均（₩）',p.price??'','number','required min="0" max="1000000" step="1"')}</div></div><label for="r-rating">口味评分</label><select id="r-rating" required><option value="">请选择口味评分</option>${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)}${'☆'.repeat(5-n)} · ${['','不太合口味','一般般','还不错','很好吃','下次还来'][n]}</option>`).join('')}</select><label for="r-note">今天吃得怎么样？</label><textarea id="r-note" maxlength="500" placeholder="推荐什么菜？辣度、分量、口味如何？"></textarea><label for="r-photo">留一张美食照片</label><input id="r-photo" type="file" accept="image/jpeg,image/png,image/webp"><img id="r-preview" class="photo-preview hidden" alt="用餐照片预览"><button id="remove-photo" type="button" class="text-button hidden">移除照片</button><small>照片将压缩后保存到服务器。同一天同一家餐厅重复提交会更新你自己的记录。</small>`,async()=>{
    await photoWork;
    await save('review',{place:$('r-place').value,date:$('r-date').value,price:Number($('r-price').value),rating:Number($('r-rating').value),note:$('r-note').value,photo});toast('这一餐已保存到每日用餐记录');
  });
  function preview() { $('r-preview').src=photo;$('r-preview').classList.toggle('hidden',!photo);$('remove-photo').classList.toggle('hidden',!photo); }
  function loadExisting() {
    old=state.reviews.find(r=>r.user===state.user.id&&r.place===$('r-place').value&&r.date===$('r-date').value);
    const selected=state.places.find(q=>q.id===$('r-place').value);
    $('r-price').value=old?.price??selected?.price??'';$('r-rating').value=old?.rating??'';$('r-note').value=old?.note||'';photo=old?.photo||'';$('r-photo').value='';preview();
  }
  $('r-place').onchange=loadExisting;$('r-date').onchange=loadExisting;loadExisting();
  $('r-photo').onchange=()=>{
    const file=$('r-photo').files[0];if(!file)return;
    $('editor-save').disabled=true;
    photoWork=compressPhoto(file).then(data=>{photo=data;preview();$('editor-error').textContent='';}).catch(e=>{$('editor-error').textContent=e.message;$('r-photo').value='';}).finally(()=>{$('editor-save').disabled=false;});
  };
  $('remove-photo').onclick=()=>{photo='';$('r-photo').value='';preview();};
}
async function choose(id) { const p=state.places.find(p=>p.id===id);await save('pick',{id});const warnings=[];if(Number($('budget').value)&&p?.price===null)warnings.push('人均价格');if(diet!=='all'&&p?.diet==='unknown')warnings.push('荤素类型');toast(warnings.length?`已抽中餐厅，${warnings.join('、')}待确认，请先核对菜单`:'今日选择已同步给大家，一起出发吧'); }
async function randomPick() {
  const list=eligible();if(!list.length)throw new Error('没有符合条件的餐厅，请调整筛选');
  const alternatives=list.length>1?list.filter(p=>p.id!==state.pick?.id):list;
  const random=new Uint32Array(1);crypto.getRandomValues(random);
  // Reject the tiny modulo-bias interval for a uniform draw.
  const limit=2**32-(2**32%alternatives.length);while(random[0]>=limit)crypto.getRandomValues(random);
  $('random').disabled=true;$('random').setAttribute('aria-busy','true');$('space-stage').classList.add('launching');
  try {
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,700));
    await choose(alternatives[random[0]%alternatives.length].id);
  } finally { $('random').disabled=false;$('random').removeAttribute('aria-busy');$('space-stage').classList.remove('launching'); }
}
async function geocode(address) { const result=await kakaoSearch('address',{query:address});if(!result.documents.length)throw new Error('没有找到此地址，请输入完整的韩国道路名地址');return result.documents[0]; }
function moveMap() { const point=new kakao.maps.LatLng(currentLocation.lat,currentLocation.lng);centerMarker.setPosition(point);map.setCenter(point);$('location-label').textContent=currentLocation.label; }
async function setLocation(lat,lng,label) { await save('location',{lat,lng,label});if(map)moveMap(); }
function loadMap() {
  if(map||mapLoading)return;mapLoading=true;
  $('map-status').textContent='正在加载地图…';
  api('config').then(config=>new Promise((resolve,reject)=>{
    if(!config.kakaoKey){$('map-hint').textContent='搜索地址，切换聚餐中心';reject(new Error('交互地图暂未启用。可搜索地址切换位置，或在下方选择附近餐厅。'));return;}
    document.querySelector('script[data-kakao]')?.remove();
    const script=document.createElement('script');script.dataset.kakao='true';script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.kakaoKey)}&libraries=services&autoload=false`;
    const timer=setTimeout(()=>reject(new Error('地图加载超时。请检查网络、JavaScript Key 和域名设置。')),12000);
    script.onerror=()=>{clearTimeout(timer);reject(new Error('Kakao 地图连接失败。请确认已启用地图 API，并将当前网址加入 JavaScript SDK 域名。'));};
    script.onload=()=>{
      if(!window.kakao?.maps?.load){clearTimeout(timer);reject(new Error('地图授权未通过，请检查 Kakao JavaScript Key 与域名。'));return;}
      kakao.maps.load(()=>{clearTimeout(timer);resolve();});
    };
    document.head.append(script);
  })).then(async()=>{
    $('map').innerHTML='';
    const point=new kakao.maps.LatLng(currentLocation.lat,currentLocation.lng);
    map=new kakao.maps.Map($('map'),{center:point,level:4});centerMarker=new kakao.maps.Marker({position:point,map});
    kakao.maps.event.addListener(map,'click',run(async e=>{const lat=e.latLng.getLat(),lng=e.latLng.getLng();await setLocation(lat,lng,`自选位置 ${lat.toFixed(5)}, ${lng.toFixed(5)}`);}));
    if(activeView!=='discover') map.relayout();
    await searchNearby();
  }).catch(e=>{const status=$('map-status');if(status)status.textContent=e.message;toast(e.message);}).finally(()=>{mapLoading=false;});
}
async function searchNearby() {
  const version=++searchVersion;searching=true;renderPlaces();$('search-note').textContent='正在通过 Kakao 搜索附近餐厅…';
  let discovered=[];
  try {
    const searchCenter={lat:currentLocation.lat,lng:currentLocation.lng,radius:Number($('radius').value)};
    const request=async page=>{const result=await kakaoSearch('nearby',{...searchCenter,page});return {data:result.documents,pagination:{hasNextPage:!result.meta.is_end}};};
    for(let page=1;page<=3;page++) {
      const result=await request(page);if(version!==searchVersion)return;
      discovered.push(...result.data);if(!result.pagination?.hasNextPage)break;
    }
    dietHints=new Set();
    if(diet==='veg') {
      const results=await Promise.allSettled(['비건','채식','샐러드'].map(query=>kakaoSearch('keyword',{...searchCenter,query})));
      if(version!==searchVersion)return;
      for(const result of results)if(result.status==='fulfilled')for(const p of result.value.documents){dietHints.add(p.id);discovered.push(p);}
    }
    discovered=[...new Map(discovered.map(p=>[p.id,p])).values()];
    for(let i=0;i<discovered.length;i+=8){if(version!==searchVersion)return;await Promise.all(discovered.slice(i,i+8).map(p=>api('place',{discovery:true,id:p.id,name:p.place_name,category:p.category_name,address:p.road_address_name||p.address_name||p.place_name,lat:Number(p.y),lng:Number(p.x),price:null,diet:'unknown'})));}
    if(version!==searchVersion)return;
    await refresh();
    markers.forEach(m=>m.setMap(null));markers=[];
    if(map)for(const p of discovered) { const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(p.y,p.x),map,title:p.place_name});kakao.maps.event.addListener(marker,'click',()=>editPlace(p.id));markers.push(marker); }
    $('search-note').textContent=`Kakao 本次返回 ${discovered.length} 家附近餐厅${diet==='veg'?'（包含素食关键词线索）':'（距离搜索最多45家）'}。点击餐厅补充人均与饮食类型；距离为直线距离。`;
  } catch(e){if(version===searchVersion){$('search-note').textContent=e.message;toast(e.message);}}
  finally {if(version===searchVersion){searching=false;renderPlaces();}}
}
$('today-label').textContent=new Date().toLocaleDateString('en-US',{timeZone:'Asia/Seoul',weekday:'long',month:'long',day:'numeric'}).toUpperCase()+' · SEOUL';
$('close-editor').onclick=()=>$('editor').close();
$('editor-form').onsubmit=async e=>{e.preventDefault();$('editor-save').disabled=true;$('editor-error').textContent='';try{await editorHandler();$('editor').close();}catch(e){$('editor-error').textContent=e.message;}finally{$('editor-save').disabled=false;}};
$('random').onclick=run(randomPick);
$('retry-map').onclick=loadMap;
$('add-place').onclick=()=>editPlace();
$('new-review').onclick=()=>editReview(state.pick?.id);
$('profile-button').onclick=()=>openProfileEditor();
function openProfileEditor() {
  let avatar=state.user.avatar||randomAvatarSeed();
  openEditor('换个宇宙身份',`<div class="avatar-picker"><span id="avatar-preview" class="avatar avatar-xl" style="--avatar-tint:${avatarTint(avatar)}">${avatarSVG(avatar)}</span><div><p class="muted">每次来宇宙，都可能遇见新的自己。</p><button type="button" class="button small" id="avatar-reroll">↻ 随机换个头像</button></div></div>${inputField('nickname','昵称',state.user.name,'text','required maxlength="30"')}`,async()=>{await save('profile',{name:$('nickname').value,avatar});toast('新身份已保存');});
  document.getElementById('avatar-reroll').onclick=()=>{
    avatar=randomAvatarSeed();
    const preview=document.getElementById('avatar-preview');
    preview.style.setProperty('--avatar-tint',avatarTint(avatar));
    preview.innerHTML=avatarSVG(avatar);
    preview.classList.remove('pop');void preview.offsetWidth;preview.classList.add('pop');
  };
}
$('mobile-profile').onclick=()=>$('profile-button').onclick();
$('invite').onclick=run(async()=>{
  try {await navigator.clipboard.writeText(location.href);toast('邀请链接已复制，发给同事即可加入同一空间');}
  catch {openEditor('邀请饭搭子',`${inputField('invite-url','复制链接，发给同事',location.href,'text','readonly')}<small>持有此链接的人可以匿名加入，查看本团队记录、照片和聊天。请仅分享给同事。</small>`,async()=>{});$('invite-url').select();}
});
$('budget').onchange=renderPlaces;
$('include-unknown-price').onchange=renderPlaces;
$('include-unknown-diet').onchange=renderPlaces;
$('radius').onchange=()=>{renderPlaces();searchNearby();};
$('reset').onclick=()=>{diet='all';$('include-unknown-price').checked=true;$('include-unknown-diet').checked=true;$('budget').value='0';$('radius').value='500';document.querySelectorAll('[data-diet]').forEach(b=>b.classList.toggle('selected',b.dataset.diet==='all'));renderPlaces();searchNearby();};
$('diary-scope').onchange=renderDiary;$('diary-date').onchange=renderDiary;$('stats-scope').onchange=renderStats;$('clear-diary').onclick=()=>{$('diary-date').value='';renderDiary();};
for(const [formId,inputId] of [['chat-form','chat-input'],['home-chat-form','home-chat-input']]){
  $(formId).onsubmit=run(async e=>{
    e.preventDefault();const input=$(inputId),original=input.value,text=original.trim();if(!text)return;
    const button=e.currentTarget.querySelector('button');button.disabled=true;
    try{await save('message',{text});if(input.value===original)input.value='';$('messages').scrollTop=$('messages').scrollHeight;}
    finally{button.disabled=false;}
  });
}
$('location-form').onsubmit=run(async e=>{
  e.preventDefault();
  const query=$('address').value.trim();if(!query)throw new Error('请输入地址或地点');
  $('location-results').innerHTML='';
  try {const p=await geocode(query);await setLocation(Number(p.y),Number(p.x),p.road_address?.address_name||p.address_name||query);toast('聚餐位置已更新并共享');}
  catch {
    const result=await kakaoSearch('keyword',{query});const results=result.documents;if(!results.length)throw new Error('没有找到地点，请输入更完整的地址或店名');
    $('location-results').innerHTML=results.slice(0,5).map((p,i)=>`<button type="button" data-location="${i}">${escapeHTML(p.place_name)}<br><small>${escapeHTML(p.road_address_name||p.address_name)}</small></button>`).join('');
    $('location-results').onclick=run(async e=>{const button=e.target.closest('[data-location]');if(!button)return;const p=results[Number(button.dataset.location)];await setLocation(Number(p.y),Number(p.x),p.road_address_name||p.address_name||p.place_name);$('location-results').innerHTML='';toast('聚餐位置已更新并共享');});
  }
});
$('locate').onclick=()=>{
  if(!navigator.geolocation){toast('浏览器不支持定位');return;}
  navigator.geolocation.getCurrentPosition(run(async p=>{await setLocation(p.coords.latitude,p.coords.longitude,'我的当前位置');toast('聚餐中心已设为当前位置');}),()=>toast('无法获取位置，请允许定位权限或手动搜索地址'),{enableHighAccuracy:true,timeout:10000});
};
document.addEventListener('click',run(async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.view) switchView(b.dataset.view);
  else if(b.dataset.go) switchView(b.dataset.go);
  else if(b.dataset.diet){diet=b.dataset.diet;document.querySelectorAll('[data-diet]').forEach(x=>x.classList.toggle('selected',x===b));renderPlaces();searchNearby();}
  else if(b.hasAttribute('data-add'))editPlace();
  else if(b.dataset.edit)editPlace(b.dataset.edit);
  else if(b.dataset.review)editReview(b.dataset.review,b.dataset.date||today());
  else if(b.dataset.pick)await choose(b.dataset.pick);
  else if(b.id==='reroll')await randomPick();
}));
async function start() {
  try {
    await refresh();
    const events=new EventSource(apiURL('events'));
    events.onopen=()=>{$('connection').textContent='团队已连接';};
    events.onmessage=()=>refresh().catch(()=>{$('connection').textContent='同步失败';});
    events.onerror=()=>{$('connection').textContent='正在重连…';};
    loadMap();
    if(!state.location) { try {const p=await geocode(currentLocation.label);await save('location',{lat:Number(p.y),lng:Number(p.x),label:currentLocation.label});}catch(e){toast(e.message);} }
    await searchNearby();
  }catch(e){$('connection').textContent='连接失败';toast('后端连接失败，请使用 npm start 启动网站后刷新');}
}
start();
