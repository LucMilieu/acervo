/* Altere BUILD a cada publicação. Nunca apague caches de outros aplicativos. */
const BUILD='2026-10-15.4';
const PREFIX='jbm-acervo:'+self.registration.scope+':';
const CACHE=PREFIX+BUILD;
const CORE=['./','index.html','styles.css','app.js','manifest.json'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)));
  // Uma atualização só assume o controle quando o usuário solicitar.
});
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  if(event.request.mode==='navigate'){
    // A página e o JS permanecem na mesma versão até a troca do worker.
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      return await cache.match(new URL('index.html',self.registration.scope))||fetch(event.request);
    })());return;
  }
  const path=url.href.split('?')[0];
  const core=CORE.slice(1).some(p=>path===new URL(p,self.registration.scope).href);
  if(core){event.respondWith(caches.open(CACHE).then(async c=>await c.match(path)||fetch(event.request)));return;}
  // Imagens locais opcionais: cache em segundo plano, mantendo o worker vivo.
  if(!/\/(icon-(180|192|512)\.png|fonts\/[\w.-]+\.woff2)$/.test(url.pathname))return;
  const update=caches.open(CACHE).then(async cache=>{
    const response=await fetch(event.request);
    if(response.ok)await cache.put(event.request,response.clone());return response;
  });
  event.waitUntil(update.then(()=>{},()=>{}));
  event.respondWith(caches.open(CACHE).then(async c=>await c.match(event.request)||update));
});
