let authListener = null;

async function clearProxy() {
    if (authListener) {
        chrome.webRequest.onAuthRequired.removeListener(authListener);
        authListener = null;
    }
    return new Promise((r) => chrome.proxy.settings.clear({ scope: "regular" }, r));
}

async function applyProxy(cfg) {
    await clearProxy();
    const v = {
        mode: "fixed_servers",
        rules: {
            singleProxy: { scheme: "http", host: cfg.host, port: Number(cfg.port) },
            bypassList: ["localhost", "127.0.0.1", "::1"]
        }
    };
    await new Promise((r) => chrome.proxy.settings.set({ value: v, scope: "regular" }, r));
    if (cfg.username && cfg.password) {
        authListener = (d) => {
            if (!d.isProxy) return { cancel: true };
            return { authCredentials: { username: cfg.username, password: cfg.password } };
        };
        chrome.webRequest.onAuthRequired.addListener(authListener, { urls: ["<all_urls>"] }, ["blocking"]);
    }
}

const policy = chrome.privacy.network.webRTCIPHandlingPolicy;
const setRTC = (v) =>
    new Promise((rs, rj) => policy.set({ value: v, scope: "regular" }, () => (chrome.runtime.lastError ? rj(chrome.runtime.lastError) : rs())));

chrome.runtime.onMessage.addListener((m, _, send) => {
    (async () => {
        try {
            if (m.action === "setAll") {
                await Promise.all([applyProxy(m.data.proxy), setRTC(m.data.webrtc)]);
                chrome.storage.sync.set({ ...m.data.proxy, webrtc: m.data.webrtc });
            } else if (m.action === "clearAll") {
                await Promise.all([clearProxy(), setRTC("default")]);
                chrome.storage.sync.clear();
            } else throw new Error("bad action");
            send({ ok: true });
        } catch (e) {
            send({ ok: false, error: e.message });
        }
    })();
    return true;
});
