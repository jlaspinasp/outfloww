/* =====================================================
   CHATTER TOOL
   All data is stored locally in the browser.
   ===================================================== */


const STORAGE_KEY = "chatterTool_v1";


// Net percentage
const NET_RATE = 0.80;


// Default data
const defaultData = {
    sales: {},
    history: [],
    models: [],
    scripts: [],
    customCategories: {
        scripts: []
    },
    deletedModels: {},
    // Per-model custom colors, e.g. { "<modelId>": "#ffd6e0" }
    modelColors: {}
};


// Load saved data
function normalizeData(obj) {

    obj = obj || {};

    obj.sales = obj.sales || {};
    obj.history = obj.history || [];
    obj.models = obj.models || [];
    obj.scripts = obj.scripts || [];
    obj.target = obj.target || 0;

    obj.customCategories = obj.customCategories || {};
    obj.customCategories.scripts = obj.customCategories.scripts || [];

    // Per-model daily targets, e.g. { "<modelId>": 300 }
    obj.modelTargets = obj.modelTargets || {};

    // Names of models that were deleted, kept so old sales
    // records can still show a name instead of "Unassigned".
    obj.deletedModels = obj.deletedModels || {};

    // Per-model custom colors, e.g. { "<modelId>": "#ffd6e0" }
    obj.modelColors = obj.modelColors || {};

    return obj;

}


let data = normalizeData(
    JSON.parse(
        localStorage.getItem(STORAGE_KEY)
    ) || defaultData
);


// Current filters
let currentCategory = {
    scripts: "All"
};

// Which model's sales page is currently active on the Sales tab.
// null = "All" (combined, original behavior).
let currentModelFilter = null;

// Remembers each tab's scroll position so switching tabs and
// coming back doesn't dump you at the top.
const pageScrollPositions = {};


/* =====================================================
   THEME
   ===================================================== */


const THEME_KEY = "chatterTool_theme";


function applyTheme(theme) {

    if (theme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
    } else {
        document.documentElement.removeAttribute("data-theme");
    }

    const icon = $("#themeToggleIcon");
    const label = $("#themeToggleLabel");
    const mobileIcon = $("#mobileThemeToggleIcon");

    if (icon) {
        icon.textContent = theme === "light" ? "☀️" : "🌙";
    }

    if (label) {
        label.textContent = theme === "light" ? "Light mode" : "Dark mode";
    }

    if (mobileIcon) {
        mobileIcon.textContent = theme === "light" ? "☀️" : "🌙";
    }

}


function initTheme() {

    const saved = localStorage.getItem(THEME_KEY) || "dark";

    applyTheme(saved);

}


const SIDEBAR_KEY = "chatterTool_sidebarCollapsed";


function applySidebarCollapsed(collapsed) {

    const app = $(".app");
    const btn = $("#sidebarCollapseBtn");

    if (app) {
        app.classList.toggle("sidebar-collapsed", collapsed);
    }

    if (btn) {
        btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    }

}


function initSidebarCollapse() {

    const saved = localStorage.getItem(SIDEBAR_KEY) === "true";

    applySidebarCollapsed(saved);

}


function toggleSidebarCollapse() {

    const app = $(".app");

    const next = !app.classList.contains("sidebar-collapsed");

    localStorage.setItem(SIDEBAR_KEY, String(next));

    applySidebarCollapsed(next);

}


function toggleTheme() {

    const current =
        document.documentElement.getAttribute("data-theme") === "light"
            ? "light"
            : "dark";

    const next = current === "light" ? "dark" : "light";

    localStorage.setItem(THEME_KEY, next);

    applyTheme(next);

    // Re-render so the model-name accent color (dark in light mode,
    // bright in dark mode) updates immediately for the new theme.
    renderSales();

}


// Modal state
let modalType = null;
let editingId = null;

// View modal state (read-only popup for a card)
let viewType = null;
let viewId = null;


/* =====================================================
   HELPERS
   ===================================================== */


function $(selector) {
    return document.querySelector(selector);
}


function $$(selector) {
    return document.querySelectorAll(selector);
}


function saveData() {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(data)
    );
    pushToCloud();
}


/* =====================================================
   CLOUD SYNC (Firebase Auth + Firestore)
   ===================================================== */


let cloudDocRef = null;
let cloudUnsubscribe = null;
let isApplyingRemoteData = false;
let lastPushedJSON = null;
let pushTimer = null;


let syncFadeTimer = null;

function setSyncStatus(state) {

    const el = $("#syncStatus");

    if (!el) {
        return;
    }

    clearTimeout(syncFadeTimer);

    el.classList.remove("synced", "syncing", "offline");
    el.classList.add(state);
    el.classList.add("show");

    el.textContent =
        state === "synced" ? "Synced" :
        state === "syncing" ? "Syncing…" :
        "Offline";

    if (state === "synced") {
        syncFadeTimer = setTimeout(() => {
            el.classList.remove("show");
        }, 1500);
    }

}


function renderAll() {
    updateHistory();
    renderSales();
    renderChips("scripts");
    renderContent("models");
    renderContent("scripts");
}


function pushToCloud() {

    if (!cloudDocRef || isApplyingRemoteData) {
        return;
    }

    setSyncStatus("syncing");

    clearTimeout(pushTimer);

    pushTimer = setTimeout(function () {

        const json = JSON.stringify(data);
        lastPushedJSON = json;

        cloudDocRef.set(data)
            .then(function () {
                setSyncStatus("synced");
            })
            .catch(function (err) {
                console.error("Cloud sync failed:", err);
                setSyncStatus("offline");
            });

    }, 500);

}


function startCloudSync(uid) {

    cloudDocRef =
        db.collection("users")
            .doc(uid)
            .collection("appData")
            .doc("main");

    setSyncStatus("syncing");

    cloudUnsubscribe = cloudDocRef.onSnapshot(
        function (snapshot) {

            // Ignore the local echo of our own pending write —
            // we already have this data.
            if (snapshot.metadata.hasPendingWrites) {
                return;
            }

            if (!snapshot.exists) {
                // First sign-in on any device: seed the cloud
                // with whatever is currently stored on this one.
                cloudDocRef.set(data).then(function () {
                    lastPushedJSON = JSON.stringify(data);
                    setSyncStatus("synced");
                });
                return;
            }

            const remote = snapshot.data();
            const remoteJSON = JSON.stringify(remote);

            // This snapshot just confirms a write we made ourselves.
            if (remoteJSON === lastPushedJSON) {
                setSyncStatus("synced");
                return;
            }

            // Genuinely new data from another device — apply it.
            isApplyingRemoteData = true;

            data = normalizeData(remote);

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(data)
            );

            renderAll();

            isApplyingRemoteData = false;
            lastPushedJSON = remoteJSON;

            setSyncStatus("synced");

        },
        function (err) {
            console.error("Cloud sync error:", err);
            setSyncStatus("offline");
        }
    );

}


function stopCloudSync() {

    if (cloudUnsubscribe) {
        cloudUnsubscribe();
        cloudUnsubscribe = null;
    }

    cloudDocRef = null;

}


// Tracks which account's data is currently cached in localStorage on
// this device, so we never seed one account's cloud doc with data
// left behind by a different account that previously signed in here.
const LAST_UID_KEY = "chatterTool_lastUid";


function resetLocalData() {

    data = normalizeData({});

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(data)
    );

    renderAll();

}


function initAuthGate() {

    const authGate = $("#authGate");
    const authError = $("#authError");
    const googleSignInBtn = $("#googleSignInBtn");
    const syncStatus = $("#syncStatus");
    const signOutBtn = $("#signOutBtn");
    const accountEmail = $("#accountEmail");

    googleSignInBtn.addEventListener("click", function () {

        authError.classList.add("hidden");
        googleSignInBtn.disabled = true;

        const provider = new firebase.auth.GoogleAuthProvider();

        auth.signInWithPopup(provider)
            .catch(function (err) {

                // User closing the popup isn't a real error.
                if (err.code === "auth/popup-closed-by-user") {
                    return;
                }

                authError.textContent =
                    "Couldn't sign in with Google — please try again.";
                authError.classList.remove("hidden");

            })
            .finally(function () {
                googleSignInBtn.disabled = false;
            });

    });

    signOutBtn.addEventListener("click", function () {
        auth.signOut();
    });

    auth.onAuthStateChanged(function (user) {

        if (user) {

            const lastUid = localStorage.getItem(LAST_UID_KEY);

            if (lastUid !== user.uid) {

                // This device's local cache belongs to a different
                // account (or no account yet). Wipe it before we do
                // anything else, so we never display it and never
                // seed this account's cloud doc with someone else's
                // data if this happens to be a first sign-in here.
                resetLocalData();

                localStorage.setItem(LAST_UID_KEY, user.uid);

            }

            authGate.classList.add("hidden");
            syncStatus.classList.remove("hidden");

            signOutBtn.classList.remove("hidden");
            accountEmail.textContent = user.email || "Signed in";

            startCloudSync(user.uid);

        } else {

            stopCloudSync();
            resetLocalData();
            localStorage.removeItem(LAST_UID_KEY);

            authGate.classList.remove("hidden");
            syncStatus.classList.add("hidden");
            signOutBtn.classList.add("hidden");

        }

    });

}


function getDateKey() {

    const date = new Date();

    const year = date.getFullYear();

    const month =
        String(date.getMonth() + 1)
        .padStart(2, "0");

    const day =
        String(date.getDate())
        .padStart(2, "0");

    return `${year}-${month}-${day}`;
}


function money(amount) {

    return "$" +
        Number(amount).toLocaleString(
            undefined,
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        );
}


function getTodaySales() {

    const key = getDateKey();

    return data.sales[key] || [];
}


function getTotal(sales) {

    return sales.reduce(
        (total, sale) =>
            total + Number(sale.amount),
        0
    );
}


function formatDate(dateKey) {

    return new Date(
        dateKey + "T00:00:00"
    ).toLocaleDateString(
        undefined,
        {
            month: "short",
            day: "numeric",
            year: "numeric"
        }
    );
}


/* =====================================================
   TRENDS (daily / monthly rollups)
   ===================================================== */

let currentTrendRange = "day";

function getPeriodKey(dateKey, range) {

    if (range === "day") {
        return dateKey;
    }

    const d = new Date(dateKey + "T00:00:00");

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getPeriodLabel(key, range) {

    if (range === "month") {
        const [y, m] = key.split("-");
        // Full year here on purpose — a 2-digit year ("Sep 26")
        // reads as day 26, not year 2026.
        return new Date(`${y}-${m}-01T00:00:00`)
            .toLocaleDateString(undefined, { month: "short", year: "numeric" });
    }

    return new Date(key + "T00:00:00")
        .toLocaleDateString(undefined, { month: "short", day: "numeric" });
}


function daysInMonthKey(monthKey) {

    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m, 0).getDate();
}


function addPeriod(key, range, delta) {

    if (range === "month") {
        const [y, m] = key.split("-").map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }

    const d = new Date(key + "T00:00:00");
    d.setDate(d.getDate() + delta);

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderTrends(range) {

    currentTrendRange = range || currentTrendRange;

    // Each model tracks its own target and history separately —
    // there's no combined "all models" trend to show here.
    if (currentModelFilter === null) {
        $("#trendBars").innerHTML =
            `<div class="trend-empty">Select a model above to see its trend</div>`;
        $("#trendSummary").innerHTML = "";
        return;
    }

    const today = getDateKey();

    const combined = computeModelDailyRows(currentModelFilter, false);

    const buckets = {};

    combined.forEach(item => {
        const key = getPeriodKey(item.date, currentTrendRange);
        if (!buckets[key]) buckets[key] = { gross: 0, net: 0, count: 0 };
        buckets[key].gross += item.gross;
        buckets[key].net += item.net;
        buckets[key].count += item.count;
    });

    // Always show 7 periods, with today/this month centered
    // (3 before, the current one, 3 after).
    const periodsToShow = 7;
    const centerOffset = 3;
    const currentKey = getPeriodKey(today, currentTrendRange);

    const rows = [];
    for (let i = -centerOffset; i <= periodsToShow - 1 - centerOffset; i++) {
        const key = addPeriod(currentKey, currentTrendRange, i);

        rows.push({
            key,
            label: getPeriodLabel(key, currentTrendRange),
            net: buckets[key] ? buckets[key].net : 0,
            count: buckets[key] ? buckets[key].count : 0,
            isCurrent: key === currentKey
        });
    }

    const maxNet = Math.max(...rows.map(r => r.net), 1);

    $("#trendBars").innerHTML = rows.map(r => {

        let modelLines = "";

        if (currentTrendRange === "day") {

            const dailyTarget = data.modelTargets[currentModelFilter] || 0;
            const pct = getTargetPercent(r.net, dailyTarget);

            if (pct !== null) {
                modelLines = `\n${pct >= 100 ? "Target hit" : `${pct}% of target`}`;
            }
        } else {

            const dailyTarget = data.modelTargets[currentModelFilter] || 0;
            const monthTarget = dailyTarget * daysInMonthKey(r.key);
            const pct = getTargetPercent(r.net, monthTarget);

            if (pct !== null) {
                modelLines = `\n${pct >= 100 ? "Target hit" : `${pct}% of target`}`;
            }
        }

        const tooltip =
            `${r.label}: ${money(r.net)} net · ${r.count} sale${r.count === 1 ? "" : "s"}${modelLines}`;

        return `
        <div class="trend-bar-col${r.isCurrent ? " trend-bar-current" : ""}" title="${escapeHTML(tooltip)}">
            <div class="trend-bar-track">
                <div class="trend-bar-fill" style="height:${r.net > 0 ? Math.max((r.net / maxNet) * 100, 4) : 0}%"></div>
            </div>
            <div class="trend-bar-label">${r.label}</div>
        </div>
    `;
    }).join("");

    const current = rows.find(r => r.isCurrent);
    const currentIndex = rows.indexOf(current);
    const prev = currentIndex > 0 ? rows[currentIndex - 1] : null;
    const periodWord = currentTrendRange === "day" ? "day" : "month";

    let summaryHtml = `<strong>${money(current.net)}</strong> net this ${periodWord}`;

    if (prev) {
        const diff = current.net - prev.net;
        const pct = prev.net > 0
            ? Math.round((diff / prev.net) * 100)
            : (current.net > 0 ? 100 : 0);

        if (diff > 0) {
            summaryHtml += ` <span class="trend-up">▲ ${pct}% vs last ${periodWord}</span>`;
        } else if (diff < 0) {
            summaryHtml += ` <span class="trend-down">▼ ${Math.abs(pct)}% vs last ${periodWord}</span>`;
        } else {
            summaryHtml += ` <span class="trend-flat">— same as last ${periodWord}</span>`;
        }
    }

    $("#trendSummary").innerHTML = summaryHtml;
}

$$(".trend-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        $$(".trend-toggle-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderTrends(btn.dataset.range);
    });
});


/* =====================================================
   MODEL AVATAR STRIP (per-model sales pages)
   ===================================================== */


function getModelById(id) {
    return data.models.find(model => model.id === id);
}


function getModelName(id) {

    if (!id) {
        return "Unassigned";
    }

    const model = getModelById(id);

    if (model) {
        return model.title;
    }

    if (data.deletedModels[id]) {
        return data.deletedModels[id];
    }

    return "Unassigned";
}


function getInitials(name) {

    const parts = String(name).trim().split(/\s+/).filter(Boolean);

    if (!parts.length) {
        return "?";
    }

    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }

    return (parts[0][0] + parts[1][0]).toUpperCase();
}


function getAvatarColor(id) {

    // A custom color the user picked wins over the generated one.
    if (data.modelColors && data.modelColors[id]) {
        return data.modelColors[id];
    }

    let hash = 0;

    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = Math.abs(hash) % 360;

    // High lightness + moderate saturation = soft pastel by default.
    return `hsl(${hue}, 70%, 84%)`;
}


/* =====================================================
   ROW CONTRAST HELPERS
   Model colors aren't guaranteed to be light pastels (the
   custom picker allows anything), so text/UI colors on top
   of a model's row are computed from its actual brightness
   instead of being hardcoded to dark.
   ===================================================== */

function hexToRgb(hex) {

    hex = hex.replace("#", "");

    if (hex.length === 3) {
        hex = hex.split("").map(c => c + c).join("");
    }

    const num = parseInt(hex, 16);

    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

function hslToRgb(h, s, l) {

    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

function parseColorToRgb(colorStr) {

    if (colorStr.startsWith("#")) {
        return hexToRgb(colorStr);
    }

    const match = colorStr.match(
        /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i
    );

    if (match) {
        return hslToRgb(
            parseFloat(match[1]),
            parseFloat(match[2]),
            parseFloat(match[3])
        );
    }

    return { r: 200, g: 200, b: 200 };
}

function rgbToHsl(r, g, b) {

    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {

        const d = max - min;

        s = l > 0.5
            ? d / (2 - max - min)
            : d / (max + min);

        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }

        h /= 6;

    }

    return { h: h * 360, s: s * 100, l: l * 100 };

}


// A heavier, high-contrast version of a model's (often pale) color,
// for use as text on top of the neutral card background rather than
// as a background fill. Darker in light mode, brighter in dark mode,
// with saturation floored so it still reads as "that model's color."
function getAccentTextColor(colorStr) {

    const { r, g, b } = parseColorToRgb(colorStr);
    const { h, s } = rgbToHsl(r, g, b);

    const isLightTheme =
        document.documentElement.getAttribute("data-theme") === "light";

    const sat = Math.max(s, 65);
    const light = isLightTheme ? 22 : 72;

    return `hsl(${h}, ${sat}%, ${light}%)`;

}


function getRowInk(colorStr) {

    const { r, g, b } = parseColorToRgb(colorStr);

    // Perceived brightness (ITU-R BT.601), 0–1.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const isDark = luminance < 0.58;

    return isDark
        ? {
            strong: "rgba(255,255,255,0.95)",
            muted: "rgba(255,255,255,0.72)",
            radioBorder: "rgba(255,255,255,0.6)",
            radioBg: "rgba(255,255,255,0.15)",
            trackBg: "rgba(255,255,255,0.22)",
            trackFill: "rgba(255,255,255,0.75)"
        }
        : {
            strong: "rgba(0,0,0,0.85)",
            muted: "rgba(0,0,0,0.58)",
            radioBorder: "rgba(0,0,0,0.4)",
            radioBg: "rgba(255,255,255,0.6)",
            trackBg: "rgba(0,0,0,0.14)",
            trackFill: "rgba(0,0,0,0.55)"
        };
}


/* =====================================================
   MODEL COLOR PICKER (pastel swatches, "Add a sale" list)
   ===================================================== */

const PASTEL_SWATCHES = [
    "#FFD6E0", "#FFE0B5", "#FFF3B0", "#D9F2B4",
    "#B8F2E6", "#B5DEFF", "#C9C4FF", "#F0C4FF",
    "#FFC4E1", "#FFCFCF", "#D4E4BC", "#BDEAEA",
    "#C6DEFF", "#E3D0FF", "#FFDAB9", "#E6E6FA"
];

let colorPickerModelId = null;

function setModelColor(modelId, hexColor) {

    data.modelColors[modelId] = hexColor;

    saveData();

    renderModelPickerList();
    renderSales(); // also refreshes the breakdown, badge, and indicator

    // Live-update the swatch preview if its modal is open for this model.
    if (modelId === currentModelFilter) {
        const colorBtn = $("#targetModalColorBtn");
        if (colorBtn) {
            colorBtn.style.background = hexColor;
        }
    }
}

function closeColorSwatchPopover() {

    const pop = $("#colorSwatchPopover");

    if (pop) {
        pop.remove();
    }

    colorPickerModelId = null;
}

function openColorSwatchPopover(modelId, anchorEl) {

    closeColorSwatchPopover();

    colorPickerModelId = modelId;

    const currentColor = getAvatarColor(modelId).toLowerCase();

    const pop = document.createElement("div");
    pop.id = "colorSwatchPopover";
    pop.className = "color-swatch-popover";

    pop.innerHTML = `
        ${PASTEL_SWATCHES.map(color => `
            <button
                type="button"
                class="color-swatch${color.toLowerCase() === currentColor ? " active" : ""}"
                style="background:${color}"
                data-color="${color}"
                title="${color}"
            ></button>
        `).join("")}
        <div class="color-swatch-custom">
            <label for="colorSwatchCustomInput">Custom</label>
            <input
                type="color"
                id="colorSwatchCustomInput"
                value="${/^#/.test(currentColor) ? currentColor : "#ffd6e0"}"
            >
        </div>
    `;

    document.body.appendChild(pop);

    const rect = anchorEl.getBoundingClientRect();
    const popWidth = pop.offsetWidth || 200;

    let left = rect.left;
    if (left + popWidth > window.innerWidth - 8) {
        left = window.innerWidth - popWidth - 8;
    }
    left = Math.max(8, left);

    let top = rect.bottom + 6;
    const popHeight = pop.offsetHeight || 140;
    if (top + popHeight > window.innerHeight - 8) {
        top = rect.top - popHeight - 6;
    }

    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    pop.addEventListener("click", function (event) {

        const swatch = event.target.closest(".color-swatch");

        if (!swatch) {
            return;
        }

        setModelColor(colorPickerModelId, swatch.dataset.color);
        closeColorSwatchPopover();
    });

    const customInput = pop.querySelector("#colorSwatchCustomInput");

    customInput.addEventListener("input", function () {
        setModelColor(colorPickerModelId, customInput.value);
    });
}

document.addEventListener(
    "click",
    function (event) {

        if (
            event.target.closest("#colorSwatchPopover") ||
            event.target.closest(".color-picker-trigger")
        ) {
            return;
        }

        closeColorSwatchPopover();
    }
);


function selectModel(modelId) {

    currentModelFilter = modelId || null;

    renderSales();
}


$("#activeModelBadge").addEventListener(
    "click",
    function () {
        selectModel(null);
    }
);


/* =====================================================
   MODEL PICKER (set a model's daily target)
   ===================================================== */


function renderModelPickerList() {

    $("#modelPickerList").innerHTML =
        data.models.map(model => `
            <button
                type="button"
                class="model-picker-item"
                data-model="${model.id}"
            >
                <span
                    class="target-breakdown-dot"
                    style="background:${getAvatarColor(model.id)}"
                ></span>
                ${escapeHTML(model.title)}
            </button>
        `).join("") ||
        `<div class="model-picker-empty">No models yet.</div>`;
}


$("#openModelPicker").addEventListener(
    "click",
    function () {

        renderModelPickerList();

        $("#modelPickerList").classList.toggle(
            "hidden"
        );
    }
);


$("#modelPickerList").addEventListener(
    "click",
    function (event) {

        const btn = event.target.closest(".model-picker-item");

        if (!btn) {
            return;
        }

        $("#modelPickerList").classList.add(
            "hidden"
        );

        selectModel(btn.dataset.model);

        openTargetModal();
    }
);


document.addEventListener(
    "click",
    function (event) {

        if (event.target.closest(".model-picker")) {
            return;
        }

        $("#modelPickerList").classList.add(
            "hidden"
        );
    }
);


/* =====================================================
   SALES
   ===================================================== */


function getVisibleSales() {

    const sales = getTodaySales();

    return sales
        .map((sale, index) => ({ sale, index }))
        .filter(
            entry =>
                currentModelFilter === null ||
                entry.sale.modelId === currentModelFilter
        );
}


function getCurrentTarget() {

    return currentModelFilter === null
        ? getTotalOfModelTargets()
        : (data.modelTargets[currentModelFilter] || 0);
}


function getTotalOfModelTargets() {

    return Object.values(data.modelTargets || {})
        .reduce((sum, value) => sum + (Number(value) || 0), 0);
}


function setCurrentTarget(value) {

    // The "All models" target is derived (sum of each model's
    // target) and is never set directly.
    if (currentModelFilter === null) {
        return;
    }

    data.modelTargets[currentModelFilter] = value;
}


function computeModelDailyRows(modelId, excludeToday) {

    const today = getDateKey();

    const rows = [];

    Object.keys(data.sales).forEach(dateKey => {

        if (excludeToday && dateKey === today) {
            return;
        }

        const sales = (data.sales[dateKey] || [])
            .filter(sale => sale.modelId === modelId);

        if (!sales.length) {
            return;
        }

        const gross = getTotal(sales);
        const net = gross * NET_RATE;
        const target = data.modelTargets[modelId] || 0;

        rows.push({
            date: dateKey,
            gross,
            net,
            count: sales.length,
            target,
            targetPercent:
                target > 0
                    ? Math.round((net / target) * 100)
                    : null
        });

    });

    return rows;
}


function renderSales() {

    const activeModel =
        currentModelFilter === null
            ? null
            : getModelById(currentModelFilter);

    const visible = getVisibleSales();
    const sales = visible.map(entry => entry.sale);

    const gross = getTotal(sales);

    const net = gross * NET_RATE;


    // Today's date
    $("#todayLabel").textContent =
        new Date().toLocaleDateString(
            undefined,
            {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
            }
        );


    // Active model badge (upper-left, next to "Sales")
    const modelBadge = $("#activeModelBadge");

    if (modelBadge) {

        if (activeModel) {

            const badgeColor = getAvatarColor(activeModel.id);
            const badgeInk = getRowInk(badgeColor);

            modelBadge.style.setProperty("--badge-color", badgeColor);
            modelBadge.style.setProperty("--badge-text", badgeInk.strong);
            modelBadge.style.setProperty("--badge-dot", badgeInk.strong);

            modelBadge.textContent = activeModel.title;
            modelBadge.classList.remove("hidden");
            modelBadge.title = "Back to all models";

        } else {

            modelBadge.textContent = "";
            modelBadge.classList.add("hidden");

        }

    }


    $("#clearSales").textContent =
        activeModel ? "Clear today" : "Clear today";


    // "Today's sales" card picks up the selected model's color as a
    // border accent, so which model you're logging for is clear at a
    // glance without a separate banner.
    const todaySalesCard = $("#todaySalesCard");
    const todaySalesModelName = $("#todaySalesModelName");

    if (todaySalesCard) {

        if (activeModel) {

            const cardColor = getAvatarColor(activeModel.id);

            todaySalesCard.classList.add("has-model-color");
            todaySalesCard.style.setProperty("--card-accent", cardColor);
            todaySalesCard.style.setProperty(
                "--card-accent-text",
                getAccentTextColor(cardColor)
            );

            if (todaySalesModelName) {
                todaySalesModelName.textContent = activeModel.title;
                todaySalesModelName.title = activeModel.title;
                todaySalesModelName.classList.remove("hidden");
            }

        } else {

            todaySalesCard.classList.remove("has-model-color");
            todaySalesCard.style.removeProperty("--card-accent");
            todaySalesCard.style.removeProperty("--card-accent-text");

            if (todaySalesModelName) {
                todaySalesModelName.textContent = "";
                todaySalesModelName.classList.add("hidden");
            }

        }

    }


    // Stats
    $("#gross").textContent =
        money(gross);

    $("#net").textContent =
        money(net);

    $("#saleCount").textContent =
        sales.length;


    // Target progress (based on net earnings, per current context)
    renderTargetProgress(net);


    // Individual sales
    $("#salesList").innerHTML =
        visible.map(
            ({ sale, index }) => {

                const saleNet =
                    Number(sale.amount) *
                    NET_RATE;

                return `
                    <div class="sale-row">

                        <div>
                            ${money(sale.amount)}
                        </div>

                        <div class="sale-right">

                            <span class="sale-net">
                                ${money(saleNet)} net
                            </span>

                            <button
                                class="delete"
                                onclick="deleteSale(${index})"
                            >
                                ×
                            </button>

                        </div>

                    </div>
                `;
            }
        ).join("");


    $("#emptySales").style.display =
        sales.length
            ? "none"
            : "block";


    // Always keep the list scrolled to the latest sale — whichever
    // model's sales are currently showing.
    $("#salesList").scrollTop =
        $("#salesList").scrollHeight;


    renderHistory();

    renderTrends();
}


/* =====================================================
   TARGET
   ===================================================== */


function getTargetPercent(net, target) {

    const activeTarget =
        target === undefined
            ? getCurrentTarget()
            : target;

    if (!activeTarget || activeTarget <= 0) {
        return null;
    }

    return Math.round(
        (net / activeTarget) * 100
    );
}


function renderTargetProgress(net) {

    // The per-model breakdown always stays visible now — model
    // selection (for logging a sale) no longer swaps it away.
    $("#targetProgress").classList.add("hidden");
    $("#targetBreakdownWrap").classList.add("active");

    renderTargetBreakdown();
}


function renderTargetBreakdown() {

    const todaySales = getTodaySales();

    const rows = data.models.map(model => {

        const sales = todaySales.filter(
            sale => sale.modelId === model.id
        );

        const net = getTotal(sales) * NET_RATE;
        const target = data.modelTargets[model.id] || 0;

        const percent =
            target > 0
                ? Math.round((net / target) * 100)
                : null;

        return { model, net, target, percent };
    });


    $("#targetBreakdownEmpty").style.display =
        rows.length
            ? "none"
            : "block";


    $("#targetBreakdown").innerHTML =
        rows.map(({ model, net, target, percent }) => {

            const hit = percent !== null && percent >= 100;
            const displayPercent =
                percent === null ? 0 : Math.min(percent, 100);

            // The further a model blows past its target, the hotter
            // its name burns in the list.
            //   0–99%    normal
            //   100%     ✨ bright gold/white pulse + subtle glow
            //   101–130% 🟠 subtle orange glow
            //   131–160% 🔥 orange-red glow + flicker
            //   161–199% 🔥🔥 intense multi-layer glow
            //   200%+    🔥🔥🔥 maximum "blazing" effect
            let fireTier = 0;
            let fireEmoji = "";
            if (percent !== null) {
                if (percent >= 200) {
                    fireTier = 5;
                    fireEmoji = "🔥🔥🔥";
                } else if (percent >= 161) {
                    fireTier = 4;
                    fireEmoji = "🔥🔥";
                } else if (percent >= 131) {
                    fireTier = 3;
                    fireEmoji = "🔥";
                } else if (percent >= 101) {
                    fireTier = 2;
                    fireEmoji = "🟠";
                } else if (percent === 100) {
                    fireTier = 1;
                    fireEmoji = "✨";
                }
            }
            const fireClass = fireTier ? ` on-fire on-fire-${fireTier}` : "";
            const fireBadge = fireTier
                ? `<span class="fire-badge fire-badge-${fireTier}">${fireEmoji}</span>`
                : "";

            const rowColor = getAvatarColor(model.id);
            const ink = getRowInk(rowColor);

            return `
                <div class="target-breakdown-row${model.id === currentModelFilter ? " selected" : ""}" data-model="${model.id}" draggable="true" style="--badge-color:${rowColor};--row-strong:${ink.strong};--row-muted:${ink.muted};--row-radio-border:${ink.radioBorder};--row-radio-bg:${ink.radioBg};--row-track-bg:${ink.trackBg};--row-track-fill:${ink.trackFill}" title="${model.id === currentModelFilter ? `Selected — adding sales for ${escapeHTML(model.title)}` : `Select to add a sale for ${escapeHTML(model.title)}`}">

                    <div class="target-breakdown-head">
                        <span class="target-breakdown-name">
                            <span class="target-breakdown-title${fireClass}">${escapeHTML(model.title)}</span>${fireBadge}
                        </span>
                        <span class="target-breakdown-percent">
                            ${percent === null
                                ? "No target"
                                : hit
                                    ? "🎉 Hit"
                                    : `${displayPercent}%`}
                        </span>
                    </div>

                    <div class="progress-track">
                        <div
                            class="progress-fill${hit ? " hit" : ""}"
                            style="width:${displayPercent}%"
                        ></div>
                    </div>

                    <div class="progress-label">
                        ${target > 0
                            ? `${money(net)} net / ${money(target)}`
                            : "Set a target in this model's tab."}
                    </div>

                </div>
            `;
        }).join("");


    fitTargetBreakdownTitles();
}


// Long model names shrink to fit their row instead of getting cut
// off or stretching the "Add a sale" card. Font-size only — the
// card's width and layout never change.
function fitTargetBreakdownTitles() {

    const MAX_FONT = 23;
    const MIN_FONT = 13;

    $("#targetBreakdown")
        .querySelectorAll(".target-breakdown-title")
        .forEach(title => {

            title.style.fontSize = MAX_FONT + "px";

            let size = MAX_FONT;

            while (
                title.scrollWidth > title.clientWidth &&
                size > MIN_FONT
            ) {
                size -= 1;
                title.style.fontSize = size + "px";
            }

        });

}


$("#targetBreakdown").addEventListener(
    "click",
    function (event) {

        const row = event.target.closest(".target-breakdown-row");

        if (!row) {
            return;
        }

        selectModel(
            row.dataset.model === currentModelFilter
                ? null
                : row.dataset.model
        );
    }
);


$("#targetBreakdown").addEventListener(
    "dragstart",
    function (event) {

        const row =
            event.target.closest(".target-breakdown-row");

        if (!row) {
            return;
        }

        dragState = {
            type: "models",
            id: row.dataset.model
        };

        row.classList.add("dragging");

        event.dataTransfer.effectAllowed = "move";

        event.dataTransfer.setData(
            "text/plain",
            row.dataset.model
        );
    }
);


$("#targetBreakdown").addEventListener(
    "dragover",
    function (event) {

        if (!dragState || dragState.type !== "models") {
            return;
        }

        const row =
            event.target.closest(".target-breakdown-row");

        if (!row) {
            return;
        }

        event.preventDefault();

        event.dataTransfer.dropEffect = "move";

        $$(".target-breakdown-row.drag-over").forEach(
            el => el.classList.remove("drag-over")
        );

        if (row.dataset.model !== dragState.id) {
            row.classList.add("drag-over");
        }
    }
);


$("#targetBreakdown").addEventListener(
    "drop",
    function (event) {

        if (!dragState || dragState.type !== "models") {
            return;
        }

        const row =
            event.target.closest(".target-breakdown-row");

        $$(".target-breakdown-row.drag-over").forEach(
            el => el.classList.remove("drag-over")
        );

        if (!row) {
            return;
        }

        event.preventDefault();

        reorderItem(
            "models",
            dragState.id,
            row.dataset.model
        );

        renderTargetBreakdown();
    }
);


$("#targetBreakdown").addEventListener(
    "dragend",
    function () {

        $$(".target-breakdown-row.dragging").forEach(
            el => el.classList.remove("dragging")
        );

        $$(".target-breakdown-row.drag-over").forEach(
            el => el.classList.remove("drag-over")
        );

        dragState = null;
    }
);


/* =====================================================
   TARGET MODAL
   ===================================================== */


function openTargetModal() {

    // Not editable in the "All models" view — the button is
    // hidden there too, but guard in case it's still reachable.
    if (currentModelFilter === null) {
        return;
    }

    $("#targetAmount").value =
        getCurrentTarget() || "";

    const colorBtn = $("#targetModalColorBtn");
    if (colorBtn) {
        colorBtn.style.background = getAvatarColor(currentModelFilter);
        const model = getModelById(currentModelFilter);
        colorBtn.title = model
            ? `Change ${model.title}'s color`
            : "Change this model's color";
    }

    $("#targetModal").classList.remove(
        "hidden"
    );

    $("#targetAmount").focus();
}


function closeTargetModal() {

    closeColorSwatchPopover();

    $("#targetModal").classList.add(
        "hidden"
    );
}


$("#targetModalColorBtn").addEventListener(
    "click",
    function (event) {

        event.stopPropagation();

        if (currentModelFilter === null) {
            return;
        }

        openColorSwatchPopover(currentModelFilter, this);
    }
);


$("#closeTargetModal").addEventListener(
    "click",
    closeTargetModal
);


$("#cancelTargetModal").addEventListener(
    "click",
    closeTargetModal
);


$("#targetModal").addEventListener(
    "click",
    function (event) {

        if (
            event.target.id === "targetModal"
        ) {
            closeTargetModal();
        }

    }
);


$("#targetForm").addEventListener(
    "submit",
    function (event) {

        event.preventDefault();


        const value =
            Number(
                $("#targetAmount").value
            );


        if (!value || value <= 0) {
            return;
        }


        setCurrentTarget(value);


        updateHistory();

        saveData();

        renderSales();

        closeTargetModal();
    }
);


/* =====================================================
   ADD SALE
   ===================================================== */


$("#saleForm").addEventListener(
    "submit",
    function (event) {

        event.preventDefault();


        const amount =
            Number(
                $("#saleAmount").value
            );


        if (!amount || amount <= 0) {
            return;
        }


        if (amount > 200) {

            alert(
                "The maximum amount for a single sale is $200."
            );

            return;
        }


        const dateKey =
            getDateKey();


        if (!data.sales[dateKey]) {
            data.sales[dateKey] = [];
        }


        data.sales[dateKey].push({
            amount: amount,
            time: Date.now(),
            modelId: currentModelFilter
        });


        $("#saleAmount").value = "";


        updateHistory();

        saveData();

        renderSales();

        playKaching();

        toast("Sale added!", "success");

        $("#saleAmount").focus();
    }
);


/* =====================================================
   DELETE SALE
   ===================================================== */


function deleteSale(index) {

    const dateKey =
        getDateKey();


    data.sales[dateKey].splice(
        index,
        1
    );


    updateHistory();

    saveData();

    renderSales();
}


/* =====================================================
   HISTORY
   ===================================================== */


function updateHistory() {

    const dateKey =
        getDateKey();


    const sales =
        data.sales[dateKey] || [];


    const existingIndex =
        data.history.findIndex(
            item =>
                item.date === dateKey
        );


    const gross =
        getTotal(sales);

    const net =
        gross * NET_RATE;

    const record = {

        date: dateKey,

        gross: gross,

        net: net,

        count:
            sales.length,

        target:
            getTotalOfModelTargets(),

        targetPercent:
            getTargetPercent(net)

    };


    if (sales.length === 0) {

        if (existingIndex !== -1) {

            data.history.splice(
                existingIndex,
                1
            );

        }

    } else {

        if (existingIndex !== -1) {

            data.history[
                existingIndex
            ] = record;

        } else {

            data.history.push(record);

        }

    }
}


function renderHistory() {

    const today =
        getDateKey();

    // The history list always shows the same thing regardless of
    // whether a model is selected on the page — just the dates.
    // Click a date to see each model's net and target status for it.
    const history =
        data.history
            .filter(item => item.date !== today)
            .sort((a, b) => b.date.localeCompare(a.date));

    const historyRowsHtml =
        history.map(
            item => `
                <div class="history-row" data-date="${item.date}" style="cursor:pointer">
                    <div class="history-date">
                        ${formatDate(item.date)}
                    </div>
                </div>

                <div class="history-model-breakdown hidden" data-breakdown="${item.date}"></div>
            `
        ).join("");

    $("#historyList").innerHTML = historyRowsHtml;

    $("#emptyHistory").textContent =
        "Your previous days will appear here.";

    $("#emptyHistory").style.display =
        history.length ? "none" : "block";
}


function getModelBreakdownForDate(dateKey) {

    const sales =
        data.sales[dateKey] || [];

    const byModel = {};

    sales.forEach(sale => {

        const key = sale.modelId || "unassigned";

        if (!byModel[key]) {
            byModel[key] = 0;
        }

        byModel[key] += Number(sale.amount);
    });

    // Show every current model that already existed by this date
    // (models with no createdDate predate this feature, so they're
    // always included), even ones with no sales that day — those
    // should still appear at $0 / 0%. Deleted models that had sales
    // that day are kept too (from byModel), so their history isn't lost.
    const modelIds = data.models
        .filter(model => !model.createdDate || model.createdDate <= dateKey)
        .map(model => model.id);

    Object.keys(byModel).forEach(id => {
        if (!modelIds.includes(id)) {
            modelIds.push(id);
        }
    });

    return modelIds
        .map(modelId => {

            const model = getModelById(modelId);
            const grossAmt = byModel[modelId] || 0;
            const net = grossAmt * NET_RATE;
            const target = data.modelTargets[modelId] || 0;

            return {
                id: modelId,
                title: getModelName(modelId === "unassigned" ? null : modelId),
                color: model ? getAvatarColor(model.id) : "#888",
                net: net,
                targetPercent: getTargetPercent(net, target)
            };
        })
        .sort((a, b) => b.net - a.net);
}


function renderModelBreakdownRow(dateKey, container) {

    const rows =
        getModelBreakdownForDate(dateKey);

    container.innerHTML =
        rows.map(
            row => `
                <div class="history-model-row">

                    <span
                        class="avatar-dot"
                        style="background:${row.color}"
                    ></span>

                    <span class="history-model-title">
                        ${escapeHTML(row.title)}
                    </span>

                    <span class="history-model-amount">
                        ${money(row.net)} net
                    </span>

                    <span class="history-target-badge ${row.targetPercent !== null && row.targetPercent >= 100 ? "hit" : ""}">
                        ${
                            row.targetPercent === null
                                ? "No target"
                                : row.targetPercent >= 100
                                    ? "Target hit"
                                    : `${row.targetPercent}%`
                        }
                    </span>

                </div>
            `
        ).join("") ||
        `<div class="history-model-row empty">No per-model sales recorded.</div>`;
}


$("#historyList").addEventListener(
    "click",
    event => {

        const row =
            event.target.closest(".history-row");

        if (!row) {
            return;
        }

        const dateKey = row.dataset.date;

        const breakdown =
            $(`[data-breakdown="${dateKey}"]`);

        if (!breakdown) {
            return;
        }

        const isHidden =
            breakdown.classList.contains("hidden");

        document
            .querySelectorAll(".history-model-breakdown")
            .forEach(el => el.classList.add("hidden"));

        if (isHidden) {

            renderModelBreakdownRow(
                dateKey,
                breakdown
            );

            breakdown.classList.remove("hidden");
        }
    }
);


/* =====================================================
   CLEAR SALES
   ===================================================== */


$("#clearSales").addEventListener(
    "click",
    function () {

        const activeModel =
            currentModelFilter === null
                ? null
                : getModelById(currentModelFilter);

        if (
            !confirm(
                activeModel
                    ? `Clear today's sales for ${activeModel.title}?`
                    : "Clear all sales for today?"
            )
        ) {
            return;
        }


        const dateKey = getDateKey();

        if (currentModelFilter === null) {

            delete data.sales[dateKey];

        } else {

            data.sales[dateKey] =
                (data.sales[dateKey] || []).filter(
                    sale => sale.modelId !== currentModelFilter
                );

        }


        updateHistory();

        saveData();

        renderSales();
    }
);


/* =====================================================
   HISTORY MODAL
   ===================================================== */


function openHistoryModal() {

    $("#historyModal").classList.remove(
        "hidden"
    );
}


function closeHistoryModal() {

    $("#historyModal").classList.add(
        "hidden"
    );
}


$("#openHistoryModal").addEventListener(
    "click",
    openHistoryModal
);


$("#closeHistoryModal").addEventListener(
    "click",
    closeHistoryModal
);


$("#historyModal").addEventListener(
    "click",
    function (event) {

        if (
            event.target.id === "historyModal"
        ) {
            closeHistoryModal();
        }

    }
);


/* =====================================================
   CLEAR HISTORY
   ===================================================== */


$("#clearHistory").addEventListener(
    "click",
    function () {

        const activeModel =
            currentModelFilter === null
                ? null
                : getModelById(currentModelFilter);

        if (
            !confirm(
                activeModel
                    ? `Clear ${activeModel.title}'s saved history? (Today's sales are kept.)`
                    : "Clear saved history?"
            )
        ) {
            return;
        }


        if (currentModelFilter === null) {

            data.history = [];

        } else {

            const today = getDateKey();

            Object.keys(data.sales).forEach(dateKey => {

                if (dateKey === today) {
                    return;
                }

                data.sales[dateKey] =
                    (data.sales[dateKey] || []).filter(
                        sale => sale.modelId !== currentModelFilter
                    );

                if (!data.sales[dateKey].length) {
                    delete data.sales[dateKey];
                }

            });

        }

        saveData();

        renderSales();

        closeHistoryModal();
    }
);


/* =====================================================
   PAGE NAVIGATION
   ===================================================== */


$$(".nav-btn").forEach(
    button => {

        button.addEventListener(
            "click",
            function () {

                // Remember where the user was on the tab they're
                // leaving, so coming back restores it instead of
                // dumping them back at the top.
                const mainEl = $(".main");
                const outgoingPage = $(".page.active");

                if (mainEl && outgoingPage) {
                    pageScrollPositions[outgoingPage.id] =
                        mainEl.scrollTop;
                }


                $$(".nav-btn")
                    .forEach(
                        btn =>
                            btn.classList.remove(
                                "active"
                            )
                    );


                this.classList.add(
                    "active"
                );


                $$(".page")
                    .forEach(
                        page =>
                            page.classList.remove(
                                "active"
                            )
                    );


                const targetPageId = this.dataset.page;

                $(
                    "#" +
                    targetPageId
                ).classList.add(
                    "active"
                );


                if (mainEl) {

                    const restoreScroll = () => {
                        mainEl.scrollTop =
                            pageScrollPositions[targetPageId] || 0;
                    };

                    // Layout for the newly-shown page isn't settled
                    // until the next frame, so wait for it before
                    // restoring scroll position.
                    requestAnimationFrame(restoreScroll);

                }

            }
        );

    }
);


/* =====================================================
   CONTENT CATEGORIES
   ===================================================== */


const categories = {

    scripts: []

};

// Content types that use the category/chip system.
// Models are excluded on purpose — no categories for models.
const CATEGORIZED_TYPES = ["scripts"];


/* =====================================================
   CATEGORY MANAGEMENT (default + user-added)
   ===================================================== */


function getCategories(type) {

    return categories[type].concat(
        data.customCategories[type] || []
    );
}


function renderChips(type) {

    const active =
        currentCategory[type];


    const items =
        data[type] || [];


    const countFor = category =>
        category === "All"
            ? items.length
            : items.filter(
                item =>
                    item.category === category
            ).length;


    const defaultChips =
        categories[type]
            .map(
                category => `
                    <button
                        class="chip ${active === category ? "active" : ""}"
                        data-category="${escapeHTML(category)}"
                        title="${escapeHTML(category)}"
                    >
                        ${escapeHTML(category)}
                        <span class="chip-count">
                            ${countFor(category)}
                        </span>
                    </button>
                `
            )
            .join("");


    const customChips =
        (data.customCategories[type] || [])
            .map(
                category => `
                    <button
                        class="chip chip-draggable ${active === category ? "active" : ""}"
                        draggable="true"
                        data-category="${escapeHTML(category)}"
                        title="${escapeHTML(category)} — hold and drag to reorder"
                    >
                        ${escapeHTML(category)}
                        <span class="chip-count">
                            ${countFor(category)}
                        </span>
                        <span
                            class="chip-remove"
                            data-category="${escapeHTML(category)}"
                            title="Remove category"
                        >
                            ×
                        </span>
                    </button>
                `
            )
            .join("");


    $("#" + type + "Chips").innerHTML =
        `
            <button
                class="chip ${active === "All" ? "active" : ""}"
                data-category="All"
            >
                All
                <span class="chip-count">
                    ${countFor("All")}
                </span>
            </button>
        ` +
        defaultChips +
        customChips +
        `
            <button
                class="chip add-chip"
                type="button"
                data-action="add"
                title="Add a new category"
            >
                + Add
            </button>
        `;
}


function addCategory(type) {

    const name =
        prompt("New category name:");


    if (name === null) {
        return;
    }


    const trimmed =
        name.trim();


    if (!trimmed) {
        return;
    }


    const alreadyExists =
        getCategories(type)
            .some(
                category =>
                    category.toLowerCase() ===
                    trimmed.toLowerCase()
            );


    if (alreadyExists) {

        alert(
            "That category already exists."
        );

        return;
    }


    data.customCategories[type].push(
        trimmed
    );


    saveData();

    renderChips(type);
}


function removeCategory(type, category) {

    if (
        !confirm(
            `Remove the "${category}" category? Items already using it will keep it, but you won't be able to filter by it here anymore.`
        )
    ) {
        return;
    }


    data.customCategories[type] =
        data.customCategories[type].filter(
            existing =>
                existing !== category
        );


    if (currentCategory[type] === category) {
        currentCategory[type] = "All";
    }


    saveData();

    renderChips(type);

    renderContent(type);
}


/* =====================================================
   RENDER CONTENT
   ===================================================== */


function renderContent(type) {

    const list =
        data[type];


    const searchInput =
        document.querySelector(
            `[data-target="${type}List"]`
        );


    const search =
        searchInput
            ? searchInput.value.toLowerCase()
            : "";


    const usesCategories =
        CATEGORIZED_TYPES.includes(type);

    const category =
        usesCategories
            ? currentCategory[type]
            : null;


    const filtered =
        list.filter(
            item => {

                const matchesCategory =
                    !usesCategories ||
                    category === "All" ||
                    item.category === category;


                const matchesSearch =
                    !search ||
                    item.title
                        .toLowerCase()
                        .includes(search) ||
                    item.text
                        .toLowerCase()
                        .includes(search);


                return (
                    matchesCategory &&
                    matchesSearch
                );

            }
        );


    const container =
        $("#" + type + "List");


    container.innerHTML =
        filtered.map(
            item => `

                <article
                    class="card content-card"
                    draggable="true"
                    data-id="${item.id}"
                    onclick="openViewModal('${type}', '${item.id}')"
                >

                    <h3>
                        ${escapeHTML(item.title)}
                    </h3>

                    ${
                        usesCategories && category === "All"
                            ? `
                                <div class="content-meta">
                                    ${escapeHTML(item.category)}
                                </div>
                            `
                            : ""
                    }

                    <div class="content-text">${escapeHTML(item.text)}</div>


                    <div class="content-actions">

                        <button
                            class="btn"
                            onclick="
                                event.stopPropagation();
                                copyItem(
                                    '${type}',
                                    '${item.id}'
                                )
                            "
                        >
                            📋 Copy
                        </button>


                        <button
                            class="btn"
                            onclick="
                                event.stopPropagation();
                                editItem(
                                    '${type}',
                                    '${item.id}'
                                )
                            "
                        >
                            ✏️ Edit
                        </button>


                        <button
                            class="btn"
                            onclick="
                                event.stopPropagation();
                                deleteItem(
                                    '${type}',
                                    '${item.id}'
                                )
                            "
                        >
                            🗑 Delete
                        </button>

                    </div>

                </article>

            `
        ).join("");


    $("#" + type + "Empty")
        .style.display =
            filtered.length
                ? "none"
                : "block";


}


/* =====================================================
   ESCAPE HTML
   ===================================================== */


function escapeHTML(text) {

    return String(text)
        .replace(
            /[&<>"']/g,
            character => {

                const characters = {

                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;"

                };

                return characters[
                    character
                ];
            }
        );
}


/* =====================================================
   SEARCH
   ===================================================== */


$$(".search").forEach(
    input => {

        input.addEventListener(
            "input",
            function () {

                const type =
                    this.dataset.target
                        .replace(
                            "List",
                            ""
                        );


                renderContent(type);
            }
        );

    }
);


/* =====================================================
   CATEGORY FILTERS
   ===================================================== */


$$(".chips").forEach(
    group => {

        group.addEventListener(
            "click",
            function (event) {

                const type =
                    group.dataset.filter;


                // Remove (×) on a custom category chip
                const removeBtn =
                    event.target.closest(
                        ".chip-remove"
                    );

                if (removeBtn) {

                    event.stopPropagation();

                    removeCategory(
                        type,
                        removeBtn.dataset.category
                    );

                    return;
                }


                // "+ Add category" chip
                const addChip =
                    event.target.closest(
                        ".add-chip"
                    );

                if (addChip) {

                    addCategory(type);

                    return;
                }


                const chip =
                    event.target.closest(
                        ".chip"
                    );

                if (!chip) {
                    return;
                }


                group
                    .querySelectorAll(
                        ".chip"
                    )
                    .forEach(
                        c =>
                            c.classList.remove(
                                "active"
                            )
                    );


                chip.classList.add(
                    "active"
                );


                currentCategory[type] =
                    chip.dataset.category;


                renderContent(type);
            }
        );

    }
);


/* =====================================================
   DRAG TO REORDER — TILES (models & scripts)
   ===================================================== */


let dragState = null;


/* ---------- Auto-scroll the page while dragging near the edges ----------
   Now that the models/scripts lists scroll with the whole page instead
   of in their own little box, dragging a card up near the header (or
   down near the bottom of the window) needs to scroll the page itself
   so you can drop it further up/down than what's currently on screen. */

let dragAutoScrollSpeed = 0;
let dragAutoScrollFrame = null;
const DRAG_AUTOSCROLL_EDGE = 90;
const DRAG_AUTOSCROLL_MAX_SPEED = 22;


function stepDragAutoScroll() {

    const mainEl = $(".main");

    if (dragAutoScrollSpeed !== 0 && mainEl) {

        mainEl.scrollTop += dragAutoScrollSpeed;

        dragAutoScrollFrame =
            requestAnimationFrame(stepDragAutoScroll);

    } else {

        dragAutoScrollFrame = null;

    }

}


function updateDragAutoScroll(clientY) {

    const mainEl = $(".main");

    if (!mainEl) {
        return;
    }

    const rect = mainEl.getBoundingClientRect();

    if (clientY < rect.top + DRAG_AUTOSCROLL_EDGE) {

        const intensity =
            (rect.top + DRAG_AUTOSCROLL_EDGE - clientY) /
            DRAG_AUTOSCROLL_EDGE;

        dragAutoScrollSpeed =
            -Math.ceil(
                DRAG_AUTOSCROLL_MAX_SPEED * Math.min(intensity, 1)
            );

    } else if (clientY > rect.bottom - DRAG_AUTOSCROLL_EDGE) {

        const intensity =
            (clientY - (rect.bottom - DRAG_AUTOSCROLL_EDGE)) /
            DRAG_AUTOSCROLL_EDGE;

        dragAutoScrollSpeed =
            Math.ceil(
                DRAG_AUTOSCROLL_MAX_SPEED * Math.min(intensity, 1)
            );

    } else {

        dragAutoScrollSpeed = 0;

    }

    if (dragAutoScrollSpeed !== 0 && !dragAutoScrollFrame) {
        dragAutoScrollFrame = requestAnimationFrame(stepDragAutoScroll);
    }

}


function stopDragAutoScroll() {

    dragAutoScrollSpeed = 0;

    if (dragAutoScrollFrame) {
        cancelAnimationFrame(dragAutoScrollFrame);
        dragAutoScrollFrame = null;
    }

}


document.addEventListener(
    "dragover",
    function (event) {

        if (!dragState) {
            return;
        }

        updateDragAutoScroll(event.clientY);

    }
);


["dragend", "drop"].forEach(
    evtName =>
        document.addEventListener(evtName, stopDragAutoScroll)
);


function reorderItem(type, draggedId, targetId) {

    if (draggedId === targetId) {
        return;
    }

    const list = data[type];

    const fromIndex =
        list.findIndex(
            item => item.id === draggedId
        );

    const toIndex =
        list.findIndex(
            item => item.id === targetId
        );

    if (fromIndex === -1 || toIndex === -1) {
        return;
    }

    const [moved] =
        list.splice(fromIndex, 1);

    list.splice(toIndex, 0, moved);

    saveData();

    renderContent(type);

    // Model order drives the "Add a sale" list order too.
    if (type === "models") {
        renderSales();
    }
}


["models", "scripts"].forEach(
    type => {

        const container =
            $("#" + type + "List");

        if (!container) {
            return;
        }


        container.addEventListener(
            "dragstart",
            function (event) {

                const card =
                    event.target.closest(
                        ".content-card"
                    );

                if (!card) {
                    return;
                }

                dragState = {
                    type: type,
                    id: card.dataset.id
                };

                card.classList.add("dragging");

                event.dataTransfer.effectAllowed = "move";

                event.dataTransfer.setData(
                    "text/plain",
                    card.dataset.id
                );
            }
        );


        container.addEventListener(
            "dragover",
            function (event) {

                if (
                    !dragState ||
                    dragState.type !== type
                ) {
                    return;
                }

                const card =
                    event.target.closest(
                        ".content-card"
                    );

                if (!card) {
                    return;
                }

                event.preventDefault();

                event.dataTransfer.dropEffect = "move";

                $$(".content-card.drag-over").forEach(
                    el => el.classList.remove("drag-over")
                );

                if (card.dataset.id !== dragState.id) {
                    card.classList.add("drag-over");
                }
            }
        );


        container.addEventListener(
            "drop",
            function (event) {

                if (
                    !dragState ||
                    dragState.type !== type
                ) {
                    return;
                }

                const card =
                    event.target.closest(
                        ".content-card"
                    );

                $$(".content-card.drag-over").forEach(
                    el => el.classList.remove("drag-over")
                );

                if (!card) {
                    return;
                }

                event.preventDefault();

                reorderItem(
                    type,
                    dragState.id,
                    card.dataset.id
                );
            }
        );


        container.addEventListener(
            "dragend",
            function () {

                $$(".content-card.dragging").forEach(
                    el => el.classList.remove("dragging")
                );

                $$(".content-card.drag-over").forEach(
                    el => el.classList.remove("drag-over")
                );

                dragState = null;
            }
        );

    }
);


/* =====================================================
   DRAG TO REORDER — SCRIPT CATEGORIES
   ===================================================== */


let categoryDragState = null;


function reorderCategory(type, draggedCategory, targetCategory) {

    if (draggedCategory === targetCategory) {
        return;
    }

    const list =
        data.customCategories[type];

    const fromIndex =
        list.indexOf(draggedCategory);

    const toIndex =
        list.indexOf(targetCategory);

    if (fromIndex === -1 || toIndex === -1) {
        return;
    }

    const [moved] =
        list.splice(fromIndex, 1);

    list.splice(toIndex, 0, moved);

    saveData();

    renderChips(type);
}


$$(".chips").forEach(
    group => {

        const type =
            group.dataset.filter;

        if (!CATEGORIZED_TYPES.includes(type)) {
            return;
        }


        group.addEventListener(
            "dragstart",
            function (event) {

                const chip =
                    event.target.closest(
                        ".chip.chip-draggable"
                    );

                if (!chip) {
                    return;
                }

                categoryDragState = {
                    type: type,
                    category: chip.dataset.category
                };

                chip.classList.add("dragging");

                event.dataTransfer.effectAllowed = "move";

                event.dataTransfer.setData(
                    "text/plain",
                    chip.dataset.category
                );
            }
        );


        group.addEventListener(
            "dragover",
            function (event) {

                if (
                    !categoryDragState ||
                    categoryDragState.type !== type
                ) {
                    return;
                }

                const chip =
                    event.target.closest(
                        ".chip.chip-draggable"
                    );

                if (!chip) {
                    return;
                }

                event.preventDefault();

                event.dataTransfer.dropEffect = "move";

                $$(".chip.drag-over").forEach(
                    el => el.classList.remove("drag-over")
                );

                if (chip.dataset.category !== categoryDragState.category) {
                    chip.classList.add("drag-over");
                }
            }
        );


        group.addEventListener(
            "drop",
            function (event) {

                if (
                    !categoryDragState ||
                    categoryDragState.type !== type
                ) {
                    return;
                }

                const chip =
                    event.target.closest(
                        ".chip.chip-draggable"
                    );

                $$(".chip.drag-over").forEach(
                    el => el.classList.remove("drag-over")
                );

                if (!chip) {
                    return;
                }

                event.preventDefault();

                reorderCategory(
                    type,
                    categoryDragState.category,
                    chip.dataset.category
                );
            }
        );


        group.addEventListener(
            "dragend",
            function () {

                $$(".chip.dragging").forEach(
                    el => el.classList.remove("dragging")
                );

                $$(".chip.drag-over").forEach(
                    el => el.classList.remove("drag-over")
                );

                categoryDragState = null;
            }
        );

    }
);


/* =====================================================
   OPEN MODAL
   ===================================================== */


function openModal(
    type,
    id = null
) {

    modalType = type;

    editingId = id;


    const item =
        id
            ? data[type].find(
                item =>
                    item.id === id
            )
            : null;


    if (id) {

        $("#modalTitle").textContent =
            "Edit Item";

    } else {

        if (type === "models") {

            $("#modalTitle").textContent =
                "New Model";

        } else {

            $("#modalTitle").textContent =
                "New Script";

        }

    }


    // Field labels/placeholders change for Models
    // so the same modal fits both use cases.
    if (type === "models") {

        $("#contentTitleLabel").textContent =
            "Model name";

        $("#contentTitle").placeholder =
            "e.g. Sophia";

        $("#contentTextLabel").textContent =
            "Info & notes";

        $("#contentText").placeholder =
            "Platform/handle, preferences, boundaries, rates, birthday, anything worth remembering...";

    } else {

        $("#contentTitleLabel").textContent =
            "Title";

        $("#contentTitle").placeholder =
            "e.g. New Subscriber Greeting";

        $("#contentTextLabel").textContent =
            "Text";

        $("#contentText").placeholder =
            "Write your message here...";

    }


    $("#contentTitle").value =
        item?.title || "";


    $("#contentText").value =
        item?.text || "";


    if (type === "models") {

        // Models have no categories — hide the field entirely.
        $("#categoryField").style.display =
            "none";

        $("#contentCategory").required =
            false;

    } else {

        $("#categoryField").style.display =
            "";

        const availableCategories =
            getCategories(type);


        $("#contentCategory").innerHTML =
            availableCategories.length
                ? availableCategories
                    .map(
                        category => `

                            <option
                                ${
                                    item?.category === category
                                        ? "selected"
                                        : ""
                                }
                            >
                                ${category}
                            </option>

                        `
                    )
                    .join("")
                : `
                    <option value="" disabled selected>
                        No categories yet — add one below first
                    </option>
                `;

    }


    $("#modal").classList.remove(
        "hidden"
    );


    $("#contentTitle").focus();
}


/* =====================================================
   ADD BUTTONS
   ===================================================== */


$$(".add-content").forEach(
    button => {

        button.addEventListener(
            "click",
            function () {

                openModal(
                    this.dataset.type
                );

            }
        );

    }
);


/* =====================================================
   CLOSE MODAL
   ===================================================== */


function closeModal() {

    $("#modal").classList.add(
        "hidden"
    );

    editingId = null;
    modalType = null;
}


$("#closeModal").addEventListener(
    "click",
    closeModal
);


$("#cancelModal").addEventListener(
    "click",
    closeModal
);


$("#modal").addEventListener(
    "click",
    function (event) {

        if (
            event.target.id === "modal"
        ) {
            closeModal();
        }

    }
);


/* =====================================================
   SAVE SCRIPT
   ===================================================== */


$("#contentForm").addEventListener(
    "submit",
    function (event) {

        event.preventDefault();


        const usesCategories =
            CATEGORIZED_TYPES.includes(
                modalType
            );


        let category = null;


        if (usesCategories) {

            category =
                $("#contentCategory").value;


            if (!category) {

                alert(
                    "Add at least one category first (use the + Add category chip), then pick it here."
                );

                return;
            }

        }


        const item = {

            id:
                editingId ||
                crypto.randomUUID(),

            title:
                $("#contentTitle")
                    .value
                    .trim(),

            text:
                $("#contentText")
                    .value
                    .trim()

        };


        if (usesCategories) {
            item.category = category;
        }


        // Stamp new models with the date they were created, so
        // history from before that date doesn't show them.
        if (modalType === "models" && !editingId) {
            item.createdDate = getDateKey();
        }


        if (editingId) {

            const index =
                data[modalType].findIndex(
                    savedItem =>
                        savedItem.id ===
                        editingId
                );


            data[modalType][index] =
                item;

        } else {

            data[modalType].unshift(
                item
            );

        }


        // If the item was saved under a category that
        // isn't the one currently being filtered on,
        // the item would be hidden from view until the
        // page reloaded (which resets the filter). Snap
        // the filter back to "All" so new/edited items
        // are always visible right away.
        if (
            usesCategories &&
            currentCategory[modalType] !== "All" &&
            currentCategory[modalType] !== item.category
        ) {

            currentCategory[modalType] =
                "All";

            renderChips(modalType);

        }


        const savedType = modalType;

        saveData();

        closeModal();

        if (
            CATEGORIZED_TYPES.includes(savedType)
        ) {
            renderChips(savedType);
        }

        renderContent(
            savedType
        );

        // Adding/editing a model needs to show up immediately in the
        // Sales tab too — the "Add a sale" model list, the today's-sale
        // header, and the model picker all read from data.models.
        if (savedType === "models") {
            renderSales();
        }
    }
);


/* =====================================================
   EDIT ITEM
   ===================================================== */


function editItem(
    type,
    id
) {

    openModal(
        type,
        id
    );
}


/* =====================================================
   DELETE ITEM
   ===================================================== */


function deleteItem(
    type,
    id
) {

    if (
        !confirm(
            "Delete this item?"
        )
    ) {
        return;
    }


    if (type === "models") {

        const deletedModel =
            data.models.find(item => item.id === id);

        if (deletedModel) {
            data.deletedModels[id] = deletedModel.title;
        }

    }


    data[type] =
        data[type].filter(
            item =>
                item.id !== id
        );


    if (type === "models") {

        delete data.modelTargets[id];

        if (currentModelFilter === id) {
            currentModelFilter = null;
        }

    }


    saveData();

    if (
        CATEGORIZED_TYPES.includes(type)
    ) {
        renderChips(type);
    }

    renderContent(type);

    if (type === "models") {
        renderSales();
    }
}


/* =====================================================
   SOUND EFFECTS
   ===================================================== */

const kachingSound = new Audio("kaching.wav");
kachingSound.volume = 0.6;

function playKaching() {
    try {
        kachingSound.currentTime = 0; // rewind so back-to-back sales retrigger it
        kachingSound.play().catch(() => {}); // ignore autoplay-block errors
    } catch {}
}


/* =====================================================
   TOAST FEEDBACK
   ===================================================== */

function toast(message, type = "") {

    const stack = $("#toastStack");
    if (!stack) return;

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;

    stack.appendChild(el);

    requestAnimationFrame(() => el.classList.add("show"));

    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 300);
    }, 2200);
}


/* =====================================================
   COPY ITEM
   ===================================================== */


async function copyItem(
    type,
    id
) {

    const item =
        data[type].find(
            item =>
                item.id === id
        );


    if (!item) {
        return;
    }


    try {

        const plain = item.text;
        const html =
            "<span style=\"font-size:16px;font-family:inherit;\">" +
            plain
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\n/g, "<br>") +
            "</span>";

        if (window.ClipboardItem) {

            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/plain": new Blob([plain], { type: "text/plain" }),
                    "text/html": new Blob([html], { type: "text/html" })
                })
            ]);

        } else {

            await navigator.clipboard.writeText(plain);

        }


        toast("Copied!", "success");

    } catch {

        prompt(
            "Copy this text:",
            item.text
        );

    }
}


/* =====================================================
   VIEW MODAL (read the full card without scrolling)
   ===================================================== */


function openViewModal(type, id) {

    const item =
        data[type].find(
            item =>
                item.id === id
        );

    if (!item) {
        return;
    }

    viewType = type;
    viewId = id;

    $("#viewModalTitle").textContent =
        item.title;

    const usesCategories =
        CATEGORIZED_TYPES.includes(type);

    if (usesCategories) {

        $("#viewModalMeta").style.display =
            "block";

        $("#viewModalMeta").textContent =
            item.category;

    } else {

        $("#viewModalMeta").style.display =
            "none";

    }

    $("#viewModalText").textContent =
        item.text;

    $("#viewModalText").scrollTop =
        0;

    $("#viewModalFade").classList.remove(
        "visible"
    );

    $("#viewModal").classList.remove(
        "hidden"
    );

    requestAnimationFrame(
        updateViewModalFade
    );
}


function updateViewModalFade() {

    const textEl =
        $("#viewModalText");

    const fadeEl =
        $("#viewModalFade");

    if (!textEl || !fadeEl) {
        return;
    }

    const hasOverflow =
        textEl.scrollHeight >
        textEl.clientHeight + 4;

    const atBottom =
        textEl.scrollTop + textEl.clientHeight >=
        textEl.scrollHeight - 4;

    fadeEl.classList.toggle(
        "visible",
        hasOverflow && !atBottom
    );
}


$("#viewModalText").addEventListener(
    "scroll",
    updateViewModalFade
);


window.addEventListener(
    "resize",
    () => {

        if (!$("#viewModal").classList.contains("hidden")) {
            updateViewModalFade();
        }

    }
);


function closeViewModal() {

    $("#viewModal").classList.add(
        "hidden"
    );

    viewType = null;
    viewId = null;
}


$("#closeViewModal").addEventListener(
    "click",
    closeViewModal
);


$("#viewModal").addEventListener(
    "click",
    function (event) {

        if (
            event.target.id === "viewModal"
        ) {
            closeViewModal();
        }

    }
);


$("#viewModalCopy").addEventListener(
    "click",
    function () {

        copyItem(viewType, viewId);

    }
);


$("#viewModalEdit").addEventListener(
    "click",
    function () {

        const type = viewType;
        const id = viewId;

        closeViewModal();

        editItem(type, id);

    }
);


$("#viewModalDelete").addEventListener(
    "click",
    function () {

        const type = viewType;
        const id = viewId;

        deleteItem(type, id);

        closeViewModal();

    }
);


$("#settingsBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    $("#settingsBtn").closest(".settings-group").classList.toggle("open");
});

document.addEventListener("click", function (e) {
    const group = $("#settingsBtn").closest(".settings-group");
    if (group.classList.contains("open") && !group.contains(e.target)) {
        group.classList.remove("open");
    }
});

$("#themeToggle").addEventListener(
    "click",
    toggleTheme
);


$("#mobileThemeToggle").addEventListener(
    "click",
    toggleTheme
);


$("#sidebarCollapseBtn").addEventListener(
    "click",
    toggleSidebarCollapse
);


/* =====================================================
   EXPORT / IMPORT (BACKUP)
   ===================================================== */


function exportData() {

    const payload = {
        app: "chatterTool",
        exportedAt: new Date().toISOString(),
        data: data
    };

    const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download =
        "chatter-tool-backup-" +
        getDateKey() +
        ".json";

    document.body.appendChild(a);

    a.click();

    a.remove();

    URL.revokeObjectURL(url);
}


function isValidImportedData(candidate) {

    if (
        !candidate ||
        typeof candidate !== "object"
    ) {
        return false;
    }

    const hasCoreShape =
        typeof candidate.sales === "object" &&
        Array.isArray(candidate.models) &&
        Array.isArray(candidate.scripts);

    return hasCoreShape;
}


function importData(file) {

    const reader = new FileReader();

    reader.onload = function (event) {

        let parsed;

        try {
            parsed = JSON.parse(event.target.result);
        } catch {

            alert(
                "That file isn't valid JSON. Please pick a backup file exported from this tool."
            );

            return;
        }

        // Support both the wrapped export format
        // ({ app, exportedAt, data }) and a raw data
        // object, in case someone hands back just the
        // "data" portion.
        const incoming =
            parsed && parsed.data
                ? parsed.data
                : parsed;

        if (!isValidImportedData(incoming)) {

            alert(
                "This doesn't look like a valid Chatter Tool backup file."
            );

            return;
        }

        const confirmed = confirm(
            "Importing will replace ALL current data (sales, history, models, scripts) on this device with the contents of the backup file. This can't be undone. Continue?"
        );

        if (!confirmed) {
            return;
        }

        data = normalizeData(incoming);

        saveData();

        currentCategory.scripts = "All";
        currentModelFilter = null;

        updateHistory();

        renderSales();

        renderChips("scripts");

        renderContent("models");
        renderContent("scripts");

        toast("Import complete!", "success");
    };

    reader.onerror = function () {

        alert(
            "Couldn't read that file. Please try again."
        );
    };

    reader.readAsText(file);
}


$("#exportDataBtn").addEventListener(
    "click",
    exportData
);


$("#importDataBtn").addEventListener(
    "click",
    function () {
        $("#importFileInput").click();
    }
);


$("#importFileInput").addEventListener(
    "change",
    function (event) {

        const file =
            event.target.files &&
            event.target.files[0];

        if (!file) {
            return;
        }

        importData(file);

        // Reset so selecting the same file again
        // still fires the change event.
        event.target.value = "";
    }
);


/* =====================================================
   INITIAL LOAD
   ===================================================== */


initTheme();

initSidebarCollapse();

renderAll();

initAuthGate();
