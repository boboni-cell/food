import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

const room='test-room-one', otherRoom='test-room-two';
const place={id:'12345',name:'测试餐厅',category:'음식점 > 한식',address:'서울특별시 서초구 강남대로89길 19',lat:37.51,lng:127.02,price:12000,diet:'mixed'};
const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function boot(file=':memory:'){
  const server=createApp(file);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  function client(){let cookie='';return async(route,data,r=room)=>{
    const res=await fetch(`${base}/api/${route}?room=${r}`,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,data:await res.json(),cookie};
  };}
  return {server,base,client,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
test('anonymous colleagues independently rate; same-day edit updates; rooms stay isolated',async()=>{
  const app=await boot();try{
    const a=app.client(),b=app.client();
    const me=(await a('state')).data.user;assert.equal((await a('state')).data.user.id,me.id);
    assert.equal((await a('place',place)).status,200);
    const review={place:place.id,date,rating:4,price:13000,note:'很好吃',photo};
    assert.equal((await a('review',review)).status,200);
    await a('review',{...review,rating:5,price:14000});
    await b('review',{...review,rating:3,price:12000});
    await b('message',{text:'今天一起吃饭'});
    await a('pick',{id:place.id});
    const state=(await a('state')).data;
    assert.equal(state.reviews.length,2);assert.equal(state.reviews.find(r=>r.user===me.id).price,14000);
    assert.equal(state.reviews.find(r=>r.user===me.id).photo,photo);assert.equal(state.messages[0].text,'今天一起吃饭');assert.equal(state.pick.id,place.id);
    const isolated=(await a('state',undefined,otherRoom)).data;assert.equal(isolated.reviews.length,0);assert.equal(isolated.places.length,0);assert.equal(isolated.messages.length,0);assert.equal(isolated.pick,null);
    await a('place',{...place,price:null,diet:'unknown',discovery:true});
    assert.equal((await a('state')).data.places[0].price,12000);
  }finally{await app.close();}
});
test('invalid prices, future dates, unsafe images and missing restaurants rejected',async()=>{
  const app=await boot();try{
    const a=app.client();await a('place',place);
    const review={place:place.id,date,rating:4,price:13000,note:'',photo:''};
    for(const patch of [{price:-1},{price:12.5},{price:'13000'},{rating:6},{rating:2.5},{date:'2099-01-01'},{date:'2025-02-30'},{photo:'data:image/svg+xml;base64,PHN2Zz4='},{place:'missing'}])assert.equal((await a('review',{...review,...patch})).status,400);
    assert.equal((await a('place',{...place,diet:'salad'})).status,400);
    assert.equal((await a('location',{lat:100,lng:127,label:'test'})).status,400);
    assert.equal((await a('message',{text:' '})).status,400);
    const res=await fetch(`${app.base}/api/message?room=${room}`,{method:'POST',headers:{Origin:'https://elsewhere.example','Content-Type':'application/json'},body:JSON.stringify({text:'bad'})});assert.equal(res.status,403);
  }finally{await app.close();}
});
test('reviews, photos, profile and actual per-person price survive a server restart',async()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'lunch-test-'));const file=path.join(folder,'db.sqlite');
  let app=await boot(file);try{
    const a=app.client();await a('profile',{name:'匿名同事 A'});await a('place',place);await a('review',{place:place.id,date,rating:5,price:15000,note:'会再来',photo});await app.close();
    app=await boot(file);const data=(await app.client()('state')).data;
    assert.equal(data.reviews.length,1);assert.equal(data.reviews[0].name,'匿名同事 A');assert.equal(data.reviews[0].price,15000);assert.equal(data.reviews[0].photo,photo);
  }finally{await app.close();rmSync(folder,{recursive:true,force:true});}
});
test('random cute avatars are generated, editable and attached to messages',async()=>{
  const app=await boot();try{
    const a=app.client(),b=app.client();
    const first=(await a('state')).data.user;
    assert.match(first.avatar,/^[a-z0-9]{8}$/);
    assert.match((await b('state')).data.user.avatar,/^[a-z0-9]{8}$/);
    assert.equal((await a('profile',{avatar:'abc123def456'})).status,200);
    assert.equal((await a('state')).data.user.name,first.name);
    assert.equal((await a('profile',{avatar:'BAD SEED!'})).status,400);
    await a('message',{text:'新头像上线'});
    const message=(await b('state')).data.messages.at(-1);
    assert.equal(message.avatar,'abc123def456');assert.equal(message.name,first.name);assert.equal(message.text,'新头像上线');
  }finally{await app.close();}
});
test('team members receive live change events',async()=>{
  const app=await boot();const controller=new AbortController();try{
    const res=await fetch(`${app.base}/api/events?room=${room}`,{signal:controller.signal});
    const reader=res.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/connected/);
    await app.client()('message',{text:'实时消息'});
    const event=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('SSE timeout')),1500))]);assert.match(new TextDecoder().decode(event.value),/update/);
    await reader.cancel();
  }finally{controller.abort();await app.close();}
});
