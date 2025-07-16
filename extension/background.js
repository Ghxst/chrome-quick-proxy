let authListener = null;

async function clearProxy() {
    if (authListener) {
        chrome.webRequest.onAuthRequired.removeListener(authListener);
        authListener = null;
    }
    return new Promise((resolve) =>
        chrome.proxy.settings.clear({ scope: 'regular' }, resolve)
    );
}

async function applyProxy(cfg) {
    await clearProxy();

    const value = {
        mode: 'fixed_servers',
        rules: {
            singleProxy: { scheme: 'http', host: cfg.host, port: Number(cfg.port) },
            bypassList: ['localhost', '127.0.0.1', '::1']
        }
    };

    await new Promise((resolve) =>
        chrome.proxy.settings.set({ value, scope: 'regular' }, resolve)
    );

    if (cfg.username && cfg.password) {
        authListener = (details) => {
            if (!details.isProxy) return { cancel: true };
            return { authCredentials: { username: cfg.username, password: cfg.password } };
        };
        chrome.webRequest.onAuthRequired.addListener(
            authListener,
            { urls: ['<all_urls>'] },
            ['blocking']
        );
    }
}

const webRtcPolicy = chrome.privacy.network.webRTCIPHandlingPolicy;

async function setWebRtcPolicy(value) {
    return new Promise((resolve, reject) => {
        webRtcPolicy.set({ value, scope: 'regular' }, () => {
            chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve();
        });
    });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        try {
            switch (msg.action) {
                case 'setAll':
                    await Promise.all([
                        applyProxy(msg.data.proxy),
                        setWebRtcPolicy(msg.data.webrtc)
                    ]);
                    chrome.storage.sync.set({ ...msg.data.proxy, webrtc: msg.data.webrtc });
                    break;
                case 'clearAll':
                    await Promise.all([clearProxy(), setWebRtcPolicy('default')]);
                    chrome.storage.sync.clear();
                    break;
                default:
                    throw new Error('unknown action');
            }
            sendResponse({ ok: true });
        } catch (err) {
            sendResponse({ ok: false, error: err.message });
        }
    })();
    return true; // keep port open
});
