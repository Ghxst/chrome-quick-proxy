let L = null;                          // auth proxy listener
let H = null;                          // "block new cookies" listener

const S = chrome.cookies.set,
    G = (u) => new Promise((r, a) =>
        S(u, x => chrome.runtime.lastError ? a(chrome.runtime.lastError) : r(x))),
    W = chrome.proxy.settings,
    P = chrome.webRequest.onAuthRequired,
    Q = chrome.privacy.network.webRTCIPHandlingPolicy;

/* ── proxy helpers ──────────────────────────────────────────────────── */

async function clearProxy() {
    if (L) { P.removeListener(L); L = null; }
    await new Promise(r => W.clear({ scope: "regular" }, r));
}

async function applyProxy(c) {
    await clearProxy();
    await new Promise(r => W.set({
        value: {
            mode: "fixed_servers",
            rules: {
                singleProxy: { scheme: "http", host: c.host, port: +c.port },
                bypassList: ["localhost", "127.0.0.1", "::1"]
            }
        },
        scope: "regular"
    }, r));
    if (c.username && c.password) {
        L = d => d.isProxy ? {
            authCredentials: { username: c.username, password: c.password }
        } : { cancel: !0 };
        P.addListener(L, { urls: ["<all_urls>"] }, ["blocking"]);
    }
}

async function setRTC(v) {
    await new Promise((r, a) =>
        Q.set({ value: v, scope: "regular" },
            () => chrome.runtime.lastError ? a(chrome.runtime.lastError) : r()));
}

/* ── block-new-cookies helpers ─────────────────────────────────────── */

function updateCookieBlock(enabled) {
    if (enabled && !H) {
        H = (d) => {
            if (!d.responseHeaders) return;
            return {
                responseHeaders: d.responseHeaders.filter(
                    h => h.name.toLowerCase() !== "set-cookie"
                )
            };
        };
        chrome.webRequest.onHeadersReceived.addListener(
            H,
            { urls: ["<all_urls>"] },
            ["blocking", "responseHeaders", "extraHeaders"]
        );
        return;
    }
    if (!enabled && H) {
        chrome.webRequest.onHeadersReceived.removeListener(H);
        H = null;
    }
}

/* restore persisted block-state on (re)load */
chrome.storage.sync.get("blockNewCookies", d =>
    updateCookieBlock(!!d.blockNewCookies));

/* ── message bridge ────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((m, _, send) => {
    (async () => {
        try {
            if (m.action === "applyProxyConfig") await applyProxy(m.cfg);
            else if (m.action === "clearProxyConfig") await clearProxy();
            else if (m.action === "setWebRTCPolicy") await setRTC(m.policy);
            else if (m.action === "setBlockCookies") updateCookieBlock(!!m.enabled);
            else if (m.action === "exportCookies") {
                const list = await new Promise(r => chrome.cookies.getAll({}, r));
                const data = 'data:application/json;base64,' +
                    btoa(unescape(encodeURIComponent(JSON.stringify(list))));
                chrome.downloads.download({
                    url: data,
                    filename: `cookies_${Date.now()}.json`
                });
            }
            else if (m.action === "importCookies") {
                const jar = JSON.parse(m.json); let ok = 0;
                for (const c of jar) if (c.name && c.value && c.domain) {
                    try {
                        await G({
                            url: (c.secure ? 'https://' : 'http://') +
                                c.domain.replace(/^\./, '') + (c.path || '/'),
                            name: c.name,
                            value: c.value,
                            domain: c.domain,
                            path: c.path || '/',
                            secure: !!c.secure,
                            httpOnly: !!c.httpOnly,
                            sameSite: m.mode === 'cross' ? 'no_restriction' : c.sameSite,
                            expirationDate: c.expirationDate ??
                                (c.expires ? Number(c.expires) : undefined)
                        });
                        ok++;
                    } catch { }
                }
            }
            else if (m.action === "importHarCookies") {
                const h = JSON.parse(m.har),
                    e = h?.log?.entries || [],
                    en = e[m.entryIndex];
                if (en) {
                    const jar = en[m.source]?.cookies || [];
                    for (const c of jar) {
                        await G({
                            url: (c.secure ? 'https://' : 'http://') +
                                (c.domain || new URL(en.request.url).hostname)
                                    .replace(/^\./, '') + (c.path || '/'),
                            name: c.name,
                            value: c.value,
                            domain: c.domain,
                            path: c.path || '/',
                            secure: !!c.secure,
                            httpOnly: !!c.httpOnly,
                            expirationDate: c.expires ? Number(c.expires) : undefined
                        });
                    }
                }
            }
        } catch (_) { }
        send();
    })();
    return true;   // keep channel open
});
