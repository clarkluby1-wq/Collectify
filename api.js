// Thin client for the Apps Script backend. GET uses query params (no
// preflight); POST sends text/plain so it also stays a "simple request" —
// Apps Script's doPost parses the JSON body itself.
const Api = {
  cfg() {
    const stored = JSON.parse(localStorage.getItem('collectify_settings') || '{}');
    return {
      url: stored.url || window.COLLECTIFY_CONFIG.APPS_SCRIPT_URL,
      secret: stored.secret !== undefined ? stored.secret : window.COLLECTIFY_CONFIG.SHARED_SECRET
    };
  },

  async get(action, params = {}) {
    const { url } = this.cfg();
    if (!url) throw new Error('Set your Apps Script URL in Settings first.');
    const qs = new URLSearchParams({ action, ...params });
    const resp = await fetch(`${url}?${qs.toString()}`);
    return resp.json();
  },

  async post(action, payload = {}) {
    const { url, secret } = this.cfg();
    if (!url) throw new Error('Set your Apps Script URL in Settings first.');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, secret, ...payload })
    });
    return resp.json();
  },

  list(category) { return this.get('list', category ? { category } : {}); },
  search(q) { return this.get('search', { q }); },
  getByBarcode(barcode) { return this.get('getByBarcode', { barcode }); },
  add(item) { return this.post('add', { item }); },
  update(id, item) { return this.post('update', { id, item }); },
  remove(id) { return this.post('delete', { id }); },
  lookupBarcode(barcode, category) { return this.post('lookupBarcode', { barcode, category }); }
};
