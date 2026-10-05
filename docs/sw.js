/* Only static shell resources are cached. Account records remain in Firestore/IndexedDB. */
if (typeof importScripts === 'function') importScripts('./shell-manifest.js');
const BASE = new URL(self.registration.scope || './',self.location.href || self.location.origin+"/cnx/");
const OWNER = 'connections-shell:'+encodeURIComponent(BASE.pathname)+':';
const CACHE = OWNER+(self.__CONNECTIONS_SHELL__?.version || 'development');
const STATE = 'connections-notification-state:'+encodeURIComponent(BASE.pathname);
const shellURL = path => new URL(path,BASE).href;
const shellPaths = self.__CONNECTIONS_SHELL__?.files || ['./','mark.svg','manifest.webmanifest','v9-extras.js','v9-extras.css','giphy-config.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(shellPaths.map(shellURL)))));
// Wait for old clients to close, preserving ongoing calls/uploads and their original chunks.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(OWNER)&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
 const relative=url.pathname.slice(BASE.pathname.length);
 if(relative.startsWith('src/')||relative.startsWith('@')||relative.startsWith('node_modules/'))return;
 if(event.request.mode==='navigate')event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(shellURL('./'))) || fetch(event.request)));
 else if(relative.startsWith('assets/')||relative.startsWith('avatars/')||relative.startsWith('coloring/')||['mark.svg','manifest.webmanifest','v9-extras.js','v9-extras.css','giphy-config.js'].includes(relative))event.respondWith(caches.open(CACHE).then(async cache=>{
  const hit=await cache.match(event.request,{ignoreSearch:true});if(hit)return hit;
  const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const data=event.notification.data||{},destination=new URL('./',BASE);
 if(data.conversationId)destination.searchParams.set('conversation',data.conversationId);
 if(data.messageId)destination.searchParams.set('message',data.messageId);
 if(data.accountId)destination.searchParams.set('account',data.accountId);
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  const client=clients.find(item=>{const url=new URL(item.url);return url.origin===BASE.origin&&url.pathname.startsWith(BASE.pathname);});
  if(client){await client.focus();client.postMessage({...data,type:'notification-open'});}else await self.clients.openWindow(destination.href);
 }));
});
const readKey=(conversation,account='')=>new Request(shellURL('__read/'+encodeURIComponent(account)+"/cnx/"+encodeURIComponent(conversation)));
self.addEventListener('message',event=>{
 const data=event.data;if(data?.type!=='conversation-read'||!data.conversationId)return;
 event.waitUntil((async()=>{
  const cache=await caches.open(STATE),key=readKey(data.conversationId,data.accountId),prior=await cache.match(key),previous=prior?await prior.json():null,readAt=data.readAt||Date.now();
  if(!previous||readAt>=previous.readAt)await cache.put(key,new Response(JSON.stringify({messageId:data.messageId,readAt})));
  const notifications=await self.registration.getNotifications({tag:'message-'+data.conversationId});
  notifications.forEach(item=>{if(data.accountId&&item.data?.accountId!==data.accountId)return;if(item.data?.messageId===data.messageId||Number(item.data?.createdAt||0)<=readAt)item.close();});
 })());
});
self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 event.waitUntil((async()=>{
  const conversation=data.data?.conversationId;
  if(conversation){const cache=await caches.open(STATE),record=await cache.match(readKey(conversation,data.data.accountId)),read=record?await record.json():null;if(read&&(read.messageId===data.data.messageId||(data.data.createdAt&&Number(data.data.createdAt)<=read.readAt)))return;}
  await self.registration.showNotification(data.title||'Connections',{body:data.body,tag:data.tag,icon:shellURL('mark.svg'),data:data.data});
 })());
});
