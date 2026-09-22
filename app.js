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

  function renderMarket() {
    const q = (document.getElementById('marketSearch').value || '').toLowerCase().trim();
    const kuhinja = document.getElementById('marketKuhinja').value;
    const onlyOpen = document.getElementById('marketOnlyOpen').checked;

    const list = restaurants.filter((r) => {
      if (q && !((r.name || '').toLowerCase().includes(q) || (r.kraj || '').toLowerCase().includes(q))) return false;
      if (kuhinja && r.kuhinja !== kuhinja) return false;
      if (onlyOpen && !r.odprto_zdaj) return false;
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

  // =================================================================
  // RESTAVRACIJA + KOŠARICA
  // =================================================================
  let currentRestaurant = null; // polni objekt iz GET /restaurants/:id
  let cart = { restaurantId: null, lines: {}, type: null, timeSlot: '', payment: '' };

  function cartCount() {
    return Object.values(cart.lines).reduce((s, q) => s + q, 0);
  }

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

    const menuHtml = (r.meni || []).map((cat) => `
      <div class="menu-cat">
        <h3>${esc(cat.name)}</h3>
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
              ${r.address ? `<p class="rd-address">${esc(r.address)}</p><a class="map-link-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}">Odpri na zemljevidu</a>` : ''}
            </div>
          </div>
        </div>
      </div>
      ${!r.odprto_zdaj ? '<div class="closed-banner">Gostilna trenutno ne sprejema naročil (zaprto ali izven delovnega časa).</div>' : ''}
      <div class="rd-body">
        <div>${menuHtml}</div>
        <div class="cart-panel" id="cartPanel"></div>
      </div>
    `;
    renderCartPanel();
  }

  function renderMenuItemRow(it) {
    const qty = cart.lines[it.id] || 0;
    const unavailable = !it.available;
    return `
      <div class="menu-item ${unavailable ? 'mi-unavailable' : ''}">
        <div class="mi-row-inner">
          ${it.photo_url ? `<img class="mi-photo" src="${esc(it.photo_url)}" alt="">` : ''}
          <div>
            <div class="mi-name">${esc(it.name)} ${it.daily ? '<span class="pill-daily">Dnevno</span>' : ''}</div>
            <div class="mi-price-row"><span class="mi-price">${eur(it.price)}</span><span class="mi-ddv">DDV ${it.vat_rate}%</span></div>
            ${it.allergens ? `<div class="mi-allergens">Alergeni: ${esc(it.allergens)}</div>` : ''}
            ${unavailable ? '<div class="mi-unavailable-label">Trenutno ni na voljo</div>' : ''}
          </div>
        </div>
        ${unavailable ? '' : (qty > 0
          ? `<div class="mi-stepper"><button type="button" onclick="window.__changeQty('${it.id}',-1)">&minus;</button><span>${qty}</span><button type="button" onclick="window.__changeQty('${it.id}',1)">+</button></div>`
          : `<button class="mi-add" type="button" onclick="window.__changeQty('${it.id}',1)">+</button>`)}
      </div>
    `;
  }

  function changeQty(itemId, delta) {
    const cur = cart.lines[itemId] || 0;
    const next = Math.max(0, cur + delta);
    if (next === 0) delete cart.lines[itemId]; else cart.lines[itemId] = next;
    renderRestaurant();
  }
  window.__changeQty = changeQty;

  function renderCartPanel() {
    const panel = document.getElementById('cartPanel');
    if (!panel) return;
    const r = currentRestaurant;
    const lines = Object.entries(cart.lines).map(([id, qty]) => {
      const it = findMenuItem(id);
      return it ? { name: it.name, qty, price: it.price, vat_rate: it.vat_rate } : null;
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
      ${lines.map((l) => `<div class="cart-line"><span class="name">${l.qty}&times; ${esc(l.name)}</span><span>${eur(l.price * l.qty)}</span></div>`).join('')}
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
        <input class="text-input" id="cartName" value="${esc(cart.customerName || '')}">
      </div>
      <div class="field-group">
        <label class="field-label">Telefon</label>
        <input class="text-input" id="cartPhone" type="tel" value="${esc(cart.phone || '')}">
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

    const items = Object.entries(cart.lines).map(([item_id, qty]) => ({ item_id, qty }));
    if (!items.length) return (errEl.textContent = 'Košarica je prazna.');

    const btn = document.getElementById('placeOrderBtn');
    btn.disabled = true; btn.textContent = 'Oddajam...';
    try {
      const result = await apiFetch('/orders', {
        method: 'POST',
        body: {
          restaurant_id: currentRestaurant.id, customer_name: name, phone,
          type: cart.type, address: cart.type === 'dostava' ? address : undefined,
          time_slot: timeSlot, payment: cart.payment, items
        }
      });
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
    const cancelWindow = order.cancel_window_ms || 120000;
    const placedAt = new Date(order.placed_at || Date.now()).getTime();

    function draw() {
      const elapsed = Date.now() - placedAt;
      const remaining = Math.max(0, cancelWindow - elapsed);
      const canCancel = order.status === 'novo' && remaining > 0;
      const mm = Math.floor(remaining / 60000);
      const ss = Math.floor((remaining % 60000) / 1000);

      document.getElementById('confirmContent').innerHTML = `
        <div class="confirm-badge">&check;</div>
        <h1>Naročilo oddano</h1>
        <p class="section-sub" style="margin:6px 0 18px;">${esc(restaurantName)} je prejela vaše naročilo.</p>
        <div class="confirm-box">
          ${(order.items || []).map((i) => `<div class="confirm-row"><span>${i.qty}&times; ${esc(i.name)}</span><span>${eur(i.price * i.qty)}</span></div>`).join('')}
          ${order.delivery_fee ? `<div class="confirm-row"><span>Strošek dostave</span><span>${eur(order.delivery_fee)}</span></div>` : ''}
          <div class="confirm-row total"><span>Skupaj za plačilo</span><span>${eur(vat ? vat.total : 0)}</span></div>
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
      if (cancelBtn) cancelBtn.addEventListener('click', () => cancelOrderFlow(order, restaurantName));
      document.getElementById('confirmBackBtn').addEventListener('click', () => { clearInterval(confirmTimer); goToView('market'); });

      if (remaining <= 0) clearInterval(confirmTimer);
    }
    draw();
    confirmTimer = setInterval(draw, 1000);
  }

  async function cancelOrderFlow(order, restaurantName) {
    try {
      const updated = await apiFetch('/orders/' + order.id + '/cancel', { method: 'POST' });
      showToast('Naročilo preklicano.');
      renderConfirm(Object.assign({}, order, updated), null, restaurantName);
    } catch (e) {
      showToast(e.message);
    }
  }

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
      renderOwnerBoard();
      renderOwnerMenu();
      renderOwnerSettings();
    } catch (e) {
      showToast('Napaka pri nalaganju: ' + e.message);
    }
  }

  const OWNER_STATUS_COLS = [
    ['novo', 'Novo'],
    ['priprava', 'V pripravi'],
    ['pripravljeno', 'Pripravljeno'],
    ['prevzeto', 'Prevzeto/oddano']
  ];
  const STATUS_NEXT_LABEL = { novo: 'Sprejmi', priprava: 'Pripravljeno', pripravljeno: 'Prevzeto/oddano' };

  function renderOwnerBoard() {
    const board = document.getElementById('ownerBoard');
    board.innerHTML = OWNER_STATUS_COLS.map(([status, label]) => {
      const list = ownerOrders.filter((o) => o.status === status);
      return `
        <div class="board-col">
          <h4>${label} (${list.length})</h4>
          ${list.length ? list.map((o) => renderOwnerOrderCard(o)).join('') : '<p class="empty-col">Ni naročil.</p>'}
        </div>
      `;
    }).join('') + `
      <div class="board-col">
        <h4>Zavrnjeno/preklicano (${ownerOrders.filter((o) => o.status === 'zavrnjeno').length})</h4>
        ${ownerOrders.filter((o) => o.status === 'zavrnjeno').slice(0, 8).map((o) => renderOwnerOrderCard(o)).join('') || '<p class="empty-col">Ni naročil.</p>'}
      </div>
    `;
  }

  function renderOwnerOrderCard(o) {
    const items = (o.order_items || []).map((i) => `${i.qty}&times; ${esc(i.name)}`).join(', ');
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
        ${next ? `
        <div class="order-actions">
          <button class="mini-btn primary" type="button" onclick="window.__advanceOrder('${o.id}')">${next}</button>
          <button class="mini-btn ghost" type="button" onclick="window.__rejectOrder('${o.id}')">Zavrni</button>
        </div>` : ''}
      </div>
    `;
  }

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
  function renderOwnerMenu() {
    const wrap = document.getElementById('ownerMenu');
    if (!ownerMenu.length) { wrap.innerHTML = '<p class="section-sub">Še ni kategorij. Dodajte prvo spodaj.</p>'; return; }
    wrap.innerHTML = ownerMenu.map((cat) => `
      <div class="mm-cat-head">
        <h4>${esc(cat.name)}</h4>
        <div class="mm-row-actions">
          <button class="secondary-btn" type="button" onclick="window.__addItemForm('${cat.id}')">+ Jed</button>
          <button class="icon-btn" type="button" title="Izbriši kategorijo" onclick="window.__deleteCategory('${cat.id}')">&times;</button>
        </div>
      </div>
      <div id="addItemForm-${cat.id}"></div>
      ${(cat.menu_items || []).map((it) => renderOwnerMenuRow(it)).join('') || '<p class="section-sub" style="padding:6px 0;">Ni jedi.</p>'}
    `).join('');
  }

  function renderOwnerMenuRow(it) {
    return `
      <div class="mm-row" id="mmrow-${it.id}">
        <div class="mm-name">
          ${it.photo_url ? `<img class="mm-photo" src="${esc(it.photo_url)}" alt="">` : ''}
          ${esc(it.name)} <span class="mi-ddv">${eur(it.price)} &middot; DDV ${it.vat_rate}%</span> ${it.daily ? '<span class="pill-daily">Dnevno</span>' : ''}
        </div>
        <div class="mm-row-actions">
          <label class="switch"><input type="checkbox" ${it.available ? 'checked' : ''} onchange="window.__toggleItemAvailable('${it.id}', this.checked)"><span class="switch-track"></span><span class="switch-thumb"></span></label>
          <button class="icon-btn" type="button" title="Uredi" onclick="window.__editItemForm('${it.id}')">&#9998;</button>
          <button class="icon-btn" type="button" title="Izbriši" onclick="window.__deleteItem('${it.id}')">&times;</button>
        </div>
      </div>
    `;
  }

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
          <input class="text-input" id="if-photo-${opts.key}" placeholder="Povezava do fotografije (URL, neobvezno)" value="${esc(it.photo_url || '')}">
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

  document.getElementById('addCatBtn').addEventListener('click', async () => {
    const input = document.getElementById('newCatName');
    const name = input.value.trim();
    if (!name) { showToast('Vpišite ime kategorije.'); return; }
    try {
      await authedFetch('/owner/menu/categories', { method: 'POST', body: { name } }, ownerToken());
      input.value = '';
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
        <h4>Logotip gostilne</h4>
        <p class="section-sub" style="margin-bottom:8px;">Vnesite povezavo (URL) do slike vašega logotipa.</p>
        <div class="field-group"><input class="text-input" value="${esc(r.logo_url||'')}" placeholder="https://..." onchange="window.__updateOwnerSetting('logo_url',this.value)"></div>
      </div>
    `;
  }

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
        <td class="td-actions"><button class="secondary-btn on-dark-btn" type="button" onclick="window.__togglePaid('${x.restaurant_id}')">${x.placano ? 'Neplačano' : 'Plačano'}</button></td>
      </tr>
    `).join('');
  }

  function togglePaid(restaurantId) {
    authedFetch('/admin/restaurants/' + restaurantId + '/toggle-paid?month=' + adminMonth, { method: 'POST' }, adminToken())
      .then(() => loadAnalytics())
      .catch((e) => showToast(e.message));
  }
  window.__togglePaid = togglePaid;

  document.getElementById('addRestaurantForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('addRestaurantError');
    errEl.textContent = '';
    const body = {
      name: document.getElementById('newName').value.trim(),
      kraj: document.getElementById('newKraj').value.trim(),
      kuhinja: document.getElementById('newKuhinja').value.trim(),
      email: document.getElementById('newEmail').value.trim(),
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
      showToast(`Gostilna "${body.name}" dodana. Lastnik je prejel povabilo po e-pošti.`);
      await loadAdminRestaurants();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // ---------------- zagon ----------------
  loadMarket();
})();
