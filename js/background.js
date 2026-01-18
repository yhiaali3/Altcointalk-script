// Background service worker: handle price fetches to avoid CORS issues in content script
const _cache = { ts: 0, ttl: 30000, data: {}, backoffUntil: 0 };
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

// Track whether we asked content scripts to open WS for given ids (so we don't spam them)
const wsRequestedFor = {};

// helper: fetch with timeout for background requests
function fetchWithTimeoutBG(resource, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const opts = Object.assign({}, options, { signal: controller.signal });
    return fetch(resource, opts).finally(() => clearTimeout(id));
}

function broadcastToTabs(message) {
    try {
        chrome.tabs.query({}, (tabs) => {
            if (!tabs) return;
            tabs.forEach(t => {
                try { chrome.tabs.sendMessage(t.id, message); } catch (e) { /* ignore send failures */ }
            });
        });
    } catch (e) { /* ignore */ }
}

// Update cache from content/websocket updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;

    if (message.type === 'ws-price-update' && message.id) {
        try {
            const now = Date.now();
            _cache.data[message.id] = Number(message.price || 0);
            _cache.ts = now;
            // keep ttl small so UI updates quickly
            _cache.ttl = 30000;
        } catch (e) { /* ignore */ }
        return; // not an async response
    }

    if (message.type !== 'fetch-prices') return;

    (async () => {
        try {
            const ids = Array.isArray(message.ids) && message.ids.length > 0 ? message.ids : ['bitcoin', 'ethereum'];
            const now = Date.now();

            // if we're in backoff period, return cached data if available
            if (_cache.backoffUntil && now < _cache.backoffUntil) {
                const available = {};
                ids.forEach(id => { if (_cache.data[id] !== undefined) available[id] = _cache.data[id]; });
                if (Object.keys(available).length > 0) {
                    sendResponse({ success: true, prices: available, source: 'cache' });
                    return;
                }
                sendResponse({ success: false, error: 'rate-limited' });
                return;
            }

            // serve from cache if fresh and covers requested ids
            if (now - _cache.ts < _cache.ttl) {
                const available = {};
                let ok = true;
                ids.forEach(id => { if (_cache.data[id] !== undefined) available[id] = _cache.data[id]; else ok = false; });
                if (ok) { sendResponse({ success: true, prices: available, source: 'cache' }); return; }
            }

            // Try CoinGecko batched request
            const idsStr = ids.join(',');
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsStr)}&vs_currencies=usd`;
            const resp = await fetchWithTimeoutBG(url, { cache: 'no-store' }, 10000);
            if (resp && resp.ok) {
                const json = await resp.json();
                const out = {};
                ids.forEach(id => { out[id] = (json[id] && json[id].usd) ? Number(json[id].usd) : 0; _cache.data[id] = out[id]; });
                _cache.ts = now; _cache.ttl = 30000; _cache.backoffUntil = 0;
                sendResponse({ success: true, prices: out, source: 'coingecko' });

                // Ask content scripts to open websocket connections for supported symbols
                const binanceIds = ids.filter(id => binanceMap[id]);
                if (binanceIds.length > 0) {
                    const key = binanceIds.sort().join(',');
                    if (!wsRequestedFor[key]) {
                        wsRequestedFor[key] = Date.now();
                        // notify all tabs to start WS for these ids; content will open WS where possible
                        broadcastToTabs({ type: 'start-ws', ids: binanceIds });
                    }
                }

                return;
            }

            // If CoinGecko returned 429 or other error, set backoff for a bit and try Binance for supported symbols
            if (resp && resp.status === 429) {
                _cache.backoffUntil = now + 60000; // 60s backoff
            }

            // attempt Binance REST fallback for each id mapped
            const toFetch = ids.map(id => ({ id, symbol: binanceMap[id] })).filter(x => x.symbol);
            if (toFetch.length > 0) {
                try {
                    const results = await Promise.all(toFetch.map(x => fetchWithTimeoutBG(`https://api.binance.com/api/v3/ticker/price?symbol=${x.symbol}`, { cache: 'no-store' }, 8000).then(r => r.ok ? r.json() : Promise.reject(new Error('binance ' + r.status)))));
                    const out = {};
                    results.forEach((r, i) => { const id = toFetch[i].id; out[id] = r && r.price ? Number(r.price) : 0; _cache.data[id] = out[id]; });
                    _cache.ts = now; _cache.ttl = 30000; sendResponse({ success: true, prices: out, source: 'binance' }); return;
                } catch (err2) {
                    // fall through
                }
            }

            sendResponse({ success: false, error: 'failed to fetch prices' });
        } catch (err) {
            sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
        }
    })();
    return true; // indicate async response
});
