(function () {
  'use strict';

  const CFG = window.MIZICA_CONFIG;
  const API = CFG.API_BASE;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  // ---------------- splošni pripomočki ----------------
  function eur(n) {
    return (Number(n) || 0).toLocaleString('sl-SI', { style: 'currency', currency: 'EUR' });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function openModal(html) {
    document.getElementById('modalBox').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('show');
  }
  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
    document.getElementById('modalBox').innerHTML = '';
  }
  window.closeModal = closeModal;
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  function askConfirm(title, text, onYes) {
    window.__confirmYes = onYes;
    openModal(`
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      <div class="modal-close-row">
        <button class="secondary-btn" type="button" onclick="closeModal()">Prekliči</button>
        <button class="mini-btn primary" type="button" style="flex:none; padding:9px 16px;" onclick="window.__confirmYes(); closeModal();">Potrdi</button>
      </div>
    `);
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* prazen odgovor */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Napaka strežnika (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function authedFetch(path, opts, token) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
    return apiFetch(path, opts);
  }

  // ---------------- nalaganje slik (Supabase Storage) ----------------
  async function uploadToStorage(file, folderHint) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${folderHint}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb.storage.from('mizica-media').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (error) throw error;
    const { data } = sb.storage.from('mizica-media').getPublicUrl(path);
    return data.publicUrl;
  }

  // ---------------- nastavitev gesla ob povabilu / obnovitvi gesla ----------------
  // Ko uporabnik klikne povezavo v e-pošti (povabilo ali "pozabljeno geslo"), Supabase doda
  // #access_token=...&type=invite (ali type=recovery) na URL. To zaznamo in mu ponudimo obrazec za novo geslo.
  let pendingAuthType = null;
  (function checkAuthHash() {
    const hash = window.location.hash || '';
    if (hash.includes('type=invite')) pendingAuthType = 'invite';
    else if (hash.includes('type=recovery')) pendingAuthType = 'recovery';
  })();

  function showSetPasswordModal() {
    openModal(`
      <h3>${pendingAuthType === 'invite' ? 'Dobrodošli! Nastavite geslo' : 'Nastavite novo geslo'}</h3>
      <p>${pendingAuthType === 'invite' ? 'To je vaša prva prijava v Mizico. Preden nadaljujete, nastavite svoje geslo.' : 'Vnesite novo geslo za svoj račun.'}</p>
      <div class="field-group"><label class="field-label">Novo geslo</label><input class="text-input" type="password" id="newPasswordInput" autocomplete="new-password"></div>
      <div class="field-group"><label class="field-label">Ponovite geslo</label><input class="text-input" type="password" id="newPasswordInput2" autocomplete="new-password"></div>
      <div class="field-error" id="setPasswordError"></div>
      <div class="modal-close-row">
        <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" id="setPasswordBtn">Shrani geslo</button>
      </div>
    `);
    document.getElementById('setPasswordBtn').addEventListener('click', async () => {
      const p1 = document.getElementById('newPasswordInput').value;
      const p2 = document.getElementById('newPasswordInput2').value;
      const errEl = document.getElementById('setPasswordError');
      if (!p1 || p1.length < 6) { errEl.textContent = 'Geslo mora imeti vsaj 6 znakov.'; return; }
      if (p1 !== p2) { errEl.textContent = 'Gesli se ne ujemata.'; return; }
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) { errEl.textContent = error.message; return; }
      closeModal();
      pendingAuthType = null;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      showToast('Geslo je nastavljeno. Prijavljeni ste — izberite "Za gostilne" ali "Skrbnik" zgoraj.');
      if (currentView === 'owner') initOwnerView();
      if (currentView === 'admin') initAdminView();
    });
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (pendingAuthType && session) showSetPasswordModal();
  });

  // ---------------- usmerjanje pogledov ----------------
  let currentView = 'market';
  function goToView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.viewnav button[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === name);
    });
    document.getElementById('cartFab').classList.toggle('show', name === 'restaurant' && cartCount() > 0);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (name === 'owner') initOwnerView();
    if (name === 'admin') initAdminView();
    if (name === 'account') initAccountView();
  }
  document.querySelectorAll('.viewnav button[data-view]').forEach((b) => {
    b.addEventListener('click', () => goToView(b.dataset.view));
  });
  document.getElementById('backToMarket').addEventListener('click', () => goToView('market'));

  // =================================================================
  // MARKETPLACE
  // =================================================================
  let restaurants = [];

  async function loadMarket() {
    document.getElementById('marketLoading').style.display = 'block';
    document.getElementById('marketEmpty').style.display = 'none';
    try {
      restaurants = await apiFetch('/restaurants');
      populateKuhinjaFilter();
      renderMarket();
      renderAccountNearby();
    } catch (e) {
      document.getElementById('marketGrid').innerHTML = `<div class="error-note">Ne morem naložiti seznama gostiln (${esc(e.message)}). Backend se morda še zaganja — poskusite čez trenutek.</div>`;
    } finally {
      document.getElementById('marketLoading').style.display = 'none';
    }
  }

  function populateKuhinjaFilter() {
    const sel = document.getElementById('marketKuhinja');
    const current = sel.value;
    const kuhinje = Array.from(new Set(restaurants.map((r) => r.kuhinja).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">Vsa kuhinja</option>' + kuhinje.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
    sel.value = current;
  }

  function heroGradient(name) {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${hue},45%,42%), hsl(${(hue + 40) % 360},50%,30%))`;
  }

  function tagsForRestaurant(r) {
    const tags = [];
    tags.push(r.odprto_zdaj ? '<span class="tag green">Odprto zdaj</span>' : '<span class="tag red">Trenutno zaprto</span>');
    if (r.prevzem_enabled) tags.push('<span class="tag">Prevzem</span>');
    if (r.dostava_enabled) tags.push('<span class="tag gold">Dostava</span>');
    return tags.join('');
  }

  function normKraj(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  const NEARBY_RADIUS_KM = 20;
  function distanceKm(a, b) {
    if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s1 = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s1));
  }

  function syncMyKrajFilterVisibility() {
    const myKraj = customerToken() ? (customerMeta().kraj || '').trim() : '';
    const wrap = document.getElementById('marketOnlyMyKrajWrap');
    wrap.style.display = myKraj ? '' : 'none';
    if (!myKraj) document.getElementById('marketOnlyMyKraj').checked = false;
  }

  // ---------------- ocene (zvezdice) ----------------
  function starsHtml(avg) {
    const rounded = Math.round((avg || 0) * 2) / 2; // na pol zvezdice
    let out = '';
    for (let i = 1; i <= 5; i++) {
      out += i <= rounded ? '★' : (i - 0.5 === rounded ? '⯨' : '☆');
    }
    return out;
  }
  function ratingLabel(r) {
    if (!r.review_count) return '';
    return `<span class="r-rating"><span class="r-rating-stars">${starsHtml(r.avg_rating)}</span> ${r.avg_rating} <span class="r-rating-count">(${r.review_count})</span></span>`;
  }

  function renderMarket() {
    const q = (document.getElementById('marketSearch').value || '').toLowerCase().trim();
    const kuhinja = document.getElementById('marketKuhinja').value;
    const onlyOpen = document.getElementById('marketOnlyOpen').checked;
    const meta = customerToken() ? customerMeta() : {};
    const myKraj = customerToken() ? normKraj(meta.kraj) : '';
    const myCoords = meta.lat != null && meta.lng != null ? { lat: meta.lat, lng: meta.lng } : null;
    const onlyMyKraj = myKraj && document.getElementById('marketOnlyMyKraj').checked;

    const list = restaurants.filter((r) => {
      if (q && !((r.name || '').toLowerCase().includes(q) || (r.kraj || '').toLowerCase().includes(q))) return false;
      if (kuhinja && r.kuhinja !== kuhinja) return false;
      if (onlyOpen && !r.odprto_zdaj) return false;
      if (onlyMyKraj) {
        const d = myCoords ? distanceKm(myCoords, { lat: r.lat, lng: r.lng }) : null;
        // Če imamo koordinate za obe strani, filtriramo po razdalji (bolj natančno — zajame tudi
        // sosednje vasi znotraj iste občine). Če geolociranje ni uspelo, se vrnemo na besedilo.
        if (d != null) { if (d > NEARBY_RADIUS_KM) return false; }
        else if (!normKraj(r.kraj).includes(myKraj)) return false;
      }
      return true;
    });

    const grid = document.getElementById('marketGrid');
    document.getElementById('marketEmpty').style.display = list.length ? 'none' : 'block';
    grid.innerHTML = list.map((r) => `
      <div class="r-card">
        <button class="card-btn-wrap" type="button" onclick="window.__openRestaurant('${r.id}')">
          <div class="r-card-img" style="${r.logo_url ? '' : `background:${heroGradient(r.name)};`}">
            ${r.logo_url ? `<img src="${esc(r.logo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : ''}
          </div>
          <div class="r-card-body">
            <div class="r-card-name">${esc(r.name)}</div>
            <div class="r-card-meta">${esc(r.kraj || '')} ${r.kuhinja ? '&middot; ' + esc(r.kuhinja) : ''}</div>
            ${ratingLabel(r) ? `<div class="r-card-rating">${ratingLabel(r)}</div>` : ''}
            <div class="r-card-tags">${tagsForRestaurant(r)}</div>
            <div class="r-card-foot"><span>${r.odpira_od ? r.odpira_od.slice(0, 5) : ''}&ndash;${r.odpira_do ? r.odpira_do.slice(0, 5) : ''}</span></div>
          </div>
        </button>
      </div>
    `).join('');
  }
  document.getElementById('marketSearch').addEventListener('input', renderMarket);
  document.getElementById('marketKuhinja').addEventListener('change', renderMarket);
  document.getElementById('marketOnlyOpen').addEventListener('change', renderMarket);
  document.getElementById('marketOnlyMyKraj').addEventListener('change', renderMarket);

  // =================================================================
  // RESTAVRACIJA + KOŠARICA
  // =================================================================
  let currentRestaurant = null; // polni objekt iz GET /restaurants/:id
  // cart.lines: { [lineKey]: { itemId, variantId, addonIds:[], qty } }
  // Jed brez izbrane velikosti/dodatkov ima lineKey enak kar itemId (nazaj združljivo s prejšnjim
  // preprostim modelom). Jed z izbrano velikostjo in/ali dodatki dobi svojo vrstico v košarici za
  // vsako kombinacijo, saj imajo lahko različne kombinacije različno ceno.
  let cart = { restaurantId: null, lines: {}, type: null, timeSlot: '', payment: '' };

  function cartCount() {
    return Object.values(cart.lines).reduce((s, l) => s + l.qty, 0);
  }

  function itemCartQty(itemId) {
    return Object.values(cart.lines).filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0);
  }

  function lineKeyFor(itemId, variantId, addonIds) {
    const a = (addonIds || []).slice().sort().join(',');
    return itemId + (variantId ? ':v' + variantId : '') + (a ? ':a' + a : '');
  }

  function adjustCartLine(key, delta) {
    const line = cart.lines[key];
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) delete cart.lines[key];
    renderRestaurant();
  }
  window.__adjustCartLine = adjustCartLine;

  function findMenuItem(itemId) {
    if (!currentRestaurant) return null;
    for (const cat of currentRestaurant.meni || []) {
      const it = (cat.menu_items || []).find((i) => i.id === itemId);
      if (it) return it;
    }
    return null;
  }

  async function openRestaurant(id) {
    goToView('restaurant');
    document.getElementById('restaurantContent').innerHTML = '<div class="loading-note">Nalagam gostilno...</div>';
    try {
      currentRestaurant = await apiFetch('/restaurants/' + id);
      if (cart.restaurantId !== id) cart = { restaurantId: id, lines: {}, type: null, timeSlot: '', payment: '' };
      renderRestaurant();
    } catch (e) {
      document.getElementById('restaurantContent').innerHTML = `<div class="error-note">Gostilne ni bilo mogoče naložiti (${esc(e.message)}).</div>`;
    }
  }
  window.__openRestaurant = openRestaurant;

  function renderRestaurant() {
    const r = currentRestaurant;
    if (!cart.type) cart.type = r.prevzem_enabled ? 'prevzem' : (r.dostava_enabled ? 'dostava' : null);

    // Malica je vedno na vrhu ponudbe — stranka jo mora videti prvo, ne glede na vrstni red kategorij.
    const sortedMeni = (r.meni || []).slice().sort((a, b) => (b.je_malica ? 1 : 0) - (a.je_malica ? 1 : 0));
    const menuHtml = sortedMeni.map((cat) => `
      <div class="menu-cat">
        <h3>${esc(cat.name)} ${catTimeLabel(cat)}</h3>
        ${(cat.menu_items || []).map((it) => renderMenuItemRow(it)).join('') || '<p class="section-sub">Ni jedi v tej kategoriji.</p>'}
      </div>
    `).join('') || '<p class="section-sub">Meni še ni na voljo.</p>';

    document.getElementById('restaurantContent').innerHTML = `
      <div class="rd-header">
        <div>
          <div class="rd-head-row">
            ${r.logo_url ? `<img class="rd-logo" src="${esc(r.logo_url)}" alt="">` : ''}
            <div>
              <h1>${esc(r.name)}</h1>
              <p class="r-card-meta">${esc(r.kraj || '')} ${r.kuhinja ? '&middot; ' + esc(r.kuhinja) : ''} &middot; ${r.odpira_od ? r.odpira_od.slice(0,5) : ''}&ndash;${r.odpira_do ? r.odpira_do.slice(0,5) : ''}</p>
              ${ratingLabel(r) ? `<div class="r-card-rating">${ratingLabel(r)}</div>` : ''}
              ${r.address ? `<p class="rd-address">${esc(r.address)}</p><a class="map-link-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}">Odpri na zemljevidu</a>` : ''}
            </div>
          </div>
        </div>
      </div>
      ${!r.odprto_zdaj ? '<div class="closed-banner">Gostilna trenutno ne sprejema naročil (zaprto ali izven delovnega časa).</div>' : ''}
      <div class="rd-body">
        <div>${menuHtml}${renderReviewsSection(r)}</div>
        <div class="cart-panel" id="cartPanel"></div>
      </div>
    `;
    renderCartPanel();
  }

  function renderReviewsSection(r) {
    const reviews = r.reviews || [];
    return `
      <div class="reviews-section">
        <h3>Ocene ${r.review_count ? `<span class="r-rating"><span class="r-rating-stars">${starsHtml(r.avg_rating)}</span> ${r.avg_rating} <span class="r-rating-count">(${r.review_count})</span></span>` : ''}</h3>
        ${reviews.length ? reviews.map((rv) => `
          <div class="review-row">
            <div class="review-row-top"><span class="review-stars">${starsHtml(rv.rating)}</span><span class="review-name">${esc(rv.customer_name || 'Stranka')}</span><span class="review-date">${new Date(rv.created_at).toLocaleDateString('sl-SI')}</span></div>
            ${rv.comment ? `<p class="review-comment">${esc(rv.comment)}</p>` : ''}
          </div>
        `).join('') : '<p class="section-sub">Še ni ocen.</p>'}
      </div>
    `;
  }

  function itemPriceLabel(it) {
    const variants = it.menu_item_variants || [];
    if (!variants.length) return eur(it.price);
    const min = Math.min(...variants.map((v) => Number(v.price)));
    return 'od ' + eur(min);
  }

  function renderMenuItemRow(it) {
    const unavailable = !it.available;
    const hasOptions = (it.menu_item_variants && it.menu_item_variants.length) || (it.menu_item_addons && it.menu_item_addons.length);
    const qty = cart.lines[it.id] ? cart.lines[it.id].qty : 0; // samo za jedi brez velikosti/dodatkov (ključ = kar id jedi)
    const totalQty = itemCartQty(it.id);
    return `
      <div class="menu-item ${unavailable ? 'mi-unavailable' : ''}">
        <div class="mi-row-inner">
          ${it.photo_url ? `<img class="mi-photo" src="${esc(it.photo_url)}" alt="">` : ''}
          <div>
            <div class="mi-name">${esc(it.name)} ${it.daily ? '<span class="pill-daily">Dnevno</span>' : ''}</div>
            <div class="mi-price-row"><span class="mi-price">${itemPriceLabel(it)}</span><span class="mi-ddv">DDV ${it.vat_rate}%</span></div>
            ${it.allergens ? `<div class="mi-allergens">Alergeni: ${esc(it.allergens)}</div>` : ''}
            ${unavailable ? '<div class="mi-unavailable-label">Trenutno ni na voljo</div>' : ''}
          </div>
        </div>
        ${unavailable ? '' : (hasOptions
          ? `<div class="mi-options-add">${totalQty > 0 ? `<span class="mi-in-cart">V košarici: ${totalQty}</span>` : ''}<button class="mi-add" type="button" onclick="window.__openItemOptionsModal('${it.id}')">+</button></div>`
          : (qty > 0
            ? `<div class="mi-stepper"><button type="button" onclick="window.__changeQty('${it.id}',-1)">&minus;</button><span>${qty}</span><button type="button" onclick="window.__changeQty('${it.id}',1)">+</button></div>`
            : `<button class="mi-add" type="button" onclick="window.__changeQty('${it.id}',1)">+</button>`))}
      </div>
    `;
  }

  // Jed z velikostmi in/ali dodatki: preden gre v košarico, stranka izbere kombinacijo v modalnem oknu
  // (cena je namreč odvisna od izbire, zato preprost "+" gumb tu ne zadostuje).
  function openItemOptionsModal(itemId) {
    const it = findMenuItem(itemId);
    if (!it) return;
    const variants = it.menu_item_variants || [];
    const addons = it.menu_item_addons || [];
    openModal(`
      <h3>${esc(it.name)}</h3>
      ${variants.length ? `
      <div class="field-group">
        <label class="field-label">Velikost</label>
        <div class="option-list">
          ${variants.map((v, i) => `<label class="chip-check"><input type="radio" name="optVariant" value="${v.id}" ${i === 0 ? 'checked' : ''}> ${esc(v.name)} — ${eur(v.price)}</label>`).join('')}
        </div>
      </div>` : ''}
      ${addons.length ? `
      <div class="field-group">
        <label class="field-label">Dodatki</label>
        <div class="option-list">
          ${addons.map((a) => `<label class="chip-check"><input type="checkbox" name="optAddon" value="${a.id}"> ${esc(a.name)} (+${eur(a.price)})</label>`).join('')}
        </div>
      </div>` : ''}
      <div class="modal-close-row">
        <button class="secondary-btn" type="button" onclick="closeModal()">Prekliči</button>
        <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__confirmAddToCart('${itemId}')">Dodaj v košarico</button>
      </div>
    `);
  }
  window.__openItemOptionsModal = openItemOptionsModal;

  function confirmAddToCart(itemId) {
    const variantEl = document.querySelector('input[name="optVariant"]:checked');
    const variantId = variantEl ? variantEl.value : null;
    const addonIds = Array.from(document.querySelectorAll('input[name="optAddon"]:checked')).map((el) => el.value);
    const key = lineKeyFor(itemId, variantId, addonIds);
    if (cart.lines[key]) cart.lines[key].qty += 1;
    else cart.lines[key] = { itemId, variantId, addonIds, qty: 1 };
    closeModal();
    renderRestaurant();
    showToast('Dodano v košarico.');
  }
  window.__confirmAddToCart = confirmAddToCart;

  function changeQty(itemId, delta) {
    const cur = cart.lines[itemId] ? cart.lines[itemId].qty : 0;
    const next = Math.max(0, cur + delta);
    if (next === 0) delete cart.lines[itemId];
    else cart.lines[itemId] = { itemId, variantId: null, addonIds: [], qty: next };
    renderRestaurant();
  }
  window.__changeQty = changeQty;

  function renderCartPanel() {
    const panel = document.getElementById('cartPanel');
    if (!panel) return;
    const r = currentRestaurant;
    const lines = Object.entries(cart.lines).map(([key, line]) => {
      const it = findMenuItem(line.itemId);
      if (!it) return null;
      let price = Number(it.price);
      let variantName = null;
      if (line.variantId) {
        const v = (it.menu_item_variants || []).find((v) => v.id === line.variantId);
        if (v) { price = Number(v.price); variantName = v.name; }
      }
      const addonNames = [];
      for (const aid of line.addonIds || []) {
        const a = (it.menu_item_addons || []).find((a) => a.id === aid);
        if (a) { price += Number(a.price); addonNames.push(a.name); }
      }
      return { key, name: it.name, variantName, addonNames, qty: line.qty, price, vat_rate: it.vat_rate };
    }).filter(Boolean);

    document.getElementById('cartFabBadge').textContent = cartCount();
    document.getElementById('cartFab').classList.toggle('show', cartCount() > 0);

    if (!lines.length) {
      panel.innerHTML = '<h3>Vaše naročilo</h3><p class="cart-empty">Košarica je prazna. Dodajte jedi iz menija.</p>';
      return;
    }

    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const deliveryFee = cart.type === 'dostava' ? Number(r.dostava_strosek || 0) : 0;
    const total = subtotal + deliveryFee;
    const belowMin = cart.type === 'dostava' && subtotal < Number(r.dostava_min_znesek || 0);

    const typeChoices = [];
    if (r.prevzem_enabled) typeChoices.push('prevzem');
    if (r.dostava_enabled) typeChoices.push('dostava');

    const paymentOptions = [];
    if (cart.type === 'prevzem') {
      if (r.prevzem_gotovina) paymentOptions.push(['gotovina', 'Gotovina']);
      if (r.prevzem_kartica) paymentOptions.push(['kartica', 'Kartica']);
    } else if (cart.type === 'dostava') {
      if (r.dostava_gotovina) paymentOptions.push(['gotovina', 'Gotovina']);
      if (r.dostava_kartica) paymentOptions.push(['kartica', 'Kartica']);
    }
    if (!paymentOptions.find(([v]) => v === cart.payment)) cart.payment = paymentOptions[0] ? paymentOptions[0][0] : '';

    const slots = r.prosti_termini || [];

    panel.innerHTML = `
      <h3>Vaše naročilo</h3>
      ${lines.map((l) => `
        <div class="cart-line">
          <span class="name">
            <span class="mi-stepper cart-line-stepper"><button type="button" onclick="window.__adjustCartLine('${l.key}',-1)">&minus;</button><span>${l.qty}</span><button type="button" onclick="window.__adjustCartLine('${l.key}',1)">+</button></span>
            ${esc(l.name)}${l.variantName ? ` <span class="cart-line-sub">(${esc(l.variantName)})</span>` : ''}
            ${l.addonNames.length ? `<div class="cart-line-addons">+ ${l.addonNames.map(esc).join(', ')}</div>` : ''}
          </span>
          <span>${eur(l.price * l.qty)}</span>
        </div>
      `).join('')}
      ${deliveryFee ? `<div class="cart-sub"><span>Strošek dostave</span><span>${eur(deliveryFee)}</span></div>` : ''}
      <div class="cart-total"><span>Skupaj</span><span>${eur(total)}</span></div>
      <div class="cart-vat-note">Plačilo neposredno gostilni ob prevzemu/dostavi.<br>Mizica ne obdeluje plačil.</div>

      ${typeChoices.length > 1 ? `
      <div class="field-group">
        <label class="field-label">Način</label>
        <div class="choice-row">
          ${typeChoices.map((t) => `<button type="button" class="choice-btn ${cart.type === t ? 'selected' : ''}" onclick="window.__setCartType('${t}')">${t === 'prevzem' ? 'Prevzem' : 'Dostava'}</button>`).join('')}
        </div>
      </div>` : ''}

      ${cart.type === 'dostava' ? `
      <div class="field-group">
        <label class="field-label">Naslov za dostavo</label>
        <input class="text-input" id="cartAddress" placeholder="Ulica in hišna št., pošta" value="${esc(cart.address || '')}">
        ${belowMin ? `<p class="warn-note">Za dostavo je potreben nakup najmanj ${eur(r.dostava_min_znesek)}.</p>` : ''}
      </div>` : ''}

      <div class="field-group">
        <label class="field-label">Termin prevzema/dostave</label>
        <select class="select-input" id="cartTimeSlot">
          <option value="">Izberite termin...</option>
          ${slots.map((s) => `<option value="${s}" ${cart.timeSlot === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>

      ${paymentOptions.length > 1 ? `
      <div class="field-group">
        <label class="field-label">Način plačila</label>
        <div class="choice-row">
          ${paymentOptions.map(([v, label]) => `<button type="button" class="choice-btn ${cart.payment === v ? 'selected' : ''}" onclick="window.__setCartPayment('${v}')">${label}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="field-group">
        <label class="field-label">Ime in priimek</label>
        <input class="text-input" id="cartName" value="${esc(cart.customerName || (customerToken() ? (customerMeta().ime || '') : ''))}">
      </div>
      <div class="field-group">
        <label class="field-label">Telefon</label>
        <input class="text-input" id="cartPhone" type="tel" value="${esc(cart.phone || (customerToken() ? (customerMeta().telefon || '') : ''))}">
      </div>

      <div class="field-error" id="cartError"></div>
      <button class="primary-btn" type="button" id="placeOrderBtn" ${!r.odprto_zdaj ? 'disabled' : ''}>Oddaj naročilo</button>
    `;

    document.getElementById('placeOrderBtn').addEventListener('click', placeOrder);
  }

  function setCartType(t) { cart.type = t; cart.timeSlot = ''; renderCartPanel(); }
  window.__setCartType = setCartType;
  function setCartPayment(p) { cart.payment = p; renderCartPanel(); }
  window.__setCartPayment = setCartPayment;

  async function placeOrder() {
    const errEl = document.getElementById('cartError');
    errEl.textContent = '';
    const name = document.getElementById('cartName').value.trim();
    const phone = document.getElementById('cartPhone').value.trim();
    const timeSlot = document.getElementById('cartTimeSlot').value;
    const addressEl = document.getElementById('cartAddress');
    const address = addressEl ? addressEl.value.trim() : '';
    cart.customerName = name; cart.phone = phone; cart.timeSlot = timeSlot; cart.address = address;

    if (!name) return (errEl.textContent = 'Vpišite ime in priimek.');
    if (!phone) return (errEl.textContent = 'Vpišite telefonsko številko.');
    if (!timeSlot) return (errEl.textContent = 'Izberite termin.');
    if (cart.type === 'dostava' && !address) return (errEl.textContent = 'Za dostavo vpišite naslov.');
    if (!cart.payment) return (errEl.textContent = 'Izberite način plačila.');

    const items = Object.values(cart.lines).map((l) => ({ item_id: l.itemId, qty: l.qty, variant_id: l.variantId || undefined, addon_ids: l.addonIds && l.addonIds.length ? l.addonIds : undefined }));
    if (!items.length) return (errEl.textContent = 'Košarica je prazna.');

    const btn = document.getElementById('placeOrderBtn');
    btn.disabled = true; btn.textContent = 'Oddajam...';
    try {
      const orderBody = {
        restaurant_id: currentRestaurant.id, customer_name: name, phone,
        type: cart.type, address: cart.type === 'dostava' ? address : undefined,
        time_slot: timeSlot, payment: cart.payment, items
      };
      const result = customerToken()
        ? await authedFetch('/orders', { method: 'POST', body: orderBody }, customerToken())
        : await apiFetch('/orders', { method: 'POST', body: orderBody });
      cart = { restaurantId: null, lines: {}, type: null, timeSlot: '', payment: '' };
      renderConfirm(result.order, result.vat, currentRestaurant.name);
      goToView('confirm');
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Oddaj naročilo';
    }
  }

  // ---------------- potrditev naročila ----------------
  let confirmTimer = null;
  function renderConfirm(order, vat, restaurantName) {
    clearInterval(confirmTimer);
    const cancelWindow = order.cancel_window_ms || 20000;
    const placedAt = new Date(order.placed_at || Date.now()).getTime();

    function draw() {
      const elapsed = Date.now() - placedAt;
      const remaining = Math.max(0, cancelWindow - elapsed);
      const canCancel = order.status === 'novo' && remaining > 0;
      const mm = Math.floor(remaining / 60000);
      const ss = Math.floor((remaining % 60000) / 1000);

      const grandTotal = vat ? vat.grandTotal : (order.items || []).reduce((s, i) => s + i.price * i.qty, 0) + Number(order.delivery_fee || 0);

      document.getElementById('confirmContent').innerHTML = `
        <div class="confirm-badge">&check;</div>
        <h1>Naročilo oddano</h1>
        <p class="section-sub" style="margin:6px 0 18px;">${esc(restaurantName)} je prejela vaše naročilo.</p>
        <div class="confirm-box">
          ${(order.items || []).map((i) => `<div class="confirm-row"><span>${i.qty}&times; ${esc(i.name)}${i.variant_name ? ' <span class="confirm-row-sub">(' + esc(i.variant_name) + ')</span>' : ''}${(i.addons && i.addons.length) ? '<br><span class="confirm-row-sub">+ ' + i.addons.map((a) => esc(a.name)).join(', ') + '</span>' : ''}</span><span>${eur(i.price * i.qty)}</span></div>`).join('')}
          ${order.delivery_fee ? `<div class="confirm-row"><span>Strošek dostave</span><span>${eur(order.delivery_fee)}</span></div>` : ''}
          <div class="confirm-row total"><span>Skupaj za plačilo</span><span>${eur(grandTotal)}</span></div>
          ${vat && vat.rows && vat.rows.length ? `
          <p class="cart-vat-note" style="text-align:left; margin-top:8px;">
            ${vat.rows.map((r) => `Od tega DDV ${r.rate}%: ${eur(r.ddv)} (osnova ${eur(r.osnova)})`).join('<br>')}
          </p>` : ''}
          <hr class="confirm-hr">
          <div class="confirm-row"><span>Način</span><span>${order.type === 'dostava' ? 'Dostava' : 'Prevzem'}</span></div>
          <div class="confirm-row"><span>Termin</span><span>${esc(order.time_slot)}</span></div>
          <div class="confirm-row"><span>Plačilo</span><span>${order.payment === 'kartica' ? 'Kartica' : 'Gotovina'} &middot; ob ${order.type === 'dostava' ? 'dostavi' : 'prevzemu'}</span></div>
          <p class="form-note" style="margin-top:14px;">Plačilo poteka neposredno pri gostilni. Mizica ne obdeluje plačil.</p>
        </div>
        ${canCancel ? `
          <button class="secondary-btn" style="margin-top:16px;" type="button" id="cancelOrderBtn">Prekliči naročilo (še ${mm}:${String(ss).padStart(2,'0')})</button>
        ` : (order.status === 'zavrnjeno' ? '<p class="warn-note" style="margin-top:16px;">Naročilo je bilo preklicano/zavrnjeno.</p>' : '')}
        <button class="link-btn" type="button" id="confirmBackBtn">Nazaj na ponudbo</button>
      `;
      const cancelBtn = document.getElementById('cancelOrderBtn');
      if (cancelBtn) cancelBtn.addEventListener('click', () => cancelOrderFlow(order, vat, restaurantName));
      document.getElementById('confirmBackBtn').addEventListener('click', () => { clearInterval(confirmTimer); goToView('market'); });

      if (remaining <= 0) clearInterval(confirmTimer);
    }
    draw();
    confirmTimer = setInterval(draw, 1000);
  }

  async function cancelOrderFlow(order, vat, restaurantName) {
    try {
      const updated = await apiFetch('/orders/' + order.id + '/cancel', { method: 'POST' });
      showToast('Naročilo preklicano.');
      renderConfirm(Object.assign({}, order, updated), vat, restaurantName);
    } catch (e) {
      showToast(e.message);
    }
  }

  // =================================================================
  // MOJ RAČUN (STRANKA)
  // =================================================================
  let customerSession = null;
  let customerOrders = [];
  let accountMode = 'login'; // 'login' | 'register'

  function customerToken() { return customerSession && customerSession.access_token; }
  function customerMeta() { return (customerSession && customerSession.user && customerSession.user.user_metadata) || {}; }

  async function initAccountView() {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      customerSession = data.session;
      await showAccountApp();
    } else {
      customerSession = null;
      showAccountLogin();
    }
  }

  function showAccountLogin() {
    document.getElementById('accountLoginWrap').style.display = 'block';
    document.getElementById('accountAppWrap').style.display = 'none';
  }

  async function showAccountApp() {
    document.getElementById('accountLoginWrap').style.display = 'none';
    document.getElementById('accountAppWrap').style.display = 'block';
    const meta = customerMeta();
    document.getElementById('accountWhoName').textContent = meta.ime || customerSession.user.email;
    document.getElementById('accountWhoSub').textContent = customerSession.user.email;
    renderAccountProfile();
    syncMyKrajFilterVisibility();
    renderMarket();
    document.getElementById('accountOrders').innerHTML = '<div class="loading-note">Nalagam naročila...</div>';
    try {
      customerOrders = await authedFetch('/customer/orders', {}, customerToken());
      renderAccountOrders();
    } catch (e) {
      document.getElementById('accountOrders').innerHTML = `<div class="error-note">Naročil ni bilo mogoče naložiti (${esc(e.message)}).</div>`;
    }
  }

  function renderAccountProfile() {
    const meta = customerMeta();
    const wrap = document.getElementById('accountProfile');
    wrap.innerHTML = `
      <div class="settings-block">
        <div class="settings-row"><span class="lbl">Ime in priimek</span><input class="text-input" style="max-width:220px;" value="${esc(meta.ime||'')}" onchange="window.__updateAccountMeta('ime',this.value)"></div>
        <div class="settings-row"><span class="lbl">Telefon</span><input class="text-input" style="max-width:220px;" value="${esc(meta.telefon||'')}" onchange="window.__updateAccountMeta('telefon',this.value)"></div>
        <div class="settings-row"><span class="lbl">Kraj</span><input class="text-input" style="max-width:220px;" value="${esc(meta.kraj||'')}" placeholder="npr. Brežice" list="siPlacesList" onchange="window.__updateAccountMeta('kraj',this.value)"></div>
        <p class="section-sub" id="accountKrajStatus" style="margin-top:4px;">${meta.kraj ? (meta.lat != null ? '' : 'Kraja ni bilo mogoče najti — filter "v bližini" ne bo deloval.') : ''}</p>
        <div id="accountNearbyWrap"></div>
      </div>
    `;
    renderAccountNearby();
  }

  // Gostilne v bližini shranjenega kraja stranke — prikažemo jih kar tu, na "Moj račun",
  // da ni treba za to posebej hoditi na Ponudbo in vklapljati filtra.
  function renderAccountNearby() {
    const wrap = document.getElementById('accountNearbyWrap');
    if (!wrap) return;
    const meta = customerMeta();
    if (meta.lat == null || meta.lng == null) { wrap.innerHTML = ''; return; }
    const myCoords = { lat: meta.lat, lng: meta.lng };

    const nearby = restaurants
      .map((r) => ({ r, d: distanceKm(myCoords, { lat: r.lat, lng: r.lng }) }))
      .filter((x) => x.d != null && x.d <= NEARBY_RADIUS_KM)
      .sort((a, b) => a.d - b.d);

    if (!restaurants.length) {
      wrap.innerHTML = `<p class="section-sub" style="margin-top:10px;">Nalagam gostilne...</p>`;
      return;
    }
    if (!nearby.length) {
      wrap.innerHTML = `<p class="section-sub" style="margin-top:10px;">V bližini (do ${NEARBY_RADIUS_KM} km) trenutno ni gostiln na Mizici.</p>`;
      return;
    }
    wrap.innerHTML = `
      <p class="section-sub" style="margin-top:14px; margin-bottom:8px;">Gostilne v bližini (do ${NEARBY_RADIUS_KM} km):</p>
      <div class="nearby-list">
        ${nearby.map(({ r, d }) => `
          <button type="button" class="nearby-row" onclick="window.__openRestaurant('${r.id}')">
            <span class="nearby-row-main">
              <span class="nearby-row-name">${esc(r.name)}</span>
              <span class="nearby-row-meta">${esc(r.kraj || '')} ${r.kuhinja ? '&middot; ' + esc(r.kuhinja) : ''}</span>
            </span>
            <span class="nearby-row-dist">${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  async function updateAccountMeta(field, value) {
    try {
      if (field === 'kraj') {
        const statusEl = document.getElementById('accountKrajStatus');
        if (statusEl) statusEl.textContent = 'Iščem kraj...';
        const updatedMeta = await authedFetch('/customer/profile', { method: 'PATCH', body: { kraj: value } }, customerToken());
        // Kraj/koordinati shranimo prek lastnega API-ja (ne prek sb.auth.updateUser), zato Supabase
        // seja v brskalniku (localStorage) o tem ne ve — brez osvežitve seje bi se ob naslednjem
        // obisku strani prikazali stari podatki (kraj bi bil spet prazen). refreshSession pridobi
        // nov žeton s trenutnimi podatki iz baze in ga tudi pravilno shrani.
        const { data: refreshed, error: refreshErr } = await sb.auth.refreshSession();
        if (!refreshErr && refreshed?.session) {
          customerSession = refreshed.session;
        } else {
          customerSession.user.user_metadata = updatedMeta;
        }
        if (statusEl) statusEl.textContent = updatedMeta.lat != null ? 'Kraj najden.' : 'Kraja ni bilo mogoče najti — filter "v bližini" ne bo deloval.';
      } else {
        const { data, error } = await sb.auth.updateUser({ data: Object.assign({}, customerMeta(), { [field]: value }) });
        if (error) throw error;
        customerSession.user = data.user;
      }
      showToast('Shranjeno.');
      syncMyKrajFilterVisibility();
      renderMarket();
      renderAccountNearby();
    } catch (e) {
      showToast(e.message);
    }
  }
  window.__updateAccountMeta = updateAccountMeta;

  const CUSTOMER_STATUS_LABEL = {
    novo: 'Novo', priprava: 'V pripravi', pripravljeno: 'Pripravljeno',
    prevzeto: 'Prevzeto/oddano', zavrnjeno: 'Zavrnjeno/preklicano'
  };

  function renderAccountOrders() {
    const wrap = document.getElementById('accountOrders');
    if (!customerOrders.length) { wrap.innerHTML = '<p class="empty-col">Še nimate naročil.</p>'; return; }
    wrap.innerHTML = customerOrders.map((o) => {
      const rest = o.restaurants || {};
      const total = o.vat ? o.vat.grandTotal : 0;
      const items = (o.order_items || []).map((i) => `${i.qty}&times; ${esc(i.name)}${i.variant_name ? ' (' + esc(i.variant_name) + ')' : ''}${(i.addons && i.addons.length) ? ' +' + i.addons.map((a) => esc(a.name)).join(', +') : ''}`).join(', ');
      const existingReview = Array.isArray(o.reviews) ? o.reviews[0] : o.reviews;
      let reviewHtml = '';
      if (o.status === 'prevzeto') {
        reviewHtml = existingReview
          ? `<div class="order-review-done"><span class="review-stars">${starsHtml(existingReview.rating)}</span> Ocenjeno</div>`
          : `<button class="secondary-btn" type="button" style="margin-top:8px;" onclick="window.__openReviewModal('${o.id}')">Ocenite naročilo</button>`;
      }
      return `
        <div class="order-card">
          <div class="order-card-top">
            <span class="order-id">${esc(rest.name || 'Gostilna')}</span>
            <span class="order-time">${new Date(o.placed_at).toLocaleString('sl-SI', { day:'2-digit', month:'2-digit', year:'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="order-meta-row">
            <span class="tag">${o.type === 'dostava' ? 'Dostava' : 'Prevzem'}</span>
            <span class="tag gold">${esc(CUSTOMER_STATUS_LABEL[o.status] || o.status)}</span>
          </div>
          <p class="order-items-line">${items}</p>
          <p class="order-total-line">${eur(total)}</p>
          ${reviewHtml}
        </div>
      `;
    }).join('');
  }

  // ---------------- ocenjevanje naročila ----------------
  let reviewRatingChoice = 0;
  function openReviewModal(orderId) {
    reviewRatingChoice = 0;
    openModal(`
      <h3>Ocenite naročilo</h3>
      <div class="review-star-picker" id="reviewStarPicker">
        ${[1,2,3,4,5].map((n) => `<button type="button" class="review-star-btn" data-n="${n}" onclick="window.__setReviewStar(${n})">☆</button>`).join('')}
      </div>
      <div class="field-group">
        <label class="field-label">Komentar (neobvezno)</label>
        <textarea class="text-input" id="reviewComment" rows="3" maxlength="1000"></textarea>
      </div>
      <div class="field-error" id="reviewError"></div>
      <div class="modal-close-row">
        <button class="secondary-btn" type="button" onclick="closeModal()">Prekliči</button>
        <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__submitReview('${orderId}')">Oddaj oceno</button>
      </div>
    `);
  }
  window.__openReviewModal = openReviewModal;

  function setReviewStar(n) {
    reviewRatingChoice = n;
    document.querySelectorAll('#reviewStarPicker .review-star-btn').forEach((btn) => {
      btn.textContent = Number(btn.dataset.n) <= n ? '★' : '☆';
    });
  }
  window.__setReviewStar = setReviewStar;

  async function submitReview(orderId) {
    const errEl = document.getElementById('reviewError');
    if (!reviewRatingChoice) { errEl.textContent = 'Izberite oceno (vsaj eno zvezdico).'; return; }
    const comment = document.getElementById('reviewComment').value.trim();
    try {
      await apiFetch('/orders/' + orderId + '/review', { method: 'POST', body: { rating: reviewRatingChoice, comment } });
      closeModal();
      showToast('Hvala za oceno!');
      customerOrders = await authedFetch('/customer/orders', {}, customerToken());
      renderAccountOrders();
    } catch (e) {
      errEl.textContent = e.message;
    }
  }
  window.__submitReview = submitReview;

  document.getElementById('accountToggleModeBtn').addEventListener('click', () => {
    accountMode = accountMode === 'login' ? 'register' : 'login';
    document.getElementById('accountFormTitle').textContent = accountMode === 'login' ? 'Prijava' : 'Registracija';
    document.getElementById('accountFormSub').textContent = accountMode === 'login'
      ? 'Prijavite se, da vidite zgodovino svojih naročil.'
      : 'Ustvarite račun — hitreje boste naročali in videli zgodovino naročil.';
    document.getElementById('accountRegisterFields').style.display = accountMode === 'register' ? 'block' : 'none';
    document.getElementById('accountSubmitBtn').textContent = accountMode === 'login' ? 'Prijava' : 'Registracija';
    document.getElementById('accountToggleModeBtn').textContent = accountMode === 'login' ? 'Nimate računa? Registrirajte se' : 'Že imate račun? Prijavite se';
    document.getElementById('accountLoginError').textContent = '';
  });

  document.getElementById('accountLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('accountLoginError');
    errEl.textContent = '';
    const email = document.getElementById('accountEmail').value.trim();
    const password = document.getElementById('accountPassword').value;
    try {
      if (accountMode === 'register') {
        const ime = document.getElementById('accountIme').value.trim();
        const telefon = document.getElementById('accountTelefon').value.trim();
        const kraj = document.getElementById('accountKraj').value.trim();
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { ime, telefon, kraj } } });
        if (error) throw error;
        customerSession = data.session;
        if (customerSession && kraj) {
          try {
            await authedFetch('/customer/profile', { method: 'PATCH', body: { kraj } }, customerToken());
            const { data: refreshed, error: refreshErr } = await sb.auth.refreshSession();
            if (!refreshErr && refreshed?.session) customerSession = refreshed.session;
          } catch (e) { /* tiho — geolociranje ni obvezno za delovanje računa */ }
        }
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        customerSession = data.session;
      }
      if (!customerSession) { errEl.textContent = 'Prijava ni uspela, poskusite znova.'; return; }
      showToast(accountMode === 'register' ? 'Račun ustvarjen — dobrodošli!' : 'Prijavljeni ste.');
      await showAccountApp();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('accountLogoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    customerSession = null;
    showAccountLogin();
    syncMyKrajFilterVisibility();
    renderMarket();
  });

  // =================================================================
  // OWNER (GOSTILNA)
  // =================================================================
  let ownerSession = null;
  let ownerRestaurant = null;
  let ownerMenu = [];
  let ownerOrders = [];
  let ownerInited = false;

  function ownerToken() { return ownerSession && ownerSession.access_token; }

  async function initOwnerView() {
    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      ownerSession = data.session;
      await showOwnerApp();
    } else {
      showOwnerLogin();
    }
    if (!ownerInited) {
      ownerInited = true;
      sb.auth.onAuthStateChange((event, session) => {
        if (currentView !== 'owner') return;
        if (session) { ownerSession = session; showOwnerApp(); }
        else { ownerSession = null; showOwnerLogin(); }
      });
    }
  }

  function showOwnerLogin() {
    document.getElementById('ownerLoginWrap').style.display = 'block';
    document.getElementById('ownerAppWrap').style.display = 'none';
  }

  document.getElementById('ownerLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('ownerEmail').value.trim();
    const password = document.getElementById('ownerPassword').value;
    const errEl = document.getElementById('ownerLoginError');
    errEl.textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { errEl.textContent = 'Napačna e-pošta ali geslo.'; return; }
    ownerSession = data.session;
    await showOwnerApp();
  });

  document.getElementById('ownerForgotBtn').addEventListener('click', async () => {
    const email = document.getElementById('ownerEmail').value.trim();
    if (!email) { showToast('Najprej vpišite e-pošto zgoraj.'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email);
    showToast(error ? 'Napaka: ' + error.message : 'Če e-pošta obstaja, boste prejeli povezavo za obnovitev gesla.');
  });

  document.getElementById('ownerLogoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    ownerSession = null; ownerRestaurant = null;
    showOwnerLogin();
  });
  document.getElementById('ownerRefreshBtn').addEventListener('click', () => loadOwnerData());

  async function showOwnerApp() {
    document.getElementById('ownerLoginWrap').style.display = 'none';
    document.getElementById('ownerAppWrap').style.display = 'block';
    await loadOwnerData();
  }

  async function loadOwnerData() {
    const token = ownerToken();
    if (!token) return;
    try {
      ownerRestaurant = await authedFetch('/owner/me', {}, token);
      document.getElementById('ownerWhoName').textContent = ownerRestaurant.name;
      document.getElementById('ownerWhoSub').textContent = ownerRestaurant.email || '';
      try {
        ownerMenu = await authedFetch('/owner/menu', {}, token);
      } catch (e) {
        // Če ta strežniška pot (še) ni na voljo, poskusimo javni prikaz menija (deluje le za aktivne gostilne).
        try {
          const pub = await apiFetch('/restaurants/' + ownerRestaurant.id);
          ownerMenu = pub.meni || [];
        } catch (e2) {
          ownerMenu = [];
        }
      }
      ownerOrders = await authedFetch('/owner/orders', {}, token);
      ownerKnownOrderIds = new Set(ownerOrders.map((o) => o.id));
      renderOwnerBoard();
      renderOwnerMenu();
      renderOwnerSettings();
    } catch (e) {
      showToast('Napaka pri nalaganju: ' + e.message);
    }
  }

  // ---------------- zvočno obvestilo in samodejno osveževanje naročil ----------------
  let audioCtx = null;
  function playAlertBeep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      [0, 0.4, 0.8, 1.2].forEach((offset) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = 900;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.37);
      });
    } catch (e) { /* zvok ni na voljo v tem brskalniku */ }
  }

  let ownerKnownOrderIds = null;
  async function pollOwnerOrders() {
    const token = ownerToken();
    if (!token) return;
    try {
      const orders = await authedFetch('/owner/orders', {}, token);
      const newOnes = ownerKnownOrderIds ? orders.filter((o) => o.status === 'novo' && !ownerKnownOrderIds.has(o.id)) : [];
      ownerOrders = orders;
      ownerKnownOrderIds = new Set(orders.map((o) => o.id));
      renderOwnerBoard();
      if (newOnes.length) {
        showToast(`🔔 Novo naročilo: ${newOnes.map((o) => o.customer_name).join(', ')}`);
      }
    } catch (e) {
      // tiho — napake pri osveževanju v ozadju ne prikazujemo, da ne motimo dela
    }
  }
  setInterval(() => { if (ownerSession) pollOwnerOrders(); }, 15000);

  // Alarm se ponavlja na nekaj sekund, dokler je vsaj eno naročilo v stanju "novo"
  // (dokler ga gostilna ne sprejme ali zavrne) — da ga zares opazijo, tudi če ne gledajo v zaslon.
  let alarmInterval = null;
  function updateAlarmState() {
    const hasNew = ownerOrders.some((o) => o.status === 'novo');
    if (hasNew && !alarmInterval) {
      playAlertBeep();
      alarmInterval = setInterval(playAlertBeep, 4000);
    } else if (!hasNew && alarmInterval) {
      clearInterval(alarmInterval);
      alarmInterval = null;
    }
  }

  const OWNER_STATUS_COLS = [
    ['novo', 'Novo'],
    ['priprava', 'V pripravi'],
    ['pripravljeno', 'Pripravljeno'],
    ['prevzeto', 'Prevzeto/oddano']
  ];
  const STATUS_NEXT_LABEL = { novo: 'Sprejmi', priprava: 'Pripravljeno', pripravljeno: 'Prevzeto/oddano' };

  // "Prevzeto/oddano" naročila se čez dan kopičijo — prikažemo jih samo zadnjih nekaj,
  // ostalo je na voljo z gumbom "Pokaži več" (ostanejo v analitiki/zgodovini, samo skrita so s pogleda).
  let prevzetoShowCount = 3;
  function showMorePrevzeto() { prevzetoShowCount += 10; renderOwnerBoard(); }
  window.__showMorePrevzeto = showMorePrevzeto;

  function renderOwnerBoard() {
    const board = document.getElementById('ownerBoard');
    board.innerHTML = OWNER_STATUS_COLS.map(([status, label]) => {
      const list = ownerOrders.filter((o) => o.status === status);
      if (status === 'prevzeto') {
        const shown = list.slice(0, prevzetoShowCount);
        return `
          <div class="board-col">
            <h4>${label} (${list.length})</h4>
            ${shown.length ? shown.map((o) => renderOwnerOrderCard(o)).join('') : '<p class="empty-col">Ni naročil.</p>'}
            ${list.length > shown.length ? `<button class="secondary-btn" type="button" style="width:100%; margin-top:8px;" onclick="window.__showMorePrevzeto()">Pokaži več (še ${list.length - shown.length})</button>` : ''}
          </div>
        `;
      }
      return `
        <div class="board-col">
          <h4>${label} (${list.length})</h4>
          ${list.length ? list.map((o) => renderOwnerOrderCard(o)).join('') : '<p class="empty-col">Ni naročil.</p>'}
        </div>
      `;
    }).join('');
    renderRejectedDropdown();
    updateAlarmState();
  }

  // Zavrnjena/preklicana naročila niso ves čas na strani (samo se kopičijo) — na voljo so
  // v zloženem meniju, ki ga gostilna odpre po potrebi.
  let rejectedOpen = false;
  function renderRejectedDropdown() {
    const rejected = ownerOrders.filter((o) => o.status === 'zavrnjeno');
    const btn = document.getElementById('rejectedToggleBtn');
    btn.textContent = `Zavrnjena/preklicana naročila (${rejected.length}) ${rejectedOpen ? '▲' : '▼'}`;
    const panel = document.getElementById('rejectedPanel');
    panel.style.display = rejectedOpen ? 'block' : 'none';
    if (rejectedOpen) {
      panel.innerHTML = `<div class="board-col" style="margin-top:10px;">${rejected.slice(0, 30).map((o) => renderOwnerOrderCard(o)).join('') || '<p class="empty-col">Ni naročil.</p>'}</div>`;
    }
  }
  document.getElementById('rejectedToggleBtn').addEventListener('click', () => {
    rejectedOpen = !rejectedOpen;
    renderRejectedDropdown();
  });

  function renderOwnerOrderCard(o) {
    const items = (o.order_items || []).map((i) => `${i.qty}&times; ${esc(i.name)}${i.variant_name ? ' (' + esc(i.variant_name) + ')' : ''}${(i.addons && i.addons.length) ? ' +' + i.addons.map((a) => esc(a.name)).join(', +') : ''}`).join(', ');
    const total = (o.order_items || []).reduce((s, i) => s + i.price * i.qty, 0) + Number(o.delivery_fee || 0);
    const next = STATUS_NEXT_LABEL[o.status];
    return `
      <div class="order-card ${o.status === 'novo' ? 'is-new' : ''}">
        <div class="order-card-top">
          <span class="order-id">${esc(o.customer_name)}</span>
          <span class="order-time">${new Date(o.placed_at).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="order-meta-row">
          <span class="tag">${o.type === 'dostava' ? 'Dostava' : 'Prevzem'}</span>
          <span class="tag">${o.payment === 'kartica' ? 'Kartica' : 'Gotovina'}</span>
          <span class="tag gold">${esc(o.time_slot || '')}</span>
        </div>
        <div class="order-items">${items}</div>
        ${o.address ? `<div class="order-items">Naslov: ${esc(o.address)}</div>` : ''}
        <div class="order-items">Tel: ${esc(o.phone)}</div>
        <div class="order-total">${eur(total)}</div>
        ${o.rejection_reason ? `<div class="order-reject">${esc(o.rejection_reason)}</div>` : ''}
        <div class="order-actions">
          ${next ? `<button class="mini-btn primary" type="button" onclick="window.__advanceOrder('${o.id}')">${next}</button>` : ''}
          ${next ? `<button class="mini-btn ghost" type="button" onclick="window.__rejectOrder('${o.id}')">Zavrni</button>` : ''}
          <button class="mini-btn ghost" type="button" onclick="window.__printOrder('${o.id}')">Natisni</button>
        </div>
      </div>
    `;
  }

  // ---------------- tiskanje naročila ----------------
  function printOrder(id) {
    const o = ownerOrders.find((x) => x.id === id);
    if (!o) return;
    const items = (o.order_items || []).map((i) => {
      const sub = [];
      if (i.variant_name) sub.push(esc(i.variant_name));
      if (i.addons && i.addons.length) sub.push('+ ' + i.addons.map((a) => esc(a.name)).join(', +'));
      return `<div class="p-line"><span>${i.qty}&times; ${esc(i.name)}${sub.length ? ' (' + sub.join(', ') + ')' : ''}</span><span>${eur(i.price * i.qty)}</span></div>`;
    }).join('');
    const total = (o.order_items || []).reduce((s, i) => s + i.price * i.qty, 0) + Number(o.delivery_fee || 0);
    const html = `<!DOCTYPE html><html lang="sl"><head><meta charset="UTF-8"><title>Naročilo — ${esc(o.customer_name)}</title>
      <style>
        @page { margin: 16mm; }
        * { box-sizing: border-box; }
        html, body { height: auto; }
        body{font-family:Arial, Helvetica, sans-serif; color:#111; margin:0 auto; padding:32px; font-size:22px; max-width:720px;}
        h2{margin:0 0 6px; font-size:2.4rem;}
        .p-sub{font-size:1.3rem; margin:0 0 26px; color:#444;}
        .p-line{display:flex; justify-content:space-between; gap:14px; font-size:1.4rem; padding:10px 0; border-bottom:1px dashed #ccc;}
        .p-total{display:flex; justify-content:space-between; font-weight:700; font-size:1.8rem; margin-top:20px; padding-top:16px; border-top:3px solid #111;}
        .p-meta{font-size:1.35rem; margin:6px 0;}
        .p-print-btn{display:block; margin:0 0 26px; padding:16px 24px; font-size:1.3rem; font-weight:700; background:#2f6b3f; color:#fff; border:none; border-radius:8px; cursor:pointer;}
        @media print { .p-print-btn{display:none;} }
      </style></head><body>
      <button class="p-print-btn" type="button" onclick="window.print()">Natisni / Shrani kot PDF</button>
      <h2>${esc(ownerRestaurant ? ownerRestaurant.name : 'Naročilo')}</h2>
      <p class="p-sub">${new Date(o.placed_at).toLocaleString('sl-SI', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</p>
      <p class="p-meta"><strong>${esc(o.customer_name)}</strong> &middot; Tel: ${esc(o.phone)}</p>
      <p class="p-meta">${o.type === 'dostava' ? 'Dostava' : 'Prevzem'} &middot; Termin: ${esc(o.time_slot || '')}</p>
      ${o.address ? `<p class="p-meta">Naslov: ${esc(o.address)}</p>` : ''}
      <p class="p-meta">Plačilo: ${o.payment === 'kartica' ? 'Kartica' : 'Gotovina'} ob ${o.type === 'dostava' ? 'dostavi' : 'prevzemu'}</p>
      <div style="margin-top:18px;">${items}</div>
      ${o.delivery_fee ? `<div class="p-line"><span>Strošek dostave</span><span>${eur(o.delivery_fee)}</span></div>` : ''}
      <div class="p-total"><span>Skupaj</span><span>${eur(total)}</span></div>
      </body></html>`;
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) { showToast('Brskalnik je blokiral pojavno okno — dovolite pojavna okna za natis.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
  window.__printOrder = printOrder;

  async function advanceOrder(id) {
    try {
      await authedFetch('/owner/orders/' + id + '/advance', { method: 'POST' }, ownerToken());
      await loadOwnerData();
    } catch (e) { showToast(e.message); }
  }
  window.__advanceOrder = advanceOrder;

  function rejectOrder(id) {
    openModal(`
      <h3>Zavrni naročilo</h3>
      <div class="field-group"><label class="field-label">Razlog (stranka ga bo videla)</label><textarea class="text-input" id="rejectReason" rows="3"></textarea></div>
      <div class="modal-close-row">
        <button class="secondary-btn" type="button" onclick="closeModal()">Prekliči</button>
        <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__confirmReject('${id}')">Zavrni naročilo</button>
      </div>
    `);
  }
  window.__rejectOrder = rejectOrder;

  async function confirmReject(id) {
    const reason = document.getElementById('rejectReason').value.trim();
    try {
      await authedFetch('/owner/orders/' + id + '/reject', { method: 'POST', body: { reason } }, ownerToken());
      closeModal();
      await loadOwnerData();
    } catch (e) { showToast(e.message); }
  }
  window.__confirmReject = confirmReject;

  // ---------------- owner: meni ----------------
  const SL_DAYS = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];
  function slDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return `${SL_DAYS[d.getDay()]}, ${d.toLocaleDateString('sl-SI')}`;
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function catTimeLabel(cat) {
    const parts = [];
    if (cat.je_malica) {
      const stale = cat.malica_datum && cat.malica_datum !== todayStr();
      parts.push(`<span class="pill-daily${stale ? ' pill-stale' : ''}">${cat.malica_datum ? slDateLabel(cat.malica_datum) : 'Malica'}${stale ? ' — morda ni več aktualno' : ''}</span>`);
    }
    if (cat.aktivna_od || cat.aktivna_do) {
      const od = cat.aktivna_od ? cat.aktivna_od.slice(0, 5) : '?';
      const doo = cat.aktivna_do ? cat.aktivna_do.slice(0, 5) : '?';
      parts.push(`<span class="pill-daily">Na voljo ${od}&ndash;${doo}</span>`);
    }
    return parts.join(' ');
  }

  function renderOwnerMenu() {
    const wrap = document.getElementById('ownerMenu');
    if (!ownerMenu.length) { wrap.innerHTML = '<p class="section-sub">Še ni kategorij. Dodajte prvo spodaj.</p>'; return; }
    wrap.innerHTML = ownerMenu.map((cat) => `
      <div class="mm-cat-head">
        <h4>${esc(cat.name)} ${catTimeLabel(cat)}</h4>
        <div class="mm-row-actions">
          <button class="secondary-btn" type="button" onclick="window.__addItemForm('${cat.id}')">+ Jed</button>
          <button class="icon-btn" type="button" title="Uredi kategorijo" onclick="window.__editCatForm('${cat.id}')">&#9998;</button>
          <button class="icon-btn" type="button" title="Izbriši kategorijo" onclick="window.__deleteCategory('${cat.id}')">&times;</button>
        </div>
      </div>
      <div id="editCatForm-${cat.id}"></div>
      <div id="addItemForm-${cat.id}"></div>
      ${(cat.menu_items || []).map((it) => renderOwnerMenuRow(it)).join('') || '<p class="section-sub" style="padding:6px 0;">Ni jedi.</p>'}
    `).join('');
  }

  function findOwnerCat(id) { return ownerMenu.find((c) => c.id === id) || null; }

  function editCatForm(catId) {
    document.querySelectorAll('[id^="editCatForm-"]').forEach((el) => (el.innerHTML = ''));
    const cat = findOwnerCat(catId);
    if (!cat) return;
    const wrap = document.getElementById('editCatForm-' + catId);
    wrap.innerHTML = `
      <div class="inline-form">
        <div class="field-group">
          <label class="field-label">Ime kategorije</label>
          <input class="text-input" id="ec-name-${catId}" value="${esc(cat.name)}">
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="field-group"><label class="field-label">Na voljo od</label><input class="num-input" style="width:100%;" type="time" id="ec-from-${catId}" value="${cat.aktivna_od ? cat.aktivna_od.slice(0,5) : ''}"></div>
          <div class="field-group"><label class="field-label">Na voljo do</label><input class="num-input" style="width:100%;" type="time" id="ec-to-${catId}" value="${cat.aktivna_do ? cat.aktivna_do.slice(0,5) : ''}"></div>
        </div>
        <p class="section-sub">Pustite prazno, če kategorija ni vezana na določeno uro.</p>
        <label class="chip-check" style="margin-top:4px;"><input type="checkbox" id="ec-malica-${catId}" ${cat.je_malica ? 'checked' : ''} onchange="window.__toggleEcMalica('${catId}')"> To je malica (dnevna ponudba z datumom)</label>
        <input class="num-input" type="date" id="ec-date-${catId}" style="display:${cat.je_malica ? '' : 'none'}; margin-top:8px;" value="${cat.malica_datum || ''}">
        <div class="field-error" id="ec-error-${catId}"></div>
        <div class="inline-form-actions">
          <button class="secondary-btn" type="button" onclick="window.__cancelCatForm('${catId}')">Prekliči</button>
          <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__saveCatForm('${catId}')">Shrani</button>
        </div>
      </div>
    `;
  }
  window.__editCatForm = editCatForm;

  function toggleEcMalica(catId) {
    const checked = document.getElementById('ec-malica-' + catId).checked;
    const dateEl = document.getElementById('ec-date-' + catId);
    dateEl.style.display = checked ? '' : 'none';
    if (checked && !dateEl.value) dateEl.value = todayStr();
  }
  window.__toggleEcMalica = toggleEcMalica;

  function cancelCatForm(catId) {
    const el = document.getElementById('editCatForm-' + catId);
    if (el) el.innerHTML = '';
  }
  window.__cancelCatForm = cancelCatForm;

  async function saveCatForm(catId) {
    const name = document.getElementById('ec-name-' + catId).value.trim();
    const aktivna_od = document.getElementById('ec-from-' + catId).value;
    const aktivna_do = document.getElementById('ec-to-' + catId).value;
    const je_malica = document.getElementById('ec-malica-' + catId).checked;
    const malica_datum = document.getElementById('ec-date-' + catId).value;
    const errEl = document.getElementById('ec-error-' + catId);
    if (!name) { errEl.textContent = 'Vpišite ime kategorije.'; return; }
    try {
      await authedFetch('/owner/menu/categories/' + catId, { method: 'PATCH', body: { name, aktivna_od: aktivna_od || null, aktivna_do: aktivna_do || null, je_malica, malica_datum: malica_datum || null } }, ownerToken());
      await loadOwnerData();
      showToast('Kategorija shranjena.');
    } catch (e) {
      errEl.textContent = e.message;
    }
  }
  window.__saveCatForm = saveCatForm;

  function renderOwnerMenuRow(it) {
    const vCount = (it.menu_item_variants || []).length;
    const aCount = (it.menu_item_addons || []).length;
    const optsLabel = (vCount || aCount) ? `Velikosti/dodatki (${vCount}/${aCount})` : 'Velikosti/dodatki';
    return `
      <div class="mm-row" id="mmrow-${it.id}">
        <div class="mm-name">
          ${it.photo_url ? `<img class="mm-photo" src="${esc(it.photo_url)}" alt="">` : ''}
          ${esc(it.name)} <span class="mi-ddv">${eur(it.price)} &middot; DDV ${it.vat_rate}%</span> ${it.daily ? '<span class="pill-daily">Dnevno</span>' : ''}
        </div>
        <div class="mm-row-actions">
          <button class="secondary-btn" type="button" onclick="window.__editVariantsAddonsForm('${it.id}')">${optsLabel}</button>
          <label class="switch"><input type="checkbox" ${it.available ? 'checked' : ''} onchange="window.__toggleItemAvailable('${it.id}', this.checked)"><span class="switch-track"></span><span class="switch-thumb"></span></label>
          <button class="icon-btn" type="button" title="Uredi" onclick="window.__editItemForm('${it.id}')">&#9998;</button>
          <button class="icon-btn" type="button" title="Izbriši" onclick="window.__deleteItem('${it.id}')">&times;</button>
        </div>
      </div>
      <div id="voaForm-${it.id}"></div>
    `;
  }

  // ---------------- owner: velikosti (variante) in dodatki jedi ----------------
  function voaRowHtml(kind, itemId, row, idx) {
    const key = kind + '-' + itemId + '-' + idx;
    return `
      <div class="voa-row" id="voarow-${key}" data-kind="${kind}">
        <input class="text-input" id="voa-name-${key}" placeholder="${kind === 'variant' ? 'Npr. Veliko' : 'Npr. Extra sir'}" value="${esc(row.name || '')}">
        <input class="num-input" id="voa-price-${key}" type="number" step="0.01" placeholder="Cena €" value="${row.price != null ? row.price : ''}">
        <button class="icon-btn" type="button" title="Odstrani" onclick="window.__removeVoaRow('${key}')">&times;</button>
      </div>
    `;
  }

  function editVariantsAddonsForm(itemId) {
    document.querySelectorAll('[id^="voaForm-"]').forEach((el) => (el.innerHTML = ''));
    const it = findOwnerItem(itemId);
    if (!it) return;
    const variants = (it.menu_item_variants || []).map((v) => ({ name: v.name, price: v.price }));
    const addons = (it.menu_item_addons || []).map((a) => ({ name: a.name, price: a.price }));
    const wrap = document.getElementById('voaForm-' + itemId);
    wrap.innerHTML = `
      <div class="inline-form">
        <h5 style="margin:0 0 6px;">Velikosti (npr. Malo / Veliko)</h5>
        <p class="section-sub" style="margin:0 0 8px;">Če dodate velikosti, bo stranka izbrala eno izmed njih namesto osnovne cene jedi.</p>
        <div id="voa-variants-${itemId}">${variants.map((v, i) => voaRowHtml('variant', itemId, v, i)).join('')}</div>
        <button class="secondary-btn" type="button" style="margin-top:6px;" onclick="window.__addVoaRow('variant','${itemId}')">+ Velikost</button>
        <h5 style="margin:16px 0 6px;">Dodatki (npr. extra sir)</h5>
        <p class="section-sub" style="margin:0 0 8px;">Stranka lahko izbere poljubno število dodatkov, vsak podraži naročilo za navedeni znesek.</p>
        <div id="voa-addons-${itemId}">${addons.map((a, i) => voaRowHtml('addon', itemId, a, i)).join('')}</div>
        <button class="secondary-btn" type="button" style="margin-top:6px;" onclick="window.__addVoaRow('addon','${itemId}')">+ Dodatek</button>
        <div class="field-error" id="voa-error-${itemId}"></div>
        <div class="inline-form-actions">
          <button class="secondary-btn" type="button" onclick="window.__cancelVoaForm('${itemId}')">Prekliči</button>
          <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__saveVoaForm('${itemId}')">Shrani</button>
        </div>
      </div>
    `;
  }
  window.__editVariantsAddonsForm = editVariantsAddonsForm;

  function cancelVoaForm(itemId) {
    const el = document.getElementById('voaForm-' + itemId);
    if (el) el.innerHTML = '';
  }
  window.__cancelVoaForm = cancelVoaForm;

  function addVoaRow(kind, itemId) {
    const listWrap = document.getElementById('voa-' + (kind === 'variant' ? 'variants' : 'addons') + '-' + itemId);
    const idx = listWrap.children.length;
    listWrap.insertAdjacentHTML('beforeend', voaRowHtml(kind, itemId, {}, idx));
  }
  window.__addVoaRow = addVoaRow;

  function removeVoaRow(key) {
    const el = document.getElementById('voarow-' + key);
    if (el) el.remove();
  }
  window.__removeVoaRow = removeVoaRow;

  function collectVoaRows(kind, itemId) {
    const listWrap = document.getElementById('voa-' + (kind === 'variant' ? 'variants' : 'addons') + '-' + itemId);
    const rows = [];
    listWrap.querySelectorAll('.voa-row').forEach((rowEl) => {
      const nameInput = rowEl.querySelector('input.text-input');
      const priceInput = rowEl.querySelector('input.num-input');
      const name = nameInput ? nameInput.value.trim() : '';
      const price = priceInput ? priceInput.value : '';
      if (name && !isNaN(parseFloat(price))) rows.push({ name, price: parseFloat(price) });
    });
    return rows;
  }

  async function saveVoaForm(itemId) {
    const errEl = document.getElementById('voa-error-' + itemId);
    const variants = collectVoaRows('variant', itemId);
    const addons = collectVoaRows('addon', itemId);
    try {
      await authedFetch('/owner/menu/items/' + itemId + '/variants', { method: 'PUT', body: { variants } }, ownerToken());
      await authedFetch('/owner/menu/items/' + itemId + '/addons', { method: 'PUT', body: { addons } }, ownerToken());
      await loadOwnerData();
      showToast('Velikosti in dodatki shranjeni.');
    } catch (e) {
      if (errEl) errEl.textContent = e.message; else showToast(e.message);
    }
  }
  window.__saveVoaForm = saveVoaForm;

  function findOwnerItem(id) {
    for (const cat of ownerMenu) {
      const it = (cat.menu_items || []).find((i) => i.id === id);
      if (it) return it;
    }
    return null;
  }

  function itemFormHtml(opts) {
    const it = opts.item || {};
    return `
      <div class="inline-form">
        <div class="form-grid">
          <input class="text-input" id="if-name-${opts.key}" placeholder="Ime jedi" value="${esc(it.name || '')}">
          <input class="text-input" id="if-price-${opts.key}" type="number" step="0.01" placeholder="Cena €" value="${it.price != null ? it.price : ''}">
          <select class="select-input" id="if-vat-${opts.key}">
            <option value="9.5" ${it.vat_rate == 9.5 ? 'selected' : ''}>DDV 9.5%</option>
            <option value="22" ${it.vat_rate == 22 ? 'selected' : ''}>DDV 22%</option>
          </select>
        </div>
        <div class="field-group">
          <input class="text-input" id="if-allergens-${opts.key}" placeholder="Alergeni (neobvezno)" value="${esc(it.allergens || '')}">
        </div>
        <div class="field-group">
          <label class="field-label">Fotografija jedi (neobvezno)</label>
          <div class="upload-row">
            ${it.photo_url ? `<img class="upload-preview" id="if-photo-preview-${opts.key}" src="${esc(it.photo_url)}" alt="">` : `<div class="thumb-empty" id="if-photo-preview-${opts.key}"></div>`}
            <label class="secondary-btn upload-btn-label">
              Naloži fotografijo
              <input type="file" accept="image/*" style="display:none;" onchange="window.__uploadPhotoFor('${opts.key}', this.files[0])">
            </label>
            <span class="section-sub" id="if-photo-status-${opts.key}"></span>
          </div>
          <input type="hidden" id="if-photo-${opts.key}" value="${esc(it.photo_url || '')}">
        </div>
        <label class="chip-check" style="margin-top:8px;"><input type="checkbox" id="if-daily-${opts.key}" ${it.daily ? 'checked' : ''}> Dnevna ponudba</label>
        <div class="field-error" id="if-error-${opts.key}"></div>
        <div class="inline-form-actions">
          <button class="secondary-btn" type="button" onclick="window.__cancelItemForm('${opts.key}')">Prekliči</button>
          <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__saveItemForm('${opts.categoryId || ''}','${opts.itemId || ''}','${opts.key}')">Shrani</button>
        </div>
      </div>
    `;
  }

  async function uploadPhotoFor(key, file) {
    if (!file) return;
    const statusEl = document.getElementById('if-photo-status-' + key);
    if (statusEl) statusEl.textContent = 'Nalagam...';
    try {
      const url = await uploadToStorage(file, ownerRestaurant.id);
      document.getElementById('if-photo-' + key).value = url;
      const preview = document.getElementById('if-photo-preview-' + key);
      if (preview) {
        const img = document.createElement('img');
        img.className = 'upload-preview';
        img.id = 'if-photo-preview-' + key;
        img.src = url;
        preview.replaceWith(img);
      }
      if (statusEl) statusEl.textContent = 'Naloženo.';
    } catch (e) {
      if (statusEl) statusEl.textContent = '';
      showToast('Napaka pri nalaganju slike: ' + e.message);
    }
  }
  window.__uploadPhotoFor = uploadPhotoFor;

  function addItemForm(categoryId) {
    document.querySelectorAll('[id^="addItemForm-"]').forEach((el) => (el.innerHTML = ''));
    document.getElementById('addItemForm-' + categoryId).innerHTML = itemFormHtml({ key: 'new-' + categoryId, categoryId });
  }
  window.__addItemForm = addItemForm;

  function editItemForm(itemId) {
    const it = findOwnerItem(itemId);
    if (!it) return;
    const row = document.getElementById('mmrow-' + itemId);
    row.insertAdjacentHTML('afterend', `<div id="editItemForm-${itemId}"></div>`);
    document.getElementById('editItemForm-' + itemId).innerHTML = itemFormHtml({ key: 'edit-' + itemId, itemId, item: it });
  }
  window.__editItemForm = editItemForm;

  function cancelItemForm(key) {
    if (key.startsWith('new-')) { document.getElementById('addItemForm-' + key.slice(4)).innerHTML = ''; return; }
    const itemId = key.slice(5);
    const el = document.getElementById('editItemForm-' + itemId);
    if (el) el.remove();
  }
  window.__cancelItemForm = cancelItemForm;

  async function saveItemForm(categoryId, itemId, key) {
    const name = document.getElementById('if-name-' + key).value.trim();
    const price = document.getElementById('if-price-' + key).value;
    const vat_rate = document.getElementById('if-vat-' + key).value;
    const allergens = document.getElementById('if-allergens-' + key).value.trim();
    const photo_url = document.getElementById('if-photo-' + key).value.trim();
    const daily = document.getElementById('if-daily-' + key).checked;
    const errEl = document.getElementById('if-error-' + key);
    if (!name || isNaN(parseFloat(price))) { errEl.textContent = 'Vpišite ime in veljavno ceno.'; return; }
    try {
      if (itemId) {
        await authedFetch('/owner/menu/items/' + itemId, { method: 'PATCH', body: { name, price, vat_rate, allergens, photo_url: photo_url || null, daily } }, ownerToken());
      } else {
        await authedFetch('/owner/menu/items', { method: 'POST', body: { category_id: categoryId, name, price, vat_rate, allergens, photo_url: photo_url || null, daily } }, ownerToken());
      }
      await loadOwnerData();
      showToast('Jed shranjena.');
    } catch (e) {
      errEl.textContent = e.message;
    }
  }
  window.__saveItemForm = saveItemForm;

  function toggleItemAvailable(itemId, available) {
    authedFetch('/owner/menu/items/' + itemId, { method: 'PATCH', body: { available } }, ownerToken())
      .then(() => loadOwnerData())
      .catch((e) => showToast(e.message));
  }
  window.__toggleItemAvailable = toggleItemAvailable;

  function deleteItem(itemId) {
    askConfirm('Izbriši jed', 'Ste prepričani, da želite izbrisati to jed iz menija?', async () => {
      try { await authedFetch('/owner/menu/items/' + itemId, { method: 'DELETE' }, ownerToken()); await loadOwnerData(); }
      catch (e) { showToast(e.message); }
    });
  }
  window.__deleteItem = deleteItem;

  function deleteCategory(catId) {
    askConfirm('Izbriši kategorijo', 'Kategorijo lahko izbrišete le, če je prazna.', async () => {
      try { await authedFetch('/owner/menu/categories/' + catId, { method: 'DELETE' }, ownerToken()); await loadOwnerData(); }
      catch (e) { showToast(e.message); }
    });
  }
  window.__deleteCategory = deleteCategory;

  document.getElementById('newCatMalica').addEventListener('change', function () {
    document.getElementById('newCatDate').style.display = this.checked ? '' : 'none';
    document.getElementById('newCatMalicaNote').style.display = this.checked ? '' : 'none';
    if (this.checked && !document.getElementById('newCatDate').value) {
      document.getElementById('newCatDate').value = new Date().toISOString().slice(0, 10);
    }
  });

  document.getElementById('addCatBtn').addEventListener('click', async () => {
    const input = document.getElementById('newCatName');
    const fromInput = document.getElementById('newCatFrom');
    const toInput = document.getElementById('newCatTo');
    const malicaBox = document.getElementById('newCatMalica');
    const dateInput = document.getElementById('newCatDate');
    const name = input.value.trim();
    if (!name) { showToast('Vpišite ime kategorije.'); return; }
    try {
      await authedFetch('/owner/menu/categories', {
        method: 'POST',
        body: { name, aktivna_od: fromInput.value || null, aktivna_do: toInput.value || null, je_malica: malicaBox.checked, malica_datum: dateInput.value || null }
      }, ownerToken());
      input.value = ''; fromInput.value = ''; toInput.value = '';
      malicaBox.checked = false; dateInput.value = ''; dateInput.style.display = 'none';
      document.getElementById('newCatMalicaNote').style.display = 'none';
      await loadOwnerData();
    } catch (e) { showToast(e.message); }
  });

  // ---------------- owner: nastavitve ----------------
  function renderOwnerSettings() {
    const r = ownerRestaurant;
    const wrap = document.getElementById('ownerSettings');
    wrap.innerHTML = `
      <div class="settings-block">
        <h4>Delovni čas in kapaciteta</h4>
        <div class="settings-row"><span class="lbl">Odpre</span><input class="num-input" style="width:100px;" type="time" value="${(r.odpira_od||'').slice(0,5)}" onchange="window.__updateOwnerSetting('odpira_od',this.value)"></div>
        <div class="settings-row"><span class="lbl">Zapre</span><input class="num-input" style="width:100px;" type="time" value="${(r.odpira_do||'').slice(0,5)}" onchange="window.__updateOwnerSetting('odpira_do',this.value)"></div>
        <div class="settings-row"><span class="lbl">Naročil na termin (max.)</span><input class="num-input" type="number" step="1" value="${r.max_per_slot}" onchange="window.__updateOwnerSetting('max_per_slot',this.value)"></div>
        <div class="settings-row"><span class="lbl">E-pošta</span><input class="text-input" style="max-width:220px;" type="email" value="${esc(r.email||'')}" onchange="window.__updateOwnerSetting('email',this.value)"></div>
        <div class="settings-row" style="align-items:flex-start;"><span class="lbl" style="padding-top:8px;">Naslov</span><input class="text-input" style="max-width:220px;" value="${esc(r.address||'')}" placeholder="Ulica in hišna št., pošta" onchange="window.__updateOwnerSetting('address',this.value)"></div>
        <h4 style="margin-top:18px;">Zaprti dnevi</h4>
        <div class="closed-dates" id="closedDatesWrap">${(r.closedDates||[]).map((d) => `<span class="closed-chip">${d}<button type="button" onclick="window.__removeClosedDate('${d}')">&times;</button></span>`).join('') || '<span class="section-sub">Trenutno ni zaprtih dni.</span>'}</div>
        <div class="add-date-row"><input class="text-input" type="date" id="newClosedDate"><button class="secondary-btn" type="button" onclick="window.__addClosedDate()">Dodaj</button></div>
      </div>
      <div class="settings-block">
        <h4>Prevzem in dostava</h4>
        <div class="pay-matrix">
          <div class="pay-matrix-row">
            <label class="checkbox-item"><input type="checkbox" ${r.prevzem_enabled?'checked':''} onchange="window.__updateOwnerSetting('prevzem_enabled',this.checked)"> Prevzem omogočen</label>
            <div class="checkbox-row">
              <label class="checkbox-item"><input type="checkbox" ${r.prevzem_gotovina?'checked':''} onchange="window.__updateOwnerSetting('prevzem_gotovina',this.checked)"> Gotovina</label>
              <label class="checkbox-item"><input type="checkbox" ${r.prevzem_kartica?'checked':''} onchange="window.__updateOwnerSetting('prevzem_kartica',this.checked)"> Kartica</label>
            </div>
          </div>
          <div class="pay-matrix-row">
            <label class="checkbox-item"><input type="checkbox" ${r.dostava_enabled?'checked':''} onchange="window.__updateOwnerSetting('dostava_enabled',this.checked)"> Dostava omogočena</label>
            <div class="checkbox-row">
              <label class="checkbox-item"><input type="checkbox" ${r.dostava_gotovina?'checked':''} onchange="window.__updateOwnerSetting('dostava_gotovina',this.checked)"> Gotovina</label>
              <label class="checkbox-item"><input type="checkbox" ${r.dostava_kartica?'checked':''} onchange="window.__updateOwnerSetting('dostava_kartica',this.checked)"> Kartica</label>
            </div>
          </div>
          <div class="pay-matrix-row"><span class="lbl">Min. znesek dostave</span><div><input class="num-input" type="number" step="0.5" value="${r.dostava_min_znesek}" onchange="window.__updateOwnerSetting('dostava_min_znesek',this.value)"> &euro;</div></div>
          <div class="pay-matrix-row"><span class="lbl">Strošek dostave</span><div><input class="num-input" type="number" step="0.5" value="${r.dostava_strosek}" onchange="window.__updateOwnerSetting('dostava_strosek',this.value)"> &euro;</div></div>
        </div>
      </div>
      <div class="settings-block">
        <h4>Javna povezava do vaše ponudbe</h4>
        <p class="section-sub" style="margin-bottom:8px;">To povezavo delite na družbenih omrežjih ali kjerkoli drugje — stranke pridejo neposredno na vaš meni.</p>
        <div class="share-link-row">
          <input class="text-input" style="flex:1;" type="text" readonly id="shareLinkInput" value="${esc(shareLinkFor(r.id))}">
          <button class="secondary-btn" type="button" onclick="window.__copyShareLink()">Kopiraj povezavo</button>
        </div>
      </div>
      <div class="settings-block">
        <h4>Logotip gostilne</h4>
        <p class="section-sub" style="margin-bottom:8px;">Prikaže se na kartici gostilne in pri naročanju.</p>
        <div class="upload-row">
          ${r.logo_url ? `<img class="upload-preview round" id="logoPreview" src="${esc(r.logo_url)}" alt="">` : `<div class="thumb-empty" id="logoPreview" style="border-radius:50%;"></div>`}
          <label class="secondary-btn upload-btn-label">
            Naloži logotip
            <input type="file" accept="image/*" style="display:none;" onchange="window.__uploadLogo(this.files[0])">
          </label>
          <span class="section-sub" id="logoUploadStatus"></span>
        </div>
      </div>
    `;
  }

  function shareLinkFor(restaurantId) {
    return `${window.location.origin}${window.location.pathname}?r=${restaurantId}`;
  }
  function copyShareLink() {
    const input = document.getElementById('shareLinkInput');
    if (!input) return;
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      showToast('Povezava kopirana.');
    }).catch(() => {
      showToast('Kopiranje ni uspelo — povezavo izberite ročno.');
    });
  }
  window.__copyShareLink = copyShareLink;

  async function uploadLogo(file) {
    if (!file) return;
    const statusEl = document.getElementById('logoUploadStatus');
    if (statusEl) statusEl.textContent = 'Nalagam...';
    try {
      const url = await uploadToStorage(file, ownerRestaurant.id);
      const updated = await authedFetch('/owner/restaurant', { method: 'PATCH', body: { logo_url: url } }, ownerToken());
      ownerRestaurant = updated;
      const preview = document.getElementById('logoPreview');
      if (preview) {
        const img = document.createElement('img');
        img.className = 'upload-preview round';
        img.id = 'logoPreview';
        img.src = url;
        preview.replaceWith(img);
      }
      if (statusEl) statusEl.textContent = 'Naloženo.';
    } catch (e) {
      if (statusEl) statusEl.textContent = '';
      showToast('Napaka pri nalaganju logotipa: ' + e.message);
    }
  }
  window.__uploadLogo = uploadLogo;

  function updateOwnerSetting(field, value) {
    authedFetch('/owner/restaurant', { method: 'PATCH', body: { [field]: value } }, ownerToken())
      .then((data) => { ownerRestaurant = data; showToast('Shranjeno.'); })
      .catch((e) => showToast(e.message));
  }
  window.__updateOwnerSetting = updateOwnerSetting;

  function addClosedDate() {
    const input = document.getElementById('newClosedDate');
    if (!input.value) return;
    authedFetch('/owner/closed-dates', { method: 'POST', body: { date: input.value } }, ownerToken())
      .then(async () => { ownerRestaurant = await authedFetch('/owner/me', {}, ownerToken()); const cd = ownerRestaurant.closedDates || []; })
      .then(() => loadOwnerData())
      .catch((e) => showToast(e.message));
  }
  window.__addClosedDate = addClosedDate;

  function removeClosedDate(date) {
    authedFetch('/owner/closed-dates/' + date, { method: 'DELETE' }, ownerToken())
      .then(() => loadOwnerData())
      .catch((e) => showToast(e.message));
  }
  window.__removeClosedDate = removeClosedDate;

  // =================================================================
  // ADMIN
  // =================================================================
  let adminSession = null;
  let adminRestaurants = [];
  let adminMonth = null;
  let adminAnalytics = null;
  let adminInited = false;
  let adminSort = { field: 'promet', dir: 'desc' };

  function adminToken() { return adminSession && adminSession.access_token; }

  async function initAdminView() {
    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      const ok = await checkIsAdmin(data.session.access_token);
      if (ok) { adminSession = data.session; await showAdminApp(); }
      else showAdminLogin();
    } else {
      showAdminLogin();
    }
    if (!adminInited) {
      adminInited = true;
      document.querySelectorAll('.admin-subnav button').forEach((b) => {
        b.addEventListener('click', () => {
          document.querySelectorAll('.admin-subnav button').forEach((x) => x.classList.remove('active'));
          document.querySelectorAll('.atab').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          document.getElementById('atab-' + b.dataset.atab).classList.add('active');
        });
      });
      document.getElementById('monthSelect').addEventListener('change', () => { adminMonth = document.getElementById('monthSelect').value; loadAnalytics(); });
      document.getElementById('adminSearchInput').addEventListener('input', renderAdminRestaurantTable);
    }
  }

  async function checkIsAdmin(token) {
    try { await authedFetch('/admin/restaurants', {}, token); return true; }
    catch (e) { return false; }
  }

  function showAdminLogin() {
    document.getElementById('adminLoginWrap').style.display = 'block';
    document.getElementById('adminAppWrap').style.display = 'none';
  }

  document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;
    const errEl = document.getElementById('adminLoginError');
    errEl.textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { errEl.textContent = 'Napačna e-pošta ali geslo.'; return; }
    const ok = await checkIsAdmin(data.session.access_token);
    if (!ok) { errEl.textContent = 'Ta uporabnik nima skrbniških pravic.'; await sb.auth.signOut(); return; }
    adminSession = data.session;
    await showAdminApp();
  });

  document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    adminSession = null;
    showAdminLogin();
  });

  async function showAdminApp() {
    document.getElementById('adminLoginWrap').style.display = 'none';
    document.getElementById('adminAppWrap').style.display = 'block';
    document.getElementById('adminWhoName').textContent = adminSession.user.email;
    populateMonthSelect();
    await Promise.all([loadAdminRestaurants(), loadAnalytics()]);
  }

  function monthKey(offset) {
    const d = new Date();
    d.setMonth(d.getMonth() - offset);
    return d.toISOString().slice(0, 7);
  }
  function monthLabel(key) {
    const [y, m] = key.split('-');
    const names = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
    return names[parseInt(m, 10) - 1] + ' ' + y;
  }
  function populateMonthSelect() {
    const sel = document.getElementById('monthSelect');
    if (sel.options.length) return;
    const keys = [3, 2, 1, 0].map((n) => monthKey(n));
    sel.innerHTML = keys.map((k) => `<option value="${k}">${monthLabel(k)}${k === monthKey(0) ? ' (tekoči)' : ''}</option>`).join('');
    adminMonth = monthKey(0);
    sel.value = adminMonth;
  }

  async function loadAdminRestaurants() {
    try {
      adminRestaurants = await authedFetch('/admin/restaurants', {}, adminToken());
      renderAdminRestaurantTable();
    } catch (e) { showToast(e.message); }
  }

  function renderAdminRestaurantTable() {
    const q = (document.getElementById('adminSearchInput').value || '').toLowerCase().trim();
    const list = adminRestaurants.filter((r) => !q || (r.name || '').toLowerCase().includes(q) || (r.kraj || '').toLowerCase().includes(q));
    document.getElementById('adminTableBody').innerHTML = list.map((r) => `
      <tr>
        <td>${esc(r.name)}</td>
        <td>${esc(r.kraj || '')}</td>
        <td>${esc(r.email || '—')}</td>
        <td><span class="status-pill ${r.aktivna ? 'active' : 'inactive'}">${r.aktivna ? 'Aktivna' : 'Neaktivna'}</span></td>
        <td class="billing-line">${billingText(r)}</td>
        <td class="td-actions">
          <button class="secondary-btn on-dark-btn" type="button" onclick="window.__openBillingModal('${r.id}')">Obračun</button>
          <button class="secondary-btn on-dark-btn" type="button" onclick="window.__openSetPasswordModal('${r.id}')">Nastavi geslo</button>
          <button class="secondary-btn on-dark-btn" type="button" onclick="window.__toggleActive('${r.id}',${!r.aktivna})">${r.aktivna ? 'Deaktiviraj' : 'Aktiviraj'}</button>
        </td>
      </tr>
    `).join('');
  }

  function billingText(r) {
    if (r.billing_model === 'najemnina') return `Naročnina ${eur(r.najemnina)}/mes.`;
    if (r.billing_model === 'provizija') return `Provizija ${r.provizija}%`;
    return `Naročnina ${eur(r.najemnina)}/mes.<div class="sub">+ provizija ${r.provizija}%</div>`;
  }

  function toggleActive(id, aktivna) {
    authedFetch('/admin/restaurants/' + id, { method: 'PATCH', body: { aktivna } }, adminToken())
      .then(() => loadAdminRestaurants())
      .catch((e) => showToast(e.message));
  }
  window.__toggleActive = toggleActive;

  function openBillingModal(id) {
    const r = adminRestaurants.find((x) => x.id === id);
    if (!r) return;
    openModal(`
      <h3>Obračun &middot; ${esc(r.name)}</h3>
      <div class="radio-row" style="margin-bottom:14px;">
        <label class="radio-item"><input type="radio" name="editBillingModel" value="najemnina" ${r.billing_model === 'najemnina' ? 'checked' : ''}> Naročnina</label>
        <label class="radio-item"><input type="radio" name="editBillingModel" value="provizija" ${r.billing_model === 'provizija' ? 'checked' : ''}> Provizija</label>
        <label class="radio-item"><input type="radio" name="editBillingModel" value="oboje" ${r.billing_model === 'oboje' ? 'checked' : ''}> Oboje</label>
      </div>
      <div class="form-grid">
        <div class="form-field"><label>Naročnina (&euro;/mesec)</label><input class="text-input" id="editNajemnina" type="number" step="1" value="${r.najemnina}"></div>
        <div class="form-field"><label>Provizija (%)</label><input class="text-input" id="editProvizija" type="number" step="0.5" value="${r.provizija}"></div>
      </div>
      <div class="modal-close-row">
        <button class="secondary-btn" type="button" onclick="closeModal()">Prekliči</button>
        <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__saveBilling('${id}')">Shrani</button>
      </div>
    `);
  }
  window.__openBillingModal = openBillingModal;

  function saveBilling(id) {
    const billing_model = document.querySelector('input[name="editBillingModel"]:checked').value;
    const najemnina = parseFloat(document.getElementById('editNajemnina').value) || 0;
    const provizija = parseFloat(document.getElementById('editProvizija').value) || 0;
    authedFetch('/admin/restaurants/' + id + '/billing', { method: 'PATCH', body: { billing_model, najemnina, provizija } }, adminToken())
      .then(() => { closeModal(); loadAdminRestaurants(); showToast('Obračun posodobljen.'); })
      .catch((e) => showToast(e.message));
  }
  window.__saveBilling = saveBilling;

  function openSetPasswordModal(id) {
    const r = adminRestaurants.find((x) => x.id === id);
    if (!r) return;
    openModal(`
      <h3>Nastavi geslo &middot; ${esc(r.name)}</h3>
      <p>Geslo boste morali gostilni sporočiti sami (npr. po telefonu ali osebno). E-pošta ob tem ne bo poslana.</p>
      <div class="field-group"><label class="field-label">Novo geslo</label><input class="text-input" type="text" id="setPwInput" placeholder="Vsaj 6 znakov"></div>
      <div class="field-error" id="setPwError"></div>
      <div class="modal-close-row">
        <button class="secondary-btn" type="button" onclick="closeModal()">Prekliči</button>
        <button class="mini-btn primary" style="flex:none; padding:9px 16px;" type="button" onclick="window.__confirmSetPassword('${id}')">Nastavi geslo</button>
      </div>
    `);
  }
  window.__openSetPasswordModal = openSetPasswordModal;

  async function confirmSetPassword(id) {
    const pw = document.getElementById('setPwInput').value.trim();
    const errEl = document.getElementById('setPwError');
    if (!pw || pw.length < 6) { errEl.textContent = 'Geslo mora imeti vsaj 6 znakov.'; return; }
    try {
      await authedFetch('/admin/restaurants/' + id + '/set-password', { method: 'POST', body: { password: pw } }, adminToken());
      closeModal();
      showToast('Geslo nastavljeno. Sporočite ga gostilni.');
    } catch (e) {
      errEl.textContent = e.message;
    }
  }
  window.__confirmSetPassword = confirmSetPassword;

  async function loadAnalytics() {
    if (!adminMonth) adminMonth = monthKey(0);
    try {
      adminAnalytics = await authedFetch('/admin/analytics?month=' + adminMonth, {}, adminToken());
      renderAnalytics();
    } catch (e) { showToast(e.message); }
  }

  function renderAnalytics() {
    const a = adminAnalytics;
    const totalPromet = a.results.reduce((s, x) => s + x.promet, 0);
    const totalNarocila = a.results.reduce((s, x) => s + x.narocila, 0);
    const unpaidCount = a.results.filter((x) => !x.placano).length;

    document.getElementById('statRow').innerHTML = `
      <div class="stat-tile"><div class="stat-num">${eur(a.total_earning)}</div><div class="stat-label">Vaš zaslužek &middot; ${monthLabel(adminMonth)}</div></div>
      <div class="stat-tile"><div class="stat-num">${eur(totalPromet)}</div><div class="stat-label">Skupni promet gostiln</div></div>
      <div class="stat-tile"><div class="stat-num">${totalNarocila}</div><div class="stat-label">Naročil v mesecu</div></div>
      <div class="stat-tile"><div class="stat-num">${unpaidCount}</div><div class="stat-label">Neplačanih gostiln</div></div>
    `;

    const sorted = a.results.slice().sort((x, y) => (adminSort.dir === 'desc' ? y[adminSort.field] - x[adminSort.field] : x[adminSort.field] - y[adminSort.field]));
    document.getElementById('monthlyTableBody').innerHTML = sorted.map((x) => `
      <tr>
        <td>${esc(x.name)}</td>
        <td>${eur(x.promet)}</td>
        <td>${x.narocila}</td>
        <td>${eur(x.earning)}</td>
        <td><span class="status-pill ${x.placano ? 'active' : 'warn'}">${x.placano ? 'Plačano' : 'Neplačano'}</span></td>
        <td class="td-actions">
          <button class="secondary-btn on-dark-btn" type="button" onclick="window.__togglePaid('${x.restaurant_id}')">${x.placano ? 'Neplačano' : 'Plačano'}</button>
          <button class="secondary-btn on-dark-btn" type="button" onclick="window.__printBilling('${x.restaurant_id}')">Natisni obračun</button>
        </td>
      </tr>
    `).join('');
  }

  function togglePaid(restaurantId) {
    authedFetch('/admin/restaurants/' + restaurantId + '/toggle-paid?month=' + adminMonth, { method: 'POST' }, adminToken())
      .then(() => loadAnalytics())
      .catch((e) => showToast(e.message));
  }
  window.__togglePaid = togglePaid;

  // ---------------- tiskanje / PDF obračuna ----------------
  const SERVICE_DDV = 22; // DDV na strošek platforme (naročnina/provizija), enako kot na strežniku (business.js)

  function printHtml(title, subtitle, bodyHtml) {
    document.getElementById('printArea').innerHTML = `
      <div class="print-doc-title">${esc(title)}</div>
      <div class="print-doc-sub">${esc(subtitle)}</div>
      ${bodyHtml}
      <p class="print-foot">Mizica — plačila potekajo vedno neposredno med stranko in gostilno; ta obračun se nanaša izključno na strošek uporabe platforme.</p>
    `;
    window.print();
  }

  function billingModelLabel(model) {
    if (model === 'najemnina') return 'Naročnina';
    if (model === 'provizija') return 'Provizija';
    return 'Naročnina + provizija';
  }

  function printBilling(restaurantId) {
    const x = (adminAnalytics?.results || []).find((r) => r.restaurant_id === restaurantId);
    const r = adminRestaurants.find((rr) => rr.id === restaurantId);
    if (!x || !r) { showToast('Podatki za obračun niso na voljo.'); return; }

    const feeOsnova = x.earning;
    const feeDdv = feeOsnova * SERVICE_DDV / 100;
    const feeTotal = feeOsnova + feeDdv;

    const rows = [];
    rows.push(`<tr><td>Promet gostilne (z DDV, vključno z dostavo)</td><td>${eur(x.promet)}</td></tr>`);
    rows.push(`<tr><td>Neto prodaja hrane/pijače (brez DDV, brez dostave)</td><td>${eur(x.osnova)}</td></tr>`);
    rows.push(`<tr><td>Število naročil</td><td>${x.narocila}</td></tr>`);
    rows.push(`<tr><td>Obračunski model</td><td>${billingModelLabel(r.billing_model)}</td></tr>`);
    if (r.billing_model === 'najemnina' || r.billing_model === 'oboje') rows.push(`<tr><td>Naročnina</td><td>${eur(r.najemnina)}</td></tr>`);
    if (r.billing_model === 'provizija' || r.billing_model === 'oboje') rows.push(`<tr><td>Provizija (${r.provizija}% od neto prodaje hrane/pijače)</td><td>${eur(x.osnova * r.provizija / 100)}</td></tr>`);
    rows.push(`<tr><td>Osnova za vaš račun</td><td>${eur(feeOsnova)}</td></tr>`);
    rows.push(`<tr><td>DDV ${SERVICE_DDV}%</td><td>${eur(feeDdv)}</td></tr>`);
    rows.push(`<tr class="print-total-row"><td>Skupaj za plačilo</td><td>${eur(feeTotal)}</td></tr>`);

    const body = `
      <table class="print-table"><tbody>${rows.join('')}</tbody></table>
      <p style="margin-top:14px; font-size:.8rem; color:#0b2f6b; font-weight:600;">Status: ${x.placano ? 'Plačano' : 'Neplačano'}</p>
    `;
    printHtml('Obračun · Mizica', `${r.name} · ${monthLabel(adminMonth)}`, body);
  }
  window.__printBilling = printBilling;

  document.getElementById('addRestaurantForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('addRestaurantError');
    errEl.textContent = '';
    const body = {
      name: document.getElementById('newName').value.trim(),
      kraj: document.getElementById('newKraj').value.trim(),
      kuhinja: document.getElementById('newKuhinja').value.trim(),
      email: document.getElementById('newEmail').value.trim(),
      password: document.getElementById('newPassword').value.trim() || undefined,
      odpira_od: document.getElementById('newOd').value,
      odpira_do: document.getElementById('newDo').value,
      max_per_slot: parseInt(document.getElementById('newMaxSlot').value, 10) || 6,
      billing_model: document.querySelector('input[name="billingModel"]:checked').value,
      najemnina: parseFloat(document.getElementById('newNajemnina').value) || 0,
      provizija: parseFloat(document.getElementById('newProvizija').value) || 0
    };
    if (!body.name || !body.kraj || !body.email) { errEl.textContent = 'Izpolnite ime, kraj in e-pošto.'; return; }
    try {
      await authedFetch('/admin/restaurants', { method: 'POST', body }, adminToken());
      e.target.reset();
      showToast(body.password ? `Gostilna "${body.name}" dodana. Geslo sporočite gostilni sami.` : `Gostilna "${body.name}" dodana. Lastnik je prejel povabilo po e-pošti.`);
      await loadAdminRestaurants();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // ---------------- zagon: ločene "povezave" za ponudbo / gostilne / skrbnika ----------------
  // Privzeto (npr. mizica-frontend.onrender.com) je viden samo javni meni ponudbe.
  // Gostilne in skrbnik dostopajo prek svoje lastne povezave (?gostilna oz. ?skrbnik),
  // ki jo dobijo neposredno od nas — v splošni navigaciji ni vidna.
  const startParams = new URLSearchParams(window.location.search);
  const shareRestaurantId = startParams.get('r');
  const wantsOwner = startParams.has('gostilna');
  const wantsAdmin = startParams.has('skrbnik');

  if (wantsOwner || pendingAuthType) document.getElementById('navOwnerBtn').style.display = '';
  if (wantsAdmin) document.getElementById('navAdminBtn').style.display = '';
  // Če je uporabnik kliknil povezavo za nastavitev/obnovitev gesla, ne vemo vnaprej, ali je
  // lastnik gostilne ali skrbnik — pokažemo oba zavihka, da lahko izbere pravega.
  if (pendingAuthType) document.getElementById('navAdminBtn').style.display = '';

  // Če je stranka že prijavljena od prej (isti brskalnik), to zaznamo ob zagonu,
  // da se takoj prikažeta filter "Samo iz mojega kraja" in prednapolnjeni podatki pri naročilu.
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session && !pendingAuthType) {
      customerSession = data.session;
      syncMyKrajFilterVisibility();
      renderMarket();
    }
  })();

  // Predlogi krajev (za "Kraj" pri stranki in gostilni) — naložimo enkrat ob zagonu,
  // da brskalnik lahko med tipkanjem sam ponuja ujemajoče se kraje (nativni <datalist>).
  fetch('./places.json').then((r) => r.json()).then((names) => {
    const list = document.getElementById('siPlacesList');
    if (!list) return;
    list.innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  }).catch(() => {});

  loadMarket();
  if (shareRestaurantId) {
    openRestaurant(shareRestaurantId);
  } else if (wantsAdmin) {
    goToView('admin');
  } else if (wantsOwner || pendingAuthType) {
    goToView('owner');
  }
})();
