/* ==================================================================== */
/*  Quick Proxy Auth – background service-worker                        */
/* ==================================================================== */

/* ── handy aliases ──────────────────────────────────────────────────── */
const S = chrome.cookies.set;
const W = chrome.proxy.settings;
const P = chrome.webRequest.onAuthRequired;
const Q = chrome.privacy.network.webRTCIPHandlingPolicy;

const G = (o) => new Promise((res, rej) =>
    S(o, () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())
);

/* ── listener handles / state ──────────────────────────────────────── */
let proxyAuthL = null;
let stripHdrL = null;
let killCookieL = null;
let baselineSet = new Set();

/* ── proxy helpers ─────────────────────────────────────────────────── */
async function clearProxy() {
    if (proxyAuthL) { P.removeListener(proxyAuthL); proxyAuthL = null; }
    await new Promise(r => W.clear({ scope: "regular" }, r));
}
async function applyProxy(cfg) {
    await clearProxy();
    await new Promise(r => W.set({
        value: {
            mode: "fixed_servers",
            rules: {
                singleProxy: { scheme: "http", host: cfg.host, port: +cfg.port },
                bypassList: ["localhost", "127.0.0.1", "::1"]
            }
        },
        scope: "regular"
    }, r));
    if (cfg.username && cfg.password) {
        proxyAuthL = d => d.isProxy
            ? { authCredentials: { username: cfg.username, password: cfg.password } }
            : { cancel: true };
        P.addListener(proxyAuthL, { urls: ["<all_urls>"] }, ["blocking"]);
    }
}
async function setRTC(policy) {
    await new Promise((r, a) =>
        Q.set({ value: policy, scope: "regular" },
            () => chrome.runtime.lastError ? a(chrome.runtime.lastError) : r()));
}

/* ── “block-new-cookies” implementation ────────────────────────────── */
const keyOf = c => `${c.name}|${c.domain}|${c.path}`;

async function snapshotCookies() {
    baselineSet.clear();
    const all = await chrome.cookies.getAll({});
    for (const c of all) baselineSet.add(keyOf(c));
}

/* install / remove block mode */
function updateCookieBlock(enabled) {
    /* turn OFF */
    if (!enabled) {
        if (stripHdrL) chrome.webRequest.onHeadersReceived.removeListener(stripHdrL);
        if (killCookieL) chrome.cookies.onChanged.removeListener(killCookieL);
        stripHdrL = killCookieL = null;
        baselineSet.clear();
        console.info("[BlockNewCookies] disabled");
        return;
    }
    /* already ON? */
    if (stripHdrL) return;

    snapshotCookies().then(() =>
        console.info(`[BlockNewCookies] enabled — baseline=${baselineSet.size}`)
    );

    /* 1) strip Set-Cookie headers (log each blocked cookie) */
    stripHdrL = (details) => {
        const kept = [];
        for (const h of details.responseHeaders) {
            if (h.name.toLowerCase() !== "set-cookie") {
                kept.push(h);
                continue;
            }
            const first = (h.value || "").split(";")[0];
            const cname = first.split("=")[0].trim() || "(unnamed)";
            console.info("[BlockNewCookies] header-block",
                cname, "←", details.url);
            /* header is dropped */
        }
        return { responseHeaders: kept };
    };
    chrome.webRequest.onHeadersReceived.addListener(
        stripHdrL,
        { urls: ["<all_urls>"] },
        ["blocking", "responseHeaders", "extraHeaders"]
    );

    /* 2) delete brand-new cookies written at runtime (log each) */
    killCookieL = ({ removed, cookie, cause }) => {
        if (removed) return;                     // ignore deletions
        const k = keyOf(cookie);
        if (baselineSet.has(k)) return;          // existed before block was enabled
        chrome.cookies.remove({
            url: (cookie.secure ? "https://" : "http://") +
                cookie.domain.replace(/^\./, "") + cookie.path,
            name: cookie.name
        });
        console.info("[BlockNewCookies] runtime-block",
            `${cookie.name}@${cookie.domain}${cookie.path}`, "cause:", cause);
    };
    chrome.cookies.onChanged.addListener(killCookieL);
}

/* restore block state on SW start */
chrome.storage.sync.get("blockNewCookies",
    ({ blockNewCookies }) => updateCookieBlock(!!blockNewCookies));

/* ── main message bridge ───────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((m, _, send) => {
    (async () => {
        try {
            switch (m.action) {
                case "applyProxyConfig": await applyProxy(m.cfg); break;
                case "clearProxyConfig": await clearProxy(); break;
                case "setWebRTCPolicy": await setRTC(m.policy); break;
                case "setBlockCookies": updateCookieBlock(!!m.enabled); break;

                /* ------- cookie export ------------------------------------- */
                case "exportCookies": {
                    const list = await chrome.cookies.getAll({});
                    const data = 'data:application/json;base64,' +
                        btoa(unescape(encodeURIComponent(JSON.stringify(list))));
                    chrome.downloads.download({
                        url: data, filename: `cookies_${Date.now()}.json`
                    });
                    break;
                }

                /* ------- JSON cookie import -------------------------------- */
                case "importCookies": {
                    const jar = JSON.parse(m.json);
                    for (const c of jar) if (c.name && c.value && c.domain) {
                        try {
                            await G({
                                url: (c.secure ? "https://" : "http://") +
                                    c.domain.replace(/^\./, "") + (c.path || "/"),
                                name: c.name, value: c.value,
                                domain: c.domain, path: c.path || "/",
                                secure: !!c.secure, httpOnly: !!c.httpOnly,
                                sameSite: m.mode === "cross" ? "no_restriction" : c.sameSite,
                                expirationDate: c.expirationDate ??
                                    (c.expires ? Number(c.expires) : undefined)
                            });
                        } catch { }
                    }
                    break;
                }

                /* ------- HAR cookie import --------------------------------- */
                case "importHarCookies": {
                    const h = JSON.parse(m.har);
                    const en = h?.log?.entries?.[m.entryIndex];
                    if (en) {
                        const jar = en[m.source]?.cookies || [];
                        for (const c of jar) {
                            await G({
                                url: (c.secure ? "https://" : "http://") +
                                    (c.domain || new URL(en.request.url).hostname)
                                        .replace(/^\./, "") + (c.path || "/"),
                                name: c.name, value: c.value,
                                domain: c.domain, path: c.path || "/",
                                secure: !!c.secure, httpOnly: !!c.httpOnly,
                                expirationDate: c.expires ? Number(c.expires) : undefined
                            });
                        }
                    }
                    break;
                }
            }
        } catch (err) {
            console.error("[background] error:", err);
        }
        send();          // async response
    })();
    return true;
});
