const $ = (id) => document.getElementById(id);
const icons = () => lucide.createIcons();

const show = (el, on = true) => el.classList[on ? 'remove' : 'add']('hidden')

document.addEventListener('DOMContentLoaded', async () => {
    icons()

    const customBtn = $('tabCustom')
    const presetBtn = $('tabPreset')
    const customForm = $('customForm')
    const presetForm = $('presetForm')
    const vendorSel = $('vendorSelect')
    const proxySel = $('proxySelect')
    const applyBtn = $('applyPresetBtn')

    const activate = tab => {
        const active = tab === 'custom'
        customBtn.classList.toggle('text-blue-600', active)
        customBtn.classList.toggle('text-slate-600', !active)
        presetBtn.classList.toggle('text-blue-600', !active)
        presetBtn.classList.toggle('text-slate-600', active)
        customBtn.classList.toggle('border-blue-600', active)
        presetBtn.classList.toggle('border-blue-600', !active)
        show(customForm, active)
        show(presetForm, !active)
    }

    customBtn.onclick = () => activate('custom')
    presetBtn.onclick = () => activate('preset')

    // load presets.json
    try {
        const presets = await fetch(chrome.runtime.getURL('presets.json')).then(r => r.json())
    
        Object.keys(presets).forEach(v => {
            const o = document.createElement('option')
            o.value = o.textContent = v
            vendorSel.appendChild(o)
        })

        vendorSel.onchange = () => {
            proxySel.innerHTML = '<option>Select proxy</option>'
            const list = presets[vendorSel.value] || []
            list.forEach((p, i) => {
                const o = document.createElement('option')
                o.value = i
                o.textContent = `${p.host}:${p.port}`
                proxySel.appendChild(o)
            })
        }

        applyBtn.onclick = () => {
            const v = vendorSel.value
            const idx = proxySel.value
            if (!presets[v] || !presets[v][idx]) return
            const p = presets[v][idx]
            $('host').value = p.host
            $('port').value = p.port
            $('user').value = p.user || ''
            $('pass').value = p.pass || ''
            activate('custom')
        }
    } catch { }
})

/* ---------- helpers ---------------------------------------------------- */

const setCookie = (o) =>
    new Promise((res, rej) =>
        chrome.cookies.set(o, () =>
            chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()
        )
    );

const toEpoch = (val) => {
    if (val == null) return undefined;            // session cookie
    if (typeof val === "number" && isFinite(val))
        return val > 0 ? val : undefined;           // 0 / –1 → session
    const t = Date.parse(val);
    return isFinite(t) ? t / 1000 : undefined;    // seconds
};
const nowSec = () => (Date.now() / 1000) | 0;

/* ---------- cookie importer ------------------------------------------- */
/**
 * @param {Array} jar   cookie objects
 * @param {string|undefined} ss  SameSite override ("no_restriction")
 * @param {string} baseUrl       url for scheme/host fallback
 * @param {boolean} ignoreExp    if true, omit expirationDate
 */
async function importJar(jar, ss, baseUrl, ignoreExp = false) {
    let ok = 0,
        failed = [],
        expired = [];

    for (const c of jar) {
        const forceSecure = ss === "no_restriction";
        const isSecure = forceSecure ? true : !!c.secure;
        const scheme =
            isSecure || /^\s*https:/i.test(baseUrl) ? "https://" : "http://";
        const host = (
            c.domain || new URL(baseUrl || "https://dummy").hostname
        ).replace(/^\./, "");
        const url = scheme + host + (c.path || "/");

        const exp = toEpoch(c.expirationDate ?? c.expires);
        if (!ignoreExp && exp !== undefined && exp <= nowSec()) {
            console.warn("⏰ expired — skip", c.name, { exp, src: c });
            expired.push(c.name);
            continue;
        }

        const obj = {
            url,
            name: c.name,
            value: c.value,
            path: c.path || "/",
            secure: isSecure,
            httpOnly: !!c.httpOnly,
        };
        if (c.domain) obj.domain = c.domain;
        if (!ignoreExp && exp !== undefined) obj.expirationDate = exp; // <<< key change
        if (ss || c.sameSite) obj.sameSite = ss ?? c.sameSite;

        try {
            console.log("🔄 setCookie »", obj);
            await setCookie(obj);
            ok++;
            continue;
        } catch (err) {
            console.warn("⚠️  failed", c.name, err?.message || err);
        }

        /* retry host-only (domain removed) */
        if (c.domain) {
            const { domain, ...hostOnly } = obj;
            try {
                console.log("🔄 retry host-only »", hostOnly);
                await setCookie(hostOnly);
                ok++;
                continue;
            } catch (err) {
                console.warn("⚠️  failed host-only", c.name, err?.message || err);
            }
        }
        failed.push(c.name);
    }

    console.info(
        `✅ imported ${ok}/${jar.length} | ⏰ expired ${expired.length} | ❌ failed ${failed.length}`
    );
    return [ok, expired, failed];
}

/* ---------- HAR state -------------------------------------------------- */

let harRaw = "",
    harEntries = [];

/* ---------- UI --------------------------------------------------------- */

document.addEventListener("click", (e) => {
    const btn = e.target.closest("#togglePass");
    if (!btn) return;
    const inp = $("pass");
    inp.type = inp.type === "password" ? "text" : "password";
    btn.querySelector("i").setAttribute(
        "data-lucide",
        inp.type === "password" ? "eye" : "eye-off"
    );
    icons();
});

document.addEventListener("DOMContentLoaded", () => {
    icons();

    /* restore settings */
    chrome.storage.sync.get(["proxyConfig", "webrtcPolicy"], (d) => {
        if (d.proxyConfig) {
            const c = d.proxyConfig;
            $("host").value = c.host || "";
            $("port").value = c.port || "";
            $("user").value = c.username || "";
            $("pass").value = c.password || "";
        }
        d.webrtcPolicy && ($("webrtc").value = d.webrtcPolicy);
    });

    /* proxy */
    $("saveBtn").onclick = () => {
        const cfg = {
            host: $("host").value.trim(),
            port: +$("port").value || 0,
            username: $("user").value.trim(),
            password: $("pass").value.trim(),
        };
        chrome.storage.sync.set({ proxyConfig: cfg });
        chrome.runtime.sendMessage({ action: "applyProxyConfig", cfg });
    };
    $("clearBtn").onclick = () => {
        chrome.storage.sync.remove("proxyConfig");
        chrome.runtime.sendMessage({ action: "clearProxyConfig" });
        ["host", "port", "user", "pass"].forEach((id) => ($(id).value = ""));
    };

    /* WebRTC */
    $("webrtc").onchange = (e) => {
        chrome.storage.sync.set({ webrtcPolicy: e.target.value });
        chrome.runtime.sendMessage({
            action: "setWebRTCPolicy",
            policy: e.target.value,
        });
    };

    /* export */
    $("exportCookiesBtn").onclick = () => {
        if (
            !confirm(
                "Warning: this will export ALL cookies stored in your browser. Continue?"
            )
        )
            return;
        chrome.cookies.getAll({}, (list) => {
            const blob = new Blob([JSON.stringify(list)], {
                type: "application/json",
            });
            chrome.downloads.download({
                url: URL.createObjectURL(blob),
                filename: `cookies_${Date.now()}.json`,
            });
        });
    };

    /* session paste */
    $("loadSessionBtn").onclick = async () => {
        const txt = prompt("Paste session JSON:");
        if (!txt) return;
        let data;
        try {
            data = JSON.parse(txt);
        } catch {
            return alert("Invalid JSON");
        }
        const jar = data.cookies || [];
        if (!jar.length) return alert("No cookies array.");
        const [ok, exp, fail] = await importJar(
            jar,
            undefined,
            location.href,
            $("ignoreExpiry").checked
        );
        alert(
            `Imported ${ok}/${jar.length}\nExpired skipped: ${exp.length}\nFailed: ${fail.length}`
        );
    };

    /* JSON imports */
    const jsonPick = $("importJsonFile");
    function pickJson(ss) {
        jsonPick.value = "";
        jsonPick.click();
        jsonPick.onchange = async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            let jar;
            try {
                jar = JSON.parse(await f.text());
            } catch {
                return alert("Invalid JSON file.");
            }
            if (!Array.isArray(jar) || !jar.length)
                return alert("No cookies array.");
            const [ok, exp, fail] = await importJar(
                jar,
                ss,
                location.href,
                $("ignoreExpiry").checked
            );
            alert(
                `Imported ${ok}/${jar.length}\nExpired skipped: ${exp.length}\nFailed: ${fail.length}`
            );
        };
    }
    $("standardImportBtn").onclick = () => pickJson(undefined);
    $("crossImportBtn").onclick = () => pickJson("no_restriction");

    /* HAR import */
    const harPick = $("harFile");
    $("importHarBtn").onclick = () => harPick.click();

    harPick.onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
            harRaw = await f.text();
            const har = JSON.parse(harRaw);
            harEntries = har?.log?.entries || [];
            if (!harEntries.length) throw 0;
            $("harEntry").innerHTML =
                '<option selected disabled>Select entry</option>' +
                harEntries
                    .map(
                        (en, i) =>
                            `<option value="${i}">${i + 1} — ${en.request.method} ${en.request.url.slice(
                                0,
                                60
                            )}</option>`
                    )
                    .join("");
            $("harUI").classList.remove("hidden");
        } catch {
            alert("Invalid HAR file.");
            harRaw = "";
            harEntries = [];
            $("harUI").classList.add("hidden");
        }
    };

    function runHarImport(mode) {
        if (!harRaw) return alert("Choose a HAR file first.");
        const idx = $("harEntry").selectedIndex - 1;
        if (idx < 0) return alert("Pick an entry first.");
        const src = $("cookieSource").value;
        const en = harEntries[idx];
        const jar = en?.[src]?.cookies || [];
        if (!jar.length) return alert("No cookies.");
        importJar(
            jar,
            mode === "cross" ? "no_restriction" : undefined,
            en.request.url,
            $("ignoreExpiry").checked
        ).then(([ok, exp, fail]) =>
            alert(
                `Imported ${ok}/${jar.length}\nExpired skipped: ${exp.length}\nFailed: ${fail.length}`
            )
        );
    }
    $("standardHarBtn").onclick = () => runHarImport("standard");
    $("crossHarBtn").onclick = () => runHarImport("cross");
});
