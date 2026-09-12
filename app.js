const app = document.getElementById('app');
const tabs = document.querySelectorAll('.tab');
let html5QrCode = null;
let editingId = null;

function render(tplId) {
  app.innerHTML = '';
  app.appendChild(document.getElementById(tplId).content.cloneNode(true));
}

function setActiveTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
}

function goTo(tab) {
  setActiveTab(tab);
  if (tab === 'scan') return renderScan();
  if (tab === 'inventory') return renderInventory();
  if (tab === 'add') return renderAdd(null);
  if (tab === 'settings') return renderSettings();
}

tabs.forEach(t => t.addEventListener('click', () => goTo(t.dataset.tab)));
document.getElementById('settingsBtn').addEventListener('click', () => goTo('settings'));

// ---------- Scan ----------
function renderScan() {
  render('tpl-scan');
  document.getElementById('startScanBtn').addEventListener('click', startScanner);
  document.getElementById('stopScanBtn').addEventListener('click', stopScanner);
  document.getElementById('manualBarcodeForm').addEventListener('submit', e => {
    e.preventDefault();
    const val = document.getElementById('manualBarcodeInput').value.trim();
    if (val) handleScannedCode(val);
  });
}

function startScanner() {
  document.getElementById('startScanBtn').hidden = true;
  document.getElementById('stopScanBtn').hidden = false;
  html5QrCode = new Html5Qrcode('reader', {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.QR_CODE
    ],
    verbose: false
  });
  html5QrCode.start(
    { facingMode: 'environment' },
    {
      fps: 10,
      qrbox: { width: 280, height: 140 },
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    },
    decodedText => {
      stopScanner();
      handleScannedCode(decodedText);
    },
    () => {}
  ).catch(err => {
    document.getElementById('scanResult').innerHTML =
      `<p class="error">Camera error: ${err}. Try the manual barcode field, or check that this page is served over HTTPS (or localhost) with camera permission granted.</p>`;
  });
}

function stopScanner() {
  document.getElementById('startScanBtn').hidden = false;
  document.getElementById('stopScanBtn').hidden = true;
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }
}

async function handleScannedCode(barcode) {
  const resultEl = document.getElementById('scanResult');
  resultEl.innerHTML = '<p>Checking your collection…</p>';
  try {
    const owned = await Api.getByBarcode(barcode);
    if (owned.item) {
      resultEl.innerHTML = ownedCardHtml(owned.item, barcode);
      return;
    }
    resultEl.innerHTML = '<p>Not in your collection yet. Looking up details…</p>';
    const lookup = await Api.lookupBarcode(barcode, '');
    resultEl.innerHTML = notOwnedCardHtml(barcode, lookup.result);
    document.getElementById('addFromScanBtn')?.addEventListener('click', () => {
      renderAdd(null, { barcode, ...(lookup.result || {}) });
      setActiveTab('add');
    });
  } catch (err) {
    resultEl.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function ownedCardHtml(item, barcode) {
  return `
    <div class="result-card owned">
      <strong>✅ Already in your collection</strong>
      ${item.coverImageUrl ? `<img src="${item.coverImageUrl}" alt="">` : ''}
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.creator || '')}</p>
      <p class="muted">${escapeHtml(item.category)} · ${escapeHtml(item.format || '')} · ${escapeHtml(item.condition || '')}</p>
      <p class="muted">Barcode: ${escapeHtml(barcode)}</p>
    </div>`;
}

function notOwnedCardHtml(barcode, meta) {
  const title = meta && meta.title ? escapeHtml(meta.title) : '(no online match found)';
  const creator = meta && meta.creator ? escapeHtml(meta.creator) : '';
  const cover = meta && meta.coverImageUrl ? `<img src="${meta.coverImageUrl}" alt="">` : '';
  return `
    <div class="result-card not-owned">
      <strong>🆕 Not in your collection</strong>
      ${cover}
      <h3>${title}</h3>
      <p>${creator}</p>
      <p class="muted">Barcode: ${escapeHtml(barcode)}</p>
      <button id="addFromScanBtn" class="primary-btn">Add to Collection</button>
    </div>`;
}

// ---------- Inventory ----------
async function renderInventory() {
  render('tpl-inventory');
  const listEl = document.getElementById('itemList');
  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');

  async function refresh() {
    listEl.innerHTML = '<p>Loading…</p>';
    try {
      const q = searchInput.value.trim();
      const data = q ? await Api.search(q) : await Api.list(categoryFilter.value);
      let items = data.items || [];
      if (q && categoryFilter.value) items = items.filter(i => i.category === categoryFilter.value);
      listEl.innerHTML = items.length ? items.map(itemRowHtml).join('') : '<p class="muted">No items found.</p>';

      listEl.querySelectorAll('.item-row').forEach(row => {
        enableSwipeToDelete(row, () => {
          const item = items.find(i => i.id === row.dataset.editId);
          renderAdd(item.id, item);
          setActiveTab('add');
        });
      });
      listEl.querySelectorAll('[data-delete-id]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this item?')) return;
          const res = await Api.remove(btn.dataset.deleteId);
          if (!res.ok) return alert(res.error || 'Failed to delete item.');
          refresh();
        }));
    } catch (err) {
      listEl.innerHTML = `<p class="error">${err.message}</p>`;
    }
  }

  searchInput.addEventListener('input', debounce(refresh, 300));
  categoryFilter.addEventListener('change', refresh);
  refresh();
}

function itemRowHtml(item) {
  return `
    <div class="item-row-wrap">
      <button class="item-row-delete" data-delete-id="${item.id}">Delete</button>
      <div class="item-row" data-edit-id="${item.id}">
        ${item.coverImageUrl ? `<img src="${item.coverImageUrl}" alt="">` : '<div class="cover-placeholder"></div>'}
        <div>
          <div class="item-title">${escapeHtml(item.title)}</div>
          <div class="muted">${escapeHtml(item.creator || '')}</div>
          <div class="muted small">${escapeHtml(item.category)} · ${escapeHtml(item.format || '')}</div>
        </div>
      </div>
    </div>`;
}

let openSwipeRow = null;

function enableSwipeToDelete(row, onTap) {
  const OPEN_X = -80;
  let startX = 0, dx = 0, dragging = false, moved = false;

  function closeRow(r) { r.style.transform = 'translateX(0)'; }

  row.addEventListener('pointerdown', e => {
    if (openSwipeRow && openSwipeRow !== row) closeRow(openSwipeRow);
    dragging = true;
    moved = false;
    startX = e.clientX;
    row.style.transition = 'none';
  });

  row.addEventListener('pointermove', e => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    if (Math.abs(delta) > 6) moved = true;
    dx = Math.min(0, Math.max(OPEN_X, delta));
    row.style.transform = `translateX(${dx}px)`;
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    row.style.transition = 'transform 0.2s ease';
    const settled = dx < OPEN_X / 2 ? OPEN_X : 0;
    row.style.transform = `translateX(${settled}px)`;
    openSwipeRow = settled === OPEN_X ? row : null;
  }
  row.addEventListener('pointerup', endDrag);
  row.addEventListener('pointercancel', endDrag);
  row.addEventListener('pointerleave', () => { if (dragging) endDrag(); });

  row.addEventListener('click', () => {
    if (moved) return;
    onTap();
  });
}

// ---------- Add / Edit ----------
function renderAdd(id, prefill) {
  render('tpl-add');
  editingId = id || null;
  const form = document.getElementById('itemForm');
  const deleteBtn = document.getElementById('deleteItemBtn');

  document.getElementById('itemId').value = id || '';
  if (prefill) {
    if (prefill.category) document.getElementById('f-category').value = prefill.category;
    document.getElementById('f-title').value = prefill.title || '';
    document.getElementById('f-creator').value = prefill.creator || '';
    document.getElementById('f-details').value = prefill.details || '';
    document.getElementById('f-barcode').value = prefill.barcode || '';
    document.getElementById('f-format').value = prefill.format || '';
    document.getElementById('f-condition').value = prefill.condition || '';
    document.getElementById('f-purchaseDate').value = prefill.purchaseDate || '';
    document.getElementById('f-purchasePrice').value = prefill.purchasePrice || '';
    document.getElementById('f-coverImageUrl').value = prefill.coverImageUrl || '';
    document.getElementById('f-notes').value = prefill.notes || '';
  }

  deleteBtn.hidden = !id;
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this item?')) return;
    const res = await Api.remove(id);
    if (!res.ok) return alert(res.error || 'Failed to delete item.');
    goTo('inventory');
  });

  document.getElementById('scanCoverBtn').addEventListener('click', () => {
    document.getElementById('coverPhotoInput').click();
  });
  document.getElementById('coverPhotoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('coverOcrStatus');
    statusEl.innerHTML = '<p>Reading cover text… this can take 10-20 seconds the first time.</p>';
    try {
      const { data: { text } } = await Tesseract.recognize(file, 'eng');
      const cleaned = text.trim();
      statusEl.innerHTML = cleaned
        ? `<p class="muted">Extracted text — review it, then copy anything useful into the fields above:</p><pre>${escapeHtml(cleaned)}</pre>`
        : '<p class="muted">No text detected — try a clearer, well-lit, straight-on photo.</p>';

      const issueMatch = cleaned.match(/#\s?(\d+)/);
      if (issueMatch && !document.getElementById('f-details').value) {
        document.getElementById('f-details').value = 'Issue #' + issueMatch[1];
      }
      if (!document.getElementById('f-title').value) {
        const bestLine = cleaned.split('\n').map(l => l.trim())
          .filter(l => l.length > 3 && !/^#?\d/.test(l))
          .sort((a, b) => b.length - a.length)[0];
        if (bestLine) document.getElementById('f-title').value = bestLine;
      }
    } catch (err) {
      statusEl.innerHTML = `<p class="error">OCR failed: ${err.message}</p>`;
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const item = {
      category: document.getElementById('f-category').value,
      title: document.getElementById('f-title').value,
      creator: document.getElementById('f-creator').value,
      details: document.getElementById('f-details').value,
      barcode: document.getElementById('f-barcode').value,
      format: document.getElementById('f-format').value,
      condition: document.getElementById('f-condition').value,
      purchaseDate: document.getElementById('f-purchaseDate').value,
      purchasePrice: document.getElementById('f-purchasePrice').value,
      coverImageUrl: document.getElementById('f-coverImageUrl').value,
      notes: document.getElementById('f-notes').value
    };
    try {
      const res = editingId ? await Api.update(editingId, item) : await Api.add(item);
      if (!res.ok) return alert(res.error || 'Failed to save item.');
      goTo('inventory');
    } catch (err) {
      alert(err.message);
    }
  });
}

// ---------- Settings ----------
function renderSettings() {
  render('tpl-settings');
  const { url, secret } = Api.cfg();
  document.getElementById('s-url').value = url || '';
  document.getElementById('s-secret').value = secret || '';
  document.getElementById('settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    localStorage.setItem('collectify_settings', JSON.stringify({
      url: document.getElementById('s-url').value.trim(),
      secret: document.getElementById('s-secret').value.trim()
    }));
    goTo('scan');
  });
}

// ---------- Utils ----------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

goTo('scan');
