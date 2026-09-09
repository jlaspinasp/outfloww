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
    }
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

    if (icon) {
        icon.textContent = theme === "light" ? "☀️" : "🌙";
    }

    if (label) {
        label.textContent = theme === "light" ? "Light mode" : "Dark mode";
    }

}


function initTheme() {

    const saved = localStorage.getItem(THEME_KEY) || "dark";

    applyTheme(saved);

}


function toggleTheme() {

    const current =
        document.documentElement.getAttribute("data-theme") === "light"
            ? "light"
            : "dark";

    const next = current === "light" ? "dark" : "light";

    localStorage.setItem(THEME_KEY, next);

    applyTheme(next);

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


function setSyncStatus(state) {

    const el = $("#syncStatus");

    if (!el) {
        return;
    }

    el.classList.remove("synced", "syncing", "offline");
    el.classList.add(state);

    el.textContent =
        state === "synced" ? "Synced" :
        state === "syncing" ? "Syncing…" :
        "Offline";

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
   TRENDS (weekly / monthly rollups)
   ===================================================== */

let currentTrendRange = "week";

function getPeriodKey(dateKey, range) {

    const d = new Date(dateKey + "T00:00:00");

    if (range === "month") {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }

    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getPeriodLabel(key, range) {

    if (range === "month") {
        const [y, m] = key.split("-");
        return new Date(`${y}-${m}-01T00:00:00`)
            .toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    }

    return new Date(key + "T00:00:00")
        .toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function addPeriod(key, range, delta) {

    if (range === "month") {
        const [y, m] = key.split("-").map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }

    const d = new Date(key + "T00:00:00");
    d.setDate(d.getDate() + delta * 7);

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderTrends(range) {

    currentTrendRange = range || currentTrendRange;

    const today = getDateKey();

    const combined =
        currentModelFilter === null
            ? data.history
            : computeModelDailyRows(currentModelFilter, false);

    const buckets = {};

    combined.forEach(item => {
        const key = getPeriodKey(item.date, currentTrendRange);
        if (!buckets[key]) buckets[key] = { gross: 0, net: 0, count: 0 };
        buckets[key].gross += item.gross;
        buckets[key].net += item.net;
        buckets[key].count += item.count;
    });

    const periodsToShow = currentTrendRange === "week" ? 8 : 6;
    const currentKey = getPeriodKey(today, currentTrendRange);

    const rows = [];
    for (let i = periodsToShow - 1; i >= 0; i--) {
        const key = addPeriod(currentKey, currentTrendRange, -i);
        rows.push({
            key,
            label: getPeriodLabel(key, currentTrendRange),
            net: buckets[key] ? buckets[key].net : 0,
            count: buckets[key] ? buckets[key].count : 0
        });
    }

    const maxNet = Math.max(...rows.map(r => r.net), 1);

    $("#trendBars").innerHTML = rows.map(r => `
        <div class="trend-bar-col" title="${r.label}: ${money(r.net)} net · ${r.count} sale${r.count === 1 ? "" : "s"}">
            <div class="trend-bar-track">
                <div class="trend-bar-fill" style="height:${r.net > 0 ? Math.max((r.net / maxNet) * 100, 4) : 0}%"></div>
            </div>
            <div class="trend-bar-label">${r.label}</div>
        </div>
    `).join("");

    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    const periodWord = currentTrendRange === "week" ? "week" : "month";

    let summaryHtml = `<strong>${money(last.net)}</strong> net this ${periodWord}`;

    if (prev) {
        const diff = last.net - prev.net;
        const pct = prev.net > 0
            ? Math.round((diff / prev.net) * 100)
            : (last.net > 0 ? 100 : 0);

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

    let hash = 0;

    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = Math.abs(hash) % 360;

    return `hsl(${hue}, 65%, 50%)`;
}


function renderModelAvatarStrip() {

    const strip = $("#modelAvatarStrip");

    if (!strip) {
        return;
    }

    const modelButtons = data.models.map(model => `
        <button
            type="button"
            class="model-avatar ${currentModelFilter === model.id ? "active" : ""}"
            data-model="${model.id}"
            title="${escapeHTML(model.title)}"
            style="--avatar-color:${getAvatarColor(model.id)}"
        >
            ${escapeHTML(getInitials(model.title))}
        </button>
    `).join("");

    strip.innerHTML = `
        <button
            type="button"
            class="model-avatar all-avatar ${currentModelFilter === null ? "active" : ""}"
            data-model=""
            title="All models"
        >
            All
        </button>
        ${modelButtons}
    `;
}


$("#modelAvatarStrip").addEventListener(
    "click",
    function (event) {

        const btn = event.target.closest(".model-avatar");

        if (!btn) {
            return;
        }

        currentModelFilter = btn.dataset.model || null;

        renderSales();
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

    renderModelAvatarStrip();

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

            modelBadge.style.setProperty(
                "--badge-color",
                getAvatarColor(activeModel.id)
            );

            modelBadge.textContent = activeModel.title;
            modelBadge.classList.remove("hidden");

        } else {

            modelBadge.textContent = "";
            modelBadge.classList.add("hidden");

        }

    }


    $("#clearSales").textContent =
        activeModel ? "Clear today" : "Clear today";


    // Stats
    $("#gross").textContent =
        money(gross);

    $("#net").textContent =
        money(net);

    $("#saleCount").textContent =
        sales.length;


    // Target progress (based on net earnings, per current context)
    renderTargetProgress(net);


    // The "All models" target is a derived total, not editable —
    // hide the gear button so it can't be opened in that view.
    const targetEditBtn = $("#openTargetModal");

    if (targetEditBtn) {
        targetEditBtn.classList.toggle(
            "hidden",
            currentModelFilter === null
        );
    }


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


    // Keep the scroll pinned to the latest sale
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

    const target = getCurrentTarget();

    const percent =
        getTargetPercent(net, target);


    if (percent === null) {

        $("#progressFill").style.width =
            "0%";

        $("#progressFill").classList.remove(
            "hit"
        );

        $("#progressLabel").textContent =
            currentModelFilter === null
                ? "Set daily targets on each model's tab to see a combined total here."
                : "Set a daily target (⚙️ above) to start tracking progress.";

        return;
    }


    const displayWidth =
        Math.min(percent, 100);

    $("#progressFill").style.width =
        displayWidth + "%";

    $("#progressFill").classList.toggle(
        "hit",
        percent >= 100
    );

    $("#progressLabel").textContent =
        percent >= 100
            ? `🎉 ${percent}% of target — ${money(net)} net / ${money(target)}`
            : `${percent}% of target — ${money(net)} net / ${money(target)}`;
}


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

    $("#targetModal").classList.remove(
        "hidden"
    );

    $("#targetAmount").focus();
}


function closeTargetModal() {

    $("#targetModal").classList.add(
        "hidden"
    );
}


$("#openTargetModal").addEventListener(
    "click",
    openTargetModal
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


    const history =
        currentModelFilter === null
            ? data.history

                .filter(
                    item =>
                        item.date !== today
                )

                .sort(
                    (a, b) =>
                        b.date.localeCompare(
                            a.date
                        )
                )
            : computeModelDailyRows(
                currentModelFilter,
                true
            ).sort(
                (a, b) =>
                    b.date.localeCompare(
                        a.date
                    )
            );


    const historyRowsHtml =
        history.map(
            item => `
                <div class="history-row">

                    <div>

                        <div class="history-date">
                            ${formatDate(item.date)}
                        </div>

                        <small class="sub">
                            ${item.count}
                            sale${item.count === 1 ? "" : "s"}
                            ${
                                item.targetPercent !== null &&
                                item.targetPercent !== undefined
                                    ? ` · ${item.targetPercent}% of target`
                                    : ""
                            }
                        </small>

                    </div>


                    <div>

                        <strong>
                            ${money(item.gross)}
                        </strong>

                        <span class="history-net">
                            ${money(item.net)} net
                        </span>

                        ${
                            item.targetPercent !== null &&
                            item.targetPercent !== undefined
                                ? `
                                    <span class="history-target-badge ${item.targetPercent >= 100 ? "hit" : ""}">
                                        ${item.targetPercent}%
                                    </span>
                                `
                                : ""
                        }

                    </div>

                </div>
            `
        ).join("");


    $("#historyList").innerHTML =
        historyRowsHtml;

    $("#mainHistoryList").innerHTML =
        historyRowsHtml;


    $("#emptyHistory").style.display =
        history.length
            ? "none"
            : "block";

    $("#mainHistoryEmpty").style.display =
        history.length
            ? "none"
            : "block";
}


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


                $(
                    "#" +
                    this.dataset.page
                ).classList.add(
                    "active"
                );

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


    if (type === "models") {
        renderModelAvatarStrip();
    }
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

function playKaching() {

    try {

        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        const ping = (freq, start, dur, vol = 0.25) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0, ctx.currentTime + start);
            gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
            osc.start(ctx.currentTime + start);
            osc.stop(ctx.currentTime + start + dur);
        };

        ping(1568, 0, 0.15);
        ping(2093, 0.08, 0.35);

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


$("#themeToggle").addEventListener(
    "click",
    toggleTheme
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

renderAll();

initAuthGate();