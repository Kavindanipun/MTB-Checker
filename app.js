(() => {
  const DATA = window.MTB_DATA;
  const searchInput = document.getElementById('modelSearch');
  const searchBtn = document.getElementById('searchBtn');
  const compatibleBtn = document.getElementById('compatibleBtn');
  const clearBtn = document.getElementById('clearBtn');
  const resultSection = document.getElementById('resultSection');
  const suggestions = document.getElementById('suggestions');
  const inventoryList = document.getElementById('inventoryList');
  const toggleInventory = document.getElementById('toggleInventory');
  const stockCount = document.getElementById('stockCount');
  const compatModal = document.getElementById('compatModal');
  const compatModalBody = document.getElementById('compatModalBody');
  const compatModalSubtitle = document.getElementById('compatModalSubtitle');
  const closeCompatModal = document.getElementById('closeCompatModal');

  const brandPrefixes = [
    'samsung', 'oppo', 'redmi', 'xiaomi', 'poco', 'huawei', 'honor',
    'infinix', 'iphone', 'vivo', 'iqoo', 'realme', 'oneplus', 'tecno',
    'motorola', 'itel'
  ];

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\+/g, ' plus ')
      .replace(/\bgalaxy\b/g, ' ')
      .replace(/\bsam\b/g, ' samsung ')
      .replace(/\brm\b/g, ' redmi ')
      .replace(/\bxm\b/g, ' xiaomi ')
      .replace(/\bop\b/g, ' oppo ')
      .replace(/\bhw\b/g, ' huawei ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function stripBrand(label) {
    let n = normalize(label);
    for (const brand of brandPrefixes) {
      if (n === brand) return '';
      if (n.startsWith(brand + ' ')) return n.slice(brand.length + 1);
    }
    return n;
  }

  function expandTerms(label) {
    const full = normalize(label);
    const stripped = stripBrand(label);
    const terms = new Set([full, stripped]);
    if (full.includes(' plus ')) terms.add(full.replace(/ plus /g, ' + '));
    return [...terms].filter(Boolean);
  }

  const aliasLookup = new Map(
    Object.entries(DATA.aliases || {}).map(([a, b]) => [normalize(a), normalize(b)])
  );

  const groupEntries = DATA.groups.map(group => {
    const packetSet = new Set((group.packetLabelModels || []).map(normalize));
    const entries = [];
    group.directModels.forEach(label => entries.push({
      label, direct: true, searchable: true, terms: expandTerms(label),
      packetVerified: packetSet.has(normalize(label))
    }));
    group.compatibleModels.forEach(label => entries.push({
      label,
      direct: false,
      searchable: group.matchCompatible !== false,
      terms: expandTerms(label),
      packetVerified: packetSet.has(normalize(label))
    }));
    // Some packet labels contain models not present in the older chart list.
    (group.packetLabelModels || []).forEach(label => {
      const n = normalize(label);
      if (!entries.some(e => normalize(e.label) === n)) {
        entries.push({label, direct:false, searchable:true, terms:expandTerms(label), packetVerified:true});
      }
    });
    return { ...group, entries, packetSet };
  });

  const stockTotal = Object.values(DATA.stockInventory).reduce((sum, list) => sum + list.length, 0);
  stockCount.textContent = stockTotal;

  function canonicalQuery(raw) {
    const n = normalize(raw);
    return aliasLookup.get(n) || n;
  }

  function exactMatchScore(entry, query) {
    const full = normalize(entry.label);
    const stripped = stripBrand(entry.label);
    if (full === query) return (entry.direct ? 120 : 110) + (entry.packetVerified ? 25 : 0);
    if (stripped === query) return (entry.direct ? 105 : 95) + (entry.packetVerified ? 25 : 0);
    return 0;
  }

  function partialScore(entry, query) {
    let score = 0;
    for (const term of entry.terms) {
      if (!term) continue;
      if (term.startsWith(query)) score = Math.max(score, entry.direct ? 75 : 68);
      else if (term.includes(query)) score = Math.max(score, entry.direct ? 60 : 54);
      else if (query.includes(term) && term.length >= 3) score = Math.max(score, entry.direct ? 50 : 45);
    }
    return score;
  }

  function searchGroups(raw, allowPartial = true) {
    const query = canonicalQuery(raw);
    if (!query) return [];
    const results = [];

    for (const group of groupEntries) {
      let best = 0;
      let matchedEntry = null;
      for (const entry of group.entries) {
        if (entry.searchable === false) continue;
        let s = exactMatchScore(entry, query);
        if (!s && allowPartial) s = partialScore(entry, query);
        if (s > best) {
          best = s;
          matchedEntry = entry;
        }
      }
      if (best > 0) {
        results.push({ group, score: best, matchedEntry });
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.matchedEntry.direct !== b.matchedEntry.direct) return a.matchedEntry.direct ? -1 : 1;
      return a.group.stockName.localeCompare(b.group.stockName);
    });
    return results;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }


  function fullGroupModels(group) {
    return [...group.directModels, ...group.compatibleModels]
      .filter((value, index, arr) => arr.indexOf(value) === index);
  }

  function resolveQueryMatches(raw) {
    const clean = String(raw || '').trim();
    if (!clean) return { clean, matches: [], usedPartial: false };

    let matches = searchGroups(clean, false);
    let usedPartial = false;
    if (!matches.length) {
      matches = searchGroups(clean, true).slice(0, 8);
      usedPartial = true;
    }
    if (!matches.length) return { clean, matches: [], usedPartial };

    const topScore = matches[0].score;
    if (!usedPartial) matches = matches.filter(m => m.score === topScore || (topScore >= 100 && m.score >= 95));
    else matches = matches.filter(m => m.score >= Math.max(45, topScore - 15)).slice(0, 6);
    return { clean, matches, usedPartial };
  }

  function renderCompatGroups(matches, queryLabel) {
    if (!matches.length) {
      compatModalBody.innerHTML = `<div class="modal-empty">No compatible model group found for <strong>${escapeHtml(queryLabel)}</strong>.</div>`;
      return;
    }

    compatModalBody.innerHTML = matches.map(({ group, matchedEntry }) => {
      const models = fullGroupModels(group);
      return `
        <section class="compat-group-block">
          <div class="compat-group-head">
            <div>
              <h3>${escapeHtml(group.stockName)}</h3>
              <div class="compat-group-meta">Matched from: <strong>${escapeHtml(matchedEntry?.label || queryLabel)}</strong> · Main stock glass: <strong>${escapeHtml(group.stockName)}</strong></div>
            </div>
            <span class="compat-count">${models.length} models</span>
          </div>
          ${group.packetLabelModels && group.packetLabelModels.length ? `
            <div class="packet-panel">
              <h4>✓ Printed on real stock packet (${group.packetLabelModels.length})</h4>
              <div class="packet-models">${group.packetLabelModels.map(model => `<span class="packet-chip">${escapeHtml(model)}</span>`).join('')}</div>
              ${group.packetNote ? `<div class="packet-note">${escapeHtml(group.packetNote)}</div>` : ''}
            </div>` : ''}
          ${group.stockVariantNote ? `<div class="verified-note">✓ ${escapeHtml(group.stockVariantNote)}</div>` : ''}
          ${group.warning ? `<div class="notes">⚠ ${escapeHtml(group.warning)}</div>` : ''}
          <div class="compat-list">${models.map(model => `<span class="chip">${escapeHtml(model)}</span>`).join('')}</div>
          <button class="compat-copy-all" type="button" data-copy-models="${escapeHtml(models.join(' | '))}">Copy all models</button>
        </section>`;
    }).join('');
  }

  function openCompatibilityForMatches(matches, queryLabel) {
    compatModalSubtitle.textContent = queryLabel
      ? `All models mapped to the same glass group as “${queryLabel}”.`
      : 'All models in the same mapped glass group.';
    renderCompatGroups(matches, queryLabel || 'this model');
    compatModal.hidden = false;
    document.body.classList.add('modal-open');
    closeCompatModal.focus();
  }

  function openCompatibilityForQuery(raw) {
    const { clean, matches } = resolveQueryMatches(raw);
    if (!clean) {
      searchInput.focus();
      return;
    }
    suggestions.hidden = true;
    openCompatibilityForMatches(matches, clean);
  }

  function closeCompatibilityModal() {
    compatModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function renderResults(raw) {
    suggestions.hidden = true;
    const clean = raw.trim();
    if (!clean) {
      resultSection.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📱</div>
          <h2>Search a phone model</h2>
          <p>The system will show which main stock glass you should take from your shelf.</p>
        </div>`;
      return;
    }

    const resolved = resolveQueryMatches(clean);
    let matches = resolved.matches;
    const usedPartial = resolved.usedPartial;

    if (!matches.length) {
      resultSection.innerHTML = `
        <div class="no-result">
          <div class="empty-icon">🔎</div>
          <h2>No mapped stock match found</h2>
          <p>No result was found for <strong>${escapeHtml(clean)}</strong>. Check spelling, brand, 4G/5G or the exact model name.</p>
        </div>`;
      return;
    }

    const cards = matches.map(({ group, matchedEntry }) => {
      const type = matchedEntry.direct ? 'Direct stock model' : 'Same-size compatible match';
      const compat = fullGroupModels(group);
      return `
        <article class="match-card">
          <div class="match-top">
            <div>
              <span class="stock-badge">● IN STOCK</span>
              <h3>${escapeHtml(group.stockName)}</h3>
              <div class="brand-line">Matched from: <strong>${escapeHtml(matchedEntry.label)}</strong></div>
            </div>
            <span class="match-type">${escapeHtml(type)}</span>
          </div>
          <div class="main-label">
            <small>Take this stock glass</small>
            <strong>${escapeHtml(group.stockName)}</strong>
          </div>
          <div class="source-badge ${matchedEntry.packetVerified ? 'packet' : 'chart'}">${matchedEntry.packetVerified ? '✓ REAL PACKET VERIFIED' : 'MTB CHART MATCH'}</div>
          ${group.packetNote ? `<div class="packet-note">${escapeHtml(group.packetNote)}</div>` : ''}
          ${group.stockVariantNote ? `<div class="verified-note">✓ ${escapeHtml(group.stockVariantNote)}</div>` : ''}
          ${group.warning ? `<div class="notes">⚠ ${escapeHtml(group.warning)}</div>` : ''}
          <div class="card-actions">
            <button class="compat-btn" type="button" data-compat-group="${escapeHtml(group.id)}" data-compat-match="${escapeHtml(matchedEntry.label)}">View All Compatible Models (${compat.length})</button>
            <button class="copy-btn" data-copy="${escapeHtml(group.stockName)}">Copy stock name</button>
          </div>
        </article>`;
    }).join('');

    const intro = usedPartial
      ? `Closest matches for <strong>${escapeHtml(clean)}</strong>. If possible, type the full brand + model for a more exact result.`
      : `Stock match for <strong>${escapeHtml(clean)}</strong>${matches.length > 1 ? ' — more than one stocked glass may match this model name, so check the phone brand/version.' : '.'}`;

    resultSection.innerHTML = `<div class="query-summary">${intro}</div><div class="match-grid">${cards}</div>`;
  }

  function buildSuggestions(raw) {
    const q = raw.trim();
    if (q.length < 2) {
      suggestions.hidden = true;
      return;
    }
    const results = searchGroups(q, true);
    const seen = new Set();
    const items = [];
    for (const r of results) {
      const key = `${r.matchedEntry.label}|${r.group.stockName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(r);
      if (items.length >= 8) break;
    }
    if (!items.length) {
      suggestions.hidden = true;
      return;
    }
    suggestions.innerHTML = items.map(r => `
      <button type="button" class="suggestion-item" data-query="${escapeHtml(r.matchedEntry.label)}">
        <span class="suggestion-model">${escapeHtml(r.matchedEntry.label)}</span>
        <span class="suggestion-stock">→ ${escapeHtml(r.group.stockName)}</span>
      </button>`).join('');
    suggestions.hidden = false;
  }

  function renderInventory() {
    const preferredOrder = ['Samsung','OPPO','Redmi / Xiaomi','POCO','Huawei','Honor','Infinix','iPhone'];
    inventoryList.innerHTML = preferredOrder.map(brand => {
      const models = DATA.stockInventory[brand] || [];
      return `<div class="inventory-brand"><h3>${escapeHtml(brand)} (${models.length})</h3><div class="inventory-models">${models.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div></div>`;
    }).join('');
  }

  searchBtn.addEventListener('click', () => renderResults(searchInput.value));
  compatibleBtn.addEventListener('click', () => openCompatibilityForQuery(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') renderResults(searchInput.value);
    if (e.key === 'Escape') suggestions.hidden = true;
  });
  searchInput.addEventListener('input', () => buildSuggestions(searchInput.value));
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.focus();
    suggestions.hidden = true;
    renderResults('');
  });

  document.addEventListener('click', e => {
    const sug = e.target.closest('[data-query]');
    if (sug) {
      searchInput.value = sug.dataset.query;
      renderResults(sug.dataset.query);
      searchInput.focus();
      return;
    }
    const compatTrigger = e.target.closest('[data-compat-group]');
    if (compatTrigger) {
      const group = groupEntries.find(g => g.id === compatTrigger.dataset.compatGroup);
      if (group) {
        openCompatibilityForMatches([{ group, matchedEntry: { label: compatTrigger.dataset.compatMatch || group.stockName } }], compatTrigger.dataset.compatMatch || group.stockName);
      }
      return;
    }
    const copyModels = e.target.closest('[data-copy-models]');
    if (copyModels) {
      navigator.clipboard?.writeText(copyModels.dataset.copyModels);
      const old = copyModels.textContent;
      copyModels.textContent = 'Copied all models';
      setTimeout(() => copyModels.textContent = old, 1000);
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy);
      const old = copy.textContent;
      copy.textContent = 'Copied';
      setTimeout(() => copy.textContent = old, 1000);
      return;
    }
    if (!e.target.closest('.search-panel')) suggestions.hidden = true;
  });

  closeCompatModal.addEventListener('click', closeCompatibilityModal);
  compatModal.addEventListener('click', e => {
    if (e.target === compatModal) closeCompatibilityModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !compatModal.hidden) closeCompatibilityModal();
  });

  toggleInventory.addEventListener('click', () => {
    const hidden = inventoryList.hidden;
    inventoryList.hidden = !hidden;
    toggleInventory.textContent = hidden ? 'Hide Stock List' : 'Show Stock List';
  });

  renderInventory();
})();
