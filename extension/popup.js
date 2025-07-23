/* ── tiny helpers ──────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const icons = () => lucide.createIcons();
const show = (el, on = true) => el.classList[on ? "remove" : "add"]("hidden");

const setDot = (colour) =>
    $("ipDot").className = `inline-block w-2 h-2 rounded-full ${colour}`;

/* ── IP lookup ─────────────────────────────────────────────────────── */
async function updateIP() {
    setDot("bg-gray-400");
    try {
        const txt = await fetch("https://cloudflare-dns.com/cdn-cgi/trace").then(r => r.text());
        const kv = Object.fromEntries(txt.trim().split("\n").map(l => l.split("=")));
        $("ipInfo").textContent = `IP: ${kv.ip || "?"} | LOC: ${kv.loc || "?"}`;
        setDot("bg-green-500");
    } catch {
        $("ipInfo").textContent = "IP: ?";
        setDot("bg-red-500");
    }
}

/* ── FIRST bootstrap: presets + IP bubble ──────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    icons();
    updateIP();

    const customBtn = $("tabCustom");
    const presetBtn = $("tabPreset");
    const customForm = $("customForm");
    const presetForm = $("presetForm");
    const vendorSel = $("vendorSelect");
    const proxySel = $("proxySelect");
    const applyBtn = $("applyPresetBtn");

    const activate = (tab) => {
        const active = tab === "custom";
        customBtn.classList.toggle("text-blue-600", active);
        customBtn.classList.toggle("text-slate-600", !active);
        presetBtn.classList.toggle("text-blue-600", !active);
        presetBtn.classList.toggle("text-slate-600", active);
        customBtn.classList.toggle("border-blue-600", active);
        presetBtn.classList.toggle("border-blue-600", !active);
        show(customForm, active);
        show(presetForm, !active);
    };
    customBtn.onclick = () => activate("custom");
    presetBtn.onclick = () => activate("preset");

    /* presets.json (optional) */
    try {
        const presets = await fetch(chrome.runtime.getURL("presets.json")).then(r => r.json());
        Object.keys(presets).forEach((v) => {
            const o = document.createElement("option");
            o.value = o.textContent = v;
            vendorSel.appendChild(o);
        });

        vendorSel.onchange = () => {
            proxySel.innerHTML = "<option>Select proxy</option>";
            (presets[vendorSel.value] || []).forEach((p, i) => {
                const o = document.createElement("option");
                o.value = i;
                o.textContent = `${p.host}:${p.port}`;
                proxySel.appendChild(o);
            });
        };

        applyBtn.onclick = () => {
            const v = vendorSel.value;
            const idx = proxySel.value;
            if (!presets[v] || !presets[v][idx]) return;
            const p = presets[v][idx];
            $("host").value = p.host;
            $("port").value = p.port;
            $("user").value = p.user || "";
            $("pass").value = p.pass || "";
            activate("custom");
        };
    } catch { }

    const queueUpdate = (d) => { setDot("bg-gray-400"); setTimeout(updateIP, d); };
    $("saveBtn").addEventListener("click", () => queueUpdate(1000));
    $("applyPresetBtn").addEventListener("click", () => queueUpdate(1000));
    $("clearBtn").addEventListener("click", () => queueUpdate(500));
});

/* ── cookie helpers ────────────────────────────────────────────────── */
const setCookie = (o) =>
    new Promise((res, rej) =>
        chrome.cookies.set(o, () =>
            chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()
        )
    );

const toEpoch = (val) => {
    if (val == null) return undefined;                 // session
    if (typeof val === "number" && isFinite(val))
        return val > 0 ? val : undefined;               // 0 / -1 → session
    const t = Date.parse(val);
    return isFinite(t) ? t / 1000 : undefined;
};
const nowSec = () => (Date.now() / 1000) | 0;

/* SameSite mapper (HTTP style → Chrome) */
function normalizeSameSite(s) {
    if (s == null) return undefined;

    if (typeof s === "number") {
        switch (s) {
            case 1: return "lax";
            case 2: return "strict";
            case 3: return "no_restriction";
            default: return "unspecified";
        }
    }
    const v = String(s).trim().toLowerCase();
    if (["lax", "strict", "no_restriction", "unspecified"].includes(v)) return v;
    if (v === "none") return "no_restriction";
    if (v === "default") return "unspecified";
    return "unspecified";
}

/**
 * Import an array of cookie objects with FULL diagnostics.
 * @param {Array} jar
 * @param {string|undefined} ss  override SameSite ("no_restriction" for cross)
 */
async function importJar(jar, ss, baseUrl, ignoreExp = false) {
    const mode = ss === "no_restriction" ? "cross-site" : "standard";
    let ok = 0, failed = [], expired = [];

    console.groupCollapsed(`[Import][${mode}] ${jar.length} cookies → ${baseUrl}`);
    for (const c of jar) {
        const forceSecure = ss === "no_restriction";
        const isSecure = forceSecure ? true : !!c.secure;
        const scheme = (isSecure || /^\s*https:/i.test(baseUrl)) ? "https://" : "http://";
        const host = (c.domain || new URL(baseUrl || "https://dummy").hostname).replace(/^\./, "");
        const url = scheme + host + (c.path || "/");

        const exp = toEpoch(c.expirationDate ?? c.expires);
        if (!ignoreExp && exp !== undefined && exp <= nowSec()) {
            console.info("⏰ expired — skip", c.name);
            expired.push(c.name);
            continue;
        }

        const mappedSS = ss ?? normalizeSameSite(c.sameSite);

        const objTemplate = {
            url,
            name: c.name,
            value: c.value,
            path: c.path || "/",
            secure: isSecure,
            httpOnly: !!c.httpOnly,
            sameSite: mappedSS
        };
        if (c.domain) objTemplate.domain = c.domain;
        if (!ignoreExp && exp !== undefined) objTemplate.expirationDate = exp;

        /* attempt #1 — as is */
        try {
            console.debug("🔄 setCookie (full)", objTemplate);
            await setCookie(objTemplate);
            ok++;
            console.debug("✅ success", c.name);
            continue;
        } catch (err) {
            console.warn("⚠️  failed", c.name, err?.message || err);
        }

        /* attempt #2 — host-only */
        if (c.domain) {
            const { domain, ...hostObj } = objTemplate;
            try {
                console.debug("↻ retry host-only", hostObj);
                await setCookie(hostObj);
                ok++;
                console.debug("✅ host-only success", c.name);
                continue;
            } catch (err) {
                console.warn("❌ host-only failed", c.name, err?.message || err);
            }
        }
        failed.push(c.name);
    }
    console.groupEnd();
    console.info(`⟡ Import summary (${mode}): ${ok}/${jar.length} ok | ${expired.length} expired | ${failed.length} failed`);
    return [ok, expired, failed];
}

/* HAR globals -------------------------------------------------------- */
let harRaw = "", harEntries = [];

/* ── toggle password visibility ────────────────────────────────────── */
document.addEventListener("click", (e) => {
    const btn = e.target.closest("#togglePass");
    if (!btn) return;
    const inp = $("pass");
    inp.type = inp.type === "password" ? "text" : "password";
    btn.querySelector("i").setAttribute("data-lucide", inp.type === "password" ? "eye" : "eye-off");
    icons();
});

/* ── SECOND bootstrap: restore settings & import/export UI ─────────── */
document.addEventListener("DOMContentLoaded", () => {
    icons();

    const blockChk = $("blockCookies");

    /* restore prefs */
    chrome.storage.sync.get(["proxyConfig", "webrtcPolicy", "blockNewCookies"], (d) => {
        if (d.proxyConfig) {
            const c = d.proxyConfig;
            $("host").value = c.host || "";
            $("port").value = c.port || "";
            $("user").value = c.username || "";
            $("pass").value = c.password || "";
        }
        d.webrtcPolicy && ($("webrtc").value = d.webrtcPolicy);
        blockChk.checked = !!d.blockNewCookies;
    });

    /* proxy save / clear */
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
        ["host", "port", "user", "pass"].forEach(id => $(id).value = "");
    };

    /* WebRTC */
    $("webrtc").onchange = (e) => {
        chrome.storage.sync.set({ webrtcPolicy: e.target.value });
        chrome.runtime.sendMessage({ action: "setWebRTCPolicy", policy: e.target.value });
    };

    /* Block-new-cookies */
    blockChk.onchange = (e) => {
        chrome.storage.sync.set({ blockNewCookies: e.target.checked });
        chrome.runtime.sendMessage({ action: "setBlockCookies", enabled: e.target.checked });
    };

    /* export all cookies */
    $("exportCookiesBtn").onclick = () => {
        if (!confirm("Warning: this will export ALL cookies in your browser. Continue?")) return;
        chrome.cookies.getAll({}, (list) => {
            const blob = new Blob([JSON.stringify(list)], { type: "application/json" });
            chrome.downloads.download({
                url: URL.createObjectURL(blob),
                filename: `cookies_${Date.now()}.json`,
            });
        });
    };

    /* session JSON paste */
    $("loadSessionBtn").onclick = async () => {
        const txt = prompt("Paste session JSON:");
        if (!txt) return;
        let data;
        try { data = JSON.parse(txt); } catch { return alert("Invalid JSON"); }
        const jar = data.cookies || [];
        if (!jar.length) return alert("No cookies array.");
        const [ok, exp, fail] = await importJar(jar, undefined, location.href, $("ignoreExpiry").checked);
        alert(`Imported ${ok}/${jar.length}\nExpired skipped: ${exp.length}\nFailed: ${fail.length}`);
    };

    /* JSON file import */
    const jsonPick = $("importJsonFile");
    function pickJson(ss) {
        jsonPick.value = "";
        jsonPick.click();
        jsonPick.onchange = async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            let jar;
            try { jar = JSON.parse(await f.text()); } catch { return alert("Invalid JSON file."); }
            if (!Array.isArray(jar) || !jar.length) return alert("No cookies array.");
            const [ok, exp, fail] = await importJar(jar, ss, location.href, $("ignoreExpiry").checked);
            alert(`Imported ${ok}/${jar.length}\nExpired skipped: ${exp.length}\nFailed: ${fail.length}`);
        };
    }
    $("standardImportBtn").onclick = () => pickJson(undefined);
    $("crossImportBtn").onclick = () => pickJson("no_restriction");

    /* HAR import workflow */
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
                harEntries.map((en, i) =>
                    `<option value="${i}">${i + 1} — ${en.request.method} ${en.request.url.slice(0, 60)}</option>`
                ).join("");
            $("harUI").classList.remove("hidden");
        } catch {
            alert("Invalid HAR file.");
            harRaw = ""; harEntries = [];
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
            alert(`Imported ${ok}/${jar.length}\nExpired skipped: ${exp.length}\nFailed: ${fail.length}`)
        );
    }
    $("standardHarBtn").onclick = () => runHarImport("standard");
    $("crossHarBtn").onclick = () => runHarImport("cross");
});
