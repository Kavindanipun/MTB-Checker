
(() => {
  const DATA = window.MTB_DATA;
  const EVIDENCE = window.MTB_EVIDENCE || {};
  const $ = id => document.getElementById(id);
  const input = $('modelSearch'), searchBtn = $('searchBtn'), compatibleBtn = $('compatibleBtn'),
        clearBtn = $('clearBtn'), suggestions = $('suggestions'), resultSection = $('resultSection'),
        inventoryList = $('inventoryList'), toggleInventory = $('toggleInventory'),
        stockCount = $('stockCount'), compatModal = $('compatModal'), compatModalBody = $('compatModalBody'),
        compatModalTitle = $('compatModalTitle'), compatModalSubtitle = $('compatModalSubtitle'),
        closeCompatModal = $('closeCompatModal'), imageOverlay = $('imageOverlay'),
        overlayImage = $('overlayImage'), closeImageOverlay = $('closeImageOverlay'),
        auditPacketGroups = $('auditPacketGroups'), auditVerifiedModels = $('auditVerifiedModels'),
        auditConflicts = $('auditConflicts'), auditConflictBox = $('auditConflictBox');

  const brandPrefixes = ['samsung','redmi','xiaomi','poco','oppo','huawei','honor','infinix','iphone','vivo','iqoo','realme','oneplus','tecno','motorola','itel'];

  function normalize(v){
    return String(v||'').toLowerCase()
      .replace(/\+/g,' plus ')
      .replace(/\bgalaxy\b/g,' ')
      .replace(/\bsam\b/g,' samsung ')
      .replace(/\brm\b/g,' redmi ')
      .replace(/\bxm\b/g,' xiaomi ')
      .replace(/\bop\b/g,' oppo ')
      .replace(/\bhw\b/g,' huawei ')
      .replace(/[^a-z0-9]+/g,' ')
      .trim().replace(/\s+/g,' ');
  }
  function stripBrand(v){
    let n=normalize(v);
    for(const b of brandPrefixes){
      if(n===b) return '';
      if(n.startsWith(b+' ')) return n.slice(b.length+1);
    }
    return n;
  }
  function hasBrand(v){
    const n=normalize(v);
    return brandPrefixes.some(b=>n===b || n.startsWith(b+' '));
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  const aliasLookup = new Map(Object.entries(DATA.aliases||{}).map(([a,b])=>[normalize(a),normalize(b)]));
  function canonical(v){ const n=normalize(v); return aliasLookup.get(n)||n; }
  function groupSignature(g){ return (g.packetEvidence||[]).slice().sort().join('||'); }

  // Build packet, direct-stock and chart-only indexes.
  const packetIndex = new Map(), directIndex = new Map(), chartIndex = new Map();
  const packetModelsAll = [];
  DATA.groups.forEach(g=>{
    (g.packetLabelModels||[]).forEach(label=>{
      const k=normalize(label);
      if(!packetIndex.has(k)) packetIndex.set(k,[]);
      packetIndex.get(k).push({group:g,label});
      packetModelsAll.push({group:g,label});
    });
    (g.directModels||[]).forEach(label=>{
      const k=normalize(label);
      if(!directIndex.has(k)) directIndex.set(k,[]);
      directIndex.get(k).push({group:g,label});
    });
    (g.compatibleModels||[]).forEach(label=>{
      const k=normalize(label);
      if(!chartIndex.has(k)) chartIndex.set(k,[]);
      chartIndex.get(k).push({group:g,label});
    });
  });

  // Informational audit: same printed model appearing on different photographed physical packet groups.
  const trueConflicts = new Map();
  packetIndex.forEach((arr,k)=>{
    const sigs = new Map();
    arr.forEach(x=>{
      const sig=groupSignature(x.group);
      if(!sigs.has(sig)) sigs.set(sig,[]);
      sigs.get(sig).push(x);
    });
    if(sigs.size>1) trueConflicts.set(k,[...sigs.values()]);
  });

  const stockTotal=Object.values(DATA.stockInventory).reduce((s,a)=>s+a.length,0);
  stockCount.textContent=stockTotal;
  const packetGroupCount=DATA.groups.filter(g=>(g.packetEvidence||[]).length).length;
  const verifiedUniqueCount=new Set(packetModelsAll.map(x=>normalize(x.label))).size;
  auditPacketGroups.textContent=packetGroupCount;
  auditVerifiedModels.textContent=verifiedUniqueCount;
  auditConflicts.textContent=trueConflicts.size;

  if(trueConflicts.size){
    const rows=[];
    trueConflicts.forEach((sets,key)=>{
      const labels=[...new Set(sets.flat().map(x=>x.label))];
      const stockNames=[...new Set(sets.flat().map(x=>x.group.stockName))];
      rows.push(`<strong>${escapeHtml(labels[0]||key)}</strong> is printed on more than one different photographed packet group: ${escapeHtml(stockNames.join(' / '))}. Strict Mode keeps every matching stock glass as a separate verified option.`);
    });
    auditConflictBox.innerHTML='⚠ <strong>Multiple-packet verification detected.</strong><br>'+rows.join('<br><br>');
  } else {
    auditConflictBox.style.display='none';
  }

  function exactCandidates(raw, index){
    const q=canonical(raw), branded=hasBrand(raw), out=[];
    index.forEach((arr,key)=>{
      if(key===q || (!branded && arr.some(x=>stripBrand(x.label)===q))){
        arr.forEach(x=>{
          if(key===q || stripBrand(x.label)===q) out.push(x);
        });
      }
    });
    return out;
  }

  function variantAmbiguity(raw){
    const q=canonical(raw);
    if(!q) return null;
    const branded=hasBrand(raw);
    const base=branded?q:stripBrand(q);
    const matches=packetModelsAll.filter(x=>{
      const full=normalize(x.label), stripped=stripBrand(x.label);
      const target=branded?full:stripped;
      if(!target.startsWith(base+' ')) return false;
      const suffix=target.slice(base.length+1);
      return /\b(4g|5g|2018|2019|2020|2021|2022|2023|2024|2025|global|india|china)\b/.test(suffix);
    });
    if(matches.length<2) return null;
    const bySig=new Map();
    matches.forEach(x=>{
      const sig=groupSignature(x.group);
      if(!bySig.has(sig)) bySig.set(sig,[]);
      bySig.get(sig).push(x);
    });
    if(bySig.size<=1) return null;
    return [...new Map(matches.map(x=>[normalize(x.label),x])).values()];
  }

  function groupBySignature(cands){
    const m=new Map();
    cands.forEach(x=>{
      const sig=groupSignature(x.group)||('no-evidence:'+x.group.id);
      if(!m.has(sig)) m.set(sig,[]);
      m.get(sig).push(x);
    });
    return m;
  }

  function resolveStrict(raw){
    const clean=String(raw||'').trim();
    if(!clean) return {type:'empty',clean};

    const variants=variantAmbiguity(clean);
    if(variants) return {type:'variant',clean,choices:variants};

    const packet=exactCandidates(clean,packetIndex);
    if(packet.length){
      // A model printed on more than one real packet is NOT a conflict.
      // Every matching packet is a valid proof for its own stock glass.
      // Keep all packet candidates so the result can show every applicable stock name.
      const bySig=groupBySignature(packet);
      return {type:'packet',clean,candidates:packet,signature:[...bySig.keys()]};
    }

    const direct=exactCandidates(clean,directIndex);
    if(direct.length) return {type:'direct',clean,candidates:direct};

    const chart=exactCandidates(clean,chartIndex);
    if(chart.length) return {type:'chart',clean,candidates:chart};

    return {type:'none',clean};
  }

  function stockNamesForPacketCandidates(cands){
    return [...new Set(cands.map(x=>x.group.stockName))];
  }
  function uniquePacketModelsForGroup(g){
    const seen=new Set(), arr=[];
    (g.packetLabelModels||[]).forEach(x=>{const k=normalize(x);if(!seen.has(k)){seen.add(k);arr.push(x);}});
    return arr;
  }
  function proofImagesForGroups(groups){
    const names=[...new Set(groups.flatMap(g=>g.packetEvidence||[]))];
    return names.filter(n=>EVIDENCE[n]).map(n=>({name:n,src:EVIDENCE[n]}));
  }
  function canonicalPacketGroup(cands){
    // Prefer the candidate whose group has the exact searched label; packet signature is the same.
    return cands[0]?.group;
  }

  function renderEmpty(){
    resultSection.innerHTML=`<div class="empty-state"><div class="empty-icon">🔐</div><h2>Strict Verified Mode</h2><p>Search a phone model. The app will only say a compatible match is verified when that model is printed on one of your photographed real MTB packets.</p></div>`;
  }

  function renderVariant(res){
    const seen=new Map();
    res.choices.forEach(x=>seen.set(normalize(x.label),x));
    resultSection.innerHTML=`<div class="variant-card">
      <span class="blocked-badge">VERSION REQUIRED</span>
      <h2>Choose the exact version</h2>
      <p><strong>${escapeHtml(res.clean)}</strong> appears in different photographed glass groups depending on version. The system will not guess.</p>
      <div class="variant-options">${[...seen.values()].map(x=>`<button class="choice-btn" data-query="${escapeHtml(x.label)}">${escapeHtml(x.label)}</button>`).join('')}</div>
    </div>`;
  }

  function renderConflict(res){
    const sets=res.sets;
    const items=sets.map(set=>{
      const stocks=[...new Set(set.map(x=>x.group.stockName))];
      const groups=[...new Map(set.map(x=>[x.group.id,x.group])).values()];
      const imgs=proofImagesForGroups(groups);
      return `<div class="conflict-item">
        <strong>${escapeHtml(stocks.join(' / '))}</strong>
        <div>This model is printed on this separate real packet group.</div>
        <div class="card-actions">${imgs.map(i=>`<button class="proof-btn" data-proof-src="${escapeHtml(i.src)}">View packet photo</button>`).join('')}</div>
      </div>`;
    }).join('');
    resultSection.innerHTML=`<div class="blocked-card">
      <span class="packet-badge">MULTIPLE PACKET PROOF</span>
      <h2>Verified on multiple stock packets</h2>
      <p><strong>${escapeHtml(res.clean)}</strong> is printed on more than one photographed packet. Every matching stock glass is shown separately below.</p>
      <div class="conflict-list">${items}</div>
    </div>`;
  }

  function renderPacket(res){
    // A searched model can be printed on multiple real packets.
    // Show every matching stock glass instead of blocking the result.
    // If the same stock name appears on multiple packets, keep one main stock
    // name and show all of its proof photos.
    const byStock=new Map();
    res.candidates.forEach(x=>{
      const name=x.group.stockName;
      if(!byStock.has(name)) byStock.set(name,{groups:new Map(),labels:new Set()});
      const item=byStock.get(name);
      item.groups.set(x.group.id,x.group);
      item.labels.add(x.label);
    });

    // If the searched model is printed on multiple packets, every one of those
    // packet groups is a valid compatibility source. Build the UNION here so
    // models from packet #2 are never lost just because packet #1 was rendered first.
    const allVerifiedModels=[];
    const seenVerified=new Set();
    res.candidates.forEach(x=>{
      (x.group.packetLabelModels||[]).forEach(model=>{
        const key=normalize(model);
        if(!seenVerified.has(key)){ seenVerified.add(key); allVerifiedModels.push(model); }
      });
    });

    const cards=[...byStock.entries()].map(([stockName,item])=>{
      const groups=[...item.groups.values()];
      const images=proofImagesForGroups(groups);
      const warnings=[...new Set(groups.map(g=>g.warning).filter(Boolean))];
      const notes=[...new Set(groups.map(g=>g.stockVariantNote).filter(Boolean))];
      return `<article class="match-card">
        <div class="match-top">
          <div>
            <span class="packet-badge">✓ REAL PACKET VERIFIED</span>
            <h3>${escapeHtml(stockName)}</h3>
            <div class="brand-line">Printed packet match: <strong>${escapeHtml([...item.labels].join(' / '))}</strong></div>
          </div>
          <span class="match-type">Strict proof match</span>
        </div>
        <div class="main-label"><small>Take this stock glass</small><strong>${escapeHtml(stockName)}</strong></div>
        <div class="verified-note">✓ <strong>${escapeHtml(res.clean)}</strong> is printed on this real MTB stock packet. This stock glass is therefore shown as a verified option for this model.</div>
        ${notes.map(n=>`<div class="verified-note">${escapeHtml(n)}</div>`).join('')}
        ${warnings.map(w=>`<div class="notes">⚠ ${escapeHtml(w)}</div>`).join('')}
        <div class="card-actions">
          <button class="compat-btn" data-strict-group="${escapeHtml(groups[0].id)}">View packet-verified models</button>
          ${images.map(i=>`<button class="proof-btn" data-proof-src="${escapeHtml(i.src)}">View proof photo</button>`).join('')}
          <button class="copy-btn" data-copy="${escapeHtml(stockName)}">Copy stock name</button>
        </div>
      </article>`;
    }).join('');

    const combinedPanel = res.candidates.length > 1 ? `
      <section class="packet-panel" style="margin-top:18px">
        <div class="match-top">
          <div>
            <span class="packet-badge">✓ COMBINED PACKET PROOF</span>
            <h3>All models verified by packets containing ${escapeHtml(res.clean)}</h3>
          </div>
          <span class="match-type">${allVerifiedModels.length} models</span>
        </div>
        <p class="verified-note">Because <strong>${escapeHtml(res.clean)}</strong> is printed on multiple real packets, the compatibility models printed on <strong>every matching packet</strong> are valid for the corresponding stock glasses. Nothing from either packet is dropped.</p>
        <div class="packet-models">${allVerifiedModels.map(x=>`<span class="packet-chip">${escapeHtml(x)}</span>`).join('')}</div>
      </section>` : '';

    resultSection.innerHTML=`<div class="query-summary">Verified result for <strong>${escapeHtml(res.clean)}</strong>. ${byStock.size>1?`This model is printed on ${byStock.size} different stock glass packets. Each packet's full printed model list is treated as compatible with that packet.`:''}</div>
      <div class="match-grid">${cards}</div>${combinedPanel}`;
  }

  function renderDirect(res){
    const groups=[...new Map(res.candidates.map(x=>[x.group.id,x.group])).values()];
    const names=[...new Set(groups.map(g=>g.stockName))];
    resultSection.innerHTML=`<div class="query-summary">Exact stock-label result for <strong>${escapeHtml(res.clean)}</strong>.</div>
      <div class="match-grid">${groups.map(g=>`
        <article class="match-card">
          <div class="match-top"><div><span class="direct-badge">EXACT STOCK ITEM</span><h3>${escapeHtml(g.stockName)}</h3></div><span class="match-type">Direct inventory match</span></div>
          <div class="main-label"><small>Exact stock label exists</small><strong>${escapeHtml(g.stockName)}</strong></div>
          ${(g.packetEvidence||[]).length
            ? `<div class="verified-note">A real packet photo is loaded for this stock group. Use “View packet-verified models” for cross-model compatibility.</div>`
            : `<div class="notes">No photographed packet compatibility label is loaded for this stock group. Strict Mode will not invent same-size models.</div>`}
          <div class="card-actions">
            ${(g.packetEvidence||[]).length?`<button class="compat-btn" data-strict-group="${escapeHtml(g.id)}">View packet-verified models</button>`:''}
            ${proofImagesForGroups([g]).map(i=>`<button class="proof-btn" data-proof-src="${escapeHtml(i.src)}">View proof photo</button>`).join('')}
            <button class="copy-btn" data-copy="${escapeHtml(g.stockName)}">Copy stock name</button>
          </div>
        </article>`).join('')}</div>`;
  }

  function renderChart(res){
    const names=[...new Set(res.candidates.map(x=>x.group.stockName))];
    resultSection.innerHTML=`<div class="reference-card">
      <span class="blocked-badge" style="background:#fff1cc;color:#8a5b00">NOT PACKET VERIFIED</span>
      <h3>Chart reference exists, but Strict Mode will not recommend a glass</h3>
      <p><strong>${escapeHtml(res.clean)}</strong> appears in the MTB chart mapping, but it is not currently confirmed by a photographed real packet label in this system.</p>
      <div class="ref-stock">Chart reference only: ${escapeHtml(names.join(' / '))}</div>
      <div class="notes">Do not issue a glass from this result until the real stock packet is checked or photographed.</div>
    </div>`;
  }

  function renderNone(res){
    resultSection.innerHTML=`<div class="no-result"><div class="empty-icon">🔎</div><h2>No exact verified match</h2><p>No exact real-packet or direct-stock match was found for <strong>${escapeHtml(res.clean)}</strong>. Type the full brand and exact model, including 4G/5G or year when applicable.</p></div>`;
  }

  function renderResult(raw){
    suggestions.hidden=true;
    const res=resolveStrict(raw);
    if(res.type==='empty') return renderEmpty();
    if(res.type==='variant') return renderVariant(res);
    if(res.type==='conflict') return renderConflict(res);
    if(res.type==='packet') return renderPacket(res);
    if(res.type==='direct') return renderDirect(res);
    if(res.type==='chart') return renderChart(res);
    renderNone(res);
  }

  function strictSuggestions(raw){
    const q=canonical(raw);
    if(!q || q.length<2){suggestions.hidden=true;return;}
    const branded=hasBrand(raw), items=[], seen=new Set();
    const add=(label,stock,type)=>{
      const full=normalize(label), stripped=stripBrand(label);
      const target=branded?full:stripped;
      if(!(target.startsWith(q)||target.includes(q))) return;
      const key=full+'|'+stock;
      if(seen.has(key)) return; seen.add(key);
      items.push({label,stock,type});
    };
    packetModelsAll.forEach(x=>add(x.label,x.group.stockName,'PACKET VERIFIED'));
    DATA.groups.forEach(g=>(g.directModels||[]).forEach(l=>add(l,g.stockName,'STOCK')));
    items.sort((a,b)=>{
      const ae=(canonical(a.label)===q||stripBrand(a.label)===q)?0:1;
      const be=(canonical(b.label)===q||stripBrand(b.label)===q)?0:1;
      if(ae!==be)return ae-be;
      if(a.type!==b.type)return a.type==='PACKET VERIFIED'?-1:1;
      return a.label.localeCompare(b.label);
    });
    const top=items.slice(0,10);
    if(!top.length){suggestions.hidden=true;return;}
    suggestions.innerHTML=top.map(x=>`<button class="suggestion-item" data-query="${escapeHtml(x.label)}"><span><span class="suggestion-model">${escapeHtml(x.label)}</span><br><small>${escapeHtml(x.type)}</small></span><span class="suggestion-stock">→ ${escapeHtml(x.stock)}</span></button>`).join('');
    suggestions.hidden=false;
  }

  function openGroupModal(group){
    const models=uniquePacketModelsForGroup(group);
    compatModalTitle.textContent='Packet-Verified Models';
    compatModalSubtitle.textContent=`Only models printed on the photographed real packet for “${group.stockName}”.`;
    const images=proofImagesForGroups([group]);
    compatModalBody.innerHTML=`
      <div class="stock-label-box"><small>Your stock label</small><strong>${escapeHtml(group.stockName)}</strong></div>
      ${(group.packetEvidence||[]).length?`
      <div class="packet-panel">
        <h3>✓ Printed on real stock packet (${models.length})</h3>
        <p>These are the only cross-model matches shown as verified in Strict Mode.</p>
        <div class="packet-models">${models.map(x=>`<span class="packet-chip">${escapeHtml(x)}</span>`).join('')}</div>
        ${group.packetNote?`<p style="margin-top:12px">${escapeHtml(group.packetNote)}</p>`:''}
        <button class="copy-all" data-copy-models="${escapeHtml(models.join(' | '))}">Copy verified models</button>
      </div>`:`<div class="notes">No real packet compatibility photo is loaded for this stock group.</div>`}
      ${images.length?`<div class="proof-section"><h3>Source proof</h3><div class="proof-gallery">${images.map(i=>`<div class="proof-card"><img src="${escapeHtml(i.src)}" data-proof-src="${escapeHtml(i.src)}" alt="Real MTB packet label"><div class="proof-caption">${escapeHtml(i.name)}</div></div>`).join('')}</div></div>`:''}
      <div class="hidden-chart-note">MTB chart-only models are intentionally hidden from this verified list. This prevents chart inference from being presented as packet proof.</div>`;
    compatModal.hidden=false; document.body.classList.add('modal-open');
  }

  function openCompatibility(raw){
    const res=resolveStrict(raw);
    if(res.type==='packet'){
      const groups=[...new Map(res.candidates.map(x=>[x.group.id,x.group])).values()];
      if(groups.length===1) return openGroupModal(groups[0]);
      // same physical packet can have multiple stock labels; show first group because packet label set is identical
      return openGroupModal(groups[0]);
    }
    if(res.type==='direct'){
      const g=res.candidates[0].group;
      return openGroupModal(g);
    }
    renderResult(raw);
  }

  function openProof(src){
    if(!src)return;
    overlayImage.src=src; imageOverlay.hidden=false; document.body.style.overflow='hidden';
  }
  function closeProof(){imageOverlay.hidden=true;overlayImage.src='';document.body.style.overflow='';}
  function closeModal(){compatModal.hidden=true;document.body.classList.remove('modal-open');}

  function renderInventory(){
    const order=['Samsung','OPPO','Redmi / Xiaomi','POCO','Huawei','Honor','Infinix','iPhone'];
    inventoryList.innerHTML=order.map(brand=>{
      const models=DATA.stockInventory[brand]||[];
      return `<div class="inventory-brand"><h3>${escapeHtml(brand)} (${models.length})</h3><div class="inventory-models">${models.map(m=>`<span>${escapeHtml(m)}</span>`).join('')}</div></div>`;
    }).join('');
  }

  searchBtn.addEventListener('click',()=>renderResult(input.value));
  compatibleBtn.addEventListener('click',()=>openCompatibility(input.value));
  input.addEventListener('input',()=>strictSuggestions(input.value));
  input.addEventListener('keydown',e=>{if(e.key==='Enter')renderResult(input.value);if(e.key==='Escape')suggestions.hidden=true;});
  clearBtn.addEventListener('click',()=>{input.value='';suggestions.hidden=true;renderEmpty();input.focus();});
  toggleInventory.addEventListener('click',()=>{inventoryList.hidden=!inventoryList.hidden;toggleInventory.textContent=inventoryList.hidden?'Show Stock List':'Hide Stock List';});
  closeCompatModal.addEventListener('click',closeModal);
  compatModal.addEventListener('click',e=>{if(e.target===compatModal)closeModal();});
  closeImageOverlay.addEventListener('click',closeProof);
  imageOverlay.addEventListener('click',e=>{if(e.target===imageOverlay)closeProof();});

  document.addEventListener('click',e=>{
    const q=e.target.closest('[data-query]'); if(q){input.value=q.dataset.query;renderResult(q.dataset.query);return;}
    const gbtn=e.target.closest('[data-strict-group]'); if(gbtn){const g=DATA.groups.find(x=>x.id===gbtn.dataset.strictGroup);if(g)openGroupModal(g);return;}
    const p=e.target.closest('[data-proof-src]'); if(p){openProof(p.dataset.proofSrc);return;}
    const cp=e.target.closest('[data-copy]'); if(cp){navigator.clipboard?.writeText(cp.dataset.copy);const t=cp.textContent;cp.textContent='Copied';setTimeout(()=>cp.textContent=t,900);return;}
    const cm=e.target.closest('[data-copy-models]'); if(cm){navigator.clipboard?.writeText(cm.dataset.copyModels);const t=cm.textContent;cm.textContent='Copied';setTimeout(()=>cm.textContent=t,900);return;}
    if(!e.target.closest('.search-panel'))suggestions.hidden=true;
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!imageOverlay.hidden)closeProof();else if(!compatModal.hidden)closeModal();}});

  renderInventory(); renderEmpty();
})();
