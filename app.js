'use strict';
/* Acervo JBM — sem bibliotecas externas. Contrato legado do Apps Script preservado.
 * Campos novos também são descritos nas observações para servidores que ignoram colunas novas.
 * Leia LEIA-ME.md antes de publicar; a confirmação de idempotência pertence ao servidor.
 */
const VERSION='2026-10-15.4';
const DEF={Coletores:['Marcos de Freitas Mortara','Marcio de Melo Leodegario','Lucas Gonçalves Ferreira'],Origem:['Silvestre','Cultivada de origem silvestre','Origem de cultivo','Desconhecida'],'Hábito':['Epífita','Rupícola','Terrícola','Hemiepífita','Outro'],'Material coletado':['Planta inteira','Muda','Semente','Estaca','Broto (keiki)','Outro'],'Local no JBM':['Viveiro de plantas','Estufa bromélias','Estufa aráceas','Outro'],Habitat:['Floresta Ombrófila Densa','Floresta Ombrófila Mista','Floresta Estacional Semidecidual','Restinga','Campo de altitude / rupestre','Afloramento rochoso','Mata ciliar','Borda de mata','Área antropizada','Outro'],'Tipo de evento':['Floração','Frutificação','Morte','Mudança de local','Divisão','Monitoramento','Determinação','Outro']};
const STEPS=['Foto','Local','Quando e quem','Identificação','Origem','Destino','Revisão'];
// Repetir somente o contexto. Identificação, quantidade, nº de coleta, fotos e observações são novos.
const REPEAT=['lat','lng','alt','prec','fonteCoord','endereco','local','habitat','habitatOutro','habito','habitoOutro','data','coletores','coletoresOutro','origem','destino','destinoOutro','material','materialOutro','substrato','substratoOutro'];
const $=s=>document.querySelector(s), main=$('#main'), nav=$('#nav');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const uuid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const clone=o=>JSON.parse(JSON.stringify(o));
const APP=location.pathname.replace(/index\.html$/,'');
const prefs='jbm:'+APP+':';
const settings=()=>({url:localStorage.getItem(prefs+'url')||localStorage.getItem('url')||'',token:localStorage.getItem(prefs+'token')??localStorage.getItem('token')??''});
const base=()=>settings().url;
const key=(type,id='')=>`${type}:${APP}:${base()}:${id}`;
const safeURL=u=>{try{const x=new URL(u);return ['https:','http:'].includes(x.protocol)?x.href:null;}catch{return null;}};
const validScript=u=>{try{const x=new URL(u);return x.protocol==='https:'&&x.hostname==='script.google.com'&&/^\/macros\/s\/[^/]+\/exec\/?$/.test(x.pathname)&&!x.search&&!x.hash;}catch{return false;}};
let D={listas:DEF,especies:[],acervo:{cab:[],linhas:[]},eventos:[]},ACV=[],SP=[],GEN={},R=null,step=0,screen='home',saving=false,photoBusy=0,render=()=>{},syncing=null,waitingWorker=null,networkBusy=false;
let query={q:'',local:'',familia:'',status:'',limit:100},detailId='',draftTimer, gpsBusy=false;
const runtime={draftSaved:false};
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('on');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('on'),5500);}
function focusHeading(){const h=main.querySelector('h1,h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}scrollTo(0,0);}
function fail(e){console.error(e?.name||'Acervo: erro');toast(e?.message||'A operação falhou. Tente novamente.');}
function storedError(e){return new Error(e?.name==='QuotaExceededError'?'O armazenamento do aparelho está cheio. Exporte os registros pendentes antes de liberar espaço.':'Não foi possível salvar no aparelho. Mantenha esta tela aberta e tente novamente.');}
const dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('jbmb',1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('kv'))req.result.createObjectStore('kv');};
  req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};
  req.onerror=()=>reject(req.error);req.onblocked=()=>toast('Feche outras abas antigas deste aplicativo.');
});
async function tx(mode,work){const db=await dbPromise;return new Promise((resolve,reject)=>{
  const transaction=db.transaction('kv',mode);let result;
  try{result=work(transaction.objectStore('kv'));}catch(e){transaction.abort();reject(e);return;}
  transaction.oncomplete=()=>resolve(result?.result);
  transaction.onerror=()=>reject(transaction.error||new Error('Erro no armazenamento.'));
  transaction.onabort=()=>reject(transaction.error||new Error('Gravação interrompida.'));
});}
const get=k=>tx('readonly',s=>s.get(k));
const put=(k,v)=>tx('readwrite',s=>s.put(v,k));
const remove=k=>tx('readwrite',s=>s.delete(k));
async function entries(prefix){const db=await dbPromise;return new Promise((resolve,reject)=>{
  const t=db.transaction('kv','readonly'),out=[];const req=t.objectStore('kv').openCursor();
  req.onsuccess=()=>{const c=req.result;if(c){if(String(c.key).startsWith(prefix))out.push([c.key,c.value]);c.continue();}};
  t.oncomplete=()=>resolve(out);t.onerror=()=>reject(t.error);
});}
const queue=()=>entries(key('queue'));
const lists=n=>Array.isArray(D.listas?.[n])&&D.listas[n].length?D.listas[n]:DEF[n]||[];
const withOther=n=>[...new Set([...lists(n),'Outro'])];
const value=(field,r=R)=>r[field]==='Outro'?String(r[field+'Outro']||'').trim():String(r[field]??'').trim();
const collectors=(r=R)=>(r.coletores||[]).map(x=>x==='Outro'?String(r.coletoresOutro||'').trim():x).filter(Boolean);
const plantName=o=>o['Espécie']||[o['Gênero'],o['Epíteto']].filter(Boolean).join(' ')||o['Família']||'Não identificada';
function indexData(){
  const species=new Map();GEN={};
  const add=(f,g,e)=>{g=String(g||'').trim();e=String(e||'').trim();f=String(f||'').trim();if(!g)return;const k=norm(g+' '+e);if(!species.has(k))species.set(k,{f,g,e,k});if(f)GEN[norm(g)]=f;};
  (D.especies||[]).forEach(r=>add(r[0],r[1],r[2]));
  ACV=(D.acervo?.linhas||[]).map(l=>Object.fromEntries(D.acervo.cab.map((h,i)=>[h,l[i]])));
  ACV.forEach(o=>add(o['Família'],o['Gênero'],o['Epíteto']));SP=[...species.values()];
}
async function request(url,options={},timeout=35000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch(url,{...options,signal:controller.signal,redirect:'follow',cache:'no-store'});
    if(!response.ok){const e=new Error(`O servidor respondeu com HTTP ${response.status}.`);e.transport=true;throw e;}
    let j;try{j=await response.json();}catch{const e=new Error('O servidor não devolveu JSON válido. Confira a publicação e as permissões do Apps Script.');e.transport=true;throw e;}
    if(typeof j?.ok!=='boolean'){const e=new Error('Resposta do servidor sem confirmação válida.');e.transport=true;throw e;}return j;
  }catch(e){if(e.name==='AbortError'){const x=new Error('O servidor demorou a responder.');x.transport=true;throw x;}if(e instanceof TypeError)e.transport=true;throw e;}
  finally{clearTimeout(timer);}
}
function cleanData(j){
  if(!Array.isArray(j.acervo?.cab)||!Array.isArray(j.acervo?.linhas)||!j.acervo.linhas.every(Array.isArray))throw new Error('A estrutura do acervo recebida é inválida. O cache anterior foi preservado.');
  return {listas:j.listas&&typeof j.listas==='object'?j.listas:DEF,especies:Array.isArray(j.especies)?j.especies:[],acervo:j.acervo,eventos:j.eventos||[],capabilities:j.capabilities||{},atualizado:Date.now()};
}
async function refresh(silent=false){
  const cfg=settings(),destination=base();if(!cfg.url){if(!silent)toast('Informe o endereço da planilha em Configurações.');return false;}
  try{const url=new URL(cfg.url);url.searchParams.set('token',cfg.token);const j=await request(url.href);if(!j.ok)throw new Error(j.erro||'Acesso recusado.');
    const data=cleanData(j);await put(key('data'),data);if(base()!==destination)return false;D=data;indexData();if(!silent)toast('Dados atualizados.');return true;
  }catch(e){if(!silent)toast(navigator.onLine?e.message:'Sem conexão. O acervo já baixado continua disponível.');return false;}
}
async function migrateLegacy(){
  if(!base())return;
  const migrationKey='legacyMigration:'+APP,owner=await get(migrationKey);
  if(owner?.url&&owner.url!==base())return;
  if(!owner)await put(migrationKey,{url:base(),at:Date.now()});
  // Vincula uma única vez a fila antiga à configuração que já existia no aparelho.
  for(const [k,item] of await entries('fila:')){
    const id=item?.dados?.uid;if(!id)continue;const target=key('queue',id);
    await tx('readwrite',s=>{s.put({...item,base:base(),created:Date.now(),state:'pending',legacy:true},target);s.delete(k);});
  }
  if(!await get(key('data'))){const legacy=await get('dados');if(legacy?.acervo?.cab)await put(key('data'),{...legacy,atualizado:Number(localStorage.getItem('atualizado'))||0});}
}
async function withSyncLock(work){
  if(navigator.locks)return navigator.locks.request('jbm-sync:'+APP+':'+base(),work);
  // Sem Web Locks, uma lease no IndexedDB impede duas abas de enviarem a mesma fila.
  const lockKey=key('lease'),owner=uuid();let acquired=false;
  await tx('readwrite',s=>{const req=s.get(lockKey);req.onsuccess=()=>{if(!req.result||req.result.until<Date.now()){s.put({owner,until:Date.now()+180000},lockKey);acquired=true;}};});
  if(!acquired)return {sent:[],error:'Outra aba está sincronizando. Aguarde.'};
  const renew=setInterval(()=>tx('readwrite',s=>{const req=s.get(lockKey);req.onsuccess=()=>{if(req.result?.owner===owner)s.put({owner,until:Date.now()+180000},lockKey);};}).catch(()=>{}),30000);
  try{return await work();}finally{clearInterval(renew);await tx('readwrite',s=>{const req=s.get(lockKey);req.onsuccess=()=>{if(req.result?.owner===owner)s.delete(lockKey);};});}
}
async function synchronize(){
  if(syncing)return syncing;if(!base())return {sent:[],error:'Configure a conexão com a planilha.'};
  syncing=withSyncLock(async()=>{
    const destination=base(),cfg=settings(),result={sent:[],error:''};
    const items=(await queue()).sort((a,b)=>(a[1].created||0)-(b[1].created||0));
    for(const [k,initial] of items){
      if(base()!==destination)break;
      const it=await get(k);if(!it||!['pending','retry'].includes(it.state||'pending'))continue;
      if(!navigator.onLine){result.error='Sem conexão. Os registros continuam no aparelho.';break;}
      // Marca antes do POST: após fechamento ou timeout o resultado pode ser incerto.
      it.state='sending';it.updated=Date.now();await put(k,it);let j;
      try{j=await request(cfg.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({token:cfg.token,tipo:it.tipo,dados:it.dados})},90000);}
      catch(e){it.state='uncertain';it.error='Envio sem confirmação: '+e.message;await put(k,it);result.error='Há um envio sem confirmação. Confira as pendências antes de tentar novamente.';break;}
      if(!j.ok){it.state='error';it.error=String(j.erro||'Registro recusado pela planilha.');await put(k,it);result.error='Há registros recusados. Veja as pendências.';continue;}
      if(it.tipo==='acesso'&&!j.registro){it.state='uncertain';it.error='O servidor confirmou a operação, mas não informou o número de registro.';await put(k,it);result.error=it.error;continue;}
      const receipt={...it,state:'sent',registro:j.registro||it.dados.registro,idEvento:j.idEvento||'',sentAt:Date.now(),error:''};
      // Só retirar da fila na mesma transação que guarda o recibo local.
      await tx('readwrite',s=>{s.put(receipt,key('sent',it.dados.uid));s.delete(k);});
      result.sent.push(receipt.registro||'evento');
    }
    if(result.sent.length&&base()===destination)await refresh(true);return result;
  }).finally(()=>{syncing=null;});return syncing;
}
function blankAccess(){return {uid:uuid(),kind:'access',fotos:[],lat:null,lng:null,alt:null,prec:null,fonteCoord:'',endereco:'',local:'',habitat:'',habito:'',data:today(),coletores:[],nColeta:'',mesmoIdent:true,naoIdent:false,familia:'',genero:'',epiteto:'',ssp:'',qualificador:'',determinador:'',detData:today(),origem:'',doacao:'Não',doador:'',dataIngresso:today(),ingressoDiferente:false,dataDesconhecida:false,destino:'',material:'',qtd:1,unidade:'indivíduos',substrato:'',obs:'',sequence:false,locConfirmed:true};}
function blankEvent(registro=''){return {uid:uuid(),kind:'event',registro,tipo:'',data:today(),responsavel:'',nota:'',fotos:[],destinoEvento:'',qtdAfetada:'',todoAcesso:false,novaFamilia:'',novoGenero:'',novoEpiteto:'',novoSsp:'',novoQualificador:'',determinadoPor:''};}
async function saveDraft(){
  if(!R||!['access','event'].includes(R.kind))return;
  runtime.draftSaved=false;
  const snapshot={record:clone(R),step,base:base(),updated:Date.now()};
  await put(key('draft',R.uid),snapshot);runtime.draftSaved=true;
  const status=$('#draftStatus');if(status)status.textContent='Rascunho salvo neste aparelho.';
}
function scheduleDraft(){runtime.draftSaved=false;clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft().catch(e=>toast(storedError(e).message)),500);}
async function flushDraft(){clearTimeout(draftTimer);if(R)await saveDraft();}
function formFrame(html,lastLabel){
  main.innerHTML=html+'<p class="dica" id="draftStatus">'+(runtime.draftSaved?'Rascunho salvo neste aparelho.':'Salvando rascunho…')+'</p>';
  nav.innerHTML=`<button class="btn sec" data-action="back">${R.kind==='access'&&step?'Voltar':'Sair'}</button><button class="btn grande" data-action="next" ${saving||photoBusy?'disabled':''}>${photoBusy?'Processando fotos…':lastLabel}</button>`;nav.hidden=false;
}
function field(id,label,placeholder='',type='text'){return `<label for="${id}">${esc(label)}</label><input id="${id}" data-field="${id}" type="${type}" value="${esc(R[id])}" placeholder="${esc(placeholder)}" ${type==='date'?'':'autocomplete="off"'}>`;}
function check(id,label){return `<label class="check" for="${id}"><input id="${id}" type="checkbox" data-field="${id}" ${R[id]?'checked':''}>${esc(label)}</label>`;}
function chips(fieldName,options,multi=false,label=''){
  return `<fieldset><legend>${esc(label||fieldName)}</legend><div class="chips">${options.map(o=>{
    const selected=multi?(R[fieldName]||[]).includes(o):R[fieldName]===o;
    return `<button type="button" class="chip" data-chip="${esc(fieldName)}" data-value="${esc(o)}" ${multi?'data-multi="1"':''} aria-pressed="${selected}">${esc(o)}</button>`;
  }).join('')}</div></fieldset>`;
}
function other(c){const selected=Array.isArray(R[c])?R[c].includes('Outro'):R[c]==='Outro';return selected?field(c+'Outro','Especifique') : '';}
function photos(){return `<div class="fotos">${R.fotos.map((f,i)=>`<div class="mini"><img src="${esc(f)}" alt="Foto ${i+1}"><button class="x" data-photo-remove="${i}" aria-label="Remover foto ${i+1}">×</button></div>`).join('')}</div>
  <label class="btn grande" for="camera">Tirar foto</label><input id="camera" type="file" accept="image/*" capture="environment" data-photo hidden>
  <label class="btn sec" for="gallery">Escolher da galeria</label><input id="gallery" type="file" accept="image/*" multiple data-photo hidden>
  <p class="dica">Até 12 fotos por registro; imagens reduzidas para envio. Fotos ainda em processamento precisam terminar antes de salvar.</p>`;}
function coordinateSummary(){if(R.lat!=null)return `${Number(R.lat).toFixed(5)}, ${Number(R.lng).toFixed(5)}${R.prec!=null?' · precisão estimada: '+Math.round(R.prec)+' m':''}${R.locRepeated?' · ponto reaproveitado':''}`;return R.endereco?'Endereço informado; coordenadas ainda não confirmadas.':'Localização ainda não informada.';}
function determinant(r=R){const col=collectors(r);if(!r.mesmoIdent)return value('determinador',r);return col.length===1?col[0]:col.includes(r.identCollector)?r.identCollector:'';}
function identityFields(){return check('naoIdent','Ainda não tenho identificação')+(R.naoIdent?'<p class="dica">Você poderá registrar uma determinação posteriormente.</p>':`
  <label for="speciesSearch">Buscar espécie</label><input id="speciesSearch" autocomplete="off" autocapitalize="none" placeholder="Gênero ou epíteto"><div id="speciesSuggestions"></div>
  ${field('familia','Família')}${field('genero','Gênero')}${field('epiteto','Epíteto')}${field('ssp','Subespécie ou variedade')}
  <details><summary>Identificação provisória</summary>${chips('qualificador',['cf.','aff.'],'','Qualificador')}</details>
  <p class="dica">Preencha apenas o que souber. Família ou gênero já são uma identificação parcial.</p>
  ${check('mesmoIdent','A identificação foi feita por quem coletou')}
  ${R.mesmoIdent?(collectors().length>1?chips('identCollector',collectors(),false,'Qual coletor identificou?'):collectors().length===1?`<p class="status">Identificador: ${esc(collectors()[0])}</p>`:'<p class="aviso">Informe o coletor na etapa anterior ou desmarque a opção acima.</p>'):chips('determinador',withOther('Coletores'),false,'Quem identificou')+other('determinador')}
  <details><summary>Data da identificação</summary>${field('detData','Data da identificação','','date')}</details>`);}
function reviewFields(){const fields={
  'Identificação':R.naoIdent?'Não identificada':[R.familia,R.genero,R.qualificador,R.epiteto,R.ssp].filter(Boolean).join(' · ')||'Não informada',
  'Identificador':determinant()||'Não informado','Coleta':R.dataDesconhecida?'Data desconhecida':R.data,
  'Ingresso':R.doacao==='Sim'||R.ingressoDiferente?R.dataIngresso:'Não informado separadamente',
  'Coletores':collectors().join('; ')||'Não informados','Nº de coleta':R.nColeta||'Não informado',
  'Local':[R.local,coordinateSummary()].filter(Boolean).join(' · '),'Procedência':value('origem')||'Não informada',
  'Doação':R.doacao==='Sim'?'Sim · '+R.doador:'Não','Destino':value('destino'),
  'Material':value('material'),'Quantidade':`${R.qtd} ${R.unidade}`,'Observações':R.obs||'—'};
  return '<dl>'+Object.entries(fields).map(([k,v])=>`<div class="campo"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')+'</dl>';
}
const accessSteps=[
  ()=>'<h1>Foto</h1><p class="dica">Fotografe o material ou avance para informar a localização.</p>'+photos(),
  ()=>`<h1>Onde foi coletada</h1><p class="dica">Informe a procedência, que pode ser diferente do local atual no jardim.</p>
    <button class="btn grande" data-action="gps" ${gpsBusy?'disabled':''}>${gpsBusy?'Buscando posição…':'Usar minha posição'}</button>
    <button class="btn sec" data-action="pasteCoord">Colar coordenada</button><button class="btn sec" data-action="address">Digitar endereço</button>
    ${R.locMode==='coord'?field('coordText','Coordenadas','-23.8123, -46.7231')+'<button class="btn" data-action="applyCoord">Usar esta coordenada</button>':''}
    ${R.locMode==='address'?field('endereco','Endereço ou procedência','Município, bairro, propriedade')+'<p class="dica">O endereço digitado não garante uma coordenada exata.</p>':''}
    <p class="status" id="locationStatus">${esc(coordinateSummary())}</p>
    ${R.locRepeated?check('locConfirmed','Confirmo que esta coleta foi feita no mesmo ponto do registro anterior'):''}
    ${field('local','Descrição do local','Trilha, propriedade, município ou referência')}
    ${chips('habitat',withOther('Habitat'),false,'Habitat')}${other('habitat')}${chips('habito',withOther('Hábito'),false,'Hábito')}${other('habito')}`,
  ()=>`<h1>Quando e quem</h1>${field('data','Data da coleta','','date')}<button class="link" data-action="dateToday">Usar hoje</button>
    ${chips('coletores',withOther('Coletores'),true,'Quem coletou — pode escolher mais de uma pessoa')}${other('coletores')}
    ${field('nColeta','Nº de coleta','Número atribuído pelo coletor, se houver')}
    <details><summary>O material ingressou no jardim em outra data?</summary>${check('ingressoDiferente','Registrar a data de ingresso separadamente')}${R.ingressoDiferente?field('dataIngresso','Data de ingresso no jardim','','date'):''}</details>`,
  ()=>'<h1>Identificação</h1>'+identityFields(),
  ()=>`<h1>Origem</h1>${chips('origem',lists('Origem'),false,'Procedência')}${chips('doacao',['Sim','Não'],false,'É doação?')}
    ${R.doacao==='Sim'?field('doador','Nome do doador')+field('dataIngresso','Data em que o jardim recebeu o material','','date')+check('dataDesconhecida','Não sei a data da coleta')+(R.dataDesconhecida?'':field('data','Data da coleta, se conhecida','','date'))+'<p class="dica">Receber uma doação hoje não significa que a planta foi coletada hoje.</p>':''}`,
  ()=>`<h1>Destino no jardim</h1>${chips('destino',withOther('Local no JBM'),false,'Local no JBM')}${other('destino')}
    ${chips('material',withOther('Material coletado'),false,'Material')}${other('material')}
    <label for="qtd">Quantidade</label><div class="qtd"><button data-action="less" aria-label="Diminuir quantidade">−</button><input id="qtd" data-field="qtd" type="number" min="1" step="1" inputmode="numeric" value="${esc(R.qtd)}"><button data-action="more" aria-label="Aumentar quantidade">+</button></div>
    ${chips('unidade',['indivíduos','sementes','estacas','lotes'],false,'Unidade')}
    ${lists('Recipiente/Substrato').length?chips('substrato',withOther('Recipiente/Substrato'),false,'Recipiente ou substrato')+other('substrato'):field('substrato','Recipiente ou substrato')}
    <label for="obs">Observações</label><textarea id="obs" data-field="obs">${esc(R.obs)}</textarea>`,
  ()=>`<h1>Conferir e salvar</h1>${reviewFields()}${R.fotos.length?`<p class="status">${R.fotos.length} foto(s) anexada(s).</p>`:''}
    <div class="aviso">${check('sequence','Continuar coletando no mesmo ponto após salvar')}<p class="dica">O próximo acesso repetirá ponto, data, coletores, habitat, procedência, destino e material. Identificação, fotos, quantidade, nº de coleta e observações começarão em branco. O ponto repetido precisará ser confirmado.</p></div>`
];
function renderAccess(){screen='access';render=renderAccess;formFrame(`<div class="modulos" aria-hidden="true">${STEPS.map((_,i)=>`<span class="${i<step?'feito':i===step?'atual':''}"></span>`).join('')}</div><p class="dica">${step+1} de ${STEPS.length} · ${STEPS[step]}</p>${accessSteps[step]()}`,step<6?'Avançar':'Salvar acesso');}
async function newAccess(sequence=false){
  R=blankAccess();step=0;runtime.draftSaved=false;
  if(sequence){const previous=await get(key('lastContext'));if(previous&&Date.now()-previous.at<3*3600e3){for(const f of REPEAT)if(previous.record[f]!==undefined)R[f]=clone(previous.record[f]);R.sequence=true;R.locRepeated=R.lat!=null;R.locConfirmed=!R.locRepeated;R.repeatedContext=true;}}
  await saveDraft();renderAccess();focusHeading();
}
async function resumeDraft(id){const draft=await get(key('draft',id));if(!draft)return toast('Rascunho não encontrado.');R=draft.record;step=Math.min(6,Math.max(0,draft.step||0));runtime.draftSaved=true;R.kind==='event'?renderEvent():renderAccess();focusHeading();}
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
function validateAccess(){
  const err=(message,index)=>({message,index});
  if(!R.dataDesconhecida&&(!validDate(R.data)||R.data>today()))return err('Informe uma data de coleta válida, que não esteja no futuro.',2);
  if((R.doacao==='Sim'||R.ingressoDiferente)&&(!validDate(R.dataIngresso)||R.dataIngresso>today()))return err('Informe uma data de ingresso válida.',R.doacao==='Sim'?4:2);
  if((R.doacao==='Sim'||R.ingressoDiferente)&&!R.dataDesconhecida&&R.dataIngresso<R.data)return err('A data de ingresso não pode anteceder a coleta. Confira as duas datas.',R.doacao==='Sim'?4:2);
  if(!value('destino'))return err('Escolha o destino no jardim.',5);
  if(!Number.isSafeInteger(Number(R.qtd))||Number(R.qtd)<1)return err('A quantidade deve ser um número inteiro maior que zero.',5);
  if(!R.unidade)return err('Escolha a unidade da quantidade.',5);
  if(R.lat!=null&&(!Number.isFinite(R.lat)||!Number.isFinite(R.lng)||Math.abs(R.lat)>90||Math.abs(R.lng)>180))return err('Confira as coordenadas.',1);
  if(R.locRepeated&&!R.locConfirmed)return err('Confirme o ponto reaproveitado ou obtenha uma nova posição.',1);
  if(R.lat==null&&!R.endereco.trim()&&!R.fotos.length)return err('Registre uma foto ou a localização.',0);
  if((R.coletores||[]).includes('Outro')&&!R.coletoresOutro?.trim())return err('Informe o nome do outro coletor.',2);
  if(!R.naoIdent&&(R.familia||R.genero)&&!determinant())return err('Escolha uma única pessoa como identificador.',3);
  if(!R.naoIdent&&(R.familia||R.genero)&&(!validDate(R.detData)||R.detData>today()))return err('Confira a data de identificação.',3);
  if(R.epiteto&&!R.genero)return err('Informe o gênero associado ao epíteto.',3);
  if(R.doacao==='Sim'&&!R.doador.trim())return err('Informe o doador, ou escreva “Não informado”.',4);
  for(const [f,s] of [['habitat',1],['habito',1],['destino',5],['material',5],['substrato',5]])if(R[f]==='Outro'&&!value(f))return err('Preencha a opção “Outro”.',s);
  return null;
}
function accessPayload(r){
  const identified=!r.naoIdent&&!!(r.familia||r.genero),id=f=>identified?String(r[f]||'').trim():'';
  const ingress=r.doacao==='Sim'||r.ingressoDiferente?r.dataIngresso:'';
  const metadata=[ingress?'Ingresso no jardim: '+ingress:'',r.dataDesconhecida?'Data da coleta desconhecida.':'',r.prec!=null?'Precisão estimada do GPS: '+Math.round(r.prec)+' m':'',r.fonteCoord?'Origem da coordenada: '+r.fonteCoord:'','Unidade da quantidade: '+r.unidade,identified&&r.qualificador?'Identificação provisória: '+r.qualificador:''];
  return {uid:r.uid,data:r.dataDesconhecida?'':r.data,dataIngresso:ingress,dataColetaConhecida:!r.dataDesconhecida,detData:identified?r.detData:'',lat:r.lat,lng:r.lng,alt:r.alt,prec:r.prec,fonteCoord:r.fonteCoord,endereco:r.lat==null?r.endereco:'',fotos:r.fotos,campos:{
    'Família':id('familia'),'Gênero':id('genero'),'Epíteto':id('epiteto'),'SSP/VAR':id('ssp'),'Qualificador':identified?r.qualificador:'','Local':r.local,
    'Qtd. coletada':Number(r.qtd),'Unidade da quantidade':r.unidade,'Hábito':value('habito',r),'Material coletado':value('material',r),'N. de coleta':r.nColeta,'Coletores':collectors(r).join('; '),'Origem':value('origem',r),'Habitat':value('habitat',r),
    'Observações':[r.obs,metadata.filter(Boolean).join('\n')].filter(Boolean).join('\n\n'),'Recipiente/Substrato':value('substrato',r),'Local no JBM':value('destino',r),'Doação':r.doacao,'Doador':r.doacao==='Sim'?r.doador:'','Data de ingresso':ingress,'Precisão GPS (m)':r.prec??'','Origem da coordenada':r.fonteCoord,'Determinação':identified?determinant(r):''}};
}
async function saveRecord(){
  if(saving||photoBusy)return toast('Aguarde o processamento das fotos.');
  const error=R.kind==='access'?validateAccess():validateEvent();
  if(error){if(R.kind==='access'){step=error.index;renderAccess();}toast(error.message);focusHeading();return;}
  clearTimeout(draftTimer);saving=true;render();const snapshot=clone(R),destination=base();
  try{
    const payload=snapshot.kind==='access'?accessPayload(snapshot):eventPayload(snapshot);
    const queueKey=key('queue',snapshot.uid),draftKey=key('draft',snapshot.uid);
    const item={tipo:snapshot.kind==='access'?'acesso':'evento',dados:payload,form:snapshot,base:destination,created:Date.now(),state:'pending'};
    // A fila e a remoção do rascunho são atômicas. Nada é apagado se a gravação falhar.
    await tx('readwrite',s=>{s.put(item,queueKey);s.delete(draftKey);if(snapshot.kind==='access')s.put({record:snapshot,at:Date.now()},key('lastContext'));});
    clearTimeout(draftTimer);R=null;runtime.draftSaved=false;
    if(snapshot.kind==='access'&&snapshot.sequence){await newAccess(true);toast('Acesso salvo no aparelho. Novo acesso no mesmo ponto; confirme a localização.');}
    else await home('Registro salvo no aparelho. O envio à planilha será confirmado separadamente.');
    if(navigator.onLine&&destination){synchronize().then(result=>{if(result.sent.length)toast('Recebido pela planilha: '+result.sent.join(', ')+'.');else if(result.error)toast(result.error);if(screen==='home')home();}).catch(fail);}
  }catch(e){toast(storedError(e).message);}
  finally{saving=false;if(screen==='access'||screen==='event')render();}
}
function renderEvent(){screen='event';render=renderEvent;
  const o=ACV.find(x=>String(x['Registro'])===String(R.registro));
  formFrame(`<h1>Registrar evento</h1>${R.registro?`<p class="status"><b>${esc(R.registro)}</b> · ${esc(o?plantName(o):'Acesso')}<br><button class="link" data-action="changeRecord">Trocar acesso</button></p>`:'<label for="recordSearch">Acesso</label><input id="recordSearch" placeholder="Registro ou espécie" autocomplete="off"><div id="recordSuggestions"></div>'}
    ${chips('tipo',withOther('Tipo de evento'),false,'O que aconteceu')}${other('tipo')}${field('data','Data do evento','','date')}
    ${chips('responsavel',withOther('Coletores'),false,'Responsável')}${other('responsavel')}
    ${R.tipo==='Mudança de local'?chips('destinoEvento',withOther('Local no JBM'),false,'Novo local no jardim')+other('destinoEvento'):''}
    ${['Morte','Divisão'].includes(R.tipo)?field('qtdAfetada','Quantidade de indivíduos afetados (se conhecida)','','number')+'<p class="dica">A quantidade documenta o evento; o saldo de indivíduos ainda não é calculado automaticamente.</p>':''}
    ${R.tipo==='Morte'?check('todoAcesso','Todo o material deste acesso morreu')+'<p class="dica">Marque apenas se não restar material vivo neste acesso. A morte parcial fica no histórico.</p>':''}
    ${R.tipo==='Determinação'?field('novaFamilia','Família')+field('novoGenero','Gênero')+field('novoEpiteto','Epíteto')+field('novoSsp','Subespécie ou variedade')+chips('novoQualificador',['cf.','aff.'],false,'Qualificador, se necessário')+chips('determinadoPor',withOther('Coletores'),false,'Quem identificou')+other('determinadoPor')+'<p class="dica">A determinação anterior será preservada no histórico. Uma determinação anterior à mais recente fica registrada sem substituir a atual.</p>':''}
    <label for="nota">Nota</label><textarea id="nota" data-field="nota">${esc(R.nota)}</textarea><label>Fotos opcionais</label>${photos()}`,'Salvar evento');
}
async function newEvent(registro=''){R=blankEvent(registro);step=0;runtime.draftSaved=false;await saveDraft();renderEvent();focusHeading();}
function validateEvent(){
  const err=message=>({message});if(!R.registro)return err('Escolha um acesso já registrado na planilha.');
  if(!value('tipo'))return err('Escolha o tipo de evento.');
  if(!validDate(R.data)||R.data>today())return err('Informe uma data de evento válida.');
  if(!value('responsavel'))return err('Informe o responsável pelo evento.');
  if(R.tipo==='Mudança de local'&&!value('destinoEvento'))return err('Informe o novo local no jardim.');
  if(R.qtdAfetada!==''&&(!Number.isSafeInteger(Number(R.qtdAfetada))||Number(R.qtdAfetada)<1))return err('A quantidade afetada deve ser um inteiro maior que zero.');
  if(R.tipo==='Determinação'&&(!(R.novaFamilia||R.novoGenero)||!value('determinadoPor')))return err('Informe ao menos família ou gênero e quem identificou.');return null;
}
function eventPayload(r){
  const extra=[r.tipo==='Mudança de local'?'Novo local: '+value('destinoEvento',r):'',r.qtdAfetada?'Quantidade afetada: '+r.qtdAfetada:'',r.tipo==='Morte'&&r.todoAcesso?'Todo o material deste acesso morreu.':'',r.tipo==='Determinação'?'Nova determinação: '+[r.novaFamilia,r.novoGenero,r.novoQualificador,r.novoEpiteto,r.novoSsp].filter(Boolean).join(' / ')+'; identificador: '+value('determinadoPor',r):''];
  return {uid:r.uid,registro:r.registro,data:r.data,tipo:value('tipo',r),responsavel:value('responsavel',r),nota:[r.nota,...extra].filter(Boolean).join('\n'),fotos:r.fotos,novoLocal:r.tipo==='Mudança de local'?value('destinoEvento',r):'',qtdAfetada:r.qtdAfetada===''?'':Number(r.qtdAfetada),todoAcesso:r.tipo==='Morte'&&r.todoAcesso===true,determinacao:r.tipo==='Determinação'?{familia:r.novaFamilia,genero:r.novoGenero,epiteto:r.novoEpiteto,ssp:r.novoSsp||'',qualificador:r.novoQualificador||'',determinador:value('determinadoPor',r)}:null};
}
async function home(message=''){
  screen='home';render=()=>{};nav.hidden=true;
  const destination=base();const [pending,drafts,last]=await Promise.all([queue(),entries(key('draft')),get(key('lastContext'))]);if(screen!=='home'||base()!==destination)return;
  const at=D.atualizado?new Date(D.atualizado).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Nunca atualizado';
  main.innerHTML=`<div class="capa"><p class="marca">Jardim<br>Botânico<br>Mborayhu</p><p class="titulo">acervo<br>vivo</p></div>${message?`<p class="aviso">${esc(message)}</p>`:''}
    ${!base()?'<p class="aviso">Configure a conexão com a planilha. Também é possível preparar rascunhos neste aparelho.</p>':''}
    <p class="dica">${navigator.onLine?'Conexão de rede disponível':'Sem conexão'} · Acervo atualizado: ${esc(at)}</p>
    ${drafts.length?'<h2>Continuar preenchimento</h2>'+drafts.map(([,d])=>`<button class="item" data-resume="${esc(d.record.uid)}">${d.record.kind==='event'?'Evento':'Novo acesso'} · ${esc(d.record.genero||d.record.registro||'Rascunho')}<span>${new Date(d.updated).toLocaleString('pt-BR')}</span></button><button class="link" data-delete-draft="${esc(d.record.uid)}">Descartar este rascunho</button>`).join(''):''}
    <button class="btn grande" data-go="new">Novo acesso</button>
    ${last&&Date.now()-last.at<3*3600e3?'<button class="btn" data-go="sequence">Novo acesso no mesmo ponto</button><p class="dica">Repete o contexto da última coleta; pede confirmação do ponto e começa uma identificação nova.</p>':''}
    <button class="btn" data-go="event">Registrar evento</button><button class="btn" data-go="catalog">Consultar acervo</button>
    <button class="btn sec" data-go="pending">${pending.length?pending.length+' registro(s) pendente(s)':'Pendências e recibos de envio'}</button>
    <button class="link" data-action="refresh">Atualizar acervo</button><button class="link" data-go="config">Configurações</button>
    <p class="dica">O envio ocorre com o aplicativo aberto. Rascunhos e pendências ficam neste aparelho até serem enviados ou exportados. Versão ${VERSION}.</p>`;
}
function backHomeButton(){return '<button class="link" data-go="home">Início</button>';}
const optionList=(values,current)=>'<option value="">Todos</option>'+values.map(x=>`<option value="${esc(x)}" ${x===current?'selected':''}>${esc(x)}</option>`).join('');
function catalog(){screen='catalog';render=()=>{};nav.hidden=true;
  const locals=[...new Set(ACV.map(o=>String(o['Local no JBM']||'')).filter(Boolean))].sort(),families=[...new Set(ACV.map(o=>String(o['Família']||'')).filter(Boolean))].sort();
  main.innerHTML=`${backHomeButton()}<h1>Acervo</h1><label for="query">Buscar</label><input id="query" value="${esc(query.q)}" placeholder="Registro, espécie, família ou local" autocomplete="off">
    <details ${query.local||query.familia||query.status?'open':''}><summary>Filtros</summary><div class="filtros"><div><label for="filterLocal">Local</label><select id="filterLocal">${optionList(locals,query.local)}</select></div><div><label for="filterFamily">Família</label><select id="filterFamily">${optionList(families,query.familia)}</select></div></div>
    <label for="filterStatus">Identificação</label><select id="filterStatus"><option value="">Todos</option><option value="incomplete" ${query.status==='incomplete'?'selected':''}>Sem identificação até espécie</option></select></details>
    <p class="dica" id="count"></p><div id="catalogList"></div><button id="loadMore" class="btn sec" data-action="loadMore" hidden>Mostrar mais 100</button>`;filterCatalog();
}
function filterCatalog(){
  const q=norm(query.q),found=ACV.map((o,i)=>({o,i})).filter(({o})=>(!q||norm([o['Registro'],plantName(o),o['Família'],o['Local no JBM'],o['Nome Popular']].join(' ')).includes(q))&&(!query.local||String(o['Local no JBM'])===query.local)&&(!query.familia||String(o['Família'])===query.familia)&&(!query.status||!o['Gênero']||!o['Epíteto'])).reverse();
  $('#count').textContent=`${found.length} de ${ACV.length} acessos · exibindo ${Math.min(found.length,query.limit)}. Registros ainda pendentes ficam na tela de pendências.`;
  $('#catalogList').innerHTML=found.slice(0,query.limit).map(({o})=>`<button class="item" data-detail="${esc(o['Registro'])}"><b>${esc(o['Registro'])}</b> <i>${esc(plantName(o))}</i><span>${esc([o['Família'],o['Local no JBM']].filter(Boolean).join(' · '))}</span></button>`).join('')||'<p>Nenhum acesso encontrado. Atualize o acervo se necessário.</p>';
  $('#loadMore').hidden=found.length<=query.limit;
}
function imageLinks(v){return String(v||'').split('|').map(s=>safeURL(s.trim())).filter(Boolean).map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Foto ${i+1}</a>`).join(' ');}
function normalizeEvents(){if(Array.isArray(D.eventos))return D.eventos;if(D.eventos?.cab&&D.eventos?.linhas)return D.eventos.linhas.map(l=>Object.fromEntries(D.eventos.cab.map((h,i)=>[h,l[i]])));return [];}
function normalizedEvent(e){return {uid:e.uid||e.UID||'',idEvento:e.idEvento||e['ID evento']||'',registro:String(e.registro||e.Registro||''),data:e.data||e.Data||'',tipo:e.tipo||e.Tipo||e['Tipo de evento']||'',responsavel:e.responsavel||e['Responsável']||'',nota:e.nota||e.Nota||e['Observações']||'',fotos:e.fotos||e.Foto||e['Registro fotográfico']||'',antes:e.antes||null,depois:e.depois||null};}
async function detail(registro){
  const o=ACV.find(x=>String(x['Registro'])===String(registro));if(!o)return toast('Acesso não encontrado no acervo baixado.');
  detailId=String(registro);screen='detail';render=()=>{};nav.hidden=true;
  const local=(await entries(key('sent'))).map(([,x])=>x).filter(x=>x.tipo==='evento'&&String(x.dados.registro)===detailId);
  if(screen!=='detail'||detailId!==String(registro))return;
  const remote=normalizeEvents().map(normalizedEvent).filter(e=>e.registro===detailId);
  const ids=new Set(remote.map(e=>e.uid).filter(Boolean)),eventIds=new Set(remote.map(e=>e.idEvento).filter(Boolean));
  const history=[...remote.map(e=>({...e,remote:true})),...local.filter(x=>!ids.has(x.dados.uid)&&!eventIds.has(x.idEvento||(/^EV-/.test(x.registro||'')?x.registro:''))).map(x=>({...normalizedEvent(x.dados),local:true}))].sort((a,b)=>String(b.data).localeCompare(String(a.data)));
  main.innerHTML=`<button class="link" data-go="catalog">Voltar à lista</button><h1><i>${esc(plantName(o))}</i></h1><p class="status">${esc(registro)}</p>
    <dl>${D.acervo.cab.filter(h=>o[h]!==''&&o[h]!=null&&!['Registro','Espécie'].includes(h)).map(h=>`<div class="campo"><dt>${esc(h)}</dt><dd>${h==='Registro fotográfico'?imageLinks(o[h]):esc(o[h])}</dd></div>`).join('')}</dl>
    <button class="btn grande" data-action="eventDetail">Registrar evento neste acesso</button><button class="btn sec" data-action="copyRecordLink">Copiar link desta ficha</button>
    <h2>Histórico</h2>${!D.eventos?.length&&!D.eventos?.linhas?.length?'<p class="dica">O servidor atual pode não fornecer o histórico. Eventos confirmados neste aparelho aparecem abaixo; o histórico completo exige suporte no Apps Script.</p>':''}
    ${history.map(e=>`<article class="linha-evento"><b>${esc(e.tipo)}</b> · ${esc(e.data)}<p>${esc(e.responsavel)}</p><p>${esc(e.nota)}</p>${e.antes&&e.depois?`<details><summary>Determinação anterior e nova</summary><p>Anterior: ${esc([e.antes['Espécie']||e.antes['Família'],e.antes['Determinação']].filter(Boolean).join(' · '))}</p><p>Nova: ${esc([e.depois['Espécie']||e.depois['Família'],e.depois['Determinação']].filter(Boolean).join(' · '))}</p></details>`:''}${e.local?'<p class="dica">Recibo deste aparelho; pode também constar na planilha.</p>':''}${typeof e.fotos==='string'?imageLinks(e.fotos):Array.isArray(e.fotos)?'<div class="fotos">'+e.fotos.filter(f=>/^data:image\/jpeg;base64,/.test(f)).map((f,i)=>`<div class="mini"><img src="${esc(f)}" alt="Foto do evento ${i+1}"></div>`).join('')+'</div>':''}</article>`).join('')||'<p>Nenhum evento disponível neste aparelho.</p>'}`;
  focusHeading();
}
function stateName(s){return {pending:'Pendente',retry:'Aguardando nova tentativa',sending:'Envio em andamento',uncertain:'Envio sem confirmação — conferir planilha',error:'Recusado pelo servidor'}[s]||'Pendente';}
async function pending(){
  screen='pending';nav.hidden=true;render=()=>{};
  const [items,sent,legacy]=await Promise.all([queue(),entries(key('sent')),entries('fila:')]);if(screen!=='pending')return;
  main.innerHTML=`${backHomeButton()}<h1>Pendências</h1><p class="dica">Você pode sair do aplicativo depois que o registro estiver salvo aqui. Para enviar, mantenha-o aberto até a confirmação.</p>
    ${legacy.length?'<p class="aviso">Há registros da versão antiga sem destino definido. Configure a planilha original antes de enviá-los.</p>':''}
    ${items.map(([,it])=>`<button class="item" data-pending="${esc(it.dados.uid)}"><b>${it.tipo==='acesso'?'Novo acesso':'Evento · '+esc(it.dados.registro)}</b> · ${esc(it.dados.campos?.['Gênero']||it.dados.tipo||'')}<span>${esc(stateName(it.state))}</span>${it.error?'<span class="erro">'+esc(it.error)+'</span>':''}</button>`).join('')||'<p>Nenhum registro pendente nesta base.</p>'}
    <button class="btn grande" data-action="sync" ${syncing?'disabled':''}>${syncing?'Enviando…':'Enviar pendências'}</button><button class="btn sec" data-action="export">Exportar backup completo deste aplicativo</button>
    <h2>Últimos recibos neste aparelho</h2>${sent.sort((a,b)=>b[1].sentAt-a[1].sentAt).slice(0,30).map(([,it])=>`<div class="campo"><b>${esc(it.registro)}</b> · ${esc(it.tipo)}<p class="dica">Confirmado em ${new Date(it.sentAt).toLocaleString('pt-BR')}</p></div>`).join('')||'<p class="dica">Ainda não há recibos.</p>'}`;
}
let selectedPending='';
async function pendingDetail(id){const it=await get(key('queue',id));if(!it)return pending();selectedPending=id;screen='pendingDetail';nav.hidden=true;
  main.innerHTML=`<button class="link" data-go="pending">Voltar às pendências</button><h1>${it.tipo==='acesso'?'Acesso pendente':'Evento pendente'}</h1><p class="status">${esc(stateName(it.state))}</p>
    ${it.error?'<p class="aviso">'+esc(it.error)+'</p>':''}
    <dl>${Object.entries(it.dados.campos||{Acesso:it.dados.registro,Tipo:it.dados.tipo,Data:it.dados.data,Nota:it.dados.nota}).map(([k,v])=>`<div class="campo"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="fotos">${(it.dados.fotos||[]).map((f,i)=>`<div class="mini"><img src="${esc(f)}" alt="Foto ${i+1}"></div>`).join('')}</div>
    ${it.state==='sending'?'<p class="dica">O envio está em andamento. Aguarde sua conclusão.</p>':`<button class="btn" data-action="editPending">Editar registro</button><button class="btn" data-action="retryPending">${it.state==='uncertain'?'Conferi a planilha: tentar enviar novamente':'Tentar enviar novamente'}</button>`}
    ${it.state==='uncertain'?'<button class="btn sec" data-action="ackPending">Já está na planilha: guardar confirmação manual</button><p class="aviso">Uma resposta perdida não significa que a gravação falhou. Confira a planilha antes de repetir. O servidor precisa reconhecer o UID para garantir que o reenvio não duplique o registro.</p>':''}
    <button class="btn sec" data-action="export">Exportar backup</button>${it.state!=='sending'?'<button class="link" data-action="deletePending">Excluir esta pendência</button>':''}`;
}
function linkConfig(){const cfg=settings(),data=btoa(unescape(encodeURIComponent(JSON.stringify({u:cfg.url,t:cfg.token}))));return new URL('./',location.href).href+'#cfg='+encodeURIComponent(data);}
function parseConfig(text){const m=String(text).match(/(?:#|&)cfg=([^&]+)/);if(!m)throw new Error('Link de configuração inválido.');let o;try{const bytes=atob(decodeURIComponent(m[1]));try{o=JSON.parse(decodeURIComponent(escape(bytes)));}catch{o=JSON.parse(bytes);}}catch{throw new Error('Link de configuração inválido.');}if(!validScript(o.u)||typeof o.t!=='string')throw new Error('O link não aponta para uma publicação válida do Apps Script.');return {url:o.u,token:o.t};}
async function setConfig(cfg){
  if(!validScript(cfg.url))throw new Error('Use a URL HTTPS da publicação do Apps Script, terminada em /exec, sem parâmetros.');
  if(syncing)throw new Error('Aguarde o envio em andamento antes de alterar a configuração.');
  const old=settings();
  const unbound=old.url?[]:(await entries('')).filter(([k])=>['queue','draft','lastContext'].some(t=>k.startsWith(`${t}:${APP}::`)));
  // Testa antes de substituir a configuração válida e o cache.
  const url=new URL(cfg.url);url.searchParams.set('token',cfg.token);const j=await request(url.href);if(!j.ok)throw new Error(j.erro||'Código de acesso recusado.');const data=cleanData(j);
  localStorage.setItem(prefs+'url',cfg.url);localStorage.setItem(prefs+'token',cfg.token);
  if(unbound.length){await tx('readwrite',s=>{for(const [k,v] of unbound){const type=k.slice(0,k.indexOf(':')),id=k.slice(`${type}:${APP}::`.length);s.put({...v,base:cfg.url},key(type,id));s.delete(k);}});}
  await put(key('data'),data);D=data;indexData();
  if(old.url!==cfg.url)toast('Base alterada. As pendências anteriores continuam vinculadas à base de origem.');
}
async function config(){screen='config';nav.hidden=true;render=()=>{};const cfg=settings();const estimate=await navigator.storage?.estimate?.().catch(()=>null);if(screen!=='config')return;
  main.innerHTML=`${backHomeButton()}<h1>Configurações</h1><label for="cfgUrl">Endereço do script da planilha</label><input id="cfgUrl" value="${esc(cfg.url)}" autocapitalize="none" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec">
    <label for="cfgToken">Código de acesso</label><input id="cfgToken" type="password" value="${esc(cfg.token)}" autocomplete="off"><button class="btn grande" data-action="saveConfig">Salvar e testar</button>
    <label for="cfgLink">Recebeu um link de configuração?</label><input id="cfgLink" type="password" autocomplete="off" placeholder="Cole o link aqui"><button class="btn sec" data-action="useConfigLink">Usar link</button>
    ${cfg.url?'<button class="btn sec" data-action="copyConfig">Copiar link de configuração para a equipe</button><p class="dica">Esse link contém o código de acesso. Envie apenas a pessoas autorizadas. O código compartilhado não identifica qual pessoa fez cada alteração.</p>':''}
    <h2>Dados neste aparelho</h2><p class="dica">${estimate?'Espaço utilizado pela origem do site: aproximadamente '+Math.round(estimate.usage/1024/1024)+' MB. ':''}O navegador pode remover dados locais. Exportar o backup é a proteção para registros ainda não enviados.</p>
    <button class="btn sec" data-action="persist">Solicitar proteção do armazenamento local</button><button class="btn sec" data-action="export">Exportar backup</button>
    <label for="importFile">Restaurar backup JSON</label><input id="importFile" type="file" accept="application/json,.json"><p class="dica">Restaura rascunhos, pendências e recibos sem substituir itens com o mesmo identificador. Nenhum envio começa automaticamente.</p>
    <p class="dica">Versão ${VERSION}. A troca de base não exclui nem transfere registros da base anterior. Para voltar a eles, use a configuração original.</p>`;
}
async function copy(text,message='Copiado.'){try{await navigator.clipboard.writeText(text);toast(message);}catch{prompt('Copie o texto:',text);}}
async function exportBackup(){
  if(R)await flushDraft();const all=(await entries('')).filter(([k])=>k.startsWith('fila:')||['queue','draft','sent','data','lastContext'].some(t=>k.startsWith(t+':'+APP+':')));
  const payload={app:'jbm-acervo',version:2,exportedAt:new Date().toISOString(),appPath:APP,entries:all};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='acervo-jbm-backup-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Backup preparado. Confira se o arquivo foi baixado. Ele não contém o token de acesso.');
}
async function importBackup(file){
  if(syncing||R)throw new Error('Termine o envio ou saia do formulário antes de restaurar um backup.');
  if(file.size>100*1024*1024)throw new Error('Backup maior que 100 MB. Restaure em um computador com espaço disponível.');
  const b=JSON.parse(await file.text());if(b.app!=='jbm-acervo'||b.version!==2||!Array.isArray(b.entries))throw new Error('Backup não reconhecido.');
  const checked=b.entries.map(pair=>{
    if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!pair[1]||typeof pair[1]!=='object')throw new Error('Há itens inválidos no backup.');
    const [k,v]=pair;
    if(!k.startsWith('fila:')&&!['queue','draft','sent','data','lastContext'].some(t=>k.startsWith(t+':'+b.appPath+':')))throw new Error('O backup contém chaves fora do aplicativo.');
    if(k.startsWith('fila:'))return [k,v];
    const type=k.slice(0,k.indexOf(':'));return [type+':'+APP+':'+k.slice((type+':'+b.appPath+':').length),v];
  });
  if(!confirm(`Restaurar ${checked.length} item(ns)? Nada será enviado automaticamente.`))return;
  // Consulta e inclusão na mesma transação: não sobrescreve alterações concorrentes.
  await tx('readwrite',s=>{for(const [k,original] of checked){const v=clone(original);if(k.startsWith('queue:')&&v.state==='sending')v.state='uncertain';const req=s.get(k);req.onsuccess=()=>{if(req.result===undefined)s.put(v,k);};}});
  toast('Backup restaurado. Confira a base configurada e as pendências.');await home();
}
async function compress(file){
  if(!file.type.startsWith('image/'))throw new Error('Escolha um arquivo de imagem.');
  if(file.size>40*1024*1024)throw new Error('Esta foto é maior que 40 MB. Escolha uma versão menor.');
  return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);const release=()=>URL.revokeObjectURL(url);
    img.onload=()=>{try{const ratio=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);const output=canvas.toDataURL('image/jpeg',.78);if(!output.startsWith('data:image/jpeg;base64,'))throw new Error('Não foi possível converter a imagem.');resolve(output);}catch(e){reject(e);}finally{release();}};
    img.onerror=()=>{release();reject(new Error('Não foi possível ler a foto. Tente usar JPEG ou PNG.'));};img.src=url;
  });
}
function parseCoord(text){
  const t=String(text||'').replace(/[−–]/g,'-').trim(),num=x=>Number(String(x||0).replace(',','.'));let lat,lng;
  const dms=[...t.matchAll(/(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″”]|'')\s*)?([NSEWLO])/gi)];
  if(dms.length===2){const points=dms.map(m=>({axis:/[NS]/i.test(m[4])?'lat':'lng',v:(num(m[1])+num(m[2])/60+num(m[3])/3600)*(/[SWO]/i.test(m[4])?-1:1),valid:num(m[2])<60&&num(m[3])<60}));if(points[0].axis===points[1].axis||points.some(p=>!p.valid))return null;for(const p of points){if(p.axis==='lat')lat=p.v;else lng=p.v;}}
  else{const m=t.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)||t.match(/^(-?\d+,\d+)\s*[;\s]\s*(-?\d+,\d+)$/);if(m){lat=num(m[1]);lng=num(m[2]);}}
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}
async function getGPS(){
  if(!navigator.geolocation)return toast('Este aparelho não fornece posição.');if(gpsBusy)return;
  const id=R.uid;gpsBusy=true;render();
  navigator.geolocation.getCurrentPosition(async p=>{
    gpsBusy=false;if(!R||R.uid!==id){if(screen==='access'&&step===1)render();return;}
    Object.assign(R,{lat:p.coords.latitude,lng:p.coords.longitude,alt:p.coords.altitude,prec:p.coords.accuracy,fonteCoord:'GPS',endereco:'',locRepeated:false,locConfirmed:true,locMode:''});
    await saveDraft().catch(fail);if(screen==='access')render();if(p.coords.accuracy>50)toast('Precisão acima de 50 m. Confira se é suficiente ou tente novamente.');
  },e=>{gpsBusy=false;if(!R||R.uid!==id){if(screen==='access'&&step===1)render();return;}toast(e.code===1?'Permita a localização nos ajustes do navegador.':'Não foi possível obter a posição. Tente novamente ou informe a coordenada.');if(screen==='access')render();},{enableHighAccuracy:true,timeout:30000,maximumAge:0});
}
async function leaveForm(){if(photoBusy)return toast('Aguarde as fotos terminarem de processar.');await flushDraft();R=null;await home('Rascunho preservado. Você pode continuar depois.');}
async function setupServiceWorker(){
  if(!('serviceWorker'in navigator))return;
  try{const registration=await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});
    const show=worker=>{waitingWorker=worker;$('#update').hidden=false;};if(registration.waiting)show(registration.waiting);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)show(worker);});});
    let reload=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reload)return;reload=true;if(waitingWorker)location.reload();});
  }catch{toast('Não foi possível preparar o modo offline. Confira a publicação dos arquivos.');}
}
const actions={
  async back(){if(R?.kind==='access'&&step){step--;await flushDraft();renderAccess();focusHeading();}else await leaveForm();},
  async next(){if(saving||photoBusy)return;if(R.kind==='event'||step===6)return saveRecord();step++;await flushDraft();renderAccess();focusHeading();},
  gps:getGPS,
  async pasteCoord(){R.locMode='coord';render();const id=R.uid;try{const t=await navigator.clipboard.readText();if(R?.uid===id&&parseCoord(t)){R.coordText=t;render();}}catch{}await saveDraft();},
  async applyCoord(){const point=parseCoord(R.coordText);if(!point)return toast('Coordenada não reconhecida. Use -23.8123, -46.7231 ou graus, minutos e segundos com hemisférios.');Object.assign(R,point,{alt:null,prec:null,fonteCoord:'Digitada',endereco:'',locRepeated:false,locConfirmed:true,locMode:''});await saveDraft();render();},
  async address(){Object.assign(R,{locMode:'address',lat:null,lng:null,alt:null,prec:null,fonteCoord:'Endereço informado',locRepeated:false,locConfirmed:true});await saveDraft();render();},
  async dateToday(){R.data=today();await saveDraft();render();},
  async less(){R.qtd=Math.max(1,(Number(R.qtd)||1)-1);await saveDraft();render();},async more(){R.qtd=(Number(R.qtd)||0)+1;await saveDraft();render();},
  async changeRecord(){R.registro='';await saveDraft();render();},
  eventDetail:()=>newEvent(detailId),
  copyRecordLink:()=>copy(new URL('./',location.href).href+'#registro='+encodeURIComponent(detailId),'Link da ficha copiado. A outra pessoa precisa ter a base configurada.'),
  loadMore(){query.limit+=100;filterCatalog();},
  async refresh(){if(networkBusy)return;networkBusy=true;toast('Atualizando acervo…');try{if(await refresh())await home();}finally{networkBusy=false;}},
  async sync(){if(syncing)return toast('Envio em andamento.');toast('Enviando…');const result=await synchronize();await pending();toast(result.error|| (result.sent.length?'Recebido pela planilha: '+result.sent.join(', '):'Nenhuma pendência pronta para envio. Confira os itens com erro ou sem confirmação.'));},
  async editPending(){
    if(syncing)return toast('Aguarde o envio terminar.');const k=key('queue',selectedPending),it=await get(k);if(!it)return pending();
    if(!it.form)return toast('Registro antigo: exporte o backup e corrija com apoio técnico, preservando o UID.');
    if(it.state==='sending')return toast('Aguarde a confirmação do envio.');
    if(it.state==='uncertain'&&!confirm('Confira primeiro se o registro já existe na planilha. Editar e reenviar pode duplicá-lo em um servidor sem proteção por UID. Continuar?'))return;
    const draft={record:it.form,step:it.tipo==='acesso'?6:0,base:base(),updated:Date.now()};
    await tx('readwrite',s=>{s.put(draft,key('draft',it.dados.uid));s.delete(k);});await resumeDraft(it.dados.uid);
  },
  async retryPending(){if(syncing)return toast('Aguarde o envio terminar.');const k=key('queue',selectedPending),it=await get(k);if(!it)return pending();
    if(it.state==='uncertain'&&!confirm('Você verificou que o registro não está na planilha? O reenvio só é garantidamente seguro quando o servidor reconhece o UID.'))return;
    if(it.state==='sending')return toast('O envio está em andamento.');it.state='retry';it.error='';await put(k,it);await actions.sync();},
  async ackPending(){if(syncing)return;const k=key('queue',selectedPending),it=await get(k);if(!it||it.state!=='uncertain')return;
    const registro=prompt('Informe exatamente o número do registro que você conferiu na planilha:',it.dados.registro||'');if(!registro?.trim())return;
    if(!confirm('Guardar sua confirmação manual e retirar este item da fila?'))return;
    await tx('readwrite',s=>{s.put({...it,state:'sent',registro:registro.trim(),sentAt:Date.now(),manual:true},key('sent',it.dados.uid));s.delete(k);});await pending();},
  async deletePending(){if(syncing)return toast('Aguarde o envio terminar.');if(!confirm('Excluir o registro pendente e suas fotos deste aparelho? Exporte um backup antes, se precisar preservá-lo.'))return;await remove(key('queue',selectedPending));await pending();},
  async saveConfig(){if(networkBusy)return;networkBusy=true;try{await setConfig({url:$('#cfgUrl').value.trim(),token:$('#cfgToken').value.trim()});await home('Conexão testada e configurada.');}finally{networkBusy=false;}},
  async useConfigLink(){if(networkBusy)return;networkBusy=true;try{await setConfig(parseConfig($('#cfgLink').value));await home('Conexão testada e configurada.');}finally{networkBusy=false;}},
  copyConfig:()=>copy(linkConfig()),
  async persist(){if(!navigator.storage?.persist)return toast('Este navegador não oferece essa opção. Mantenha backups.');const ok=await navigator.storage.persist();toast(ok?'Armazenamento persistente concedido. A limpeza manual do navegador ainda remove os dados.':'O navegador não concedeu proteção extra. Continue exportando backups.');},
  export:exportBackup,
  async updateApp(){if(syncing||photoBusy||saving)return toast('Aguarde a operação em andamento.');if(R)await flushDraft();if(waitingWorker)waitingWorker.postMessage({type:'ACTIVATE'});}
};
const routes={home:()=>home(),new:()=>newAccess(),sequence:()=>newAccess(true),event:()=>newEvent(),catalog,pending,config};
document.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button||button.disabled)return;const d=button.dataset;
  if(saving)return;
  try{
    if(d.chip&&R){const c=d.chip,v=d.value;if(d.multi){const a=R[c]||[];R[c]=a.includes(v)?a.filter(x=>x!==v):[...a,v];}else R[c]=R[c]===v?'':v;
      if(c==='doacao'&&v!=='Sim')R.dataDesconhecida=false;
      await saveDraft();render();return;}
    if(d.action&&actions[d.action])return await actions[d.action]();
    if(d.go&&routes[d.go]){if(R)await leaveForm();await routes[d.go]();if(d.go!=='home')focusHeading();return;}
    if(d.resume)return await resumeDraft(d.resume);
    if(d.deleteDraft){if(confirm('Descartar este rascunho e suas fotos?')){await remove(key('draft',d.deleteDraft));await home();}return;}
    if(d.photoRemove!==undefined&&R){R.fotos.splice(Number(d.photoRemove),1);await saveDraft();render();return;}
    if(d.species!==undefined&&R){const s=SP[Number(d.species)];Object.assign(R,{familia:s.f||GEN[norm(s.g)]||'',genero:s.g,epiteto:s.e});await saveDraft();render();return;}
    if(d.record&&R){R.registro=d.record;await saveDraft();render();return;}
    if(d.detail)return await detail(d.detail);
    if(d.pending)return await pendingDetail(d.pending);
  }catch(e){fail(e);}
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.dataset.field&&R&&t.type!=='checkbox'){R[t.dataset.field]=t.type==='number'?(t.value===''?'':Number(t.value)):t.value;scheduleDraft();return;}
  if(t.id==='speciesSearch'){const q=norm(t.value),found=[];if(q.length>=2)for(let i=0;i<SP.length&&found.length<8;i++)if(SP[i].k.startsWith(q)||norm(SP[i].e).startsWith(q))found.push(i);
    $('#speciesSuggestions').innerHTML=q.length<2?'':found.map(i=>`<button class="item" data-species="${i}"><i>${esc(SP[i].g+' '+SP[i].e)}</i><span>${esc(SP[i].f)}</span></button>`).join('')||'<p class="dica">Preencha a identificação abaixo.</p>';return;}
  if(t.id==='recordSearch'){const q=norm(t.value);$('#recordSuggestions').innerHTML=q.length<2?'':ACV.filter(o=>norm(o['Registro']+' '+plantName(o)).includes(q)).slice(0,8).map(o=>`<button class="item" data-record="${esc(o['Registro'])}">${esc(o['Registro'])} · <i>${esc(plantName(o))}</i></button>`).join('')||'<p class="dica">Nenhum acesso encontrado. Registros pendentes precisam ser enviados primeiro.</p>';return;}
  if(t.id==='query'){query.q=t.value;query.limit=100;filterCatalog();}
});
document.addEventListener('change',async e=>{
  const t=e.target;
  try{
    if(t.dataset.field&&R){if(t.type==='checkbox'){R[t.dataset.field]=t.checked;await saveDraft();render();}else if(t.dataset.field==='genero'&&!R.familia&&GEN[norm(t.value)]){R.familia=GEN[norm(t.value)];await saveDraft();render();}return;}
    if(t.hasAttribute('data-photo')&&R){const id=R.uid,files=[...t.files];if(photoBusy)return;photoBusy++;render();
      try{for(const file of files){if(!R||R.uid!==id)break;if(R.fotos.length>=12){toast('Limite de 12 fotos por registro.');break;}try{const image=await compress(file);if(R?.uid!==id)break;R.fotos.push(image);await saveDraft();}catch(e){toast(e.message);}}}
      finally{photoBusy--;if(R?.uid===id)render();}return;}
    if(t.id==='filterLocal'){query.local=t.value;query.limit=100;filterCatalog();}if(t.id==='filterFamily'){query.familia=t.value;query.limit=100;filterCatalog();}if(t.id==='filterStatus'){query.status=t.value;query.limit=100;filterCatalog();}
    if(t.id==='importFile'&&t.files[0])await importBackup(t.files[0]);
  }catch(e){fail(e);}
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&R)flushDraft().catch(()=>{});});
addEventListener('pagehide',()=>{if(R)flushDraft().catch(()=>{});});
addEventListener('beforeunload',e=>{if(R&&(!runtime.draftSaved||photoBusy)){e.preventDefault();e.returnValue='';}});
addEventListener('online',async()=>{try{const result=await synchronize();if(result.sent.length)toast('Recebido pela planilha: '+result.sent.join(', '));if(screen==='home')await home();}catch(e){fail(e);}});
addEventListener('offline',()=>{toast('Sem conexão. Continue preenchendo; os registros ficam no aparelho.');if(screen==='home')home().catch(fail);});
async function boot(){
  try{
    // Preserva a configuração antiga para a migração; nunca guarda token no backup.
    const previous=settings();if(previous.url&&!localStorage.getItem(prefs+'url')){localStorage.setItem(prefs+'url',previous.url);localStorage.setItem(prefs+'token',previous.token);}
    await migrateLegacy();const cached=await get(key('data'));if(cached)D=cached;indexData();
    // Um POST interrompido não pode ser automaticamente repetido com segurança no servidor legado.
    if(!syncing)await withSyncLock(async()=>{for(const [k,it] of await queue())if(it.state==='sending'){it.state='uncertain';it.error='O aplicativo foi fechado antes da confirmação. Confira a planilha.';await put(k,it);}return {sent:[]};});
    const hash=location.hash;let message='';
    if(hash.includes('cfg=')){
      history.replaceState(null,'',location.pathname+location.search);
      try{const cfg=parseConfig(hash);await setConfig(cfg);message='Configuração aplicada e testada.';}catch(e){message=e.message;}
    }
    await home(message);setupServiceWorker();
    if(navigator.onLine&&base()){await refresh(true);if(screen==='home')await home(message);}
    const match=hash.match(/^#registro=(.+)$/);if(match)await detail(decodeURIComponent(match[1]));
    // Não envia pendências na abertura: o usuário pode estar revisando ou restaurando um backup.
  }catch(e){main.innerHTML='<h1>Não foi possível abrir o armazenamento</h1><p>Use uma aba normal do navegador, permita o armazenamento do site e tente novamente. Não limpe os dados se houver registros pendentes.</p>';fail(e);}
}
boot();
