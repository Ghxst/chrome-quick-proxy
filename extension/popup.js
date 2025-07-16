document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);

    const hostEl = $('host');
    const portEl = $('port');
    const userEl = $('user');
    const passEl = $('pass');
    const rtcEl = $('webrtc');
    const saveBtn = $('save');
    const clrBtn = $('clear');

    const harBtn = $('harBtn');
    const harFile = $('harFile');
    const harControls = $('harControls');
    const entrySel = $('entrySelect');
    const sideSel = $('sideSelect');
    const importBtn = $('importCookies');

    chrome.storage.sync.get(
        ['host', 'port', 'username', 'password', 'webrtc'],
        (d) => {
            if (d.host) hostEl.value = d.host;
            if (d.port) portEl.value = d.port;
            if (d.username) userEl.value = d.username;
            if (d.password) passEl.value = d.password;
            if (d.webrtc) rtcEl.value = d.webrtc;
        }
    );

    saveBtn.addEventListener('click', () => {
        const proxy = {
            host: hostEl.value.trim(),
            port: Number(portEl.value.trim()),
            username: userEl.value.trim(),
            password: passEl.value
        };
        if (!proxy.host || !proxy.port) {
            alert('Host and port are required.');
            return;
        }
        chrome.runtime.sendMessage(
            { action: 'setAll', data: { proxy, webrtc: rtcEl.value } },
            handleBgResponse
        );
    });

    clrBtn.addEventListener('click', () =>
        chrome.runtime.sendMessage({ action: 'clearAll' }, handleBgResponse)
    );

    function handleBgResponse(res) {
        if (chrome.runtime.lastError || (res && res.ok === false)) {
            alert(chrome.runtime.lastError?.message || res?.error || 'Unknown error');
        } else {
            window.close();
        }
    }

    let cachedEntries = [];

    harBtn.addEventListener('click', () => harFile.click());

    harFile.addEventListener('change', () => {
        if (!harFile.files.length) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const har = JSON.parse(e.target.result);
                cachedEntries = har?.log?.entries || [];
                if (!cachedEntries.length) throw new Error('No log.entries[] in file');
                entrySel.innerHTML = cachedEntries
                    .map(
                        (en, i) =>
                            `<option value="${i}">${i + 1} — ${en.request.method} ${en.request.url}</option>`
                    )
                    .join('');
                harControls.style.display = 'block';
            } catch (err) {
                alert('HAR parse error: ' + err.message);
                cachedEntries = [];
                harControls.style.display = 'none';
            }
        };
        reader.readAsText(harFile.files[0]);
    });

    importBtn.addEventListener('click', async () => {
        const entry = cachedEntries[Number(entrySel.value)];
        if (!entry) {
            alert('No entry selected.');
            return;
        }
        const jar = entry[sideSel.value]?.cookies || [];
        if (!jar.length) {
            alert('Selected entry has no cookies on that side.');
            return;
        }
        const fallbackURL = entry.request.url;
        const mkURL = (c, def) => {
            const base = c.secure ? 'https://' : 'http://';
            const host = (c.domain || new URL(def).hostname).replace(/^\./, '');
            const path = c.path || '/';
            return base + host + path;
        };
        let ok = 0;
        for (const c of jar) {
            try {
                await new Promise((res, rej) =>
                    chrome.cookies.set(
                        {
                            url: mkURL(c, fallbackURL),
                            name: c.name,
                            value: c.value,
                            domain: c.domain,
                            path: c.path || '/',
                            secure: !!c.secure,
                            httpOnly: !!c.httpOnly,
                            sameSite: c.sameSite,
                            expirationDate: c.expires ? Date.parse(c.expires) / 1000 : undefined
                        },
                        () => (chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())
                    )
                );
                ok++;
            } catch (e) {
                console.warn('cookie import:', e);
            }
        }
        alert(`Imported ${ok}/${jar.length} cookie(s).`);
    });
});
