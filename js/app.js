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
    // Legacy: per-model colors from the retired color picker. Kept
    // (unused) so saved and synced data round-trips unchanged.
    modelColors: {},
    // Shift used only in the "Copy for logout" text (24h "HH:MM")
    logoutShift: { start: "16:00", end: "00:00", cover: false }
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

    // Legacy (unused): see defaultData.
    obj.modelColors = obj.modelColors || {};

    // Shift time + cover flag, used only by the "Copy for logout" text.
    const TIME_RE = /^\d{1,2}:\d{2}$/;
    const shift = obj.logoutShift || {};

    obj.logoutShift = {
        start: TIME_RE.test(shift.start) ? shift.start : "16:00",
        end: TIME_RE.test(shift.end) ? shift.end : "00:00",
        cover: shift.cover === true
    };

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

// Which day's row is currently expanded in the history modal.
// Drives the fixed "Copy for Logout" button at the bottom of the
// modal, since that button needs to know which day to build from.
let expandedHistoryDate = null;

// Remembers each tab's scroll position so switching tabs and
// coming back doesn't dump you at the top.
const pageScrollPositions = {};


/* =====================================================
   UI ICONS
   Inline SVG. The look (size, stroke, colour) comes from the
   .icon class in style.css, so every icon in the app matches.
   ===================================================== */

const svgIcon = body =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

const ICONS = {
    sun: svgIcon(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`),
    moon: svgIcon(`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`),
    x: svgIcon(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
    clock: svgIcon(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
    heart: svgIcon(`<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>`),
    edit: svgIcon(`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`),
    copy: svgIcon(`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`)
};


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
        icon.innerHTML = theme === "light" ? ICONS.sun : ICONS.moon;
    }

    if (label) {
        label.textContent = theme === "light" ? "Light mode" : "Dark mode";
    }

    if (mobileIcon) {
        mobileIcon.innerHTML = theme === "light" ? ICONS.sun : ICONS.moon;
    }

    // Keep the browser chrome (mobile address bar) in step with the theme.
    const themeMeta = document.querySelector('meta[name="theme-color"]');

    if (themeMeta) {
        themeMeta.setAttribute(
            "content",
            theme === "light" ? "#f3f2ef" : "#17191d"
        );
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


/* What scrolls the app? On phones the document itself scrolls, so
   the browser's address bar and toolbars can tuck away. On larger
   screens the app fills the window and .main scrolls inside it. */
const phoneScrollQuery = window.matchMedia("(max-width: 700px)");

function getScroller() {
    return phoneScrollQuery.matches
        ? (document.scrollingElement || document.documentElement)
        : $(".main");
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
let pushPending = false;
let pushInFlight = null;


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

    pushPending = true;

    pushTimer = setTimeout(function () {

        pushPending = false;

        const json = JSON.stringify(data);
        lastPushedJSON = json;

        pushInFlight = cloudDocRef.set(data)
            .then(function () {
                setSyncStatus("synced");
            })
            .catch(function (err) {
                console.error("Cloud sync failed:", err);
                setSyncStatus("offline");
            });

    }, 500);

}


// Send any edit that's still waiting out the 500ms debounce right now,
// and resolve once the latest write has settled. Used before a reload
// so a change made just before refreshing isn't lost.
function flushCloudPush() {

    if (cloudDocRef && pushPending) {

        clearTimeout(pushTimer);
        pushPending = false;

        lastPushedJSON = JSON.stringify(data);

        pushInFlight = cloudDocRef.set(data)
            .then(function () {
                setSyncStatus("synced");
            })
            .catch(function (err) {
                console.error("Cloud sync failed:", err);
                setSyncStatus("offline");
            });

    }

    return pushInFlight || Promise.resolve();

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

        // Sign-in state is known: let the splash screen lift.
        if (window.hideSplash) window.hideSplash();

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


function moneyShort(amount) {

    // Whole-dollar, no-cents version for tight spaces like chart
    // bar labels, where "$120" reads faster than "$120.00".
    return "$" +
        Math.round(Number(amount)).toLocaleString();
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
            `<div class="trend-empty">Select a model to see its trend</div>`;

        $("#trendSummary").innerHTML = "";

        const extraEl = $("#trendExtra");
        if (extraEl) extraEl.innerHTML = "";

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

    // Always show 7 periods ending on today/this month, so the
    // present day sits at the right edge and the 6 before it fill
    // in the rest — no upcoming/empty future periods shown.
    const periodsToShow = 7;
    const currentKey = getPeriodKey(today, currentTrendRange);

    const dailyTarget = data.modelTargets[currentModelFilter] || 0;

    const rows = [];
    for (let i = -(periodsToShow - 1); i <= 0; i++) {

        const key = addPeriod(currentKey, currentTrendRange, i);
        const bucket = buckets[key];

        const net = bucket ? bucket.net : 0;
        const count = bucket ? bucket.count : 0;

        const target =
            currentTrendRange === "day"
                ? dailyTarget
                : dailyTarget * daysInMonthKey(key);

        rows.push({
            key,
            label: getPeriodLabel(key, currentTrendRange),
            date: currentTrendRange === "day" ? key : null,
            net,
            count,
            target,
            targetPercent: getTargetPercent(net, target),
            isCurrent: key === currentKey
        });
    }

    // Scale the chart to the tallest bar — and, on the day view, to
    // the target itself, so a target line actually means something.
    const scaleValues = rows.map(r => r.net);

    if (currentTrendRange === "day" && dailyTarget > 0) {
        scaleValues.push(dailyTarget);
    }

    const maxNet = Math.max(...scaleValues, 1);

    // Matches the reserved height of .trend-bar-label in CSS, so the
    // dashed target line lines up with the same 0-84px track scale
    // the bars use, rather than the raw column height.
    const LABEL_BLOCK_HEIGHT = 20;
    const TRACK_HEIGHT = 84;

    const targetLineHtml =
        currentTrendRange === "day" && dailyTarget > 0
            ? (() => {

                const lineHeightPx =
                    Math.min((dailyTarget / maxNet) * TRACK_HEIGHT, TRACK_HEIGHT);

                return `
                    <div class="trend-target-line" style="bottom:${LABEL_BLOCK_HEIGHT + lineHeightPx}px">
                        <span>${moneyShort(dailyTarget)} target</span>
                    </div>
                `;
            })()
            : "";

    const barsHtml = rows.map(r => {

        const barClass =
            r.net <= 0
                ? ""
                : r.targetPercent !== null && r.targetPercent >= 100
                    ? "target-hit"
                    : r.target > 0
                        ? "target-missed"
                        : "";

        const valueHtml =
            r.net > 0
                ? `
                    ${moneyShort(r.net)}
                    ${
                        r.targetPercent !== null
                            ? `<span class="trend-bar-pct${r.targetPercent >= 100 ? " hit" : ""}">${r.targetPercent >= 100 ? "✓" : `${r.targetPercent}%`}</span>`
                            : ""
                    }
                `
                : "";

        const tooltip =
            `${r.label}: ${money(r.net)} net · ${r.count} sale${r.count === 1 ? "" : "s"}` +
            (r.targetPercent !== null
                ? ` · ${r.targetPercent >= 100 ? "Target hit" : `${r.targetPercent}% of target`}`
                : "");

        // Past days with sales drill into the history modal on
        // click; today and empty days have nothing to open.
        const clickable =
            currentTrendRange === "day" &&
            r.date &&
            r.date !== today &&
            r.count > 0;

        return `
            <div
                class="trend-bar-col${r.isCurrent ? " trend-bar-current" : ""}${clickable ? " clickable" : ""}"
                title="${escapeHTML(tooltip)}"
                ${r.date ? `data-date="${r.date}"` : ""}
            >
                <div class="trend-bar-value">${valueHtml}</div>
                <div class="trend-bar-track">
                    <div class="trend-bar-fill ${barClass}" style="height:${r.net > 0 ? Math.max((r.net / maxNet) * 100, 4) : 0}%"></div>
                </div>
                <div class="trend-bar-label">${r.label}</div>
            </div>
        `;
    }).join("");

    $("#trendBars").innerHTML = `
        <div class="trend-bars-inner">
            ${targetLineHtml}
            ${barsHtml}
        </div>
    `;

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


    // Second line: average and best across the 7 shown periods —
    // gives a sense of typical performance, not just today vs. today.
    const extraEl = $("#trendExtra");

    if (extraEl) {

        const activeRows = rows.filter(r => r.net > 0);

        if (activeRows.length) {

            const avg =
                activeRows.reduce((sum, r) => sum + r.net, 0) / activeRows.length;

            const best =
                activeRows.reduce((a, b) => (b.net > a.net ? b : a));

            extraEl.innerHTML =
                `Avg ${moneyShort(avg)} / ${periodWord} · Best ${moneyShort(best.net)} <span class="trend-extra-muted">(${best.label})</span>`;

        } else {

            extraEl.innerHTML = "";

        }

    }
}

$("#trendBars").addEventListener(
    "click",
    event => {

        const col =
            event.target.closest(".trend-bar-col.clickable");

        if (!col) {
            return;
        }

        const dateKey = col.dataset.date;

        if (!dateKey) {
            return;
        }

        openHistoryModal();

        // Give the modal a frame to become visible before we hunt
        // for the row and expand it, so the click feels immediate.
        // This always ends up expanded (never toggles it closed),
        // regardless of whatever state it was left in last time the
        // modal was open.
        requestAnimationFrame(() => {
            expandHistoryRow(dateKey);
        });

    }
);

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

    const deleted = data.deletedModels[id];

    if (deleted) {
        // Older saves stored just the title string; newer saves
        // store { title, target } so history can still show the
        // percent this model hit before it was deleted.
        return typeof deleted === "string" ? deleted : deleted.title;
    }

    return "Unassigned";
}


function getDeletedModelTarget(id) {

    const deleted = data.deletedModels[id];

    if (!deleted) {
        return 0;
    }

    return typeof deleted === "string" ? 0 : (Number(deleted.target) || 0);
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


function relativeLuminance({ r, g, b }) {

    const channel = value => {
        const c = value / 255;
        return c <= 0.03928
            ? c / 12.92
            : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}


function contrastRatio(a, b) {

    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);

    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}


// A model's colour, as text on the card. If the model's own colour is
// already readable on the card it is used exactly. Otherwise its hue and
// saturation are kept and only the lightness moves, just far enough to
// read clearly (so yellow becomes a deeper yellow, white becomes grey,
// never a different colour).
function getModelTextColor(colorStr) {

    const MIN_CONTRAST = 3.5; // the name is set large (28px)

    const own = parseColorToRgb(colorStr);

    const cardBg = parseColorToRgb(
        getComputedStyle(document.documentElement)
            .getPropertyValue("--bg-card")
            .trim() || "#ffffff"
    );

    if (contrastRatio(own, cardBg) >= MIN_CONTRAST) {
        return `rgb(${own.r}, ${own.g}, ${own.b})`;
    }

    const { h, s, l } = rgbToHsl(own.r, own.g, own.b);
    const cardIsLight = relativeLuminance(cardBg) > 0.5;
    const step = cardIsLight ? -1 : 1;

    for (let lightness = l; lightness >= 0 && lightness <= 100; lightness += step) {

        const candidate = hslToRgb(h, s, lightness);

        if (contrastRatio(candidate, cardBg) >= MIN_CONTRAST) {
            return `rgb(${candidate.r}, ${candidate.g}, ${candidate.b})`;
        }

    }

    return cardIsLight ? "#000000" : "#ffffff";
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
   MODEL COLOR PICKER (swatches, "Add a sale" list)
   ===================================================== */

const MODEL_SWATCHES = [
    // light + neutral
    "#FFFFFF", "#E4E6EB", "#FFD6E0", "#FFE0B5", "#FFF3B0", "#F7F150",
    // mid
    "#FF9EC4", "#FFB562", "#B5EFA0", "#8FE3D0", "#9CCBFF", "#C0B4FF",
    // bold
    "#FF5FA8", "#FF6B6B", "#4ECB71", "#3FB6E8", "#6D5DF0", "#2B2D31"
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
        ${MODEL_SWATCHES.map(color => `
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


// The model name in the "Today's sales" header is set large; long names
// shrink to fit on one line (same idea as the model rows).
function fitTodaySalesName() {

    const el = $("#todaySalesModelName");

    if (!el || el.classList.contains("hidden")) {
        return;
    }

    const MAX_FONT = 28;
    const MIN_FONT = 15;

    let size = MAX_FONT;

    el.style.fontSize = size + "px";

    while (el.scrollWidth > el.clientWidth && size > MIN_FONT) {
        size -= 1;
        el.style.fontSize = size + "px";
    }

}

window.addEventListener("resize", fitTodaySalesName);


function renderSales() {

    const activeModel =
        currentModelFilter === null
            ? null
            : getModelById(currentModelFilter);

    // Lock the "Add a sale" form until a model is selected
    const saleAmountInput = $("#saleAmount");
    const addSaleBtn = $("#addSaleBtn");

    if (saleAmountInput) {

        saleAmountInput.disabled = !activeModel;

        saleAmountInput.placeholder =
            activeModel
                ? activeModel.title
                : "Select a model first";

        if (!activeModel) {
            saleAmountInput.value = "";
        }
    }

    if (addSaleBtn) {

        addSaleBtn.disabled = !activeModel;

        addSaleBtn.title =
            activeModel
                ? ""
                : "Select a model to add a sale";
    }


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

            modelBadge.style.setProperty(
                "--badge-color",
                getAvatarColor(activeModel.id)
            );

            modelBadge.innerHTML =
                `<span class="active-model-name">${escapeHTML(activeModel.title)}</span>`;
            modelBadge.classList.remove("hidden");
            modelBadge.title = "Clear selection — back to all models";
            modelBadge.setAttribute(
                "aria-label",
                `Selected model: ${activeModel.title}. Clear selection`
            );

        } else {

            modelBadge.textContent = "";
            modelBadge.style.removeProperty("--badge-color");
            modelBadge.classList.add("hidden");

        }

    }


    $("#shiftSettingsBtn").title =
        `Logout shift: ${getShiftTimeText()}`;


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
                getModelTextColor(cardColor)
            );

            if (todaySalesModelName) {
                todaySalesModelName.textContent = activeModel.title;
                todaySalesModelName.title = activeModel.title;
                todaySalesModelName.classList.remove("hidden");
                fitTodaySalesName();
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


    // Gross / net / PPV totals belong to a single model. The cards are
    // always on screen so choosing or clearing a model never changes the
    // page height or moves anything; with no model selected they show a
    // dash instead of a total.
    const salesPage = $("#sales");

    $("#gross").textContent =
        activeModel ? money(gross) : "—";

    $("#net").textContent =
        activeModel ? money(net) : "—";

    $("#saleCount").textContent =
        activeModel ? sales.length : "—";

    if (salesPage) {
        salesPage.classList.toggle("has-model", !!activeModel);
    }



    // Target progress (based on net earnings, per current context)
    renderTargetProgress(net);


    // Individual sales — only shown when a model is selected
    const listed = activeModel ? visible : [];

    $("#salesList").innerHTML =
        listed.map(
            ({ sale, index }) => {

                const saleNet =
                    Number(sale.amount) *
                    NET_RATE;

                const tagBadge =
                    sale.tip
                        ? `<span class="sale-tag-badge tip" title="Tip — ${escapeHTML(sale.buyerUsername || "")}">${ICONS.heart}Tip</span>`
                        : sale.outsideShift
                            ? `<span class="sale-tag-badge outside" title="Outside shift — ${escapeHTML(sale.buyerUsername || "")}">${ICONS.clock}Outside</span>`
                            : "";

                return `
                    <div class="sale-row">

                        <div class="sale-left">
                            <span class="sale-amount">${money(sale.amount)}</span>
                            ${tagBadge}
                        </div>

                        <div class="sale-right">

                            <span class="sale-net">
                                ${money(saleNet)} net
                            </span>

                            <button
                                class="delete"
                                onclick="deleteSale(${index})"
                                title="Delete sale"
                                aria-label="Delete sale"
                            >
                                ${ICONS.x}
                            </button>

                        </div>

                    </div>
                `;
            }
        ).join("");


    const emptySales = $("#emptySales");

    emptySales.textContent =
        activeModel
            ? "No sales added today."
            : "Select a model to see today's sales.";

    // "flex" (not "block") so the text centers in the card, the
    // way the Overview card's empty state does.
    emptySales.style.display =
        listed.length
            ? "none"
            : "flex";


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
                <div class="target-breakdown-row${model.id === currentModelFilter ? " selected" : ""}" data-model="${model.id}" draggable="true" role="button" tabindex="0" aria-pressed="${model.id === currentModelFilter}" style="--badge-color:${rowColor};--row-strong:${ink.strong};--row-muted:${ink.muted};--row-radio-border:${ink.radioBorder};--row-radio-bg:${ink.radioBg};--row-track-bg:${ink.trackBg};--row-track-fill:${ink.trackFill}" title="${model.id === currentModelFilter ? `Selected — adding sales for ${escapeHTML(model.title)}` : `Select to add a sale for ${escapeHTML(model.title)}`}">

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

        const nextId =
            row.dataset.model === currentModelFilter
                ? null
                : row.dataset.model;

        // The wiggle is pure CSS on `.selected`, so it persists across
        // re-renders and stops as soon as the model is deselected.
        selectModel(nextId);
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


// The username armed via the "Add Username" popover, or null when
// not armed, plus the kind of tag it is: "tip" or "outside".
// Purely a logout-text convenience flag — tagged sales still count
// as normal sales everywhere else (totals, target progress,
// history). Armed for exactly the next sale added, then clears.
let armedUsername = null;
let armedUsernameType = "tip";


function usernameTypeLabel(type) {

    return type === "outside"
        ? "Outside shift"
        : "Tip";
}


function setArmedUsername(username, type) {

    armedUsername = username || null;

    if (type) {
        armedUsernameType = type;
    }

    const toggle = $("#addUsernameToggle");

    toggle.classList.toggle(
        "active",
        Boolean(armedUsername)
    );

    toggle.classList.toggle(
        "armed-outside",
        Boolean(armedUsername) && armedUsernameType === "outside"
    );

    toggle.setAttribute(
        "aria-pressed",
        armedUsername ? "true" : "false"
    );

    toggle.title =
        armedUsername
            ? `${usernameTypeLabel(armedUsernameType)} — ${armedUsername} (next sale — click to change)`
            : "Tag the next sale with a username";
}


function setUsernameTypeUI(type) {

    armedUsernameType = type;

    document
        .querySelectorAll(".username-type-btn")
        .forEach(btn => {

            const on =
                btn.dataset.usernameType === type;

            btn.classList.toggle("active", on);

            btn.setAttribute(
                "aria-pressed",
                on ? "true" : "false"
            );
        });
}


document
    .querySelectorAll(".username-type-btn")
    .forEach(btn => {

        btn.addEventListener(
            "click",
            function () {

                setUsernameTypeUI(
                    btn.dataset.usernameType
                );

                $("#saleTagField").focus();
            }
        );
    });


$("#addUsernameToggle").addEventListener(
    "click",
    function () {

        const opening =
            $("#addUsernamePopover").classList.contains("hidden");

        $("#addUsernamePopover").classList.toggle(
            "hidden"
        );

        if (opening) {

            setUsernameTypeUI(armedUsernameType);

            $("#saleTagField").value =
                armedUsername || "";

            $("#saleTagField").focus();
        }
    }
);


$("#addUsernameForm").addEventListener(
    "submit",
    function (event) {

        event.preventDefault();

        const username =
            $("#saleTagField").value.trim();

        setArmedUsername(
            username,
            armedUsernameType
        );

        $("#addUsernamePopover").classList.add("hidden");
    }
);


document.addEventListener(
    "click",
    function (event) {

        if (event.target.closest(".outside-shift-picker")) {
            return;
        }

        $("#addUsernamePopover").classList.add(
            "hidden"
        );
    }
);


$("#saleForm").addEventListener(
    "submit",
    function (event) {

        event.preventDefault();


        if (currentModelFilter === null) {

            toast(
                "Select a model first."
            );

            return;
        }


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


        const sale = {
            amount: amount,
            time: Date.now(),
            modelId: currentModelFilter
        };

        if (armedUsername) {

            sale.buyerUsername = armedUsername;

            if (armedUsernameType === "outside") {
                sale.outsideShift = true;
            } else {
                sale.tip = true;
            }
        }

        data.sales[dateKey].push(sale);


        $("#saleAmount").value = "";

        setArmedUsername(null);


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

    // Rebuilding the list means whatever was expanded no longer
    // has a matching breakdown element, so the fixed logout button
    // shouldn't keep pointing at a stale date.
    expandedHistoryDate = null;
    updateCopyLogoutButton();

    const today =
        getDateKey();

    const modelNameEl =
        $("#historyModelName");

    // When a specific model is selected on the Sales page, the
    // history modal switches to that model's own layout: its name
    // up top, and the date list built from its own daily totals
    // rather than the combined per-day record.
    if (currentModelFilter !== null) {

        const activeModel =
            getModelById(currentModelFilter);

        if (modelNameEl) {

            modelNameEl.textContent =
                activeModel ? activeModel.title : "";

            modelNameEl.classList.toggle(
                "hidden",
                !activeModel
            );

        }

        const modelHistory =
            computeModelDailyRows(currentModelFilter, true)
                .sort((a, b) => b.date.localeCompare(a.date));

        const modelHistoryRowsHtml =
            modelHistory.map(
                item => `
                    <div class="history-row" data-date="${item.date}" role="button" tabindex="0" style="cursor:pointer">

                        <div class="history-date">
                            ${formatDate(item.date)}
                        </div>

                        <span class="history-target-badge ${item.targetPercent !== null && item.targetPercent >= 100 ? "hit" : ""}">
                            ${
                                item.targetPercent === null
                                    ? "No target"
                                    : item.targetPercent >= 100
                                        ? "Target hit"
                                        : `${item.targetPercent}%`
                            }
                        </span>

                    </div>

                    <div class="history-model-breakdown hidden" data-breakdown="${item.date}"></div>
                `
            ).join("");

        $("#historyList").innerHTML = modelHistoryRowsHtml;

        $("#emptyHistory").textContent =
            "This model's previous days will appear here.";

        $("#emptyHistory").style.display =
            modelHistory.length ? "none" : "block";

        return;
    }

    if (modelNameEl) {
        modelNameEl.textContent = "";
        modelNameEl.classList.add("hidden");
    }

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
                <div class="history-row" data-date="${item.date}" role="button" tabindex="0" style="cursor:pointer">
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

            // A deleted model no longer has an entry in
            // data.modelTargets (it's removed on deletion), so fall
            // back to the target it had at the moment it was
            // deleted, kept in data.deletedModels, to keep showing
            // its target-hit status on past days.
            const target = model
                ? (data.modelTargets[modelId] || 0)
                : getDeletedModelTarget(modelId);

            return {
                id: modelId,
                title: getModelName(modelId === "unassigned" ? null : modelId),
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


function getModelSalesForDate(dateKey, modelId) {

    return (data.sales[dateKey] || [])
        .filter(sale => sale.modelId === modelId)
        .map(sale => {

            const amount = Number(sale.amount);

            return {
                amount: amount,
                net: amount * NET_RATE,
                time: sale.time,
                outsideShift: sale.outsideShift,
                tip: sale.tip,
                buyerUsername: sale.buyerUsername
            };

        });
}


function renderModelDayDetail(dateKey, container) {

    const sales =
        getModelSalesForDate(
            dateKey,
            currentModelFilter
        );

    const gross =
        sales.reduce(
            (total, sale) => total + sale.amount,
            0
        );

    const net = gross * NET_RATE;

    const salesRowsHtml =
        sales.map(
            sale => `
                <div class="history-detail-sale-row">

                    <span>
                        ${money(sale.amount)}
                    </span>

                    <span class="sale-net">
                        ${money(sale.net)} net
                    </span>

                </div>
            `
        ).join("") ||
        `<div class="history-model-row empty">No sales recorded.</div>`;

    container.innerHTML = `

        <div class="history-detail-stats">

            <div class="history-detail-stat">
                <div class="history-detail-stat-label">Gross sales</div>
                <div class="history-detail-stat-value">${money(gross)}</div>
            </div>

            <div class="history-detail-stat">
                <div class="history-detail-stat-label">Net earnings</div>
                <div class="history-detail-stat-value">${money(net)}</div>
            </div>

            <div class="history-detail-stat">
                <div class="history-detail-stat-label">PPVs unlocked</div>
                <div class="history-detail-stat-value">${sales.length}</div>
            </div>

        </div>

        <div class="history-detail-sales-list">
            ${salesRowsHtml}
        </div>

    `;
}


function buildLogoutText(dateKey) {

    const activeModel =
        getModelById(currentModelFilter);

    const modelName =
        activeModel ? activeModel.title : "";

    const sales =
        getModelSalesForDate(
            dateKey,
            currentModelFilter
        );

    const gross =
        sales.reduce(
            (total, sale) => total + sale.amount,
            0
        );

    const net = gross * NET_RATE;

    // Sales tagged with a username still count in the totals above
    // like any other sale — these blocks just list them separately
    // at the bottom of the logout text, oldest first.
    const usernameLine =
        sale =>
            `${sale.buyerUsername} - ${money(Number(sale.amount) * NET_RATE)} net`;

    const tipSales = sales
        .filter(sale => sale.tip && sale.buyerUsername)
        .sort((a, b) => a.time - b.time);

    const tipsBlock =
        tipSales.length
            ? `\n\nTIPS:\n` +
              tipSales.map(usernameLine).join("\n")
            : "";

    const outsideShiftSales = sales
        .filter(sale => sale.outsideShift && sale.buyerUsername)
        .sort((a, b) => a.time - b.time);

    const outsideShiftBlock =
        outsideShiftSales.length
            ? `\n\nOUTSIDE SHIFT:\n` +
              outsideShiftSales.map(usernameLine).join("\n")
            : "";

    return (
        `🌸 LOGOUT 🌸\n\n` +
        `${modelName} -\n\n` +
        `Shift Time: ${getShiftTimeText()}\n` +
        `Date: ${formatDate(dateKey)}\n` +
        `Subscriptions - $\n` +
        `MM Sales - $\n` +
        `Tips + Messages - ${money(net)} net` +
        tipsBlock +
        outsideShiftBlock
    );
}


async function copyLogoutText(dateKey) {

    const text = buildLogoutText(dateKey);

    try {

        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            throw new Error("Clipboard API unavailable");
        }

        toast("Logout text copied!", "success");

    } catch {

        prompt(
            "Copy this text:",
            text
        );

    }
}


function updateCopyLogoutButton() {

    const btn = $("#copyLogoutBtn");

    if (!btn) {
        return;
    }

    const shouldShow =
        currentModelFilter !== null &&
        expandedHistoryDate !== null;

    btn.classList.toggle("hidden", !shouldShow);

    if (shouldShow) {
        btn.dataset.date = expandedHistoryDate;
    }
}


function expandHistoryRow(dateKey) {

    // Idempotent version of the "click a history row" behaviour —
    // always ends up expanded, regardless of whatever state that
    // row's breakdown was left in from a previous open/close of the
    // modal. Used when a trend bar drives the expansion directly.
    const breakdown =
        $(`[data-breakdown="${dateKey}"]`);

    if (!breakdown) {
        return;
    }

    document
        .querySelectorAll(".history-model-breakdown")
        .forEach(el => el.classList.add("hidden"));

    if (currentModelFilter !== null) {

        renderModelDayDetail(
            dateKey,
            breakdown
        );

    } else {

        renderModelBreakdownRow(
            dateKey,
            breakdown
        );

    }

    breakdown.classList.remove("hidden");

    expandedHistoryDate = dateKey;
    updateCopyLogoutButton();

    const row =
        $(`.history-row[data-date="${dateKey}"]`);

    if (row) {
        row.scrollIntoView({ block: "nearest" });
    }
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

            if (currentModelFilter !== null) {

                renderModelDayDetail(
                    dateKey,
                    breakdown
                );

            } else {

                renderModelBreakdownRow(
                    dateKey,
                    breakdown
                );

            }

            breakdown.classList.remove("hidden");
        }

        expandedHistoryDate = isHidden ? dateKey : null;
        updateCopyLogoutButton();
    }
);


/* =====================================================
   LOGOUT SHIFT (shift time + cover flag)
   Only feeds the "Copy for logout" text — nothing else reads it.
   ===================================================== */


// "16:00" -> "4:00PM", "00:00" -> "12:00AM"
function formatShiftTime(value) {

    const [hours, minutes] = String(value).split(":").map(Number);

    const period = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;

    return `${hour12}:${String(minutes).padStart(2, "0")}${period}`;
}


function getShiftTimeText(shift) {

    const current = shift || data.logoutShift;

    return (
        `${formatShiftTime(current.start)}-${formatShiftTime(current.end)}` +
        (current.cover ? " cover" : "")
    );
}


// Cover choice while the modal is open (only saved on "Save").
let shiftDraftCover = false;


function readShiftDraft() {

    return {
        start: $("#shiftStart").value,
        end: $("#shiftEnd").value,
        cover: shiftDraftCover
    };
}


function renderShiftModal() {

    $$("#shiftTypeToggle .shift-toggle-btn").forEach(
        btn => btn.classList.toggle(
            "active",
            (btn.dataset.cover === "true") === shiftDraftCover
        )
    );

    const draft = readShiftDraft();

    $("#shiftPreview").textContent =
        draft.start && draft.end
            ? `Shift Time: ${getShiftTimeText(draft)}`
            : "Pick a start and end time.";
}


function openShiftModal() {

    $("#shiftStart").value = data.logoutShift.start;
    $("#shiftEnd").value = data.logoutShift.end;

    shiftDraftCover = data.logoutShift.cover;

    renderShiftModal();

    $("#shiftModal").classList.remove("hidden");

    $("#shiftStart").focus();
}


function closeShiftModal() {

    $("#shiftModal").classList.add("hidden");
}


$("#shiftSettingsBtn").addEventListener(
    "click",
    openShiftModal
);


$("#closeShiftModal").addEventListener(
    "click",
    closeShiftModal
);


$("#cancelShiftModal").addEventListener(
    "click",
    closeShiftModal
);


$("#shiftModal").addEventListener(
    "click",
    function (event) {

        if (event.target.id === "shiftModal") {
            closeShiftModal();
        }

    }
);


["#shiftStart", "#shiftEnd"].forEach(
    selector =>
        $(selector).addEventListener("input", renderShiftModal)
);


$("#shiftTypeToggle").addEventListener(
    "click",
    function (event) {

        const btn = event.target.closest(".shift-toggle-btn");

        if (!btn) {
            return;
        }

        shiftDraftCover = btn.dataset.cover === "true";

        renderShiftModal();
    }
);


$("#shiftForm").addEventListener(
    "submit",
    function (event) {

        event.preventDefault();

        const draft = readShiftDraft();

        if (!draft.start || !draft.end) {
            return;
        }

        data.logoutShift = draft;

        saveData();

        renderSales();

        closeShiftModal();

        toast("Logout shift saved", "success");
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

    expandedHistoryDate = null;
    updateCopyLogoutButton();
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


$("#copyLogoutBtn").addEventListener(
    "click",
    function () {

        if (!expandedHistoryDate) {
            return;
        }

        copyLogoutText(expandedHistoryDate);
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
                        getScroller().scrollTop;
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
                        getScroller().scrollTop =
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
   CARD ACTION ICONS
   Shared inline SVGs (see ICONS at the top of this file), so
   they pick up the card's text colour and stay crisp.
   ===================================================== */

const ICON_EDIT = ICONS.edit;

const ICON_COPY = ICONS.copy;


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
                        title="${escapeHTML(category)} — hold to rename, drag to reorder"
                    >
                        ${escapeHTML(category)}
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


function renameCategory(type, oldName) {

    const list =
        data.customCategories[type] || [];


    const index =
        list.indexOf(oldName);


    // Only user-added categories can be renamed.
    if (index === -1) {
        return;
    }


    const input =
        prompt(
            "Rename category:",
            oldName
        );


    if (input === null) {
        return;
    }


    const trimmed =
        input.trim();


    if (!trimmed || trimmed === oldName) {
        return;
    }


    const alreadyExists =
        getCategories(type)
            .some(
                category =>
                    category !== oldName &&
                    category.toLowerCase() ===
                    trimmed.toLowerCase()
            );


    if (alreadyExists) {

        alert(
            "That category already exists."
        );

        return;
    }


    list[index] = trimmed;


    // Re-tag every item that was filed under the old name,
    // so nothing silently drops out of its category.
    (data[type] || []).forEach(
        item => {

            if (item.category === oldName) {
                item.category = trimmed;
            }

        }
    );


    if (currentCategory[type] === oldName) {
        currentCategory[type] = trimmed;
    }


    saveData();

    renderChips(type);

    renderContent(type);
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
                    tabindex="0"
                    data-id="${item.id}"
                    onclick="openViewModal('${type}', '${item.id}')"
                >

                    <button
                        class="card-icon-btn card-edit-btn"
                        type="button"
                        title="Edit"
                        aria-label="Edit"
                        onclick="
                            event.stopPropagation();
                            editItem(
                                '${type}',
                                '${item.id}'
                            )
                        "
                    >
                        ${ICON_EDIT}
                    </button>

                    <h3>
                        ${escapeHTML(item.title)}
                    </h3>

                    ${
                        usesCategories
                            ? `
                                <div class="content-meta">
                                    ${escapeHTML(item.category)}
                                </div>
                            `
                            : ""
                    }

                    <div class="content-text">${escapeHTML(item.text)}</div>

                    <div class="card-actions">

                        <button
                            class="card-icon-btn"
                            type="button"
                            title="Copy"
                            aria-label="Copy"
                            onclick="
                                event.stopPropagation();
                                copyItem(
                                    '${type}',
                                    '${item.id}'
                                )
                            "
                        >
                            ${ICON_COPY}
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

// How long the pointer has to sit in an edge zone before we start
// auto-scrolling — avoids kicking off a scroll from a quick pass
// through the edge on the way to dropping somewhere on-screen.
const DRAG_AUTOSCROLL_DELAY = 300;
let dragAutoScrollEdgeSince = null;


function stepDragAutoScroll() {

    const scroller = getScroller();

    if (dragAutoScrollSpeed !== 0 && scroller) {

        scroller.scrollTop += dragAutoScrollSpeed;

        dragAutoScrollFrame =
            requestAnimationFrame(stepDragAutoScroll);

    } else {

        dragAutoScrollFrame = null;

    }

}


/* Keep the Scripts floating category bar pinned right under the sticky
   top bar, whatever height the top bar ends up being. */
(function () {

    const page = $("#scripts");
    const topbar = page ? page.querySelector(".page-topbar") : null;

    if (!page || !topbar) {
        return;
    }

    function syncTopbarHeight() {

        const height = topbar.offsetHeight;

        if (height > 0) {
            page.style.setProperty("--topbar-h", height + "px");
        }

    }

    syncTopbarHeight();

    if (window.ResizeObserver) {
        new ResizeObserver(syncTopbarHeight).observe(topbar);
    }

    window.addEventListener("resize", syncTopbarHeight);

})();


function updateDragAutoScroll(clientY) {

    const mainEl = $(".main");

    if (!mainEl) {
        return;
    }

    // On phones the whole window scrolls; otherwise .main does.
    const rect = phoneScrollQuery.matches
        ? { top: 0, bottom: window.innerHeight }
        : mainEl.getBoundingClientRect();

    // The upward trigger zone starts at the BOTTOM of the sticky
    // page-topbar (title/search/stats/trash icon), not the top of
    // the viewport — otherwise hovering anywhere in that header,
    // including over the trash icon, kept scrolling the page and
    // made it hard to actually drop on it.
    // On Scripts this is also the anchor: the floating category bar
    // sits inside the upward zone rather than pushing it lower, so
    // dragging a script toward the top scrolls as soon as it reaches
    // the bottom of the top bar.
    const topbarEl = $(".page.active .page-topbar");

    const topEdge =
        topbarEl
            ? topbarEl.getBoundingClientRect().bottom
            : rect.top;

    const inEdgeZone =
        (clientY >= topEdge && clientY < topEdge + DRAG_AUTOSCROLL_EDGE) ||
        clientY > rect.bottom - DRAG_AUTOSCROLL_EDGE;

    if (!inEdgeZone) {
        dragAutoScrollEdgeSince = null;
        dragAutoScrollSpeed = 0;
        return;
    }

    // Just entered the edge zone — start the clock, but don't scroll yet.
    if (dragAutoScrollEdgeSince === null) {
        dragAutoScrollEdgeSince = performance.now();
    }

    if (performance.now() - dragAutoScrollEdgeSince < DRAG_AUTOSCROLL_DELAY) {
        dragAutoScrollSpeed = 0;
        return;
    }

    if (clientY < topEdge + DRAG_AUTOSCROLL_EDGE) {

        const intensity =
            (topEdge + DRAG_AUTOSCROLL_EDGE - clientY) /
            DRAG_AUTOSCROLL_EDGE;

        dragAutoScrollSpeed =
            -Math.ceil(
                DRAG_AUTOSCROLL_MAX_SPEED * Math.min(intensity, 1)
            );

    } else {

        const intensity =
            (clientY - (rect.bottom - DRAG_AUTOSCROLL_EDGE)) /
            DRAG_AUTOSCROLL_EDGE;

        dragAutoScrollSpeed =
            Math.ceil(
                DRAG_AUTOSCROLL_MAX_SPEED * Math.min(intensity, 1)
            );

    }

    if (dragAutoScrollSpeed !== 0 && !dragAutoScrollFrame) {
        dragAutoScrollFrame = requestAnimationFrame(stepDragAutoScroll);
    }

}


function stopDragAutoScroll() {

    dragAutoScrollSpeed = 0;
    dragAutoScrollEdgeSince = null;

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
   HOLD TO RENAME — SCRIPT CATEGORIES
   Press and hold a custom category chip (mouse or finger)
   and you get a prompt to rename it. Moving your finger /
   mouse cancels the hold, so dragging a chip to reorder it
   or to the trash still works exactly as before.
   ===================================================== */


const CATEGORY_HOLD_MS = 550;
const CATEGORY_HOLD_MOVE_TOLERANCE = 10;

let categoryHoldState = null;

// Set for a moment after a hold fires, so releasing the chip
// doesn't also register as a click and switch the filter.
let suppressChipClick = false;


function cancelCategoryHold() {

    if (!categoryHoldState) {
        return;
    }

    clearTimeout(categoryHoldState.timer);

    categoryHoldState.chip.classList.remove(
        "holding"
    );

    categoryHoldState = null;
}


$$(".chips").forEach(
    group => {

        const type =
            group.dataset.filter;

        if (!CATEGORIZED_TYPES.includes(type)) {
            return;
        }


        group.addEventListener(
            "pointerdown",
            function (event) {

                cancelCategoryHold();

                suppressChipClick = false;


                // Left button / touch / pen only.
                if (
                    event.pointerType === "mouse" &&
                    event.button !== 0
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


                const category =
                    chip.dataset.category;


                categoryHoldState = {
                    chip: chip,
                    type: type,
                    category: category,
                    startX: event.clientX,
                    startY: event.clientY,
                    fired: false,
                    timer: setTimeout(
                        function () {

                            if (!categoryHoldState) {
                                return;
                            }

                            categoryHoldState.fired = true;

                            chip.classList.remove("holding");

                            suppressChipClick = true;

                            categoryHoldState = null;

                            renameCategory(type, category);

                            // In case the release never produces a
                            // click (the chip gets re-rendered under
                            // your finger), don't leave the flag on.
                            setTimeout(
                                function () {
                                    suppressChipClick = false;
                                },
                                400
                            );

                        },
                        CATEGORY_HOLD_MS
                    )
                };


                chip.classList.add("holding");
            }
        );


        group.addEventListener(
            "pointermove",
            function (event) {

                if (!categoryHoldState) {
                    return;
                }

                const movedFar =
                    Math.abs(
                        event.clientX - categoryHoldState.startX
                    ) > CATEGORY_HOLD_MOVE_TOLERANCE ||
                    Math.abs(
                        event.clientY - categoryHoldState.startY
                    ) > CATEGORY_HOLD_MOVE_TOLERANCE;

                if (movedFar) {
                    cancelCategoryHold();
                }
            }
        );


        ["pointerup", "pointercancel", "pointerleave", "dragstart"].forEach(
            evtName =>
                group.addEventListener(
                    evtName,
                    cancelCategoryHold
                )
        );


        // A long press on touch would otherwise pop up the
        // browser's own text-selection / context menu on top
        // of the rename prompt.
        group.addEventListener(
            "contextmenu",
            function (event) {

                if (
                    suppressChipClick ||
                    (
                        categoryHoldState &&
                        event.pointerType !== "mouse"
                    )
                ) {
                    event.preventDefault();
                }
            }
        );


        // Capture phase, so this runs before the filter-switching
        // click handler further up and can swallow the click that
        // follows a hold.
        group.addEventListener(
            "click",
            function (event) {

                if (!suppressChipClick) {
                    return;
                }

                suppressChipClick = false;

                event.preventDefault();

                event.stopPropagation();
            },
            true
        );

    }
);


window.addEventListener(
    "scroll",
    cancelCategoryHold,
    true
);


/* =====================================================
   DRAG TO DELETE — SIDEBAR TRASH DROP ZONE
   A single trash bin, docked above the Settings button, that
   fades in for the duration of any drag — a content-card, a
   "target breakdown" model row, or (on Scripts) a custom
   category chip — and fades back out as soon as the drag ends.
   Drop the dragged thing on it to delete it.
   ===================================================== */


function armTrash(isArmed) {

    const trash = $("#sidebarTrash");

    if (!trash) {
        return;
    }

    trash.classList.toggle("armed", isArmed);
}


document.addEventListener(
    "dragstart",
    function (event) {

        if (
            event.target.closest(".content-card") ||
            event.target.closest(".chip.chip-draggable") ||
            event.target.closest(".target-breakdown-row")
        ) {
            armTrash(true);
        }

    }
);


["dragend", "drop"].forEach(
    evtName =>
        document.addEventListener(
            evtName,
            function () {
                armTrash(false);
            }
        )
);


(function () {

    const trash = $("#sidebarTrash");

    if (!trash) {
        return;
    }


    trash.addEventListener(
        "dragover",
        function (event) {

            if (!dragState && !categoryDragState) {
                return;
            }

            event.preventDefault();

            event.dataTransfer.dropEffect = "move";

            trash.classList.add("drag-over");
        }
    );


    trash.addEventListener(
        "dragleave",
        function () {
            trash.classList.remove("drag-over");
        }
    );


    trash.addEventListener(
        "drop",
        function (event) {

            trash.classList.remove("drag-over");


            if (dragState) {

                event.preventDefault();

                const type = dragState.type;
                const id = dragState.id;

                dragState = null;

                deleteItem(type, id);

                return;
            }


            if (categoryDragState) {

                event.preventDefault();

                const type = categoryDragState.type;
                const category = categoryDragState.category;

                categoryDragState = null;

                removeCategory(type, category);

            }

        }
    );

})();


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


        let item = {

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

            // Merge onto the existing item instead of replacing it
            // outright, so fields the form doesn't manage (like a
            // model's createdDate) survive an edit.
            if (index !== -1) {
                item = {
                    ...data[modalType][index],
                    ...item
                };
            }

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
            // Keep the model's title AND the target it had at the
            // moment of deletion, so past days can still show what
            // percent of target it hit instead of losing that info
            // once modelTargets[id] is deleted below.
            data.deletedModels[id] = {
                title: deletedModel.title,
                target: data.modelTargets[id] || 0
            };
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
   KEYBOARD: rows that act like buttons
   Model rows, history dates and content cards are clickable
   divs; Enter / Space now activates them like a real button.
   ===================================================== */

document.addEventListener(
    "keydown",
    function (event) {

        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        const el = event.target;

        if (
            el.matches &&
            el.matches(".target-breakdown-row, .history-row, .content-card")
        ) {
            event.preventDefault();
            el.click();
        }

    }
);


/* =====================================================
   PHONE: HIDE TAB BAR ON SCROLL
   On a phone the sidebar is a bottom tab bar. Scrolling down
   slides it away to give the content room; scrolling up (or
   getting back near the top) brings it back.
   ===================================================== */

(function () {

    const mainEl = $(".main");

    if (!mainEl) {
        return;
    }

    const phoneQuery = window.matchMedia("(max-width: 700px)");

    // Don't hide until we're this far from the top of the page.
    const HIDE_AFTER = 48;

    // Distance to travel in one direction before the bar reacts, so
    // small jitters and finger wobble don't make it flicker.
    const TRAVEL = 10;

    // On phones the window scrolls (not .main), so listen there.
    let lastY = window.scrollY;
    let travel = 0;
    let suppressUntil = 0;

    function setNavHidden(hidden) {
        document.body.classList.toggle("nav-hidden", hidden);
    }

    window.addEventListener(
        "scroll",
        function () {

            const y = Math.max(window.scrollY, 0);
            const dy = y - lastY;

            lastY = y;

            if (!phoneQuery.matches) {
                return;
            }

            // Near the top: the bar is always visible.
            if (y <= HIDE_AFTER && dy <= 0) {
                travel = 0;
                setNavHidden(false);
                return;
            }

            // Scrolls we caused ourselves (switching tabs restores a
            // saved position; drag auto-scroll) aren't the user
            // flicking the page, so they shouldn't move the bar.
            if (performance.now() < suppressUntil || dragState) {
                travel = 0;
                return;
            }

            // Changing direction restarts the count.
            if ((dy > 0) !== (travel > 0)) {
                travel = 0;
            }

            travel += dy;

            if (travel > TRAVEL && y > HIDE_AFTER) {
                setNavHidden(true);
            } else if (travel < -TRAVEL) {
                setNavHidden(false);
            }

        },
        { passive: true }
    );

    // Switching tabs: bring the bar back and ignore the scroll jump
    // that restoring the other tab's position causes.
    $$(".nav-btn").forEach(
        button => {
            button.addEventListener(
                "click",
                function () {
                    suppressUntil = performance.now() + 500;
                    travel = 0;
                    setNavHidden(false);
                }
            );
        }
    );

    // Leaving phone width (rotate / resize): never leave it hidden.
    phoneQuery.addEventListener(
        "change",
        function () {
            if (!phoneQuery.matches) {
                setNavHidden(false);
            }
        }
    );

})();


/* =====================================================
   PHONE: PULL DOWN FROM THE TOP TO RELOAD
   The browser's own pull-to-refresh is switched off, so this
   is done by hand:
   drag down while already at the top, past the threshold,
   and let go to reload.
   ===================================================== */

(function () {

    const mainEl = $(".main");

    if (!mainEl) {
        return;
    }

    const phoneQuery = window.matchMedia("(max-width: 700px)");

    const THRESHOLD = 64;   // pull distance (after resistance) that triggers a reload
    const MAX_PULL = 96;
    const RESISTANCE = 0.5; // finger travels 2px for every 1px the indicator moves
    const SLOP = 8;         // finger movement before we decide it's a pull

    const indicator = document.createElement("div");

    indicator.className = "ptr";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML =
        `<svg class="icon" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`;

    document.body.appendChild(indicator);

    let startX = 0;
    let startY = 0;
    let pull = 0;
    let tracking = false;
    let pulling = false;
    let refreshing = false;


    function showIndicator(distance) {

        const progress = Math.min(distance / THRESHOLD, 1);

        indicator.style.opacity = progress;
        indicator.style.transform = `translateY(${distance - 44}px)`;
        indicator.style.setProperty("--ptr-rot", (progress * 270) + "deg");

    }


    function resetIndicator() {

        indicator.classList.remove("pulling", "ready");

        // Hand control back to the stylesheet so it eases away.
        indicator.style.opacity = "";
        indicator.style.transform = "";
        indicator.style.removeProperty("--ptr-rot");

        pull = 0;
        pulling = false;
        tracking = false;

    }


    // Is the touch inside something that's scrolled down (like the
    // sales list)? Then a downward drag should scroll that, not pull.
    function insideScrolledChild(el) {

        while (el && el !== mainEl) {

            if (el.scrollTop > 0) {
                return true;
            }

            el = el.parentElement;
        }

        return false;
    }


    function startRefresh() {

        refreshing = true;

        indicator.classList.remove("pulling", "ready");
        indicator.classList.add("refreshing");
        showIndicator(THRESHOLD);

        // Let any edit that hasn't reached the cloud yet finish
        // first, otherwise the reload could bring back older data.
        const settled = Promise.race([
            flushCloudPush(),
            new Promise(resolve => setTimeout(resolve, 2500))
        ]);

        settled.then(
            () => location.reload(),
            () => location.reload()
        );

    }


    mainEl.addEventListener(
        "touchstart",
        function (event) {

            if (
                refreshing ||
                !phoneQuery.matches ||
                event.touches.length !== 1 ||
                getScroller().scrollTop > 0 ||
                $(".modal:not(.hidden)") ||
                insideScrolledChild(event.target)
            ) {
                tracking = false;
                return;
            }

            startX = event.touches[0].clientX;
            startY = event.touches[0].clientY;

            tracking = true;
            pulling = false;
            pull = 0;

        },
        { passive: true }
    );


    mainEl.addEventListener(
        "touchmove",
        function (event) {

            if (!tracking || refreshing) {
                return;
            }

            // A second finger (pinch etc.) cancels the pull.
            if (event.touches.length !== 1) {
                resetIndicator();
                return;
            }

            const dx = event.touches[0].clientX - startX;
            const dy = event.touches[0].clientY - startY;

            if (!pulling) {

                // Scrolling up, or sideways (chip strips, etc.):
                // not ours.
                if (dy < -SLOP || Math.abs(dx) > Math.abs(dy)) {
                    tracking = false;
                    return;
                }

                if (dy < SLOP) {
                    return;
                }

                pulling = true;
                indicator.classList.add("pulling");
            }

            // The page moved (or the finger came back up past the
            // start): stop pulling and let normal scrolling take over.
            if (getScroller().scrollTop > 0 || dy <= 0) {
                resetIndicator();
                return;
            }

            if (event.cancelable) {
                event.preventDefault();
            }

            pull = Math.min((dy - SLOP) * RESISTANCE, MAX_PULL);

            indicator.classList.toggle("ready", pull >= THRESHOLD);

            showIndicator(pull);

        },
        { passive: false }
    );


    function endPull(event) {

        if (!tracking) {
            return;
        }

        const shouldRefresh =
            pulling &&
            event.type === "touchend" &&
            pull >= THRESHOLD;

        if (shouldRefresh) {
            tracking = false;
            pulling = false;
            startRefresh();
            return;
        }

        resetIndicator();

    }


    mainEl.addEventListener("touchend", endPull);
    mainEl.addEventListener("touchcancel", endPull);

})();


/* =====================================================
   INITIAL LOAD
   ===================================================== */


initTheme();

initSidebarCollapse();

renderAll();

initAuthGate();
