document.addEventListener("DOMContentLoaded", () => {
    const $ = (i) => document.getElementById(i);
    const host = $("host"), port = $("port"), user = $("user"), pass = $("pass"), rtc = $("webrtc");
    const save = $("save"), clr = $("clear");
    const harBtn = $("harBtn"), harFile = $("harFile"), harCtl = $("harControls"), entrySel = $("entrySelect"), sideSel = $("sideSelect"), harImp = $("importCookies");
    const sessBtn = $("sessionBtn");

    chrome.storage.sync.get(["host", "port", "username", "password", "webrtc"], (d) => {
        if (d.host) host.value = d.host;
        if (d.port) port.value = d.port;
        if (d.username) user.value = d.username;
        if (d.password) pass.value = d.password;
        if (d.webrtc) rtc.value = d.webrtc;
    });

    const bg = (msg, cb) => chrome.runtime.sendMessage(msg, cb);

    save.addEventListener("click", () => {
        const p = { host: host.value.trim(), port: Number(port.value.trim()), username: user.value.trim(), password: pass.value };
        if (!p.host || !p.port) return alert("Host and port required.");
        bg({ action: "setAll", data: { proxy: p, webrtc: rtc.value } }, (r) => {
            if (chrome.runtime.lastError || r?.ok === false) alert(chrome.runtime.lastError?.message || r?.error || "Error");
            else window.close();
        });
    });

    clr.addEventListener("click", () =>
        bg({ action: "clearAll" }, (r) => {
            if (chrome.runtime.lastError || r?.ok === false) alert(chrome.runtime.lastError?.message || r?.error || "Error");
            else window.close();
        })
    );

    let harEntries = [];

    harBtn.addEventListener("click", () => harFile.click());

    harFile.addEventListener("change", () => {
        if (!harFile.files.length) return;
        const rd = new FileReader();
        rd.onload = (e) => {
            try {
                const h = JSON.parse(e.target.result);
                harEntries = h?.log?.entries || [];
                if (!harEntries.length) throw "no entries";
                entrySel.innerHTML = harEntries.map((en, i) => `<option value="${i}">${i + 1} — ${en.request.method} ${en.request.url}</option>`).join("");
                harCtl.style.display = "block";
            } catch (err) {
                alert("HAR error"); harEntries = []; harCtl.style.display = "none";
            }
        };
        rd.readAsText(harFile.files[0]);
    });

    const setCk = (o) => new Promise((res, rej) => chrome.cookies.set(o, () => (chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())));

    const mkURL = (c, def) => {
        const h = (c.domain || new URL(def).hostname).replace(/^\./, "");
        return (c.secure ? "https://" : "http://") + h + (c.path || "/");
    };

    harImp.addEventListener("click", async () => {
        const en = harEntries[Number(entrySel.value)];
        if (!en) return alert("No entry.");
        const jar = en[sideSel.value]?.cookies || [];
        if (!jar.length) return alert("No cookies.");
        let ok = 0;
        for (const c of jar)
            try {
                await setCk({ url: mkURL(c, en.request.url), name: c.name, value: c.value, domain: c.domain, path: c.path || "/", secure: !!c.secure, httpOnly: !!c.httpOnly, expirationDate: c.expires ? Number(c.expires) : undefined });
                ok++;
            } catch (_) { }
        alert(`Imported ${ok}/${jar.length} cookies`);
    });

    sessBtn.addEventListener("click", async () => {
        const txt = prompt("Paste session JSON"); if (!txt) return;
        let data; try { data = JSON.parse(txt); } catch (_) { return alert("Invalid JSON"); }
        const jar = data.cookies || []; if (!jar.length) return alert("No cookies field.");
        let ok = 0;
        for (const c of jar)
            if (c.name && c.value && c.domain)
                try {
                    await setCk({ url: mkURL(c, "https://" + c.domain.replace(/^\./, "")), name: c.name, value: c.value, domain: c.domain, path: c.path || "/", secure: !!c.secure, httpOnly: !!c.httpOnly, expirationDate: c.expires ? Number(c.expires) : undefined });
                    ok++;
                } catch (_) { }
        alert(`Loaded ${ok}/${jar.length} cookies`);
    });
});
