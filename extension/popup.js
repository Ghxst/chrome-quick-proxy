document.addEventListener('DOMContentLoaded', () => {
    const el = (id) => document.getElementById(id);

    chrome.storage.sync.get(
        ['host', 'port', 'username', 'password', 'webrtc'],
        (d) => {
            if (d.host) el('host').value = d.host;
            if (d.port) el('port').value = d.port;
            if (d.username) el('user').value = d.username;
            if (d.password) el('pass').value = d.password;
            if (d.webrtc) el('webrtc').value = d.webrtc;
        }
    );

    el('save').addEventListener('click', () => {
        const proxyCfg = {
            host: el('host').value.trim(),
            port: Number(el('port').value.trim()),
            username: el('user').value.trim(),
            password: el('pass').value
        };
        if (!proxyCfg.host || !proxyCfg.port) {
            alert('Host and port are required.');
            return;
        }
        const webrtc = el('webrtc').value;
        chrome.runtime.sendMessage(
            { action: 'setAll', data: { proxy: proxyCfg, webrtc } },
            handleResponse
        );
    });

    el('clear').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'clearAll' }, handleResponse);
    });

    function handleResponse(res) {
        if (chrome.runtime.lastError || (res && res.ok === false)) {
            alert(
                chrome.runtime.lastError?.message ||
                res?.error ||
                'Unknown error while communicating with background script.'
            );
        } else {
            window.close();
        }
    }
});
