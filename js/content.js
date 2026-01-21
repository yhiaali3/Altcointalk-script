// canonical single-copy content.js, duplicates removed
// js/content.js
// Combined content script: early-inject (prevents FOUC) + Altcointalks extension logic.
// Make sure this file path matches manifest and that css/altcoinstalks/custom.css exists in your extension.

// Minimal early-inject guard: prevent double injection and top-frame only.
(function earlyInject() {
    try {
        if (window !== window.top) return;
        if (window.__altcoinstalks_early_injected) return;
        window.__altcoinstalks_early_injected = true;
        // Intentionally minimal: do not use async/await or external helpers here.
        // This avoids introducing syntax errors in environments where the
        // editor may contain unsaved async changes.
    } catch (err) {
        console.error('early-inject error', err);
        try { if (document && document.documentElement) document.documentElement.style.visibility = ''; } catch (e) { /* ignore */ }
    }
})();

// Small helper: fetch with timeout to avoid hanging requests
function fetchWithTimeout(resource, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const opts = Object.assign({}, options, { signal: controller.signal });
    return fetch(resource, opts).finally(() => clearTimeout(id));
}

// Inject a small page-context script to force links/buttons to open in the same tab
(function preventNewTabInjection() {
    try {
        const scriptUrl = chrome.runtime.getURL('js/injected-page.js');
        const s = document.createElement('script');
        s.src = scriptUrl;
        s.onload = function () { try { this.remove(); } catch (e) { } };
        (document.documentElement || document.head || document.body).appendChild(s);
    } catch (e) { /* ignore injection failures */ }
})();
// Inject page interceptor for capturing "Insert Quote" clicks (Altcointalk)
(function injectAltPageInterceptor() {
    try {
        const scriptUrl = chrome.runtime.getURL('js/page-inject.js');
        const s = document.createElement('script');
        s.src = scriptUrl;
        s.type = 'text/javascript';
        s.async = false;
        s.onload = function () { try { this.remove(); } catch (e) { } };
        (document.documentElement || document.head || document.body).appendChild(s);
    } catch (e) { /* ignore injection failures */ }
})();

// Listen for intercepted quotes dispatched from the page script and insert into Quill
(function listenAltQuoteEvents() {
    try {
        if (!window.__alt_pending_quotes) window.__alt_pending_quotes = [];

        window.addEventListener('alt-quote-text', function (ev) {
            try {
                var text = ev && ev.detail && ev.detail.text ? ev.detail.text : '';
                if (!text) return;
                // If Quill instance available, insert immediately
                try {
                    var q = window.__bt_quill_instance;
                    if (q) {
                        var range = q.getSelection() || { index: q.getLength() };
                        q.insertText(range.index, text, 'user');
                        q.setSelection(range.index + (text ? text.length : 0), 0);
                        q.focus();
                        return;
                    }
                } catch (e) { }
                // otherwise queue for later
                window.__alt_pending_quotes.push(text);
            } catch (e) { }
        }, false);

        // Flush pending quotes when Quill becomes available
        (function flushPendingLoop() {
            var attempts = 0;
            var maxAttempts = 120; // ~30s
            var iv = setInterval(function () {
                try {
                    attempts++;
                    if (window.__bt_quill_instance && window.__alt_pending_quotes && window.__alt_pending_quotes.length) {
                        var q = window.__bt_quill_instance;
                        while (window.__alt_pending_quotes.length) {
                            var txt = window.__alt_pending_quotes.shift();
                            try {
                                var range = q.getSelection() || { index: q.getLength() };
                                q.insertText(range.index, txt, 'user');
                                q.setSelection(range.index + (txt ? txt.length : 0), 0);
                            } catch (e) { }
                        }
                        q.focus();
                        clearInterval(iv);
                        return;
                    }
                    if (attempts > maxAttempts) { clearInterval(iv); }
                } catch (e) { clearInterval(iv); }
            }, 250);
        })();
    } catch (e) { }
})();
// Migrate existing storage from old key 'bitcointalk' to new 'altcoinstalks' if needed
(function storageMigration() {
    try {
        chrome.storage.local.get(['bitcointalk', 'altcoinstalks'], function (s) {
            try {
                if (s && s.bitcointalk && !s.altcoinstalks) {
                    chrome.storage.local.set({ altcoinstalks: s.bitcointalk }, function () {
                        console.info('Altcointalks: migrated storage from bitcointalk -> altcoinstalks');
                    });
                }
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
})();

// Add enable/disable buttons for Quill above original textarea and persist state
(function quillToggleUI() {
    function createButtons() {
        try {
            const textarea = document.querySelector('textarea[name="message"]');
            if (!textarea) return;
            if (document.getElementById('altcoinstalks-quill-toggle')) return; // already created

            const container = document.createElement('div');
            container.id = 'altcoinstalks-quill-toggle';
            container.style.display = 'flex';
            container.style.gap = '8px';
            container.style.alignItems = 'center';
            container.style.marginBottom = '6px';

            const btnEnable = document.createElement('button');
            btnEnable.id = 'altcoinstalks-quill-enable';
            btnEnable.textContent = 'Enable Editor';
            btnEnable.style.cursor = 'pointer';

            const btnDisable = document.createElement('button');
            btnDisable.id = 'altcoinstalks-quill-disable';
            btnDisable.textContent = 'Disable Editor';
            btnDisable.style.cursor = 'pointer';

            container.appendChild(btnEnable);
            container.appendChild(btnDisable);

            textarea.parentNode.insertBefore(container, textarea);

            function updateButtons(state) {
                try {
                    if (state) {
                        btnEnable.disabled = true;
                        btnDisable.disabled = false;
                    } else {
                        btnEnable.disabled = false;
                        btnDisable.disabled = true;
                    }
                } catch (e) { }
            }

            btnEnable.addEventListener('click', function (event) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                try {
                    // set without callback to avoid running code inside storage callback (context may be invalidated)
                    // also disable emoji toolbar when Quill is enabled
                    chrome.storage.local.get('altcoinstalks', function (res) {
                        const s = res && res.altcoinstalks ? res.altcoinstalks : {};
                        s.quillEnabled = true;
                        s.enableEmojiToolbar = false;
                        try { chrome.storage.local.set({ altcoinstalks: s }); } catch (e) { /* ignore */ }
                    });
                } catch (e) {
                    // ignore storage errors
                }
                // call init immediately (with retries) so UI responds even if storage callback won't run
                (function callInit(retries) {
                    try {
                        if (window.initQuillEditor) return void window.initQuillEditor();
                    } catch (e) { }
                    if (retries > 0) setTimeout(function () { callInit(retries - 1); }, 200);
                })(10);
                updateButtons(true);
                // hide any visible emoji toolbars immediately
                try { document.querySelectorAll('.altcoinstalks-emoji-toolbar').forEach(el => el.style.display = 'none'); } catch (e) { }
            });

            btnDisable.addEventListener('click', function (event) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                try {
                    // re-enable emoji toolbar when Quill is disabled
                    chrome.storage.local.get('altcoinstalks', function (res) {
                        const s = res && res.altcoinstalks ? res.altcoinstalks : {};
                        s.quillEnabled = false;
                        s.enableEmojiToolbar = true;
                        try { chrome.storage.local.set({ altcoinstalks: s }); } catch (e) { /* ignore */ }
                    });
                } catch (e) { }
                try { if (window.destroyQuillEditor) window.destroyQuillEditor(); } catch (e) { }
                updateButtons(false);
                // show emoji toolbars by triggering a storage change; also ensure any removed toolbars are reattached by toolbar script
                try { document.querySelectorAll('.altcoinstalks-emoji-toolbar').forEach(el => el.remove()); } catch (e) { }
            });

            // initialize state from storage
            chrome.storage.local.get('quillEnabled', function (res) {
                const enabled = !!(res && res.quillEnabled);
                updateButtons(enabled);
                if (enabled) {
                    // If quill assets are not yet injected, retry until available
                    (function callInit(retries) {
                        try {
                            if (window.initQuillEditor) return void window.initQuillEditor();
                        } catch (e) { }
                        if (retries > 0) setTimeout(function () { callInit(retries - 1); }, 200);
                    })(10);
                } else {
                    try { if (window.destroyQuillEditor) window.destroyQuillEditor(); } catch (e) { }
                }
            });
        } catch (err) {
            console.warn('quillToggleUI error', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createButtons, { once: true });
    } else {
        // small timeout to allow other scripts to run first
        setTimeout(createButtons, 50);
    }
})();

// background.js crypto prices getter
// moved to content.js because of Chrome manifest v3 restrictions

// Prices store and CoinGecko fetch implementation
let prices = {};
// human-readable symbol map for coin ids
const coinLabels = {
    bitcoin: 'BTC',
    ethereum: 'ETH',
    binancecoin: 'BNB',
    solana: 'SOL',
    dogecoin: 'DOGE',
    monero: 'XMR',
    polkadot: 'DOT',
    ripple: 'XRP'
};
// Binance symbol map (for websockets / REST fallback)
const binanceMap = {
    bitcoin: 'BTCUSDT',
    ethereum: 'ETHUSDT',
    binancecoin: 'BNBUSDT',
    solana: 'SOLUSDT',
    dogecoin: 'DOGEUSDT',
    monero: 'XMRUSDT',
    polkadot: 'DOTUSDT',
    ripple: 'XRPUSDT'
};

// WebSocket management in page context: service workers don't reliably support WebSocket,
// so content scripts open WS connections when requested by background.
const __alt_ws = { conns: {}, lastMsgAt: {} };

function startWebSockets(ids = []) {
    try {
        ids.forEach(id => {
            try {
                if (!binanceMap[id]) return;
                const symbol = binanceMap[id];
                if (__alt_ws.conns[symbol]) return; // already open
                const url = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@miniTicker`;
                const ws = new WebSocket(url);
                ws.addEventListener('open', () => {
                    console.info('Altcointalks WS opened for', symbol);
                });
                ws.addEventListener('message', (ev) => {
                    try {
                        const msg = JSON.parse(ev.data);
                        // miniTicker / ticker include last price as 'c'
                        const last = msg && (msg.c || msg.lastPrice || msg.p) ? Number(msg.c || msg.lastPrice || msg.p) : null;
                        if (last !== null && !isNaN(last)) {
                            prices[id] = last;
                            __alt_ws.lastMsgAt[id] = Date.now();
                            // send update to background cache so other tabs/content can pick it up
                            try { chrome.runtime.sendMessage({ type: 'ws-price-update', id: id, price: last }); } catch (e) { /* ignore */ }
                            // throttle UI refresh: update prices UI at most once per 3000ms per id
                            if (!__alt_ws._throttle) __alt_ws._throttle = {};
                            if (!__alt_ws._throttle[id]) {
                                __alt_ws._throttle[id] = true;
                                setTimeout(() => { try { const header = (document.querySelectorAll('td.catbg')[1]) || null; Altcointalks.updatePrices(header); } catch (e) { } __alt_ws._throttle[id] = false; }, 3000);
                            }
                        }
                    } catch (e) { /* ignore parse errors */ }
                });
                ws.addEventListener('close', (ev) => {
                    try { console.info('Altcointalks WS closed for', symbol, ev && ev.code); } catch (e) { }
                    // attempt reconnect after a short delay
                    delete __alt_ws.conns[symbol];
                    setTimeout(() => { startWebSockets([id]); }, 5000);
                });
                ws.addEventListener('error', (ev) => { try { console.warn('Altcointalks WS error for', symbol); } catch (e) { } });
                __alt_ws.conns[symbol] = ws;
            } catch (e) { /* ignore per-id ws failure */ }
        });
    } catch (e) { /* ignore overall */ }
}

// price interval and dialog are created on-demand and stored on the Altcointalks object

// Fetch latest BTC/ETH prices from CoinGecko (USD)
// Fetch latest prices for a list of CoinGecko ids (vs USD)
// Fetch prices by asking the background service worker (avoids CORS problems)
async function fetchPrices(ids = ['bitcoin', 'ethereum']) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'fetch-prices', ids }, (resp) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(resp || { success: false, error: 'no-response' });
                }
            });
        } catch (e) { resolve({ success: false, error: e && e.message ? e.message : String(e) }); }
    });
}

/* =========================
    Existing Altcointalks code (kept, initialization deferred until DOM ready)
    ========================= */

const Altcointalks = {
    init: function (key, value, event) {
        this.setStorage(key, value);
        switch (key) {
            case "signature":
                this.toggleSignature(value);
                break;
            case "avatar":
                this.toggleAvatar(value);
                break;
            case "theme":
                this.toggleTheme(value);
                break;
            case "price":
                this.displayBitcoinPrice(value);
                break;
            case "zoom":
                this.zoomFontSize(value, event);
                break;
            case "pins":
                this.pinsPost(value);
                break;
            case "direction":
                this.toggleDirection(value);
                break;
        }
    },
    setStorage: function (key, value) {
        // Write into new key 'altcoinstalks'. If migration is needed, it's handled elsewhere.
        chrome.storage.local.get(['altcoinstalks'], function (storage) {
            let newStorage = {};
            if (storage && typeof storage === 'object' && storage.altcoinstalks) {
                newStorage = storage.altcoinstalks;
            }
            newStorage[key] = value;
            chrome.storage.local.set({ 'altcoinstalks': newStorage });
        });
    },
    getStorage: function (key, callback) {
        chrome.storage.local.get('altcoinstalks', function (storage) {
            const out = storage && storage.altcoinstalks && storage.altcoinstalks[key] !== undefined ? storage.altcoinstalks[key] : [];
            callback(out);
        });
    },
    clearStorage: function () {
        chrome.storage.local.clear(function () {
            console.log("cleared");
        });
    },
    httpGet: function (theUrl, callback) {
        fetchWithTimeout(theUrl, {}, 10000).then(response => response.text()).then(html => {
            callback(html);
        }).catch(err => { console.warn('httpGet fetch error', err); callback(''); });
    },
    externalLink: function () {
        let externalLink = document.getElementsByTagName("a");
        for (let i = 0; i < externalLink.length; i++) {
            try {
                if (!externalLink[i].href.includes("https://altcoinstalks.com") && externalLink[i].href.includes("http")) {
                    externalLink[i].removeAttribute('target');
                }
            } catch (e) { }
        }
    },
    toggleTheme: function (value) {
        // Remove previously injected theme styles and any existing theme classes
        try {
            const prev = document.querySelectorAll('.altcoinstalks-css-inject');
            prev.forEach(el => { try { el.remove(); } catch (e) { /* ignore */ } });
            document.querySelectorAll('link[data-extension-theme], style[data-extension-theme]').forEach(el => { try { el.remove(); } catch (e) { /* ignore */ } });
            if (document && document.documentElement) {
                const clsList = Array.from(document.documentElement.classList).filter(c => c.indexOf('altcoinstalks-theme-') === 0);
                clsList.forEach(c => document.documentElement.classList.remove(c));
            }
        } catch (e) { /* ignore if DOM not ready */ }

        // if 'on' => default, do nothing further
        if (value === 'on') return;

        // colorblind-safe theme support
        if (value === 'colorblind-safe') {
            const className = 'altcoinstalks-theme-colorblind-safe';
            const fileName = 'colorblind-safe.css';
            const urlCss = chrome.runtime.getURL(`css/altcoinstalks/${fileName}`);
            console.info('toggleTheme: loading colorblind-safe theme', { fileName, urlCss });
            fetchWithTimeout(urlCss, {}, 10000).then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
                return response.text();
            }).then(css => {
                try {
                    const scoped = Altcointalks.scopeCss(css, `html.${className}`);
                    const style = document.createElement('style');
                    style.className = 'altcoinstalks-css-inject';
                    style.setAttribute('data-extension-theme', 'altcoinstalks');
                    style.textContent = scoped;
                    const head = document.querySelector('head') || document.head || document.documentElement;
                    head.appendChild(style);
                    if (document && document.documentElement) document.documentElement.classList.add(className);
                } catch (err) {
                    console.warn('toggleTheme: error scoping/injecting colorblind-safe css', err);
                }
            }).catch(err => {
                console.warn('toggleTheme: failed to fetch colorblind-safe css', err);
            });
            return;
        }

        // apply numeric theme id (1,2,3,4) — map to filenames matching popup labels
        if (!isNaN(parseInt(value))) {
            const themeId = String(value);
            const className = `altcoinstalks-theme-${themeId}`;
            const themeMap = { '1': 'dark1.css', '2': 'dark2.css', '3': 'dark3.css', '4': 'bitcoin.css' };
            const fileName = themeMap[themeId] || `${themeId}.css`;
            const urlCss = chrome.runtime.getURL(`css/altcoinstalks/${fileName}`);
            console.info('toggleTheme: loading theme', { themeId, fileName, urlCss });
            fetchWithTimeout(urlCss, {}, 10000).then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
                return response.text();
            }).then(css => {
                try {
                    const scoped = Altcointalks.scopeCss(css, `html.${className}`);
                    const style = document.createElement('style');
                    style.className = 'altcoinstalks-css-inject';
                    style.setAttribute('data-extension-theme', 'altcoinstalks');
                    style.textContent = scoped;
                    const head = document.querySelector('head') || document.head || document.documentElement;
                    head.appendChild(style);
                    if (document && document.documentElement) document.documentElement.classList.add(className);
                } catch (err) {
                    console.warn('toggleTheme: error scoping/injecting css', err);
                }
            }).catch(err => {
                console.warn('toggleTheme: failed to fetch theme css', err);
            });
        }
    },

    // Scope plain CSS text by prefixing all selectors with `scope` (e.g. "html.altcoinstalks-theme-1").
    // Handles top-level rules and @media/@supports blocks. Leaves @keyframes and similar untouched.
    scopeCss: function (cssText, scope) {
        let i = 0;
        const len = cssText.length;
        let out = '';

        function skipWS() { while (i < len && /\s/.test(cssText[i])) i++; }

        function readUntil(ch) { let s = i; while (i < len && cssText[i] !== ch) i++; return cssText.slice(s, i); }

        function process() {
            skipWS();
            if (i >= len) return;
            if (cssText[i] === '@') {
                const atStart = i;
                const header = readUntil('{');
                if (i >= len) { out += cssText.slice(atStart); return; }
                out += header + '{';
                i++; // skip '{'
                let depth = 1; const innerStart = i;
                while (i < len && depth > 0) { if (cssText[i] === '{') depth++; else if (cssText[i] === '}') depth--; i++; }
                const inner = cssText.slice(innerStart, i - 1);
                if (/^@media|@supports|@document/.test(header.trim())) out += this.scopeCss(inner, scope);
                else out += inner;
                out += '}';
            } else {
                const selStart = i;
                const selectors = readUntil('{');
                if (i >= len) { out += cssText.slice(selStart); return; }
                i++; // skip '{'
                const bodyStart = i; let depth = 1;
                while (i < len && depth > 0) { if (cssText[i] === '{') depth++; else if (cssText[i] === '}') depth--; i++; }
                const body = cssText.slice(bodyStart, i - 1);
                const pref = selectors.split(',').map(s => {
                    const t = s.trim(); if (!t) return ''; if (/^from$|^to$|^[0-9.]+%$/.test(t)) return t; if (t.indexOf(scope) !== -1) return t; return scope + ' ' + t;
                }).filter(Boolean).join(', ');
                out += pref + ' {' + body + '}';
            }
        }

        while (i < len) process.call(this);
        return out;
    },
    // Escape HTML to prevent injection when inserting stored titles/URLs
    escapeHtml: function (str) {
        if (str === undefined || str === null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
    toggleSignature: function (value) {
        let signature = document.getElementsByClassName("signature");
        for (let i = 0; i < signature.length; i++) {
            signature[i].style.display = (value === "on" ? "none" : "block");
        }
    },
    toggleAvatar: function (value) {
        try {
            const imgs = document.getElementsByTagName('img');
            // User expects: pressing 'on' hides avatars, 'off' shows them
            const shouldHide = (value === 'on');
            for (let i = 0; i < imgs.length; i++) {
                try {
                    const el = imgs[i];
                    const src = (el.src || '').toLowerCase();
                    const cls = (el.className || '').toLowerCase();
                    // match common avatar indicators in src or class names
                    if (src.includes('useravatars') || src.includes('avatar') || cls.includes('avatar') || cls.includes('useravatar')) {
                        el.style.display = shouldHide ? 'none' : '';
                    }
                } catch (e) { /* ignore per-image errors */ }
            }
        } catch (e) { /* ignore overall errors */ }
    },
    applyWidgetTheme: function (themeVal) {
        try {
            const container = document.querySelector('.altcoinstalks-gecko-widget');
            if (!container) return;
            if (themeVal === 'night') {
                container.style.background = 'rgba(17,17,17,0.95)';
                container.style.color = '#fff';
                container.style.border = '1px solid rgba(255,255,255,0.06)';
                container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.6)';
            } else {
                container.style.background = 'rgba(255,255,255,0.95)';
                container.style.color = '#111';
                container.style.border = '1px solid #ccc';
                container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
            }
        } catch (e) { /* ignore */ }
    },
    zoomFontSize: function (value, event) {
        if (event === 0) {
            if (!isNaN(parseInt(value))) {
                let newFontSize = parseInt(value);
                this.setStorage('zoom', newFontSize);
                document.body.style.zoom = newFontSize + "%";
                if (document.documentElement) document.documentElement.style.zoom = newFontSize + "%";
            } else {
                let newFontSize = !isNaN(parseInt(document.body.style.zoom)) ? parseInt(document.body.style.zoom) : 100;
                if (value === "plus") {
                    newFontSize += 5;
                } else if (value === "minus") {
                    newFontSize -= 5;
                } else {
                    newFontSize = 100;
                }
                this.setStorage('zoom', newFontSize);
                document.body.style.zoom = newFontSize + "%";
                if (document.documentElement) document.documentElement.style.zoom = newFontSize + "%";
            }
        } else {
            const applyZoom = (res) => {
                let parsed = !isNaN(parseInt(res)) ? parseInt(res) : null;
                if (parsed === null && !isNaN(parseInt(value))) {
                    parsed = parseInt(value);
                }
                let finalZoom = parsed !== null ? parsed : 100;
                document.body.style.zoom = finalZoom + "%";
                if (document.documentElement) document.documentElement.style.zoom = finalZoom + "%";
            };

            if (!isNaN(parseInt(value))) {
                applyZoom(value);
            } else {
                this.getStorage('zoom', function (res) {
                    applyZoom(res);
                });
            }
        }
    },
    toggleMerit: function () {
        // merit feature removed
    },
    displayPostPins: function (currentListPost) {
        let postsPinnedOld = document.getElementsByClassName("postsPinned");
        if (postsPinnedOld.length > 0) {
            postsPinnedOld[0].remove();
        }
        if (!currentListPost || (Array.isArray(currentListPost) && currentListPost.length === 0)) {
            return;
        }
        let minusIcon = chrome.runtime.getURL(`icons/minus.png`);
        let listPostsHtml = [];
        for (let i = 0; i < currentListPost.length; i++) {
            const raw = currentListPost[i] || {};
            const msgId = (raw.url && raw.url.includes("#msg") ? raw.url.split("#")[1] : '');
            const urlEsc = this.escapeHtml(raw.url || '');
            const titleEsc = this.escapeHtml(raw.title || '');

            listPostsHtml.push([
                '<tr>',
                '<td class="windowbg" valign="middle">',
                '<b><a href="' + urlEsc + '">' + titleEsc + '</a></b>',
                msgId !== '' ? "#" + this.escapeHtml(msgId) : '',
                '</td>',
                '<td class="windowbg">',
                msgId !== '' ? 'Comment in post' : 'Post',
                '</td>',
                '<td class="windowbg removePostPins" style="cursor:pointer;display: flex;align-items: center" valign="middle" data-url="' + urlEsc + '">',
                '<img src="' + minusIcon + '" height="16" width="16" alt="minus-icon"/>',
                '<a style="margin-left: 5px;" href="javascript:void(0)">Remove</a>',
                '</td>',
                '</tr>'
            ].join(""));
        }

        let bodyarea = document.getElementById("bodyarea") || document.querySelector('#content') || document.body;
        let postsPinned = document.createElement("div");

        postsPinned.className = "postsPinned";
        postsPinned.innerHTML = `<div class="tborder">
                                        <table border="0" width="100%" cellspacing="1" cellpadding="4" class="bordercolor">
                                            <tbody>
                                                <tr> <td class="catbg">Posts and comment pinned</td> <td class="catbg">Type</td> <td class="catbg">Action</td> </tr>
                                                ${listPostsHtml.join("")}
                                                <tr>
                                                    <td class="windowbg">Total: ${listPostsHtml.length} post & comment</td>
                                                    <td class="windowbg"></td>
                                                    <td class="windowbg removeAllPostPins" style="cursor:pointer;display: flex;align-items: center" >
                                                        <img src="${minusIcon}" height="16" width="16" alt="minus-icon"/>
                                                        <a style="margin-left: 5px;" href="javascript:void(0)"> Remove All </a>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                     </div>`;
        try {
            if (bodyarea) {
                bodyarea.insertBefore(postsPinned, bodyarea.firstChild);
            } else {
                document.body.insertBefore(postsPinned, document.body.firstChild);
            }
        } catch (e) {
            try { document.body.insertBefore(postsPinned, document.body.firstChild); } catch (e2) { /* ignore */ }
        }

        let removePostPinsSpan = postsPinned.getElementsByTagName("td");
        for (let i = 0; i < removePostPinsSpan.length; i++) {
            if (removePostPinsSpan[i].className.includes("removePostPins")) {
                removePostPinsSpan[i].addEventListener("click", () => {
                    this.removePostPins(removePostPinsSpan[i].getAttribute("data-url"));
                })
            }
            if (removePostPinsSpan[i].className.includes("removeAllPostPins")) {
                removePostPinsSpan[i].addEventListener("click", () => {
                    this.setStorage('list-post', []);
                    setTimeout(() => {
                        this.pinsPost("on");
                    }, 100);
                })
            }
        }
    },
    removePostPins: function (url) {
        this.getStorage('list-post', (listPost) => {
            listPost = Array.isArray(listPost) ? listPost : [];
            let flagExist = 0;
            for (let i = 0; i < listPost.length; i++) {
                if (listPost[i].url === url) {
                    flagExist = 1;
                    listPost.splice(i, 1);
                }
            }
            this.setStorage('list-post', listPost);
            setTimeout(() => {
                this.pinsPost("on");
            }, 100);
        });
    },
    pinsPost: async function (value) {
        try {
            // remove previous inline pin controls
            const existingPins = document.querySelectorAll('span.pins-post');
            existingPins.forEach(el => el.remove());

            if (value === 'off') {
                if (document.getElementsByClassName('postsPinned').length > 0) {
                    document.getElementsByClassName('postsPinned')[0].remove();
                }
                return;
            }

            const plusIcon = chrome.runtime.getURL('icons/plus.png');
            const minusIcon = chrome.runtime.getURL('icons/minus.png');

            // Find thread title cells (td elements whose class includes 'subject') and attach pin only to the main title link
            const subjectCells = Array.from(document.querySelectorAll('td')).filter(td => {
                try { return td.className && td.className.indexOf('subject') !== -1; } catch (e) { return false; }
            });

            await this.getStorage('list-post', (currentListPost) => {
                currentListPost = Array.isArray(currentListPost) ? currentListPost : [];

                this.displayPostPins(currentListPost);

                subjectCells.forEach(td => {
                    try {
                        // pick the first anchor inside the subject cell that links to a thread (ignore anchors with #msg)
                        const anchor = td.querySelector('a[href*="index.php?topic="]');
                        if (!anchor) return;
                        const hrefAttr = (anchor.getAttribute('href') || '').toString();
                        if (!hrefAttr || hrefAttr.indexOf('#msg') !== -1) return;
                        if (anchor.closest('.post')) return;

                        const title = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
                        const url = anchor.href;

                        const spanNode = document.createElement('span');
                        spanNode.className = 'pins-post';
                        spanNode.style.marginLeft = '8px';
                        spanNode.style.cursor = 'pointer';
                        // create img element safely instead of setting innerHTML
                        try {
                            const imgEl = document.createElement('img');
                            imgEl.setAttribute('data-url', url);
                            imgEl.src = plusIcon;
                            imgEl.height = 16; imgEl.width = 16; imgEl.alt = 'plus-icon';
                            spanNode.appendChild(imgEl);
                        } catch (e) { spanNode.innerHTML = `<img data-url="${url}" src="${plusIcon}" height="16" width="16" alt="plus-icon"/>`; }

                        for (let k = 0; k < currentListPost.length; k++) {
                            if (currentListPost[k].url === url) {
                                try {
                                    spanNode.innerHTML = '';
                                    const imgEl2 = document.createElement('img');
                                    imgEl2.setAttribute('data-url', url);
                                    imgEl2.src = minusIcon; imgEl2.height = 16; imgEl2.width = 16; imgEl2.alt = 'minus-icon';
                                    spanNode.appendChild(imgEl2);
                                } catch (e) { spanNode.innerHTML = `<img data-url="${url}" src="${minusIcon}" height="16" width="16" alt="minus-icon"/>`; }
                                break;
                            }
                        }

                        // Insert the + immediately after the title anchor so it appears only next to the title
                        try { anchor.insertAdjacentElement('afterend', spanNode); } catch (e) { try { anchor.after(spanNode); } catch (e2) { td.appendChild(spanNode); } }

                        spanNode.addEventListener('click', () => {
                            this.getStorage('list-post', (res) => {
                                let listPost = Array.isArray(res) ? res.slice() : [];
                                let found = false;
                                for (let j = 0; j < listPost.length; j++) {
                                    if (listPost[j].url === url) { found = true; listPost.splice(j, 1); break; }
                                }
                                if (!found) {
                                    listPost.push({ title: title, url: url });
                                    try { spanNode.innerHTML = ''; const imgEl3 = document.createElement('img'); imgEl3.setAttribute('data-url', url); imgEl3.src = minusIcon; imgEl3.height = 16; imgEl3.width = 16; imgEl3.alt = 'minus-icon'; spanNode.appendChild(imgEl3); } catch (e) { spanNode.innerHTML = `<img data-url="${url}" src="${minusIcon}" height="16" width="16" alt="minus-icon"/>`; }
                                } else {
                                    try { spanNode.innerHTML = ''; const imgEl4 = document.createElement('img'); imgEl4.setAttribute('data-url', url); imgEl4.src = plusIcon; imgEl4.height = 16; imgEl4.width = 16; imgEl4.alt = 'plus-icon'; spanNode.appendChild(imgEl4); } catch (e) { spanNode.innerHTML = `<img data-url="${url}" src="${plusIcon}" height="16" width="16" alt="plus-icon"/>`; }
                                }
                                this.setStorage('list-post', listPost);
                                this.displayPostPins(listPost);
                            });
                        });
                    } catch (e) { /* ignore per-cell errors */ }
                });
            });
        } catch (e) { console.warn('pinsPost error', e); }
    },
    scrollToTop: function () {
        try {
            if (this._scrollInit) return;
            this._scrollInit = true;

            let toTop = chrome.runtime.getURL(`icons/to-top.png`);
            let divNode = document.createElement("div");
            let dialogPrice = document.getElementsByClassName("dialog-price");
            divNode.style.cssText = "display: none;position: fixed;bottom: 20px;right: 30px;z-index: 99;cursor: pointer;padding: 15px;border-radius: 4px;";
            divNode.setAttribute('data-altcoinstalks', 'to-top');

            const img = document.createElement('img');
            img.src = toTop;
            img.alt = 'to-top';
            img.height = 36;
            divNode.appendChild(img);

            const footer = document.getElementById('footerarea');
            try {
                if (footer) footer.appendChild(divNode);
                else (document.body || document.documentElement).appendChild(divNode);
            } catch (e) {
                try { (document.body || document.documentElement).appendChild(divNode); } catch (e2) { console.warn('scrollToTop: failed to append to DOM', e2); }
            }

            // store refs so we can clean up later
            this._toTopNode = divNode;

            const self = this;
            this._scrollHandler = function () {
                try {
                    const scTop = (document.body && document.body.scrollTop) || (document.documentElement && document.documentElement.scrollTop) || 0;
                    if (scTop > 200) {
                        divNode.style.display = 'block';
                        if (dialogPrice.length > 0) dialogPrice[0].style.display = 'block';
                    } else {
                        divNode.style.display = 'none';
                        if (dialogPrice.length > 0) dialogPrice[0].style.display = 'none';
                    }
                } catch (err) { console.warn('scrollToTop scroll handler error', err); }
            };

            window.addEventListener('scroll', this._scrollHandler, { passive: true });

            divNode.addEventListener('click', () => {
                try { document.body.scrollTop = 0; document.documentElement.scrollTop = 0; } catch (e) { console.warn('scrollToTop click error', e); }
            });

            // cleanup on unload: clear price interval, remove widget, and remove scroll listener
            if (!this._cleanupRegistered) {
                this._cleanupRegistered = true;
                try {
                    window.addEventListener('beforeunload', function () {
                        try { if (self._priceInterval) { clearInterval(self._priceInterval); self._priceInterval = null; } } catch (e) { }
                        try { if (self.geckoWidgetContainer) { self.geckoWidgetContainer.remove(); self.geckoWidgetContainer = null; self.geckoWidgetInner = null; } } catch (e) { }
                        try { if (self._scrollHandler) { window.removeEventListener('scroll', self._scrollHandler); self._scrollHandler = null; } } catch (e) { }
                    });
                } catch (e) { /* ignore */ }
            }
        } catch (e) { console.warn('scrollToTop initialization error', e); }
    },
    sumMerit: function () {
        // merit feature removed
    },
    highlightMyNameInMerit: function () {
        // merit feature removed
    },
    enhancedReportToModeratorUI: function () {
        if (document.location.href.match(/https:\/\/altcoinstalks.com\/index.php\?action=profile;(.*?)sa=showPosts/s)) {
            let buttons = document.querySelectorAll("span.middletext");
            let flagIcon = chrome.runtime.getURL(`icons/flag.png`);

            [...document.querySelectorAll("td.middletext a:last-of-type")].forEach((post, i) => {
                let a = document.createElement("a");
                a.setAttribute("href", post.getAttribute("href").replace("index.php?", "index.php?action=reporttm;").replace(".msg", ";msg="));
                a.innerHTML = `<img src="${flagIcon}" alt="Reply" align="middle"> <b>Report to moderator</b>`;
                if (buttons[i + 1]) {
                    buttons[i + 1].prepend(a);
                }
            });
        }
    },
    displayBitcoinPrice: function (value) {
        try {
            const header = (document.querySelectorAll("td.catbg")[1]) || null;
            // create or remove an internal marquee widget (external CoinGecko widget blocked by page CSP)
            function createOrUpdateLocalMarquee(selectedIds) {
                try {
                    let container = document.querySelector('.altcoinstalks-gecko-widget');
                    if (!container) {
                        container = document.createElement('div');
                        container.className = 'altcoinstalks-gecko-widget';
                        container.style.position = 'fixed';
                        container.style.top = '12px';
                        container.style.right = '12px';
                        container.style.zIndex = 99999;
                        container.style.background = 'rgba(255,255,255,0.95)';
                        container.style.border = '1px solid #ccc';
                        container.style.padding = '6px 8px';
                        container.style.borderRadius = '6px';
                        container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
                        container.style.fontFamily = 'Verdana, Arial, Helvetica, sans-serif';
                        container.style.fontSize = '13px';
                        container.style.color = '#111';
                        container.style.overflow = 'hidden';
                        container.style.whiteSpace = 'nowrap';
                        container.style.maxWidth = '320px';
                        const inner = document.createElement('div');
                        inner.className = 'altcoinstalks-marquee-inner';
                        inner.style.display = 'inline-block';
                        inner.style.paddingLeft = '100%';
                        inner.style.animation = 'alt-scroll 20s linear infinite';
                        container.appendChild(inner);

                        // add minimal keyframes (inject once)
                        if (!document.getElementById('altcoinstalks-marquee-style')) {
                            const style = document.createElement('style');
                            style.id = 'altcoinstalks-marquee-style';
                            style.textContent = `@keyframes alt-scroll { from { transform: translateX(0%); } to { transform: translateX(-100%); } } .altcoinstalks-marquee-item{display:inline-block;margin-right:18px;} .altcoinstalks-theme-dot{width:16px;height:16px;border-radius:50%;transition:transform .12s ease,outline .12s ease,box-shadow .12s ease;} .altcoinstalks-theme-dot:hover{transform:translateY(-2px);box-shadow:0 2px 6px rgba(0,0,0,0.12);} .altcoinstalks-theme-dot:focus{outline:2px solid rgba(0,0,0,0.18);} .altcoinstalks-theme-dot.active{outline:2px solid rgba(0,0,0,0.25);}`;
                            (document.head || document.documentElement).appendChild(style);
                        }

                        (document.body || document.documentElement).appendChild(container);

                        // add a simple widget-only theme toggle (day / night) on the right edge
                        // clicking sets `widgetTheme` in storage and applies styles to the widget only
                        try {
                            if (!container.querySelector('.altcoinstalks-theme-toggle')) {
                                const toggle = document.createElement('div');
                                toggle.className = 'altcoinstalks-theme-toggle';
                                toggle.style.position = 'absolute';
                                toggle.style.top = '50%';
                                toggle.style.right = '8px';
                                toggle.style.transform = 'translateY(-50%)';
                                toggle.style.display = 'flex';
                                toggle.style.gap = '6px';
                                toggle.style.alignItems = 'center';
                                toggle.style.pointerEvents = 'auto';

                                const makeDot = function (color, val) {
                                    const d = document.createElement('div');
                                    d.className = 'altcoinstalks-theme-dot';
                                    d.style.width = '14px';
                                    d.style.height = '14px';
                                    d.style.borderRadius = '50%';
                                    d.style.cursor = 'pointer';
                                    d.tabIndex = 0;
                                    d.tabIndex = 0;
                                    d.style.boxSizing = 'border-box';
                                    d.style.border = '1px solid rgba(0,0,0,0.2)';
                                    d.style.background = color;
                                    d.setAttribute('data-theme-val', val);
                                    d.title = val === 'day' ? 'Day (widget)' : 'Night (widget)';
                                    d.addEventListener('click', function () {
                                        const v = this.getAttribute('data-theme-val');
                                        try { Altcointalks.setStorage('widgetTheme', v); } catch (err) { try { chrome.storage.local.set({ altcoinstalks: { widgetTheme: v } }); } catch (e) { } }
                                        try { applyWidgetTheme(container, v); } catch (e) { }
                                        try {
                                            const all = container.querySelectorAll('.altcoinstalks-theme-dot');
                                            all.forEach(a => a.classList.remove('active'));
                                            this.classList.add('active');
                                        } catch (e) { }
                                    });
                                    d.addEventListener('keydown', function (ev) {
                                        if (ev && (ev.key === 'Enter' || ev.key === ' ')) {
                                            ev.preventDefault();
                                            this.click();
                                        }
                                    });
                                    d.addEventListener('keydown', function (ev) {
                                        if (ev && (ev.key === 'Enter' || ev.key === ' ')) {
                                            ev.preventDefault();
                                            this.click();
                                        }
                                    });
                                    return d;
                                };

                                const whiteDot = makeDot('#ffffff', 'day');
                                const blackDot = makeDot('#111111', 'night');
                                toggle.appendChild(whiteDot);
                                toggle.appendChild(blackDot);
                                // make space for the toggle
                                container.style.paddingRight = '36px';
                                container.appendChild(toggle);

                                // reflect stored theme in UI
                                try {
                                    chrome.storage.local.get('altcoinstalks', function (res) {
                                        const theme = res && res.altcoinstalks && res.altcoinstalks.widgetTheme ? res.altcoinstalks.widgetTheme : 'day';
                                        try { applyWidgetTheme(container, theme); } catch (e) { }
                                        const toActivate = container.querySelector('[data-theme-val="' + theme + '"]');
                                        if (toActivate) toActivate.style.outline = '2px solid rgba(0,0,0,0.25)';
                                    });
                                } catch (e) { }
                            }
                        } catch (e) { }
                    }

                    // helper to apply widget-only theme (day/night)
                    function applyWidgetTheme(containerEl, themeVal) {
                        try {
                            if (!containerEl) return;
                            if (themeVal === 'night') {
                                containerEl.style.background = 'rgba(17,17,17,0.95)';
                                containerEl.style.color = '#fff';
                                containerEl.style.border = '1px solid rgba(255,255,255,0.06)';
                                containerEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.6)';
                            } else {
                                containerEl.style.background = 'rgba(255,255,255,0.95)';
                                containerEl.style.color = '#111';
                                containerEl.style.border = '1px solid #ccc';
                                containerEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
                            }
                        } catch (e) { }
                    }

                    const inner = container.querySelector('.altcoinstalks-marquee-inner');
                    if (!inner) return;

                    const ids = Array.isArray(selectedIds) && selectedIds.length > 0 ? selectedIds : ['bitcoin', 'ethereum'];
                    inner.innerHTML = '';
                    ids.forEach(id => {
                        const span = document.createElement('span');
                        span.className = 'altcoinstalks-marquee-item';
                        span.setAttribute('data-coin-id', id);
                        span.textContent = `${(coinLabels[id] || id).toUpperCase()}: loading...`;
                        inner.appendChild(span);
                    });

                    // store refs
                    this.geckoWidgetContainer = container;
                    this.geckoWidgetInner = inner;
                } catch (e) { /* ignore */ }
            }

            async function refreshLocalMarquee(selectedIds) {
                try {
                    const ids = Array.isArray(selectedIds) && selectedIds.length > 0 ? selectedIds : ['bitcoin', 'ethereum'];
                    const resp = await fetchPrices(ids);
                    const pricesMap = (resp && resp.success && resp.prices) ? resp.prices : {};
                    const container = document.querySelector('.altcoinstalks-gecko-widget');
                    if (!container) return;
                    const inner = container.querySelector('.altcoinstalks-marquee-inner');
                    if (!inner) return;
                    ids.forEach(id => {
                        const el = inner.querySelector(`[data-coin-id="${id}"]`);
                        if (el) {
                            const val = pricesMap[id] !== undefined ? pricesMap[id] : (prices[id] !== undefined ? prices[id] : 0);
                            el.textContent = `${(coinLabels[id] || id).toUpperCase()}: $${Number(val || 0).toLocaleString()}`;
                        }
                    });
                } catch (e) { /* ignore refresh errors */ }
            }

            if (value === 'on') {
                // clear any old interval
                if (this._priceInterval) { clearInterval(this._priceInterval); this._priceInterval = null; }
                // create marquee and refresh immediately
                try {
                    chrome.storage.local.get('altcoinstalks', (d) => {
                        const selected = (d && d.altcoinstalks && Array.isArray(d.altcoinstalks.altcoins) && d.altcoinstalks.altcoins.length > 0) ? d.altcoinstalks.altcoins : ['bitcoin', 'ethereum'];
                        createOrUpdateLocalMarquee.call(this, selected);
                        refreshLocalMarquee.call(this, selected);
                        // refresh every 30s
                        this._priceInterval = setInterval(() => { refreshLocalMarquee.call(this, selected); }, 120000);
                    });
                } catch (e) { createOrUpdateLocalMarquee.call(this, ['bitcoin', 'ethereum']); }
            } else if (value === 'off') {
                if (this._priceInterval) { clearInterval(this._priceInterval); this._priceInterval = null; }
                try {
                    if (this.geckoWidgetContainer) { this.geckoWidgetContainer.remove(); this.geckoWidgetContainer = null; this.geckoWidgetInner = null; }
                } catch (e) { /* ignore */ }
                if (header) header.innerHTML = `<img src="https://altcoinstalks.com/Themes/custom1/images/smflogo.gif" style="margin: 2px;" alt="">`;
            }
        } catch (e) {
            console.error('displayBitcoinPrice error', e);
        }
    },

    updateGeckoWidget: function (selectedIds) {
        try {
            // Create or update the local marquee (same behavior as displayBitcoinPrice local marquee)
            function createOrUpdateLocal(selected) {
                try {
                    let container = document.querySelector('.altcoinstalks-gecko-widget');
                    if (!container) {
                        container = document.createElement('div');
                        container.className = 'altcoinstalks-gecko-widget';
                        container.style.position = 'fixed';
                        container.style.top = '12px';
                        container.style.right = '12px';
                        container.style.zIndex = 99999;
                        container.style.background = 'rgba(255,255,255,0.95)';
                        container.style.border = '1px solid #ccc';
                        container.style.padding = '6px 8px';
                        container.style.borderRadius = '6px';
                        container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
                        container.style.fontFamily = 'Verdana, Arial, Helvetica, sans-serif';
                        container.style.fontSize = '13px';
                        container.style.color = '#111';
                        container.style.overflow = 'hidden';
                        container.style.whiteSpace = 'nowrap';
                        container.style.maxWidth = '320px';
                        const inner = document.createElement('div');
                        inner.className = 'altcoinstalks-marquee-inner';
                        inner.style.display = 'inline-block';
                        inner.style.paddingLeft = '100%';
                        inner.style.animation = 'alt-scroll 20s linear infinite';
                        container.appendChild(inner);

                        // add theme toggle for widget (day/night)
                        try {
                            if (!container.querySelector('.altcoinstalks-theme-toggle')) {
                                const toggle = document.createElement('div');
                                toggle.className = 'altcoinstalks-theme-toggle';
                                toggle.style.position = 'absolute';
                                toggle.style.top = '50%';
                                toggle.style.right = '8px';
                                toggle.style.transform = 'translateY(-50%)';
                                toggle.style.display = 'flex';
                                toggle.style.gap = '6px';
                                toggle.style.alignItems = 'center';

                                const makeDot = function (color, val) {
                                    const d = document.createElement('div');
                                    d.className = 'altcoinstalks-theme-dot';
                                    d.style.width = '14px';
                                    d.style.height = '14px';
                                    d.style.borderRadius = '50%';
                                    d.style.cursor = 'pointer';
                                    d.style.boxSizing = 'border-box';
                                    d.style.border = '1px solid rgba(0,0,0,0.2)';
                                    d.style.background = color;
                                    d.setAttribute('data-theme-val', val);
                                    d.title = val === 'day' ? 'Day (widget)' : 'Night (widget)';
                                    d.addEventListener('click', function () {
                                        const v = this.getAttribute('data-theme-val');
                                        try { Altcointalks.setStorage('widgetTheme', v); } catch (err) { try { chrome.storage.local.set({ altcoinstalks: { widgetTheme: v } }); } catch (e) { } }
                                        try { applyWidgetTheme(container, v); } catch (e) { }
                                        try {
                                            const all = container.querySelectorAll('.altcoinstalks-theme-dot');
                                            all.forEach(a => a.classList.remove('active'));
                                            this.classList.add('active');
                                        } catch (e) { }
                                    });
                                    return d;
                                };

                                const whiteDot = makeDot('#ffffff', 'day');
                                const blackDot = makeDot('#111111', 'night');
                                toggle.appendChild(whiteDot);
                                toggle.appendChild(blackDot);
                                container.style.paddingRight = '36px';
                                container.appendChild(toggle);

                                try {
                                    chrome.storage.local.get('altcoinstalks', function (res) {
                                        const theme = res && res.altcoinstalks && res.altcoinstalks.widgetTheme ? res.altcoinstalks.widgetTheme : 'day';
                                        try { applyWidgetTheme(container, theme); } catch (e) { }
                                        const toActivate = container.querySelector('[data-theme-val="' + theme + '"]');
                                        if (toActivate) toActivate.style.outline = '2px solid rgba(0,0,0,0.25)';
                                    });
                                } catch (e) { }
                            }
                        } catch (e) { }

                        // helper to apply widget-only theme (day/night)
                        function applyWidgetTheme(containerEl, themeVal) {
                            try {
                                if (!containerEl) return;
                                if (themeVal === 'night') {
                                    containerEl.style.background = 'rgba(17,17,17,0.95)';
                                    containerEl.style.color = '#fff';
                                    containerEl.style.border = '1px solid rgba(255,255,255,0.06)';
                                    containerEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.6)';
                                } else {
                                    containerEl.style.background = 'rgba(255,255,255,0.95)';
                                    containerEl.style.color = '#111';
                                    containerEl.style.border = '1px solid #ccc';
                                    containerEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
                                }
                            } catch (e) { }
                        }

                        if (!document.getElementById('altcoinstalks-marquee-style')) {
                            const style = document.createElement('style');
                            style.id = 'altcoinstalks-marquee-style';
                            style.textContent = `@keyframes alt-scroll { from { transform: translateX(0%); } to { transform: translateX(-100%); } } .altcoinstalks-marquee-item{display:inline-block;margin-right:18px;} .altcoinstalks-theme-dot{width:16px;height:16px;border-radius:50%;transition:transform .12s ease,outline .12s ease,box-shadow .12s ease;} .altcoinstalks-theme-dot:hover{transform:translateY(-2px);box-shadow:0 2px 6px rgba(0,0,0,0.12);} .altcoinstalks-theme-dot:focus{outline:2px solid rgba(0,0,0,0.18);} .altcoinstalks-theme-dot.active{outline:2px solid rgba(0,0,0,0.25);}`;
                            (document.head || document.documentElement).appendChild(style);
                        }

                        (document.body || document.documentElement).appendChild(container);
                    }

                    const inner = container.querySelector('.altcoinstalks-marquee-inner');
                    if (!inner) return;
                    const ids = Array.isArray(selected) && selected.length > 0 ? selected : ['bitcoin', 'ethereum'];
                    inner.innerHTML = '';
                    ids.forEach(id => {
                        const span = document.createElement('span');
                        span.className = 'altcoinstalks-marquee-item';
                        span.setAttribute('data-coin-id', id);
                        span.textContent = `${(coinLabels[id] || id).toUpperCase()}: loading...`;
                        inner.appendChild(span);
                    });
                    this.geckoWidgetContainer = container;
                    this.geckoWidgetInner = inner;
                } catch (e) { /* ignore */ }
            }

            async function refreshLocal(selected) {
                try {
                    const ids = Array.isArray(selected) && selected.length > 0 ? selected : ['bitcoin', 'ethereum'];
                    const resp = await fetchPrices(ids);
                    const pricesMap = (resp && resp.success && resp.prices) ? resp.prices : {};
                    const container = document.querySelector('.altcoinstalks-gecko-widget');
                    if (!container) return;
                    const inner = container.querySelector('.altcoinstalks-marquee-inner');
                    if (!inner) return;
                    ids.forEach(id => {
                        const el = inner.querySelector(`[data-coin-id="${id}"]`);
                        if (el) {
                            const val = pricesMap[id] !== undefined ? pricesMap[id] : (prices[id] !== undefined ? prices[id] : 0);
                            el.textContent = `${(coinLabels[id] || id).toUpperCase()}: $${Number(val || 0).toLocaleString()}`;
                        }
                    });
                } catch (e) { /* ignore */ }
            }

            if (Array.isArray(selectedIds) && selectedIds.length > 0) {
                createOrUpdateLocal.call(this, selectedIds);
                refreshLocal.call(this, selectedIds);
            } else {
                try {
                    chrome.storage.local.get('altcoinstalks', (d) => {
                        try {
                            const sel = (d && d.altcoinstalks && Array.isArray(d.altcoinstalks.altcoins) && d.altcoinstalks.altcoins.length > 0) ? d.altcoinstalks.altcoins : ['bitcoin', 'ethereum'];
                            createOrUpdateLocal.call(this, sel);
                            refreshLocal.call(this, sel);
                        } catch (e) { createOrUpdateLocal.call(this, ['bitcoin', 'ethereum']); refreshLocal.call(this, ['bitcoin', 'ethereum']); }
                    });
                } catch (e) { createOrUpdateLocal.call(this, ['bitcoin', 'ethereum']); refreshLocal.call(this, ['bitcoin', 'ethereum']); }
            }
        } catch (e) { /* ignore */ }
    },

    updatePrices: async function (container) {
        try {
            // determine selected coins from storage (default: bitcoin, ethereum)
            const selected = await new Promise((resolve) => {
                try {
                    chrome.storage.local.get('altcoinstalks', (d) => {
                        try {
                            const arr = (d && d.altcoinstalks && Array.isArray(d.altcoinstalks.altcoins) && d.altcoinstalks.altcoins.length > 0) ? d.altcoinstalks.altcoins : ['bitcoin', 'ethereum'];
                            resolve(arr);
                        } catch (e) { resolve(['bitcoin', 'ethereum']); }
                    });
                } catch (e) { resolve(['bitcoin', 'ethereum']); }
            });

            // ensure BTC and ETH are present on top line
            const topIds = ['bitcoin', 'ethereum'];
            const fetchIds = Array.from(new Set(topIds.concat(selected)));
            const response = await fetchPrices(fetchIds);
            if (response && response.success) {
                // response may include only requested ids; prefer values from response then cached prices
                const getVal = (id) => {
                    if (response.prices && response.prices[id] !== undefined) return response.prices[id];
                    return prices[id] !== undefined ? prices[id] : 0;
                };

                const topParts = topIds.map(id => {
                    const sym = coinLabels[id] || id;
                    const val = getVal(id);
                    return `<span class="price-item">$${Number(val || 0).toLocaleString()}/${sym}</span>`;
                }).filter(Boolean);

                const altIds = (selected || []).filter(id => id !== 'bitcoin' && id !== 'ethereum');
                const altParts = altIds.map(id => {
                    const sym = coinLabels[id] || id;
                    const val = getVal(id);
                    return `<div class="altcoin-line"><span class="price-item">$${Number(val || 0).toLocaleString()}/${sym}</span></div>`;
                });

                const htmlTop = topParts.join(' | ');
                const html = htmlTop + (altParts.length ? '<br>' + altParts.join('') : '');
                if (container) container.innerHTML = htmlTop + (altParts.length ? '<br>' + altParts.join('') : '');
                if (this.priceDialog) {
                    try {
                        const el = this.priceDialog.querySelector('.prices-text');
                        if (el) el.innerHTML = html;
                        else this.priceDialog.insertAdjacentHTML('afterbegin', html);
                    } catch (e) { try { this.priceDialog.innerHTML = html; } catch (e2) { /* ignore */ } }
                }
            } else {
                if (container) container.innerHTML = "Can't fetch prices.";
                if (this.priceDialog) {
                    const el = this.priceDialog.querySelector('.prices-text');
                    if (el) el.textContent = '⚠️ Prices unavailable';
                    else this.priceDialog.textContent = '⚠️ Prices unavailable';
                }
                // If the extension was just reloaded the background/context may be invalidated.
                // Treat that as a transient condition and return silently rather than throwing.
                const errMsg = response && response.error ? String(response.error) : '';
                if (/Extension context invalidated/i.test(errMsg) || /context invalidated/i.test(errMsg)) {
                    return;
                }
                throw new Error(errMsg || 'Unknown error');
            }
        } catch (error) {
            const errMsg = error && error.message ? String(error.message) : String(error);
            // Ignore transient "Extension context invalidated" errors which occur when the extension
            // (background/service worker) is reloaded while the page is still active. These are
            // noisy but harmless; bail out silently.
            if (/Extension context invalidated/i.test(errMsg) || /context invalidated/i.test(errMsg)) {
                return;
            }
            console.error('Error fetching crypto prices:', error);
            if (container) container.textContent = '⚠️ Prices unavailable. May be blocked in your region.';
            if (this.priceDialog) {
                const el = this.priceDialog.querySelector('.prices-text');
                if (el) el.textContent = '⚠️ Prices unavailable';
                else this.priceDialog.textContent = '⚠️ Prices unavailable';
            }
        }
    },

    // New: toggle page direction (rtl / ltr)
    toggleDirection: function (value) {
        try {
            if (value === 'rtl') {
                if (document.documentElement) document.documentElement.setAttribute('dir', 'rtl');
                if (document.body) document.body.style.direction = 'rtl';
            } else if (value === 'ltr') {
                if (document.documentElement) document.documentElement.setAttribute('dir', 'ltr');
                if (document.body) document.body.style.direction = 'ltr';
            } else {
                if (document.documentElement) document.documentElement.removeAttribute('dir');
                if (document.body) document.body.style.direction = '';
            }
        } catch (e) {
            console.error('toggleDirection error', e);
        }
    },

    // Utility methods: isLoggedIn, addBoardNavigation, format_counters
    isLoggedIn: function () {
        return document.querySelectorAll("td.maintab_back").length >= 1;
    },

    addBoardNavigation: function () {
        try {
            const url = window.location.href;
            if (!url.includes("?board=")) return;
            const board = url.replace(/(\.\d+)$/, '');

            document.querySelectorAll('td.middletext').forEach(function (td) {
                const bElements = td.querySelectorAll('b');
                bElements.forEach((element) => {
                    if (element.innerHTML && element.innerHTML.includes("...")) {
                        const input = document.createElement('input');
                        input.type = 'number';
                        input.min = 1;
                        input.placeholder = 'Go';
                        input.style.width = '40px';
                        input.style.fontSize = '11px';

                        element.innerHTML = '';
                        element.appendChild(input);

                        input.addEventListener('keydown', function (event) {
                            if (event.key === 'Enter') {
                                const pageNum = parseInt(input.value, 10);
                                if (Number.isInteger(pageNum) && pageNum > 0) {
                                    const threadCount = 40;
                                    const offset = (pageNum - 1) * threadCount;
                                    window.location.href = `${board}.${offset}`;
                                } else {
                                    alert('Please enter a valid page number.');
                                }
                            }
                        });
                    }
                });
            });
        } catch (e) {
            console.error('addBoardNavigation error', e);
        }
    },

    format_counters: function () {
        try {
            function format_number(number) {
                const n = typeof number === 'number' ? number : parseInt(number, 10);
                if (!Number.isFinite(n)) return number;
                return new Intl.NumberFormat('en').format(n);
            }

            document.querySelectorAll('td.windowbg[valign="middle"]').forEach(function (td) {
                if (td.innerHTML && (td.innerHTML.includes('Posts') || td.innerHTML.includes('Topics'))) {
                    td.innerHTML = td.innerHTML.replace(/\d+/g, (match) => format_number(match));
                }
            });
        } catch (e) {
            console.error('format_counters error', e);
        }
    },
    // Quick Quote: replaced with updated implementation from attachment
    initQuickQuote: function () {
        (function () {
            'use strict';

            if (window.__altcoinstalks_quick_quote_injected) return;
            window.__altcoinstalks_quick_quote_injected = true;

            const btn = document.createElement('button');
            btn.textContent = '❝ Copy Quote';
            btn.style.position = 'fixed';
            btn.style.display = 'none';
            btn.style.zIndex = '9999';
            btn.style.padding = '5px 10px';
            btn.style.backgroundColor = '#e7eaef';
            btn.style.border = '1px solid #000';
            btn.style.borderRadius = '3px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '11px';
            btn.style.fontWeight = 'bold';
            btn.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.2)';
            document.body.appendChild(btn);

            function hideButton() { btn.style.display = 'none'; }

            function showButtonNearRange(range) {
                if (!range) return hideButton();
                const rects = range.getClientRects();
                const r = rects && rects.length ? rects[0] : range.getBoundingClientRect();
                if (!r || (r.width === 0 && r.height === 0)) return hideButton();

                // Make it visible first so we can measure its size
                btn.style.display = 'block';
                btn.style.visibility = 'hidden';

                // position relative to viewport (fixed)
                let top = Math.round(r.bottom + 5);
                let left = Math.round(r.left);

                // measure button and clamp within viewport
                const btnRect = btn.getBoundingClientRect();
                const btnH = btnRect.height || 28;
                const btnW = btnRect.width || 120;

                if (top + btnH > window.innerHeight - 5) {
                    top = Math.round(r.top - btnH - 5);
                }
                if (left + btnW > window.innerWidth - 5) {
                    left = Math.max(5, window.innerWidth - btnW - 5);
                }
                if (left < 5) left = 5;
                if (top < 5) top = 5;

                btn.style.top = `${top}px`;
                btn.style.left = `${left}px`;
                btn.style.visibility = 'visible';
            }

            // show button on mouseup (mouse selection) and on selectionchange (keyboard selection)
            document.addEventListener('mouseup', function () {
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();
                if (selectedText.length < 1) { hideButton(); return; }
                let node = selection.anchorNode;
                if (node && node.nodeType === 3) node = node.parentNode;
                if (!node) { hideButton(); return; }
                const postDiv = node.closest('div.post');
                if (!postDiv) { hideButton(); return; }
                try {
                    const range = selection.getRangeAt(0);
                    showButtonNearRange(range);
                    btn.onclick = function () { processQuote(postDiv, selectedText); };
                } catch (e) { hideButton(); }
            });

            document.addEventListener('selectionchange', function () {
                try {
                    const selection = window.getSelection();
                    if (!selection || selection.isCollapsed) { hideButton(); return; }
                    const selectedText = selection.toString().trim();
                    if (selectedText.length < 1) { hideButton(); return; }
                    let node = selection.anchorNode;
                    if (node && node.nodeType === 3) node = node.parentNode;
                    if (!node) { hideButton(); return; }
                    const postDiv = node.closest('div.post');
                    if (!postDiv) { hideButton(); return; }
                    const range = selection.getRangeAt(0);
                    showButtonNearRange(range);
                    btn.onclick = function () { processQuote(postDiv, selectedText); };
                } catch (e) { /* ignore */ }
            });

            document.addEventListener('mousedown', function (e) { if (!btn.contains(e.target)) hideButton(); });

            function safeEncode(str) { return encodeURIComponent(str).replace(/'/g, '%27'); }

            function generateTextFragment(text) {
                const cleanText = text.replace(/\s+/g, ' ');
                const words = cleanText.split(' ');
                if (words.length <= 8) return safeEncode(cleanText);
                const textStart = words.slice(0, 4).join(' ');
                const textEnd = words.slice(-4).join(' ');
                return `${safeEncode(textStart)},${safeEncode(textEnd)}`;
            }

            function getFormattedDateString() {
                const date = new Date();
                const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
            }

            function fallbackCopy(text) {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    // make tiny and off-screen but focusable
                    ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.width = '1px'; ta.style.height = '1px'; ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    const ok = document.execCommand && document.execCommand('copy');
                    try { ta.remove(); } catch (e) { }
                    return !!ok;
                } catch (e) {
                    try { console.warn('fallbackCopy error', e); } catch (ee) { }
                    return false;
                }
            }

            async function writeClipboard(text) {
                // Try fast clipboard API first (requires secure context and user gesture)
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    try {
                        await navigator.clipboard.writeText(text);
                        return true;
                    } catch (e) {
                        try { console.warn('navigator.clipboard.writeText failed', e); } catch (ee) { }
                    }
                }

                // As a last resort, attempt the legacy execCommand method with focus
                return fallbackCopy(text);
            }

            function processQuote(postDiv, selectedText) {
                try {
                    // Try to locate the td containing the post content (Bitcointalk-style layout)
                    let contentTd = postDiv.closest('td.td_headerandpost') || postDiv.closest('td.windowbg') || postDiv.closest('td');

                    // Prepare common variables early so header parsing can set them
                    let authorName = 'Unknown';
                    let permalink = '';
                    let rawDate = '';

                    // If selection is inside an existing quoted header (preview/inserted quote),
                    // prefer parsing that header since it already contains author + date text.
                    try {
                        let walker = postDiv;
                        let foundQuoteAnchor = null;
                        while (walker) {
                            try {
                                if (walker.querySelector) {
                                    foundQuoteAnchor = walker.querySelector('div.quoteheader a') || walker.querySelector('div.topslice_quote a') || walker.querySelector('a.bbc_link') || walker.querySelector('a[href*="#msg"]');
                                }
                            } catch (e) { foundQuoteAnchor = null; }
                            if (foundQuoteAnchor) break;
                            walker = walker.parentElement;
                        }
                        if (foundQuoteAnchor) {
                            // Try text inside the anchor first
                            try {
                                const txt = (foundQuoteAnchor.textContent || '').trim();
                                let m = txt.match(/Quote\s*from\s*:?\s*(.*?)\s+on\s+([\s\S]+)/i);
                                if (m && m[1] && !/Unknown/i.test(m[1])) authorName = m[1].trim();
                                if (m && m[2] && !/Unknown Date/i.test(m[2])) rawDate = m[2].trim();
                            } catch (e) { }

                            // If anchor text is unhelpful (e.g. "Unknown on Unknown Date"), scan parent/ancestors
                            if ((!authorName || /Unknown/i.test(authorName)) || (!rawDate || /Unknown Date/i.test(rawDate))) {
                                try {
                                    let p = foundQuoteAnchor.parentElement;
                                    let scanned = '';
                                    // gather text from parent and a few ancestor levels to find the header string
                                    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
                                        if (p && p.textContent) scanned = (p.textContent || '') + '\n' + scanned;
                                    }
                                    if (scanned) {
                                        const mm = scanned.match(/Quote\s*from\s*:?\s*(.*?)\s+on\s+([\s\S]+)/i);
                                        if (mm && mm[1] && !/Unknown/i.test(mm[1])) authorName = mm[1].trim();
                                        if (mm && mm[2] && !/Unknown Date/i.test(mm[2])) rawDate = mm[2].trim();
                                    }
                                } catch (e) { }
                            }

                            try { if (!permalink && foundQuoteAnchor.href) permalink = foundQuoteAnchor.href; } catch (e) { }
                        }
                    } catch (e) { }
                    try {
                        // Primary: previous sibling td (poster info)
                        if (contentTd && contentTd.previousElementSibling) {
                            const authorTd = contentTd.previousElementSibling;
                            const aElem = authorTd.querySelector('b > a') || authorTd.querySelector('a');
                            if (aElem && aElem.textContent) authorName = aElem.textContent.trim();
                        }
                        // Fallbacks: search nearby within the postDiv or row
                        if (authorName === 'Unknown') {
                            const tr = contentTd ? contentTd.closest('tr') : postDiv.closest('tr');
                            if (tr) {
                                const tryEl = tr.querySelector('td.poster_info b > a, td.poster_info a, .poster_info b > a, .username a, .poster a');
                                if (tryEl && tryEl.textContent) authorName = tryEl.textContent.trim();
                            }
                        }
                        // Last resort: any bold link inside ancestors
                        if (authorName === 'Unknown') {
                            const anyA = postDiv.querySelector('b > a') || postDiv.querySelector('a[rel="author"]') || postDiv.querySelector('a');
                            if (anyA && anyA.textContent) authorName = anyA.textContent.trim();
                        }
                        // Additional fallback: search the document for common poster-info patterns near the post id
                        if (authorName === 'Unknown') {
                            try {
                                const id = postDiv && postDiv.id ? postDiv.id : null;
                                if (id) {
                                    const byId = document.querySelector(`#${id}`);
                                    if (byId) {
                                        // look for preceding header row in same container
                                        const maybeRow = byId.closest('tr') || byId.closest('div.windowbg') || byId.closest('div.content');
                                        if (maybeRow) {
                                            const found = maybeRow.querySelector('td.poster_info a, .poster_info a, .username a, .poster a, a[rel="author"]');
                                            if (found && found.textContent) authorName = found.textContent.trim();
                                        }
                                    }
                                }
                            } catch (e) { }
                        }
                    } catch (e) { /* ignore author lookup errors */ }

                    // Permalink / subject
                    try {
                        const subjectDiv = contentTd ? contentTd.querySelector('div.subject') : (postDiv.querySelector('div.subject') || null);
                        if (subjectDiv) {
                            const linkElem = subjectDiv.querySelector('a'); if (linkElem) permalink = linkElem.href;
                        }
                        if (!permalink && contentTd) {
                            const anchorLink = contentTd.querySelector('a[href*="#msg"]'); if (anchorLink) permalink = anchorLink.href;
                        }
                        if (!permalink) {
                            const anyAnchor = postDiv.querySelector('a[href*="#msg"]') || document.querySelector('a[href*="#msg"]');
                            if (anyAnchor) permalink = anyAnchor.href;
                        }
                        if (permalink) {
                            const parts = permalink.split('#'); let cleanBase = parts[0].split(';')[0]; if (parts[1]) permalink = cleanBase + '#' + parts[1];
                        }
                    } catch (e) { }

                    // Date: try smalltext near subject, then any '.smalltext', then fallback to time element
                    try {
                        const subjectDiv = contentTd ? contentTd.querySelector('div.subject') : (postDiv.querySelector('div.subject') || null);
                        if (subjectDiv && subjectDiv.parentElement) {
                            const smallTextDiv = subjectDiv.parentElement.querySelector('.smalltext'); if (smallTextDiv) rawDate = smallTextDiv.textContent.trim();
                        }
                        if (!rawDate) {
                            const st = postDiv.querySelector('.smalltext') || postDiv.querySelector('time');
                            if (st) rawDate = (st.textContent || st.getAttribute('datetime') || '').trim();
                        }
                        // extra: scan nearby container for date-like text (month names / year)
                        if (!rawDate) {
                            try {
                                const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
                                    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec'];
                                const container = contentTd || postDiv;
                                const textCandidates = container ? Array.from(container.querySelectorAll('*')).map(n => n.textContent || '') : [];
                                for (let t of textCandidates) {
                                    if (!t) continue;
                                    for (let m of months) {
                                        if (t.indexOf(m) !== -1 && /\d{4}/.test(t)) { rawDate = t.trim(); break; }
                                    }
                                    if (rawDate) break;
                                }
                            } catch (e) { }
                        }
                    } catch (e) { }
                    try { if (rawDate && rawDate.indexOf('Today') === 0) rawDate = rawDate.replace('Today', getFormattedDateString()).replace(' at ', ', '); } catch (e) { }

                    const fragment = generateTextFragment(selectedText);
                    const dateStr = rawDate || 'Unknown Date';
                    const authorStr = authorName || 'Unknown Author';

                    const finalUrl = `${permalink}#:~:text=${fragment}`;
                    const quoteHeader = `[url=${finalUrl}]${authorStr} on ${dateStr}[/url]`;
                    const bbcode = `[quote="${quoteHeader}"]\n${selectedText}\n[/quote]`;

                    writeClipboard(bbcode).then(success => {
                        const originalText = btn.textContent;
                        if (success) {
                            btn.textContent = 'Copied!'; btn.style.backgroundColor = '#dff0d8'; btn.style.color = '#3c763d';
                            setTimeout(() => { btn.textContent = originalText; btn.style.backgroundColor = '#e7eaef'; btn.style.color = '#000'; hideButton(); }, 1000);
                        } else {
                            console.warn('processQuote: copy failed for bbcode', bbcode.slice(0, 120));
                            btn.textContent = 'Error'; btn.style.backgroundColor = '#f2dede'; setTimeout(hideButton, 1000);
                        }
                    }).catch(e => {
                        console.error('processQuote: writeClipboard threw', e);
                        btn.textContent = 'Error'; btn.style.backgroundColor = '#f2dede'; setTimeout(hideButton, 1000);
                    });
                } catch (err) {
                    console.error('Quote Error:', err, { selectedText: selectedText, postDiv: postDiv });
                    btn.textContent = 'Error'; btn.style.backgroundColor = '#f2dede'; setTimeout(hideButton, 1000);
                }
            }

        })();
    },

    // end of Altcointalks object
};

// Listener from popup.js
chrome.runtime.onMessage.addListener(
    function (message) {
        if (message && message.type === 'emoji-toolbar-toggle') {
            // emoji toolbar is handled by emoji-toolbar.js
        } else if (message && message.type === 'extension-reset-theme') {
            // remove any injected theme styles and classes
            try {
                document.querySelectorAll('.altcoinstalks-css-inject').forEach(el => { try { el.remove(); } catch (e) { /* ignore */ } });
                document.querySelectorAll('link[data-extension-theme], style[data-extension-theme]').forEach(el => { try { el.remove(); } catch (e) { /* ignore */ } });
                if (document && document.documentElement) {
                    const clsList = Array.from(document.documentElement.classList).filter(c => c.indexOf('altcoinstalks-theme-') === 0);
                    clsList.forEach(c => document.documentElement.classList.remove(c));
                }
            } catch (e) { /* ignore */ }
        } else if (message && message.key) {
            Altcointalks.init(message.key, message.value, 0);
        } else if (message && message.type === 'start-ws') {
            try {
                if (Array.isArray(message.ids) && message.ids.length > 0) startWebSockets(message.ids);
            } catch (e) { /* ignore */ }
        } else if (message && message.type === 'update-prices') {
            try {
                const header = (document.querySelectorAll('td.catbg')[1]) || null;
                Altcointalks.updatePrices(header);
            } catch (e) { /* ignore */ }
        } else if (message && message.type === 'toggle-quill-editor') {
            // Activate or disable the Quill editor according to the message.
            if (typeof window.initQuillEditor === 'function' && typeof window.destroyQuillEditor === 'function') {
                if (message.enabled) {
                    window.initQuillEditor();
                } else {
                    window.destroyQuillEditor();
                }
            }
        } else if (message && message.type === 'extension-apply-custom') {
            try {
                if (message.css) {
                    applyCustomCss(message.css);
                } else {
                    // fallback: read stored customCss
                    chrome.storage.local.get('customCss', (d) => { if (d && d.customCss) applyCustomCss(d.customCss); });
                }
            } catch (e) { /* ignore */ }
        }
    }
);

// Defer DOM-dependent initialization until DOM is ready
(function runWhenReady() {
    function doInit() {
        // Fetch stored settings plus any stored default/custom theme so
        // we can prefer default/custom over a numeric theme value.
        chrome.storage.local.get(['altcoinstalks', 'defaultTheme', 'customCss', 'themes'], function (storage) {
            try {
                Altcointalks.externalLink();
                Altcointalks.scrollToTop();
                Altcointalks.enhancedReportToModeratorUI();
                Altcointalks.addBoardNavigation();
                Altcointalks.format_counters();

                if (Altcointalks.isLoggedIn()) {
                    // merit-related feature removed
                }

                try {
                    if (typeof Altcointalks.initQuickQuote === 'function') {
                        Altcointalks.initQuickQuote();
                    }
                } catch (e) {
                    console.error('initQuickQuote error', e);
                }

                const bt = storage && storage.altcoinstalks ? storage.altcoinstalks : {};
                const hasDefaultOrCustom = !!(storage && (storage.defaultTheme || storage.customCss));
                // Apply stored zoom immediately so it's not accidentally overridden
                // by theme injection or later initialization steps.
                if (bt && bt.zoom !== undefined) {
                    try {
                        Altcointalks.init('zoom', bt.zoom, 1);
                    } catch (e) { console.warn('Altcointalks zoom init failed', e); }
                }
                if (bt && Object.keys(bt).length > 0) {
                    Object.keys(bt).forEach(function (key) {
                        // If a default theme or customCss exists, do not apply the numeric
                        // `theme` value since that would override the user's
                        // chosen default/custom theme immediately after applying it.
                        // Also skip 'zoom' because it's already applied above.
                        if ((key === 'theme' && hasDefaultOrCustom) || key === 'zoom') return;
                        Altcointalks.init(key, bt[key], 1);
                    });
                }
            } catch (e) {
                console.error('Altcointalks init error', e);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doInit, { once: true });
    } else {
        doInit();
    }
})();
// Apply custom CSS if available + live update when changed
function applyCustomCss(cssCode) {
    // remove any previous custom theme class/styles
    try {
        document.querySelectorAll('style.altcoinstalks-custom-theme, style[data-extension-theme="altcoinstalks-custom"]').forEach(el => { try { el.remove(); } catch (e) { } });
        if (document && document.documentElement) document.documentElement.classList.remove('altcoinstalks-custom');
    } catch (e) { /* ignore */ }

    if (!cssCode) return;

    // scope custom CSS under html.altcoinstalks-custom to avoid leaking to other themes
    try {
        const scope = 'html.altcoinstalks-custom';
        const scopedCss = (typeof Altcointalks !== 'undefined' && typeof Altcointalks.scopeCss === 'function') ? Altcointalks.scopeCss(cssCode, scope) : cssCode;
        const styleEl = document.createElement('style');
        styleEl.className = 'altcoinstalks-custom-theme';
        styleEl.setAttribute('data-extension-theme', 'altcoinstalks-custom');
        styleEl.textContent = scopedCss;
        (document.head || document.documentElement).appendChild(styleEl);
        if (document && document.documentElement) document.documentElement.classList.add('altcoinstalks-custom');
    } catch (e) {
        // fallback: inject raw css (less safe)
        try {
            const styleEl = document.createElement('style');
            styleEl.className = 'altcoinstalks-custom-theme';
            styleEl.setAttribute('data-extension-theme', 'altcoinstalks-custom');
            styleEl.textContent = cssCode;
            (document.head || document.documentElement).appendChild(styleEl);
        } catch (e2) { /* ignore */ }
    }
}

// Load default theme or last applied CSS
chrome.storage.local.get(['customCss', 'defaultTheme', 'themes'], (data) => {
    if (data.defaultTheme && data.themes && data.themes[data.defaultTheme]) {
        applyCustomCss(data.themes[data.defaultTheme]);
        chrome.storage.local.set({ customCss: data.themes[data.defaultTheme] });
    } else if (data.customCss) {
        applyCustomCss(data.customCss);
    }
});

// Listen for changes from popup
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.customCss) {
        applyCustomCss(changes.customCss.newValue);
    }
    // Update CoinGecko widget when altcoin selection changes
    try {
        if (area === 'local' && changes.altcoinstalks) {
            try {
                const newVal = changes.altcoinstalks.newValue || {};
                const altcoins = Array.isArray(newVal.altcoins) ? newVal.altcoins : null;
                if (altcoins !== null) {
                    try { Altcointalks.updateGeckoWidget(altcoins); } catch (e) { /* ignore */ }
                }
                // Show/hide price widget when popup toggles `price`
                try {
                    if (newVal && newVal.price !== undefined) {
                        try { Altcointalks.displayBitcoinPrice(newVal.price); } catch (e) { /* ignore */ }
                    }
                } catch (e) { /* ignore */ }
                // Apply widgetTheme if changed
                try {
                    if (newVal && newVal.widgetTheme !== undefined) {
                        try { Altcointalks.applyWidgetTheme(newVal.widgetTheme); } catch (e) { /* ignore */ }
                        try {
                            const container = document.querySelector('.altcoinstalks-gecko-widget');
                            if (container) {
                                const toActivate = container.querySelector('[data-theme-val="' + newVal.widgetTheme + '"]');
                                if (toActivate) {
                                    container.querySelectorAll('.altcoinstalks-theme-dot').forEach(a => a.classList.remove('active'));
                                    toActivate.classList.add('active');
                                }
                            }
                        } catch (e) { }
                    }
                } catch (e) { /* ignore */ }
                // Show/hide site ads when popup toggles `ads`
                try {
                    if (newVal && newVal.ads !== undefined) {
                        try { Altcointalks.toggleSiteAds(newVal.ads); } catch (e) {
                            // fallback: apply/remove ad-blocking style
                            try { applyAdToggle(newVal.ads !== 'on'); } catch (e2) { }
                        }
                    }
                } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }
});

// Inject local Quill assets (quill.snow.css, quill.min.js) and initialize editor
(function injectQuillAssets() {
    if (window.__altcoinstalks_quill_injected) return;
    window.__altcoinstalks_quill_injected = true;

    const cssUrl = chrome.runtime.getURL('css/quill.snow.css');
    const quillJsUrl = chrome.runtime.getURL('js/quill.min.js');
    const initUrl = chrome.runtime.getURL('js/quill-editor.js');

    function doInject() {
        try {
            // inject stylesheet
            try {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = cssUrl;
                (document.head || document.documentElement).appendChild(link);
            } catch (e) { /* ignore */ }

            // inject quill script
            const s = document.createElement('script');
            s.src = quillJsUrl;
            s.async = false;
            s.onload = function () {
                try {
                    // inject initializer
                    const s2 = document.createElement('script');
                    s2.src = initUrl;
                    s2.async = false;
                    s2.onload = function () {
                        try { if (window.initQuillEditor) window.initQuillEditor(); } catch (e) { }
                    };
                    (document.documentElement || document.head || document.body).appendChild(s2);
                } catch (e) { console.warn('quill init inject failed', e); }
            };
            s.onerror = function (e) { console.warn('quill script failed to load', e); };
            (document.documentElement || document.head || document.body).appendChild(s);
        } catch (err) {
            console.warn('injectQuillAssets error', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doInject, { once: true });
    } else {
        doInject();
    }
})();

// Simple ad-toggle helper: inject/remove a lightweight style that hides common ad containers
function applyAdToggle(hideAds) {
    try {
        const STYLE_ID = 'altcoinstalks-ad-blocker-style';
        // Restore: unhide previously hidden nodes and remove style
        if (!hideAds) {
            try {
                document.querySelectorAll('[data-altcoinstalks-hidden="1"]').forEach(el => {
                    try {
                        const prev = el.getAttribute('data-altcoinstalks-prev-display');
                        if (prev !== null && prev !== undefined) el.style.display = prev;
                        else el.style.display = '';
                        el.removeAttribute('data-altcoinstalks-prev-display');
                        el.removeAttribute('data-altcoinstalks-hidden');
                    } catch (e) { }
                });
            } catch (e) { }
            const existing = document.getElementById(STYLE_ID);
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
            return;
        }

        // Hide path: find likely ad containers but avoid hiding those that contain whitelisted images
        const containerSelectors = [
            '.adsbygoogle', '.ad', '.ads', '.advert', '.advertise', '.advertisement', '.adbox', '.ad-container', '.ad-slot', '.adunit', '.ad-wrapper', '[id^="ad-"]', '[id^="ad_"]', '[id*="-ad-"]'
        ];

        const whitelistImgSelectors = [
            'img[src*="i.imgur.com"]', 'img[src*="imgur.com"]'
        ];

        // First, hide any <center> blocks that contain known ad link patterns (site-specific selectors)
        try {
            const centerAdHosts = ['reumix.xyz', 'mixero.io'];
            document.querySelectorAll('center').forEach(center => {
                try {
                    const links = Array.from(center.querySelectorAll('a'));
                    const adLink = links.find(a => {
                        try {
                            const href = a.getAttribute && a.getAttribute('href') ? a.getAttribute('href') : (a.href || '');
                            if (!href) return false;
                            return centerAdHosts.some(h => href.indexOf(h) !== -1);
                        } catch (e) { return false; }
                    });
                    if (adLink) {
                        if (center.getAttribute && center.getAttribute('data-altcoinstalks-hidden') !== '1') {
                            const prev = center.style && center.style.display ? center.style.display : window.getComputedStyle(center).display || '';
                            try { center.setAttribute('data-altcoinstalks-prev-display', prev); } catch (e) { }
                            try { center.setAttribute('data-altcoinstalks-hidden', '1'); } catch (e) { }
                            try { center.style.display = 'none'; } catch (e) { }
                        }
                    }
                } catch (e) { }
            });
        } catch (e) { }

        // Then hide matching containers unless they contain a whitelisted image
        try {
            const nodes = document.querySelectorAll(containerSelectors.join(','));
            nodes.forEach(node => {
                try {
                    // skip if node already hidden by us
                    if (node.getAttribute && node.getAttribute('data-altcoinstalks-hidden') === '1') return;
                    let hasWhitelisted = false;
                    for (const sel of whitelistImgSelectors) {
                        try { if (node.querySelector(sel)) { hasWhitelisted = true; break; } } catch (e) { }
                    }
                    if (hasWhitelisted) return; // do not hide
                    const prev = node.style && node.style.display ? node.style.display : window.getComputedStyle(node).display || '';
                    try { node.setAttribute('data-altcoinstalks-prev-display', prev); } catch (e) { }
                    try { node.setAttribute('data-altcoinstalks-hidden', '1'); } catch (e) { }
                    try { node.style.display = 'none'; } catch (e) { }
                } catch (e) { }
            });
        } catch (e) { }

        // Also hide clearly ad-related iframes via style element
        try {
            if (!document.getElementById(STYLE_ID)) {
                const s = document.createElement('style');
                s.id = STYLE_ID;
                s.textContent = 'iframe[src*="ads"]{display:none !important;}';
                (document.head || document.documentElement).appendChild(s);
            }
        } catch (e) { }
    } catch (e) { /* ignore errors */ }
}

// Apply initial ads setting on load
try {
    chrome.storage.local.get('altcoinstalks', (res) => {
        try {
            const s = res && res.altcoinstalks ? res.altcoinstalks : {};
            // default: ads ON (do not hide). If key exists and is 'off', hide.
            const shouldHide = s.ads === 'off' || s.ads === false;
            applyAdToggle(!!shouldHide);
        } catch (e) { }
    });
} catch (e) { }
