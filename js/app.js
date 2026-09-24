/* =====================================================
   CHATTER TOOL
   All data is stored locally in the browser.
   ===================================================== */


const STORAGE_KEY = "chatterTool_v1";


// Net percentage
const NET_RATE = 0.80;

// First line of the "Copy for logout" text. Each person can restyle it
// in Settings > Logout title; it syncs with their account like the rest
// of their data. Stored as "" while they're on the default.
const DEFAULT_LOGOUT_TITLE = "🌸 LOGOUT 🌸";
const LOGOUT_TITLE_MAX = 60;   // characters as the person sees them


// Splits text into what a person sees as single characters, so an emoji
// (which can be several code units, e.g. flags or skin tones) counts as
// one and is never cut in half.
function splitGraphemes(text) {

    if (window.Intl && Intl.Segmenter) {
        return Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" })
                .segment(text),
            part => part.segment
        );
    }

    return Array.from(text);
}


function limitGraphemes(text, max) {
    return splitGraphemes(text).slice(0, max).join("");
}


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
    logoutShift: { start: "16:00", end: "00:00", cover: false },
    // Custom first line of the logout text ("" = use the default)
    logoutTitle: ""
};


// Load saved data
function normalizeData(obj) {

    obj = obj || {};

    obj.sales = obj.sales || {};
    obj.history = obj.history || [];
    obj.models = obj.models || [];
    obj.scripts = obj.scripts || [];
    obj.target = obj.target || 0;

    // Guard against a corrupted/hand-edited backup where
    // customCategories isn't a plain object (e.g. a string or array) —
    // reset it instead of silently leaving it broken.
    obj.customCategories =
        (obj.customCategories &&
            typeof obj.customCategories === "object" &&
            !Array.isArray(obj.customCategories))
            ? obj.customCategories
            : {};
    obj.customCategories.scripts =
        Array.isArray(obj.customCategories.scripts)
            ? obj.customCategories.scripts
            : [];

    // Per-model daily targets, e.g. { "<modelId>": 300 }
    obj.modelTargets = obj.modelTargets || {};

    // Names of models that were deleted, kept so old sales
    // records can still show a name instead of "Unassigned".
    obj.deletedModels = obj.deletedModels || {};

    // Shifts saved to history from the Shift Report window:
    // { "<dateKey>": { "<modelId>": [ { shift, times, at } ] } }
    obj.closedShifts = obj.closedShifts || {};

    // Legacy (unused): see defaultData.
    obj.modelColors = obj.modelColors || {};

    // Shift time + cover flag, used only by the "Copy for logout" text.
    const TIME_RE = /^\d{1,2}:\d{2}$/;
    const shift = obj.logoutShift || {};

    // Custom first line of the logout text: one line, trimmed, capped.
    obj.logoutTitle =
        typeof obj.logoutTitle === "string"
            ? limitGraphemes(obj.logoutTitle.replace(/[\r\n]+/g, " ").trim(), LOGOUT_TITLE_MAX)
            : "";

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

// What the Today's sales list last showed, so a newly added sale can ease
// in (see renderSales).
let lastSalesRender = { modelId: null, count: 0 };

// The model whose row is currently playing its "un-select" (revert)
// animation — see selectModel() and the ".deselecting" CSS below.
// null when nothing is reverting.
let deselectingModelId = null;
let deselectingModelTimer = null;

// Same idea for the pop-in: only the row that was JUST selected plays
// it. Without this the pop-in replayed on every re-render and every
// time the Sales tab was shown again.
let selectingModelId = null;
let selectingModelTimer = null;

// Which day's row is currently expanded in the history modal. When a
// model is selected this is a row key (a day can have more than one
// row — one per saved shift), not just a date. Drives the fixed
// "Copy for Logout" button at the bottom of the modal, since that
// button needs to know which day (and which shift) to build from.
let expandedHistoryDate = null;

// Row key -> { dateKey, shift, times } for whatever the model-specific
// history list last rendered. Lets the expand/copy-logout code turn a
// row key back into the real date, its saved shift, and exactly the
// sale times that belong to that one row.
let historyRowMeta = {};

// How many history rows to render at once. renderHistory() slices to
// this count and shows a "Load more" row when there's more history
// than that, instead of dumping months of rows into the DOM in one
// go. Reset to the initial page whenever the modal is (re)opened.
const HISTORY_PAGE_SIZE = 30;
let historyVisibleCount = HISTORY_PAGE_SIZE;

// Multi-select for the Models/Scripts content grids — long-press a
// card to turn this on (iOS Photos style), tap more cards to add to
// the selection, then drag a selected card onto the toolbar's trash
// button (or just tap it) to delete everything selected at once.
let selectMode = { models: false, scripts: false };
let selectedIds = { models: new Set(), scripts: new Set() };

// Remembers each tab's scroll position so switching tabs and
// coming back doesn't dump you at the top.
const pageScrollPositions = {};

// Same idea, one level deeper: remembers scroll position per
// category filter (e.g. Scripts categories), keyed by
// categoryScrollPositions[type][categoryName], so flipping between
// chips restores where you were instead of wherever a shorter list
// happened to clamp the scroll to.
const categoryScrollPositions = {};


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
    copy: svgIcon(`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`),
    trash: svgIcon(`<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`),
    alertTriangle: svgIcon(`<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>`),
    info: svgIcon(`<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/>`)
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


/* =====================================================
   REDUCE MOTION (Settings)
   Sets <html data-reduce-motion="true">, which style.css uses to
   strip animations app-wide (except the Sales tab's model rows).
   Stored per device, like the theme.
   ===================================================== */

const REDUCE_MOTION_KEY = "chatterTool_reduceMotion";


function isReduceMotionSetting() {

    try {
        return localStorage.getItem(REDUCE_MOTION_KEY) === "true";
    } catch (err) {
        return false;
    }

}


function applyReduceMotionSetting(on) {

    if (on) {
        document.documentElement.setAttribute("data-reduce-motion", "true");
    } else {
        document.documentElement.removeAttribute("data-reduce-motion");
    }

    ["#reduceMotionToggle", "#mobileReduceMotionToggle"].forEach(
        function (selector) {

            const btn = $(selector);

            if (btn) {
                btn.setAttribute("aria-checked", String(on));
            }

        }
    );

}


function initReduceMotion() {

    applyReduceMotionSetting(isReduceMotionSetting());

}


function toggleReduceMotion() {

    const next = !isReduceMotionSetting();

    try {
        localStorage.setItem(REDUCE_MOTION_KEY, String(next));
    } catch (err) {
        // Storage blocked: still apply it for this session.
    }

    applyReduceMotionSetting(next);

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
    preserveScroll(function () {
        renderSales();
    });

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


/* Promise-based replacement for window.confirm(), using the app's
   own modal styling (#confirmModal) instead of the native dialog.
   Resolves true on Confirm, false on Cancel, backdrop click, or
   Escape. options: { title, message, confirmLabel, icon }. icon is
   "trash" or "warning" (default "warning") — which badge shows next
   to the title. */
function confirmDialog(options) {

    return new Promise(resolve => {

        const modal = $("#confirmModal");
        const iconEl = $("#confirmModalIcon");
        const titleEl = $("#confirmModalTitle");
        const descEl = $("#confirmModalDesc");
        const cancelBtn = $("#confirmModalCancel");
        const confirmBtn = $("#confirmModalConfirm");

        if (iconEl) {
            iconEl.innerHTML =
                options.icon === "trash"
                    ? ICONS.trash
                    : ICONS.alertTriangle;
        }

        titleEl.textContent = options.title || "Are you sure?";
        descEl.textContent = options.message || "";
        confirmBtn.textContent = options.confirmLabel || "Confirm";

        modal.classList.remove("hidden");
        cancelBtn.focus();

        function settle(result) {

            modal.classList.add("hidden");

            modal.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKeydown);
            cancelBtn.removeEventListener("click", onCancel);
            confirmBtn.removeEventListener("click", onConfirm);

            resolve(result);
        }

        function onCancel() {
            settle(false);
        }

        function onConfirm() {
            settle(true);
        }

        function onBackdrop(event) {
            if (event.target === modal) {
                settle(false);
            }
        }

        function onKeydown(event) {
            if (event.key === "Escape") {
                settle(false);
            }
        }

        cancelBtn.addEventListener("click", onCancel);
        confirmBtn.addEventListener("click", onConfirm);
        modal.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKeydown);

    });
}


/* Add-category card (#categoryModal). Promise-based replacement for
   the native prompt(): resolves with the trimmed name, or null on
   Cancel, backdrop click, or Escape.
   options: { title, submitLabel, initial, isTaken(name) }
   Validation (empty / duplicate) is shown inline, and the preview chip
   mirrors how the category will look on the chip bar. */
const CATEGORY_NAME_MAX = 30;
const CATEGORY_MODAL_OUT_MS = 140;

function categoryDialog(options) {

    options = options || {};

    return new Promise(resolve => {

        const modal = $("#categoryModal");
        const form = $("#categoryForm");
        const input = $("#categoryName");
        const count = $("#categoryCount");
        const hint = $("#categoryHint");
        const preview = $("#categoryPreviewChip");
        const submitBtn = $("#categorySubmit");
        const cancelBtn = $("#categoryCancel");
        const closeBtn = $("#categoryClose");

        const isTaken = options.isTaken || function () { return false; };
        const DEFAULT_HINT = options.hint || "Appears as a chip above your scripts.";

        $("#categoryTitle").textContent = options.title || "New category";
        submitBtn.textContent = options.submitLabel || "Add category";
        input.value = options.initial || "";

        function validate() {

            const value = input.value.trim();
            const taken = value !== "" && isTaken(value);

            count.textContent = input.value.length + "/" + CATEGORY_NAME_MAX;
            count.classList.toggle(
                "near",
                input.value.length >= CATEGORY_NAME_MAX - 5
            );

            preview.textContent = value || "Category name";
            preview.classList.toggle("is-empty", !value);

            hint.textContent = taken
                ? "A category with that name already exists."
                : DEFAULT_HINT;
            hint.classList.toggle("error", taken);
            input.setAttribute("aria-invalid", taken ? "true" : "false");

            const unchanged =
                options.initial !== undefined &&
                value === String(options.initial).trim();

            submitBtn.disabled = !value || taken || unchanged;

            return !submitBtn.disabled;
        }

        function open() {
            clearTimeout(modal._hideTimer);
            modal.classList.remove("fx-closing");
            modal.classList.remove("hidden");
            validate();
            input.focus();
            input.select();
        }

        function close() {

            // Blur before hiding so the page doesn't jump (see closeModal).
            if (document.activeElement && modal.contains(document.activeElement)) {
                document.activeElement.blur();
            }

            clearTimeout(modal._hideTimer);

            if (reduceMotion()) {
                modal.classList.add("hidden");
                return;
            }

            modal.classList.add("fx-closing");

            modal._hideTimer = setTimeout(function () {
                modal.classList.add("hidden");
                modal.classList.remove("fx-closing");
            }, CATEGORY_MODAL_OUT_MS);
        }

        function settle(result) {

            form.removeEventListener("submit", onSubmit);
            input.removeEventListener("input", validate);
            cancelBtn.removeEventListener("click", onCancel);
            closeBtn.removeEventListener("click", onCancel);
            modal.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKeydown);

            close();
            resolve(result);
        }

        function onSubmit(event) {

            event.preventDefault();

            if (validate()) {
                settle(input.value.trim());
                return;
            }

            // Enter on an invalid name: nudge the field.
            input.classList.remove("shake");
            void input.offsetWidth;
            input.classList.add("shake");
            input.focus();
        }

        function onCancel() {
            settle(null);
        }

        function onBackdrop(event) {
            if (event.target === modal) {
                settle(null);
            }
        }

        function onKeydown(event) {
            if (event.key === "Escape") {
                settle(null);
            }
        }

        form.addEventListener("submit", onSubmit);
        input.addEventListener("input", validate);
        cancelBtn.addEventListener("click", onCancel);
        closeBtn.addEventListener("click", onCancel);
        modal.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKeydown);

        open();
    });
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


// Runs `fn`, then re-applies whatever scroll position the page
// scroller (getScroller()) had right before `fn` ran. Needed
// because hiding the modal (display:none on an ancestor of the
// focused field) or rebuilding a list's innerHTML makes some
// browsers blur focus back to <body> and jump the scroller to the
// top. We snapshot/restore across two animation frames so it wins
// even if the browser's own "scroll to top" happens a frame late.
function preserveScroll(fn) {

    const scroller = getScroller();
    const scrollPos = scroller.scrollTop;

    fn();

    const restore = function () {
        scroller.scrollTop = scrollPos;
    };

    restore();
    requestAnimationFrame(function () {
        restore();
        requestAnimationFrame(restore);
    });

}


// Plays the .restore-fade-in animation on elements that Undo just
// put back in the DOM, so they fade/settle in instead of just
// appearing. Call this right after the re-render that restores
// them, passing the actual elements (not selectors) — falsy/missing
// ones (already scrolled out of a filtered list, etc.) are skipped.
function flashRestoreFadeIn(elements) {

    (elements || []).forEach(function (el) {

        if (!el) {
            return;
        }

        // In case something is still mid-animation from a moment
        // ago (rapid repeated undo), restart it cleanly.
        el.classList.remove("restore-fade-in");
        void el.offsetWidth;
        el.classList.add("restore-fade-in");

        el.addEventListener(
            "animationend",
            function handler() {
                el.classList.remove("restore-fade-in");
                el.removeEventListener("animationend", handler);
            }
        );

    });

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


// Sync happens silently in the background; nothing is shown while it
// works. The last state is remembered so signing out can warn when the
// latest changes haven't reached the cloud yet, and a failure shows one
// quiet toast.
let syncState = "synced";

function setSyncStatus(state) {

    const wasOffline = syncState === "offline";

    syncState = state;

    // One toast per failure streak: repeated failures stay quiet until
    // a sync succeeds again, so a bad connection doesn't spam the person.
    if (state === "offline" && !wasOffline && cloudDocRef) {

        toast(
            "Couldn't sync to the cloud. Your changes are saved on this device.",
            "error",
            { duration: 4500 }
        );
    }
}


function renderAll() {
    if (autoCloseStaleShifts()) {
        saveData();
    }
    updateHistory();
    renderSales();
    renderChips("scripts");
    renderContent("models");
    renderContent("scripts");
}


// Everything except `sales`, for the general push below. Sales get
// their own additive channel (see pushSaleAdded / pushSaleRemoved)
// so two devices adding sales at once can't overwrite each other —
// this field is deliberately left out here so a merge write never
// clobbers it with a possibly-stale local copy.
function dataWithoutSales() {

    const { sales, ...rest } = data;

    return rest;

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

        pushInFlight = cloudDocRef.set(dataWithoutSales(), { merge: true })
            .then(function () {
                // The write only ever touched non-sales fields, and
                // those already matched local before it went out, so
                // the full local snapshot is still an accurate record
                // of what the cloud now holds.
                lastPushedJSON = JSON.stringify(data);
                setSyncStatus("synced");
            })
            .catch(function (err) {
                console.error("Cloud sync failed:", err);
                setSyncStatus("offline");
            });

    }, 500);

}


// Reserved for explicit, user-initiated full replacements (import,
// restoring a backup) where sales SHOULD be overwritten too — unlike
// the routine push above, which deliberately leaves sales out.
function pushFullDataToCloud() {

    if (!cloudDocRef) {
        return;
    }

    setSyncStatus("syncing");

    clearTimeout(pushTimer);
    pushPending = false;

    pushInFlight = cloudDocRef.set(data)
        .then(function () {
            lastPushedJSON = JSON.stringify(data);
            setSyncStatus("synced");
        })
        .catch(function (err) {
            console.error("Cloud sync failed:", err);
            setSyncStatus("offline");
        });

}


// Send any edit that's still waiting out the 500ms debounce right now,
// and resolve once the latest write has settled. Used before a reload
// so a change made just before refreshing isn't lost.
function flushCloudPush() {

    if (cloudDocRef && pushPending) {

        clearTimeout(pushTimer);
        pushPending = false;

        pushInFlight = cloudDocRef.set(dataWithoutSales(), { merge: true })
            .then(function () {
                lastPushedJSON = JSON.stringify(data);
                setSyncStatus("synced");
            })
            .catch(function (err) {
                console.error("Cloud sync failed:", err);
                setSyncStatus("offline");
            });

    }

    return pushInFlight || Promise.resolve();

}


// Sales get pushed as targeted array operations rather than folded
// into the general document push above. That's what makes them safe
// to add from two devices at once: arrayUnion appends server-side
// against whatever is already there, instead of a whole-document
// write silently overwriting a sale the other device just added.
function pushSaleAdded(dateKey, sale) {

    if (!cloudDocRef) {
        return;
    }

    setSyncStatus("syncing");

    cloudDocRef.set(
        { sales: { [dateKey]: firebase.firestore.FieldValue.arrayUnion(sale) } },
        { merge: true }
    )
        .then(function () {
            lastPushedJSON = JSON.stringify(data);
            setSyncStatus("synced");
        })
        .catch(function (err) {
            console.error("Cloud sync failed:", err);
            setSyncStatus("offline");
        });

}


// Mirrors pushSaleAdded: arrayRemove takes an exact match of the sale
// object being removed (every sale carries its own `time`, so this
// can't accidentally remove a different sale with the same amount).
function pushSaleRemoved(dateKey, sale) {

    if (!cloudDocRef) {
        return;
    }

    setSyncStatus("syncing");

    cloudDocRef.set(
        { sales: { [dateKey]: firebase.firestore.FieldValue.arrayRemove(sale) } },
        { merge: true }
    )
        .then(function () {
            lastPushedJSON = JSON.stringify(data);
            setSyncStatus("synced");
        })
        .catch(function (err) {
            console.error("Cloud sync failed:", err);
            setSyncStatus("offline");
        });

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

            preserveScroll(renderAll);

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

    preserveScroll(renderAll);

}


function initAuthGate() {

    const authGate = $("#authGate");
    const authError = $("#authError");
    const googleSignInBtn = $("#googleSignInBtn");
    const signOutBtn = $("#signOutBtn");
    const accountEmail = $("#accountEmail");
    const mobileSignOutBtn = $("#mobileSignOutBtn");
    const mobileAccountEmail = $("#mobileAccountEmail");

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

    // Signing out wipes this device's cache, so ask first.
    const signOutModal = $("#signOutModal");
    const signOutWarning = $("#signOutWarning");
    const cancelSignOut = $("#cancelSignOut");
    const confirmSignOut = $("#confirmSignOut");

    function openSignOutConfirm() {

        // Warn if the last sync hadn't finished (or we're offline):
        // those changes only exist on this device.
        signOutWarning.classList.toggle(
            "hidden",
            !(syncState === "syncing" || syncState === "offline")
        );

        signOutModal.classList.remove("hidden");

        // Focus the safe choice, not the destructive one.
        cancelSignOut.focus();

    }

    function closeSignOutConfirm() {

        signOutModal.classList.add("hidden");

        signOutBtn.focus();

    }

    signOutBtn.addEventListener("click", openSignOutConfirm);
    mobileSignOutBtn.addEventListener("click", function () {

        // Close the popover it lives in before showing the modal.
        const group = $("#mobileSettingsGroup");
        if (group) group.classList.remove("open");

        openSignOutConfirm();

    });

    cancelSignOut.addEventListener("click", closeSignOutConfirm);

    signOutModal.addEventListener("click", function (event) {

        if (event.target === signOutModal) {
            closeSignOutConfirm();
        }

    });

    document.addEventListener("keydown", function (event) {

        if (
            event.key === "Escape" &&
            !signOutModal.classList.contains("hidden")
        ) {
            closeSignOutConfirm();
        }

    });

    confirmSignOut.addEventListener("click", function () {

        signOutModal.classList.add("hidden");

        auth.signOut().catch(function () {
            toast("Couldn't sign out. Please try again.", "error");
        });

    });

    auth.onAuthStateChanged(function (user) {

        // Sign-in state is known: let the splash screen lift.
        if (window.hideSplash) window.hideSplash(!!user);

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

            signOutBtn.classList.remove("hidden");
            accountEmail.textContent = user.email || "Signed in";

            mobileSignOutBtn.classList.remove("hidden");
            mobileAccountEmail.textContent = user.email || "Signed in";

            startCloudSync(user.uid);

        } else {

            stopCloudSync();
            resetLocalData();
            localStorage.removeItem(LAST_UID_KEY);

            authGate.classList.remove("hidden");
            signOutBtn.classList.add("hidden");
            mobileSignOutBtn.classList.add("hidden");

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

    const num = Number(amount);

    // Invalid/missing amounts (corrupted data, a stray undefined)
    // show as $0.00 instead of the confusing "$NaN".
    if (!Number.isFinite(num)) {
        return "$0.00";
    }

    const formatted =
        Math.abs(num).toLocaleString(
            undefined,
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        );

    // Sign goes in front of the "$" ("-$12.30"), not after it
    // ("$-12.30" — what plain string concatenation used to produce).
    return (num < 0 ? "-$" : "$") + formatted;
}


function moneyShort(amount) {

    const num = Number(amount);

    if (!Number.isFinite(num)) {
        return "$0";
    }

    // Whole-dollar, no-cents version for tight spaces like chart
    // bar labels, where "$120" reads faster than "$120.00".
    const rounded = Math.round(Math.abs(num));

    // A small negative that rounds to 0 reads as "$0", not "-$0".
    const sign = num < 0 && rounded !== 0 ? "-$" : "$";

    return sign + rounded.toLocaleString();
}


function getTodaySales() {

    const key = getDateKey();

    return data.sales[key] || [];
}


/* -----------------------------------------------------
   SAVED SHIFTS
   "Copy for logout" in the Shift Report window can also save the
   shift: those sales are marked done, leave Today's sales, and show
   up in Sales History straight away (with the shift time).

   Sales are never edited or moved. Each saved shift is just a
   record of which sales (by their unique `time`) it settled, so the
   normal add / delete / sync of sales works exactly as before.
   ----------------------------------------------------- */

function getClosedRecords(dateKey, modelId) {

    const byModel = (data.closedShifts || {})[dateKey];

    return (byModel && byModel[modelId]) || [];
}


function isSaleClosed(dateKey, sale) {

    return getClosedRecords(dateKey, sale.modelId)
        .some(record => (record.times || []).includes(sale.time));
}


function hasClosedShift(dateKey) {

    const byModel = (data.closedShifts || {})[dateKey];

    return !!byModel &&
        Object.values(byModel).some(records => records.length > 0);
}


function getRecordedShift(dateKey, modelId) {

    const records = getClosedRecords(dateKey, modelId);

    return records.length
        ? records[records.length - 1].shift
        : undefined;
}


// e.g. "4:00PM-12:00AM cover" — every saved shift for that day, once each.
function getShiftLabel(dateKey, modelId) {

    const records = getClosedRecords(dateKey, modelId);

    return [
        ...new Set(
            records.map(record => getShiftTimeText(record.shift))
        )
    ].join(", ");
}


// A day that ends without an explicit "Copy for logout" close (you
// just stop, or the app is closed) shouldn't leave sales stranded —
// once that day is no longer today, whatever wasn't already saved to
// a shift gets swept into history automatically, tagged with
// whatever shift is currently set in Shift Report. This runs the
// same way a manual shift close does: it never touches or moves the
// sales themselves, it just records which ones that "shift" covers.
function autoCloseStaleShifts() {

    const today = getDateKey();

    let changed = false;

    Object.keys(data.sales).forEach(dateKey => {

        if (dateKey >= today) {
            return;
        }

        const salesByModel = {};

        (data.sales[dateKey] || []).forEach(sale => {

            if (!sale.modelId) {
                return;
            }

            if (!salesByModel[sale.modelId]) {
                salesByModel[sale.modelId] = [];
            }

            salesByModel[sale.modelId].push(sale);

        });

        Object.keys(salesByModel).forEach(modelId => {

            const unclosed = salesByModel[modelId]
                .filter(sale => !isSaleClosed(dateKey, sale));

            if (!unclosed.length) {
                return;
            }

            if (!data.closedShifts[dateKey]) {
                data.closedShifts[dateKey] = {};
            }

            if (!data.closedShifts[dateKey][modelId]) {
                data.closedShifts[dateKey][modelId] = [];
            }

            data.closedShifts[dateKey][modelId].push({
                shift: {
                    start: data.logoutShift.start,
                    end: data.logoutShift.end,
                    cover: data.logoutShift.cover
                },
                times: unclosed.map(sale => sale.time),
                at: Date.now(),
                auto: true
            });

            changed = true;

        });

    });

    return changed;
}


function getTotal(sales) {

    return sales.reduce(
        (total, sale) => {
            // A single corrupted/non-numeric sale.amount shouldn't
            // turn the whole total into NaN — skip it instead.
            const amount = Number(sale.amount);
            return total + (Number.isFinite(amount) ? amount : 0);
        },
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

    // Rows that aren't "::open" come from a saved shift, which is
    // what History lists for today.
    const todayHasSavedSales =
        combined.some(
            item =>
                item.date === today &&
                !item.rowKey.endsWith("::open")
        );

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

        // Days with sales drill into the history modal on click.
        // Today only counts once part of it has been saved (a saved
        // shift shows up in History right away); until then today's
        // sales are still "live" and there's no row to open.
        const clickable =
            currentTrendRange === "day" &&
            r.date &&
            r.count > 0 &&
            (r.date !== today || todayHasSavedSales);

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
        // for the day's rows and expand them, so the click feels
        // immediate. A day worked in more than one shift has more
        // than one row for the same calendar date — expand all of
        // them together rather than guessing which one was meant.
        requestAnimationFrame(() => {
            expandAllHistoryRowsForDate(dateKey);
        });

    }
);

// Daily / Monthly: the summary, bars and extra block fade out, swap
// while invisible, then fade back in (`.trend-swap-out` in style.css).
const TREND_SWAP_OUT_MS = 140;
let trendSwapTimer = null;
let trendSwapPending = false;

function fadeTrendRange(range) {

    if (reduceMotion()) {
        preserveScroll(function () {
            renderTrends(range);
        });
        return;
    }

    const els = ["#trendSummary", "#trendBars", "#trendExtra"]
        .map(selector => $(selector))
        .filter(Boolean);

    // Clicking Daily/Monthly quickly just restarts the wait, so the
    // content swaps once, to the range you ended on.
    clearTimeout(trendSwapTimer);
    trendSwapPending = true;

    els.forEach(el => el.classList.add("trend-swap-out"));

    trendSwapTimer = setTimeout(function () {

        trendSwapPending = false;

        preserveScroll(function () {
            renderTrends(range);
        });

        void document.body.offsetWidth;   // commit the swap at opacity 0

        els.forEach(el => el.classList.remove("trend-swap-out"));

    }, TREND_SWAP_OUT_MS);
}

$$(".trend-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {

        // Already on this range: nothing to switch.
        if (!trendSwapPending && btn.dataset.range === currentTrendRange) {
            return;
        }

        $$(".trend-toggle-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        fadeTrendRange(btn.dataset.range);
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

    hex = String(hex).replace("#", "");

    if (hex.length === 3) {
        hex = hex.split("").map(c => c + c).join("");
    }

    // A malformed value (wrong length, non-hex characters — e.g. from
    // a corrupted color) used to silently parse to black via NaN
    // bitwise coercion. Fall back to the same neutral gray
    // parseColorToRgb() already uses for unrecognized colors.
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
        return { r: 200, g: 200, b: 200 };
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

    preserveScroll(function () {
        renderModelPickerList();
        renderSales(); // also refreshes the breakdown, badge, and indicator
    });

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


// How long the ".deselecting" revert animation runs for — must match
// the longest animation-duration used by ".deselecting" in style.css.
const DESELECT_ANIM_MS = 350;

// Same for ".selecting" (the pop-in) — matches model-select-pop-in.
const SELECT_ANIM_MS = 400;

function selectModel(modelId) {

    const nextId = modelId || null;
    const previousId = currentModelFilter;

    // Picking the model that's already selected (e.g. from the target
    // picker) changes nothing, so don't run the fade / pop animations.
    if (nextId === previousId) {
        return;
    }

    // Losing selection (deselected outright, or swapped for a
    // different model): give that row a one-shot revert animation
    // instead of just snapping back to rest on the next render.
    if (previousId !== null && previousId !== nextId) {

        deselectingModelId = previousId;

        clearTimeout(deselectingModelTimer);
        deselectingModelTimer = setTimeout(
            function () {

                deselectingModelId = null;

                // The Sales page is display:none on other tabs, and
                // CSS animations restart when an element is shown
                // again — so a leftover class would replay the revert
                // when you come back. Remove it once it has played.
                document
                    .querySelectorAll(".target-breakdown-row.deselecting")
                    .forEach(el => el.classList.remove("deselecting"));

            },
            DESELECT_ANIM_MS
        );

    }

    // Gaining selection: only this row plays the pop-in.
    if (nextId !== null) {

        selectingModelId = nextId;

        clearTimeout(selectingModelTimer);
        selectingModelTimer = setTimeout(
            function () {

                selectingModelId = null;

                document
                    .querySelectorAll(".target-breakdown-row.selecting")
                    .forEach(el => el.classList.remove("selecting"));

            },
            SELECT_ANIM_MS
        );

    } else {

        selectingModelId = null;
        clearTimeout(selectingModelTimer);

    }

    currentModelFilter = nextId;

    // The model rows react instantly (their own pop animation), so
    // update them right away rather than waiting for the fade below.
    preserveScroll(renderTargetBreakdown);

    // Everything else that depends on the selected model (top bar,
    // Overview, the Add a sale input, Today's sales) fades out, swaps
    // its content while invisible, then fades back in.
    fadeModelRegions(function () {
        renderSales({ skipBreakdown: true });
    });
}


// How long the fade-out lasts before the content is swapped. Slightly
// longer than the fade-out `transition-duration` on `#sales.model-fading`
// in style.css, so the regions are fully invisible when they change.
const MODEL_FADE_OUT_MS = 170;
let modelFadeTimer = null;

// Whether the person has asked their OS/browser for less motion.
function reduceMotion() {
    return isReduceMotionSetting() || !!(
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}


// Fades `el` out, runs `updateFn` (which swaps its content) while it's
// invisible, then fades it back in. Rapid calls just restart the wait,
// so only the last update runs. Used for category switches; the CSS is
// `.fx-swap` / `.fx-out` in style.css.
const FX_SWAP_OUT_MS = 140;

function fadeSwap(el, updateFn) {

    if (!el || reduceMotion()) {
        updateFn();
        return;
    }

    clearTimeout(el._fxTimer);

    // The transition needs to exist before the first fade-out starts.
    el.classList.add("fx-swap");
    void el.offsetWidth;
    el.classList.add("fx-out");

    el._fxTimer = setTimeout(function () {

        updateFn();

        void el.offsetWidth;   // commit the swapped content at opacity 0

        el.classList.remove("fx-out");

    }, FX_SWAP_OUT_MS);
}


// Tab switching: the current page fades out, then the next one is
// shown (and fades in via the `.page.active` animation in style.css).
const PAGE_FADE_OUT_MS = 130;
let pageSwitchTimer = null;

function showPage(targetId) {

    const outgoing = $(".page.active");
    const incoming = $("#" + targetId);

    if (!incoming) {
        return;
    }

    // Remember where the user was on the tab they're leaving, so
    // coming back restores it instead of dumping them at the top.
    if (outgoing) {
        pageScrollPositions[outgoing.id] = getScroller().scrollTop;
    }

    clearTimeout(pageSwitchTimer);

    // Clicked the tab you're already on (or came straight back to it
    // mid-fade): just make sure it's fully visible.
    if (outgoing === incoming) {
        outgoing.classList.remove("leaving");
        return;
    }

    function finish() {

        $$(".page").forEach(
            page => page.classList.remove("active", "leaving")
        );

        incoming.classList.add("active");

        // Layout for the newly-shown page isn't settled until the
        // next frame, so wait for it before restoring scroll.
        requestAnimationFrame(function () {
            getScroller().scrollTop =
                pageScrollPositions[targetId] || 0;
        });
    }

    if (!outgoing || reduceMotion()) {
        finish();
        return;
    }

    outgoing.classList.add("leaving");

    pageSwitchTimer = setTimeout(finish, PAGE_FADE_OUT_MS);
}


function fadeModelRegions(renderFn) {

    const page = $("#sales");

    if (!page || reduceMotion()) {
        preserveScroll(renderFn);
        return;
    }

    // Clicking quickly through several models just restarts the wait,
    // so the content only swaps once, to the model you ended on.
    clearTimeout(modelFadeTimer);

    // Lets the CSS also fade out any half-typed sale amount when the
    // selection is being cleared (that's when the input empties).
    page.classList.toggle("model-clearing", currentModelFilter === null);
    page.classList.add("model-fading");

    modelFadeTimer = setTimeout(function () {

        preserveScroll(renderFn);

        // Commit the swapped-in content at opacity 0 first, so removing
        // the class below has a starting point to fade in from.
        void page.offsetWidth;

        page.classList.remove("model-fading");

    }, MODEL_FADE_OUT_MS);
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

        preserveScroll(renderModelPickerList);

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

    const dateKey = getDateKey();

    const sales = getTodaySales();

    return sales
        .map((sale, index) => ({ sale, index }))
        .filter(
            entry =>
                // Sales already saved to history by a shift report
                // are done, so they no longer show as today's sales.
                !isSaleClosed(dateKey, entry.sale) &&
                (
                    currentModelFilter === null ||
                    entry.sale.modelId === currentModelFilter
                )
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

        const allSales = (data.sales[dateKey] || [])
            .filter(sale => sale.modelId === modelId);

        if (!allSales.length) {
            return;
        }

        const target = data.modelTargets[modelId] || 0;
        const records = getClosedRecords(dateKey, modelId);
        const closedTimes = new Set();

        // One row per saved shift — a day worked in two shifts always
        // gets two rows here, never lumped into one combined row.
        records.forEach((record, index) => {

            const times = (record.times || [])
                .filter(time => allSales.some(sale => sale.time === time));

            times.forEach(time => closedTimes.add(time));

            if (!times.length) {
                return;
            }

            const shiftSales = allSales.filter(
                sale => times.includes(sale.time)
            );

            const gross = getTotal(shiftSales);
            const net = gross * NET_RATE;

            rows.push({
                date: dateKey,
                rowKey: `${dateKey}::${record.at || index}`,
                shiftText: getShiftTimeText(record.shift),
                shift: record.shift,
                times,
                gross,
                net,
                count: shiftSales.length,
                target,
                targetPercent:
                    target > 0
                        ? Math.round((net / target) * 100)
                        : null
            });

        });

        // Sales no saved shift covers yet. Today's still count as
        // "live" and stay off the history list; a past day's leftover
        // (from before any auto-close ran) still needs its own row.
        const leftover = allSales.filter(
            sale => !closedTimes.has(sale.time)
        );

        if (!leftover.length || (excludeToday && dateKey === today)) {
            return;
        }

        const gross = getTotal(leftover);
        const net = gross * NET_RATE;

        rows.push({
            date: dateKey,
            rowKey: `${dateKey}::open`,
            shiftText: "",
            shift: null,
            times: leftover.map(sale => sale.time),
            gross,
            net,
            count: leftover.length,
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


// options.skipBreakdown: the model rows were already re-rendered by the
// caller (selectModel does this so they respond instantly), so don't
// rebuild them again — that would replay their pop animation.
function renderSales(options) {

    const skipBreakdown = !!(options && options.skipBreakdown === true);

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
        `Shift Report: ${getShiftTimeText()}`;


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
    if (!skipBreakdown) {
        renderTargetProgress(net);
    }


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
                                onclick="deleteSale(${index}, this)"
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


    // A sale added to the model that's already showing eases in
    // (the list is rebuilt on every render, so we compare counts).
    if (
        lastSalesRender.modelId === currentModelFilter &&
        listed.length === lastSalesRender.count + 1
    ) {

        const rows = $("#salesList").children;

        if (rows.length) {
            rows[rows.length - 1].classList.add("sale-row-new");
        }
    }

    lastSalesRender = {
        modelId: currentModelFilter,
        count: listed.length
    };


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

    const todayKey = getDateKey();

    const todaySales = getTodaySales().filter(
        sale => !isSaleClosed(todayKey, sale)
    );

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
                <div class="target-breakdown-row${model.id === currentModelFilter ? " selected" : ""}${model.id === deselectingModelId ? " deselecting" : ""}${model.id === selectingModelId ? " selecting" : ""}" data-model="${model.id}" draggable="true" role="button" tabindex="0" aria-pressed="${model.id === currentModelFilter}" style="--badge-color:${rowColor};--row-strong:${ink.strong};--row-muted:${ink.muted};--row-radio-border:${ink.radioBorder};--row-radio-bg:${ink.radioBg};--row-track-bg:${ink.trackBg};--row-track-fill:${ink.trackFill}" title="${model.id === currentModelFilter ? `Selected — adding sales for ${escapeHTML(model.title)}` : `Select to add a sale for ${escapeHTML(model.title)}`}">

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

                    <button
                        type="button"
                        class="target-breakdown-info-btn"
                        draggable="false"
                        title="View ${escapeHTML(model.title)}'s info"
                        aria-label="View ${escapeHTML(model.title)}'s info"
                        onclick="event.stopPropagation(); openViewModal('models', '${model.id}')"
                    >
                        ${ICONS.info}
                    </button>

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

        preserveScroll(renderTargetBreakdown);
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
            toast("Enter an amount above $0", "error");
            return;
        }


        setCurrentTarget(value);


        updateHistory();

        saveData();

        preserveScroll(renderSales);

        closeTargetModal();

        toast("Target saved", "success");
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

            toast(
                "The maximum amount for a single sale is $200.",
                "error"
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

        pushSaleAdded(dateKey, sale);

        preserveScroll(renderSales);

        playKaching();

        toast("Sale added!", "success");

        $("#saleAmount").focus();
    }
);


/* =====================================================
   DELETE SALE
   ===================================================== */


function deleteSale(index, btn) {

    const dateKey =
        getDateKey();

    const row =
        btn && btn.closest
            ? btn.closest(".sale-row")
            : null;

    if (row && row.classList.contains("sale-row-out")) {
        return;
    }


    const [removedSale] =
        data.sales[dateKey].splice(
            index,
            1
        );


    updateHistory();

    saveData();

    if (removedSale) {
        pushSaleRemoved(dateKey, removedSale);
        toast(`${money(removedSale.amount)} sale removed`, "delete");
    }

    if (row && !reduceMotion()) {

        // The data is already updated; let the row fade out and
        // collapse, then rebuild the list. The list ignores clicks
        // meanwhile, since the other rows' indexes are stale until then.
        const list = $("#salesList");

        list.classList.add("is-busy");

        row.style.maxHeight = row.offsetHeight + "px";
        void row.offsetHeight;
        row.classList.add("sale-row-out");
        row.style.maxHeight = "0px";

        setTimeout(function () {
            list.classList.remove("is-busy");
            preserveScroll(renderSales);
        }, 220);

        return;
    }

    preserveScroll(renderSales);
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

    // Nobody can see this list right now, and it gets re-rendered on
    // essentially every data change (renderSales() calls this, and
    // renderSales() runs from 15+ places). Rebuilding the full row
    // set — including the model-specific branch, which recomputes
    // computeModelDailyRows() from scratch — while the modal is
    // hidden is pure waste. Skip it; openHistoryModal() renders once
    // on the way in, so the list is current by the time it's shown.
    if ($("#historyModal").classList.contains("hidden")) {
        return;
    }

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

        const modelHistoryFull =
            computeModelDailyRows(currentModelFilter, true)
                .sort((a, b) => b.date.localeCompare(a.date));

        const modelHistory =
            modelHistoryFull.slice(0, historyVisibleCount);

        // Rebuilt every render so a row key always maps back to the
        // right date + saved shift + exact sale times, even across a
        // day with more than one shift. Only the visible slice needs
        // an entry — rows past the page size aren't in the DOM yet.
        historyRowMeta = {};

        modelHistory.forEach(item => {
            historyRowMeta[item.rowKey] = {
                dateKey: item.date,
                shift: item.shift,
                times: item.times
            };
        });

        const modelHistoryRowsHtml =
            modelHistory.map(
                item => `
                    <div class="history-row" data-date="${item.rowKey}" data-calendar-date="${item.date}" role="button" tabindex="0" style="cursor:pointer">

                        <div class="history-row-main">
                            <div class="history-date">
                                ${formatDate(item.date)}
                            </div>
                            ${
                                item.shiftText
                                    ? `<div class="history-shift">${escapeHTML(item.shiftText)}</div>`
                                    : ""
                            }
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

                    <div class="history-model-breakdown hidden" data-breakdown="${item.rowKey}"></div>
                `
            ).join("") +
            (
                modelHistoryFull.length > modelHistory.length
                    ? `<button type="button" class="history-load-more">Load more (${modelHistoryFull.length - modelHistory.length} left)</button>`
                    : ""
            );

        $("#historyList").innerHTML = modelHistoryRowsHtml;

        $("#emptyHistory").textContent =
            "This model's previous days will appear here.";

        $("#emptyHistory").style.display =
            modelHistoryFull.length ? "none" : "block";

        return;
    }

    if (modelNameEl) {
        modelNameEl.textContent = "";
        modelNameEl.classList.add("hidden");
    }

    // The history list always shows the same thing regardless of
    // whether a model is selected on the page — just the dates.
    // Click a date to see each model's net and target status for it.
    const historyFull =
        data.history
            .filter(item => item.date !== today || hasClosedShift(item.date))
            .sort((a, b) => b.date.localeCompare(a.date));

    const history =
        historyFull.slice(0, historyVisibleCount);

    const historyRowsHtml =
        history.map(
            item => `
                <div class="history-row" data-date="${item.date}" data-calendar-date="${item.date}" role="button" tabindex="0" style="cursor:pointer">
                    <div class="history-date">
                        ${formatDate(item.date)}
                    </div>
                </div>

                <div class="history-model-breakdown hidden" data-breakdown="${item.date}"></div>
            `
        ).join("") +
        (
            historyFull.length > history.length
                ? `<button type="button" class="history-load-more">Load more (${historyFull.length - history.length} left)</button>`
                : ""
        );

    $("#historyList").innerHTML = historyRowsHtml;

    $("#emptyHistory").textContent =
        "Your previous days will appear here.";

    $("#emptyHistory").style.display =
        historyFull.length ? "none" : "block";
}


function getModelBreakdownForDate(dateKey) {

    // Today only counts for what a shift report has already saved.
    const sales =
        (data.sales[dateKey] || []).filter(
            sale =>
                dateKey !== getDateKey() ||
                isSaleClosed(dateKey, sale)
        );

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
                shiftText: getShiftLabel(dateKey, modelId),
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
                        ${
                            row.shiftText
                                ? `<small class="history-model-shift">${escapeHTML(row.shiftText)}</small>`
                                : ""
                        }
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


// scope "live": today's sales that haven't been saved by a shift report.
// Otherwise the History view: a past day in full; today only what a
// shift report has already saved.
function getModelSalesForDate(dateKey, modelId, scope) {

    let sales = (data.sales[dateKey] || [])
        .filter(sale => sale.modelId === modelId);

    if (Array.isArray(scope)) {

        // An explicit list of sale times — exactly one saved shift's
        // own sales, so a multi-shift day never mixes them together.
        sales = sales.filter(sale => scope.includes(sale.time));

    } else if (scope === "live") {

        sales = sales.filter(sale => !isSaleClosed(dateKey, sale));

    } else if (dateKey === getDateKey()) {

        sales = sales.filter(sale => isSaleClosed(dateKey, sale));

    }

    return sales
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


function renderModelDayDetail(rowKey, container) {

    // rowKey is a plain date for the "all models" view, or a
    // date::shift key for the model-specific view — resolve it back
    // to the real date and (when there is one) that row's own shift
    // times, so a two-shift day's detail never mixes the two shifts.
    const meta = historyRowMeta[rowKey];

    const dateKey = meta ? meta.dateKey : rowKey;

    const sales =
        getModelSalesForDate(
            dateKey,
            currentModelFilter,
            meta ? meta.times : undefined
        );

    const gross =
        sales.reduce(
            (total, sale) =>
                total + (Number.isFinite(sale.amount) ? sale.amount : 0),
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


function buildLogoutText(dateKey, shift, scope) {

    const activeModel =
        getModelById(currentModelFilter);

    const modelName =
        activeModel ? activeModel.title : "";

    const sales =
        getModelSalesForDate(
            dateKey,
            currentModelFilter,
            scope
        );

    // A day saved from the Shift Report window remembers its shift, so
    // copying it again from History prints that shift, not whatever is
    // saved now.
    const shiftForText =
        shift || getRecordedShift(dateKey, currentModelFilter);

    const gross =
        sales.reduce(
            (total, sale) =>
                total + (Number.isFinite(sale.amount) ? sale.amount : 0),
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
        `${getLogoutTitle()}\n\n` +
        `${modelName} -\n\n` +
        `Shift Time: ${getShiftTimeText(shiftForText)}\n` +
        `Date: ${formatDate(dateKey)}\n` +
        `Subscriptions - $\n` +
        `MM Sales - $\n` +
        `Tips + Messages - ${money(net)} net` +
        tipsBlock +
        outsideShiftBlock
    );
}


// Older / stricter browsers (and non-HTTPS pages) refuse the modern
// clipboard API. This copies through a hidden textarea instead, so the
// text still lands on the clipboard without any pop-up box.
function copyTextLegacy(text) {

    const area = document.createElement("textarea");

    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");

    // 16px stops iOS zooming in; off-screen so nothing flashes.
    area.style.cssText =
        "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;";

    document.body.appendChild(area);

    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);

    let copied = false;

    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }

    area.remove();

    return copied;
}


// Returns true when the text made it to the clipboard. `quiet` skips
// the success toast (the caller shows its own); errors always toast.
async function copyLogoutText(dateKey, shift, scope, quiet) {

    const text = buildLogoutText(dateKey, shift, scope);

    let copied = false;

    try {

        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            copied = true;
        }

    } catch {
        copied = false;
    }

    if (!copied) {
        copied = copyTextLegacy(text);
    }

    if (copied) {

        if (!quiet) {
            toast("Logout text copied!", "success");
        }

    } else {

        toast("Couldn't copy. Please try again.", "error");

    }

    return copied;
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

    hideAllHistoryBreakdowns();

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

    showHistoryBreakdown(breakdown);

    expandedHistoryDate = dateKey;
    updateCopyLogoutButton();

    const row =
        $(`.history-row[data-date="${dateKey}"]`);

    if (row) {
        row.scrollIntoView({ block: "nearest" });
    }
}


// History: the date breakdown fades in when a date is opened and
// fades out when it closes (or another date is opened), instead of
// popping in/out. `.fx-closing` is the fade-out; `.hidden` is only
// applied once it has finished.
const HISTORY_BREAKDOWN_OUT_MS = 140;

function showHistoryBreakdown(el) {

    clearTimeout(el._hideTimer);
    el.classList.remove("fx-closing");
    el.classList.remove("hidden");
}

function hideHistoryBreakdown(el) {

    if (el.classList.contains("hidden")) {
        return;
    }

    clearTimeout(el._hideTimer);

    if (reduceMotion()) {
        el.classList.add("hidden");
        el.classList.remove("fx-closing");
        return;
    }

    el.classList.add("fx-closing");

    el._hideTimer = setTimeout(function () {
        el.classList.add("hidden");
        el.classList.remove("fx-closing");
    }, HISTORY_BREAKDOWN_OUT_MS);
}

function hideAllHistoryBreakdowns() {
    document
        .querySelectorAll(".history-model-breakdown")
        .forEach(hideHistoryBreakdown);
}


// A trend bar represents one calendar date, but that date can have
// several rows in History (one per saved shift). Clicking the bar
// opens every one of that day's shifts at once, rather than guessing
// which single shift the person meant.
function expandAllHistoryRowsForDate(calendarDate) {

    const rows =
        document.querySelectorAll(
            `.history-row[data-calendar-date="${calendarDate}"]`
        );

    if (!rows.length) {
        return;
    }

    hideAllHistoryBreakdowns();

    rows.forEach(row => {

        const rowKey = row.dataset.date;

        const breakdown =
            $(`[data-breakdown="${rowKey}"]`);

        if (!breakdown) {
            return;
        }

        if (currentModelFilter !== null) {

            renderModelDayDetail(
                rowKey,
                breakdown
            );

        } else {

            renderModelBreakdownRow(
                rowKey,
                breakdown
            );

        }

        showHistoryBreakdown(breakdown);

    });

    // A day with more than one shift is genuinely ambiguous — the
    // fixed button can't point at a single row, so it stays hidden
    // until the person narrows it down by clicking one row directly.
    // A day with exactly one shift has no such ambiguity, so show
    // the button for it immediately instead of always hiding it.
    expandedHistoryDate =
        rows.length === 1
            ? rows[0].dataset.date
            : null;

    updateCopyLogoutButton();

    rows[0].scrollIntoView({ block: "nearest" });
}


$("#historyList").addEventListener(
    "click",
    event => {

        const loadMoreBtn =
            event.target.closest(".history-load-more");

        if (loadMoreBtn) {
            historyVisibleCount += HISTORY_PAGE_SIZE;
            preserveScroll(renderHistory);
            return;
        }

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

        // A breakdown that is mid fade-out counts as closed.
        const isHidden =
            breakdown.classList.contains("hidden") ||
            breakdown.classList.contains("fx-closing");

        hideAllHistoryBreakdowns();

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

            showHistoryBreakdown(breakdown);
        }

        expandedHistoryDate = isHidden ? dateKey : null;
        updateCopyLogoutButton();
    }
);


/* =====================================================
   LOGOUT TITLE (Settings)
   Lets each person restyle the first line of the logout text.
   ===================================================== */

function getLogoutTitle() {
    return (data.logoutTitle || "").trim() || DEFAULT_LOGOUT_TITLE;
}


function cleanLogoutTitle(raw) {
    return limitGraphemes(
        String(raw || "").replace(/[\r\n]+/g, " ").trim(),
        LOGOUT_TITLE_MAX
    );
}


function renderLogoutTitlePreview() {

    const title = cleanLogoutTitle($("#logoutTitleInput").value) ||
        DEFAULT_LOGOUT_TITLE;

    $("#logoutTitlePreview").textContent = title;
}


// Emojis offered in the picker, grouped in tabs. Space-separated so
// multi-part emojis stay whole.
const EMOJI_GROUPS = [
    {
        icon: "🌸",
        label: "Flowers & nature",
        emojis: "🌸 🌺 🌹 🌷 🌼 🌻 💐 🪷 🌿 🍀 🌈 ☀️ 🌙 ⭐ 🌟 ✨ 💫 ⚡ 🔥 ❄️ 🌊 🦋 🐝 🐰 🐱 🐻 🦄 🍒 🍓 🍑 🍋 🍉 🍭"
    },
    {
        icon: "💕",
        label: "Hearts",
        emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💖 💗 💓 💞 💕 💘 💝 💟 ❣️ 💋 🫶 🥰 😍 😘"
    },
    {
        icon: "😊",
        label: "Faces",
        emojis: "😊 😄 😁 😆 😂 🤣 😉 😎 🥳 🤩 😇 🙂 😌 😏 😈 🥺 😴 🤗 🤭 🫡 😜 😋 🤑 😤 😭 🥹 🙃 😳 🤔 😮‍💨"
    },
    {
        icon: "🎀",
        label: "Fun",
        emojis: "🎀 🎉 🎊 🎁 🎈 👑 💎 💍 💄 👗 👠 🕶️ 🎧 🎵 🎶 🎤 🎮 🎬 📸 🍾 🥂 🍸 ☕ 🍰 🧁 🍫"
    },
    {
        icon: "💸",
        label: "Money & work",
        emojis: "💸 💰 💵 💳 🤑 📈 🏆 🥇 🎯 ✅ ☑️ 📌 📝 💼 ⏰ ⌛ 🕛 🕓 🔔 📣 🚀 💯 🆒 🔝"
    },
    {
        icon: "✅",
        label: "Symbols",
        emojis: "✨ ⭐ 💫 ⚡ 🔥 💥 ❗ ❓ ➕ ➖ ✔️ ❌ ⚠️ ♾️ 🔞 🔒 🔓 ➡️ ⬇️ ▪️ ◾ 🔸 🔹 🔻 🔺 ⚜️ ☯️ ♡ ✿ ❀ ❁ ★ ☆ ♪"
    }
];

let emojiGroupIndex = 0;

// When a tap outside last closed the popover, so that same tap doesn't
// also close the whole window behind it.
let emojiClosedAt = 0;


function renderEmojiGrid() {

    const group = EMOJI_GROUPS[emojiGroupIndex];

    $$("#emojiTabs .emoji-tab").forEach((tab, i) =>
        tab.classList.toggle("active", i === emojiGroupIndex)
    );

    $("#emojiGrid").innerHTML =
        group.emojis.split(" ").map(
            emoji =>
                `<button type="button" class="emoji-btn" data-emoji="${emoji}" aria-label="${emoji}">${emoji}</button>`
        ).join("");

    $("#emojiGrid").scrollTop = 0;
}


function buildEmojiPicker() {

    $("#emojiTabs").innerHTML =
        EMOJI_GROUPS.map(
            (group, i) =>
                `<button type="button" class="emoji-tab" role="tab" data-group="${i}" title="${group.label}" aria-label="${group.label}">${group.icon}</button>`
        ).join("");

    renderEmojiGrid();
}


// Puts the popover just under the emoji button (right edges lined up),
// or above it when there isn't room below.
function positionEmojiPicker() {

    const picker = $("#emojiPicker");
    const toggle = $("#logoutEmojiToggle").getBoundingClientRect();

    const margin = 8;
    const gap = 6;

    const width = picker.offsetWidth;
    const height = picker.offsetHeight;

    let left = toggle.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    let top = toggle.bottom + gap;

    if (top + height > window.innerHeight - margin) {
        top = toggle.top - gap - height;
    }

    top = Math.max(margin, top);

    picker.style.left = left + "px";
    picker.style.top = top + "px";
}


function setEmojiPickerOpen(open) {

    $("#emojiPicker").classList.toggle("hidden", !open);
    $("#logoutEmojiToggle").setAttribute("aria-expanded", String(open));

    if (open) {
        positionEmojiPicker();
    }
}


function isEmojiPickerOpen() {
    return !$("#emojiPicker").classList.contains("hidden");
}


// The text box's cursor is remembered separately, because some browsers
// reset it when the box loses focus (e.g. after tapping the picker).
let logoutTitleCaret = { start: 0, end: 0 };

function rememberLogoutTitleCaret() {

    const input = $("#logoutTitleInput");

    logoutTitleCaret = {
        start: input.selectionStart ?? input.value.length,
        end: input.selectionEnd ?? input.value.length
    };
}

["input", "keyup", "click", "blur"].forEach(type =>
    $("#logoutTitleInput").addEventListener(type, rememberLogoutTitleCaret)
);


// Drops an emoji in at the cursor (or over the selection), unless that
// would push the title past its length limit.
function insertLogoutEmoji(emoji) {

    const input = $("#logoutTitleInput");

    const { start, end } = logoutTitleCaret;

    const next =
        input.value.slice(0, start) + emoji + input.value.slice(end);

    if (splitGraphemes(next).length > LOGOUT_TITLE_MAX) {
        return;
    }

    input.value = next;

    const caret = start + emoji.length;

    logoutTitleCaret = { start: caret, end: caret };

    input.setSelectionRange(caret, caret);

    renderLogoutTitlePreview();
}


buildEmojiPicker();

$("#logoutEmojiToggle").addEventListener("click", function () {
    setEmojiPickerOpen(!isEmojiPickerOpen());
});

// Tapping anywhere else in the window closes the popover.
document.addEventListener("pointerdown", function (event) {

    if (
        isEmojiPickerOpen() &&
        !event.target.closest("#emojiPicker") &&
        !event.target.closest("#logoutEmojiToggle")
    ) {
        setEmojiPickerOpen(false);
        emojiClosedAt = Date.now();
    }

});

window.addEventListener("resize", function () {

    if (isEmojiPickerOpen()) {
        positionEmojiPicker();
    }

});

$("#logoutTitleModal .modal-card").addEventListener("scroll", function () {

    if (isEmojiPickerOpen()) {
        positionEmojiPicker();
    }

});

// Keep the cursor in the text box while tapping the picker, so an emoji
// lands where the person was typing (and the phone keyboard stays put).
$("#emojiPicker").addEventListener("mousedown", function (event) {
    event.preventDefault();
});

$("#emojiTabs").addEventListener("click", function (event) {

    const tab = event.target.closest(".emoji-tab");

    if (!tab) {
        return;
    }

    emojiGroupIndex = Number(tab.dataset.group);
    renderEmojiGrid();
});

$("#emojiGrid").addEventListener("click", function (event) {

    const btn = event.target.closest(".emoji-btn");

    if (btn) {
        insertLogoutEmoji(btn.dataset.emoji);
    }
});


function openLogoutTitleModal() {

    // Close whichever settings popover the click came from.
    $$(".settings-group.open, .mobile-settings-group.open")
        .forEach(group => group.classList.remove("open"));

    $("#logoutTitleInput").value = data.logoutTitle || "";

    setEmojiPickerOpen(false);

    logoutTitleCaret = {
        start: $("#logoutTitleInput").value.length,
        end: $("#logoutTitleInput").value.length
    };

    renderLogoutTitlePreview();

    $("#logoutTitleModal").classList.remove("hidden");

    $("#logoutTitleInput").focus();
}


function closeLogoutTitleModal() {
    setEmojiPickerOpen(false);
    $("#logoutTitleModal").classList.add("hidden");
}


$("#logoutTitleBtn").addEventListener("click", openLogoutTitleModal);
$("#mobileLogoutTitleBtn").addEventListener("click", openLogoutTitleModal);

$("#closeLogoutTitleModal").addEventListener("click", closeLogoutTitleModal);
$("#cancelLogoutTitle").addEventListener("click", closeLogoutTitleModal);

$("#logoutTitleModal").addEventListener("click", function (event) {

    if (
        event.target.id === "logoutTitleModal" &&
        Date.now() - emojiClosedAt > 400
    ) {
        closeLogoutTitleModal();
    }

});

document.addEventListener("keydown", function (event) {

    if (
        event.key === "Escape" &&
        !$("#logoutTitleModal").classList.contains("hidden")
    ) {

        // First Escape closes the emoji popover, the next the window.
        if (isEmojiPickerOpen()) {
            setEmojiPickerOpen(false);
        } else {
            closeLogoutTitleModal();
        }

    }

});

$("#logoutTitleInput").addEventListener("input", renderLogoutTitlePreview);

$("#resetLogoutTitle").addEventListener("click", function () {

    $("#logoutTitleInput").value = "";

    renderLogoutTitlePreview();

    $("#logoutTitleInput").focus();
});

$("#logoutTitleForm").addEventListener("submit", function (event) {

    event.preventDefault();

    const title = cleanLogoutTitle($("#logoutTitleInput").value);

    // Blank, or typed out the same as the default: stay on the default.
    data.logoutTitle = title === DEFAULT_LOGOUT_TITLE ? "" : title;

    saveData();

    closeLogoutTitleModal();

    toast("Logout title saved", "success");
});


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

    // The logout text is built for the selected model, so copying
    // needs one (and a complete shift to print).
    const hasModel = currentModelFilter !== null;

    $("#copyShiftLogoutBtn").disabled =
        !hasModel || !draft.start || !draft.end;

    $("#shiftCopyNote").classList.toggle("hidden", hasModel);
}


function openShiftModal() {

    $("#shiftStart").value = data.logoutShift.start;
    $("#shiftEnd").value = data.logoutShift.end;

    shiftDraftCover = data.logoutShift.cover;

    preserveScroll(renderShiftModal);

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

        preserveScroll(renderShiftModal);
    }
);


// "Copy for logout" in this window is the end-of-shift button: it copies
// the logout text using the shift shown above (saved or not), then —
// after a confirmation — saves the shift so those sales are cleared from
// Today's sales and go straight into Sales History.

let pendingShiftSave = null;


function openShiftSaveConfirm() {

    const draft = readShiftDraft();

    const model = getModelById(currentModelFilter);

    if (!model || !draft.start || !draft.end) {
        return;
    }

    const dateKey = getDateKey();

    const live = getModelSalesForDate(dateKey, model.id, "live");

    // Nothing left to save: just copy the text.
    if (!live.length) {
        copyLogoutText(dateKey, draft, "live");
        return;
    }

    pendingShiftSave = {
        dateKey: dateKey,
        modelId: model.id,
        shift: draft
    };

    const gross = live.reduce(
        (total, sale) =>
            total + (Number.isFinite(sale.amount) ? sale.amount : 0),
        0
    );

    $("#shiftSaveModel").textContent = model.title;

    $("#shiftSaveSummary").textContent =
        `Date: ${formatDate(dateKey)}\n` +
        `Shift Time: ${getShiftTimeText(draft)}\n` +
        `${live.length} sale${live.length === 1 ? "" : "s"} · ` +
        `${money(gross * NET_RATE)} net`;

    $("#confirmShiftSave").disabled = false;

    $("#shiftSaveModal").classList.remove("hidden");

    // Focus the safe choice, not the one that clears sales.
    $("#cancelShiftSave").focus();
}


function closeShiftSaveConfirm() {

    pendingShiftSave = null;

    $("#shiftSaveModal").classList.add("hidden");
}


function saveShiftToHistory(pending, times) {

    if (!data.closedShifts[pending.dateKey]) {
        data.closedShifts[pending.dateKey] = {};
    }

    const byModel = data.closedShifts[pending.dateKey];

    if (!byModel[pending.modelId]) {
        byModel[pending.modelId] = [];
    }

    byModel[pending.modelId].push({
        shift: {
            start: pending.shift.start,
            end: pending.shift.end,
            cover: pending.shift.cover
        },
        times: times,
        at: Date.now()
    });

    updateHistory();

    saveData();

    preserveScroll(renderSales);
}


async function confirmShiftSave() {

    const pending = pendingShiftSave;

    if (!pending || pending.modelId !== currentModelFilter) {
        closeShiftSaveConfirm();
        return;
    }

    $("#confirmShiftSave").disabled = true;

    // Work out exactly which sales the copied text covers, in the same
    // breath as building it, so what's saved matches what's copied.
    const times =
        getModelSalesForDate(pending.dateKey, pending.modelId, "live")
            .map(sale => sale.time);

    const copied = await copyLogoutText(
        pending.dateKey,
        pending.shift,
        "live",
        true
    );

    if (!copied) {
        // Nothing was copied, so nothing is saved or cleared.
        $("#confirmShiftSave").disabled = false;
        return;
    }

    if (times.length) {
        saveShiftToHistory(pending, times);
    }

    closeShiftSaveConfirm();

    closeShiftModal();

    toast(
        times.length
            ? `Logout text copied — ${times.length} sale${times.length === 1 ? "" : "s"} saved to history`
            : "Logout text copied!",
        "success"
    );
}


$("#copyShiftLogoutBtn").addEventListener(
    "click",
    openShiftSaveConfirm
);


$("#confirmShiftSave").addEventListener(
    "click",
    confirmShiftSave
);


$("#cancelShiftSave").addEventListener(
    "click",
    closeShiftSaveConfirm
);


$("#shiftSaveModal").addEventListener(
    "click",
    function (event) {

        if (event.target.id === "shiftSaveModal") {
            closeShiftSaveConfirm();
        }

    }
);


document.addEventListener(
    "keydown",
    function (event) {

        if (
            event.key === "Escape" &&
            !$("#shiftSaveModal").classList.contains("hidden")
        ) {
            closeShiftSaveConfirm();
        }

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

        preserveScroll(renderSales);

        closeShiftModal();

        toast("Shift saved", "success");
    }
);


/* =====================================================
   HISTORY MODAL
   ===================================================== */


function openHistoryModal() {

    // Back to the first page every time the modal is opened fresh —
    // otherwise a page size left over from a previous visit (or
    // bumped way up by repeated "Load more" clicks) would carry over
    // silently.
    historyVisibleCount = HISTORY_PAGE_SIZE;

    $("#historyModal").classList.remove(
        "hidden"
    );

    // renderHistory() now bails out while the modal is hidden (see
    // its own comment), so this is the one place that has to force
    // a render on the way in — otherwise the list stays whatever it
    // was rendered as before the guard was added, or empty on first
    // load.
    preserveScroll(renderHistory);
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

        const meta = historyRowMeta[expandedHistoryDate];

        if (meta) {
            // Copy exactly the shift that's expanded, not the whole day.
            copyLogoutText(meta.dateKey, meta.shift, meta.times);
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
    async function () {

        const activeModel =
            currentModelFilter === null
                ? null
                : getModelById(currentModelFilter);

        const confirmed = await confirmDialog({
            title: activeModel
                ? `Clear ${activeModel.title}'s history?`
                : "Clear all history?",
            message: "Saved days will be removed from Sales History. Today's sales are kept, and you can undo this right after.",
            confirmLabel: "Clear history"
        });

        if (!confirmed) {
            return;
        }

        // Snapshots for Undo — cheap since history/sales are plain
        // JSON-able data, and this only runs on a user click.
        const historySnapshot = JSON.parse(JSON.stringify(data.history));
        const salesSnapshot = JSON.parse(JSON.stringify(data.sales));

        if (currentModelFilter === null) {

            // A shift saved today stays listed until the day is over.
            const todayKey = getDateKey();

            data.history = data.history.filter(
                item =>
                    item.date === todayKey &&
                    hasClosedShift(todayKey)
            );

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

        preserveScroll(renderSales);

        closeHistoryModal();

        toast(
            activeModel
                ? `${activeModel.title}'s history cleared`
                : "History cleared",
            "delete",
            {
                actionLabel: "Undo",
                onAction: function () {

                    data.history = historySnapshot;
                    data.sales = salesSnapshot;

                    saveData();

                    preserveScroll(renderSales);

                    toast("History restored", "success");
                }
            }
        );
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

                showPage(this.dataset.page);

            }
        );

    }
);


/* =====================================================
   FAQ
   ===================================================== */


// The FAQ button lives outside the main nav rail (in the Settings
// popover, as an icon on the mobile header, and in the footer), so it gets
// its own small switcher instead of joining the .nav-btn group —
// but it still plays by the same rules: no nav item stays "active"
// while FAQ is open, and leaving FAQ via any .nav-btn already works
// for free, since that handler hides every .page (FAQ included).
// About works the same way: it lives in the footer, not in the nav
// rail, so it joins this switcher.
const infoPageButtons = {
    faq: "#faqBtn, #mobileFaqBtn, #footerFaqBtn",
    about: "#footerAboutBtn",
    terms: "#footerTermsBtn",
    privacy: "#footerPrivacyBtn"
};

Object.keys(infoPageButtons).forEach(pageId => {

$$(infoPageButtons[pageId]).forEach(
    button => {

        button.addEventListener(
            "click",
            function () {

                $$(".nav-btn").forEach(
                    btn => btn.classList.remove("active")
                );

                showPage(pageId);

                // Close the settings popover(s) if they happened to be open.
                const settingsGroup =
                    $("#settingsBtn") && $("#settingsBtn").closest(".settings-group");

                if (settingsGroup) {
                    settingsGroup.classList.remove("open");
                }

                const mobileSettingsGroup = $("#mobileSettingsGroup");

                if (mobileSettingsGroup) {
                    mobileSettingsGroup.classList.remove("open");
                }

            }
        );

    }
);

});


// Footer "Contact": phones keep the plain mailto: link (it opens the
// Gmail / Mail app). On desktop (mouse + hover) mailto: often does
// nothing when no mail app is set up, so open Gmail's compose window
// in a new tab instead.
const footerContactLink = $("#footerContactLink");

if (footerContactLink) {

    footerContactLink.addEventListener(
        "click",
        function (event) {

            const isDesktop =
                window.matchMedia("(hover: hover) and (pointer: fine)").matches;

            if (!isDesktop) {
                return;
            }

            event.preventDefault();

            const to =
                footerContactLink.getAttribute("href").replace(/^mailto:/, "");

            window.open(
                "https://mail.google.com/mail/?view=cm&fs=1&to=" +
                    encodeURIComponent(to),
                "_blank",
                "noopener"
            );

        }
    );

}


// Accordion: click a question to reveal its answer. Several can be
// open at once — nothing forces the others shut.
$$("#faq .faq-q").forEach(
    q => {

        q.addEventListener(
            "click",
            function () {

                const item = this.closest(".faq-item");
                const isOpen = item.classList.toggle("open");

                this.setAttribute(
                    "aria-expanded",
                    isOpen ? "true" : "false"
                );

            }
        );

    }
);


// Quick-nav chips: jump to a group and mark the chip closest to
// what's actually on screen as active while scrolling.
(function () {

    const chips = $$("#faqChips .chip");
    const groups = $$("#faq .faq-group");

    if (!chips.length || !groups.length) {
        return;
    }

    chips.forEach(
        chip => {

            chip.addEventListener(
                "click",
                function () {

                    const target = $("#" + this.dataset.faqJump);

                    if (!target) {
                        return;
                    }

                    const floatBar = $("#faqFloatBar");
                    const offset =
                        (floatBar ? floatBar.offsetHeight : 0) + 24;

                    const top =
                        target.getBoundingClientRect().top +
                        getScroller().scrollTop -
                        offset;

                    getScroller().scrollTo(
                        { top: top, behavior: "smooth" }
                    );

                }
            );

        }
    );

    if (window.IntersectionObserver) {

        const observer = new IntersectionObserver(
            entries => {

                entries.forEach(
                    entry => {

                        if (!entry.isIntersecting) {
                            return;
                        }

                        chips.forEach(
                            chip =>
                                chip.classList.toggle(
                                    "active",
                                    chip.dataset.faqJump === entry.target.id
                                )
                        );

                    }
                );

            },
            { rootMargin: "-30% 0px -60% 0px" }
        );

        groups.forEach(group => observer.observe(group));

    }

})();


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


async function addCategory(type) {

    // Already open (double click on "+ Add").
    if (!$("#categoryModal").classList.contains("hidden")) {
        return;
    }

    // Closing the card can make some browsers snap the page to the
    // top, so remember where we were and put it back afterwards.
    const scroller = getScroller();
    const scrollPos = scroller.scrollTop;

    function restoreScroll() {
        scroller.scrollTop = scrollPos;
        requestAnimationFrame(function () {
            scroller.scrollTop = scrollPos;
            requestAnimationFrame(function () {
                scroller.scrollTop = scrollPos;
            });
        });
    }


    const name = await categoryDialog({
        title: "New category",
        submitLabel: "Add category",
        isTaken: value =>
            getCategories(type).some(
                category =>
                    category.toLowerCase() === value.toLowerCase()
            )
    });


    if (name === null) {
        restoreScroll();
        return;
    }


    data.customCategories[type].push(
        name
    );


    saveData();

    renderChips(type);

    restoreScroll();

    toast(`"${name}" category added`, "success");
}


async function renameCategory(type, oldName) {

    const list =
        data.customCategories[type] || [];


    const index =
        list.indexOf(oldName);


    // Only user-added categories can be renamed.
    if (index === -1) {
        return;
    }


    // Already open (e.g. a second long-press).
    if (!$("#categoryModal").classList.contains("hidden")) {
        return;
    }

    // Closing the card can make some browsers snap the page to the
    // top, so remember where we were and put it back afterwards.
    const scroller = getScroller();
    const scrollPos = scroller.scrollTop;

    function restoreScroll() {
        scroller.scrollTop = scrollPos;
        requestAnimationFrame(function () {
            scroller.scrollTop = scrollPos;
            requestAnimationFrame(function () {
                scroller.scrollTop = scrollPos;
            });
        });
    }


    const trimmed = await categoryDialog({
        title: "Rename category",
        submitLabel: "Save",
        initial: oldName,
        hint: "Scripts in this category will follow the new name.",
        isTaken: value =>
            getCategories(type).some(
                category =>
                    category !== oldName &&
                    category.toLowerCase() === value.toLowerCase()
            )
    });


    if (trimmed === null) {
        restoreScroll();
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

    restoreScroll();

    toast(`Renamed to "${trimmed}"`, "success");
}


async function removeCategory(type, category) {

    const confirmed = await confirmDialog({
        title: `Remove "${category}"?`,
        message: "Scripts already using it keep the category, but it will no longer appear as a filter. You can undo this right after.",
        confirmLabel: "Remove"
    });

    if (!confirmed) {
        return;
    }

    const originalIndex =
        data.customCategories[type].indexOf(category);

    const previousSelection = currentCategory[type];

    data.customCategories[type] =
        data.customCategories[type].filter(
            existing =>
                existing !== category
        );


    if (currentCategory[type] === category) {
        currentCategory[type] = "All";
    }


    saveData();

    preserveScroll(function () {
        renderChips(type);
        renderContent(type);
    });

    toast(`"${category}" category removed`, "delete", {
        actionLabel: "Undo",
        onAction: function () {

            const restoreAt =
                Math.min(
                    originalIndex,
                    data.customCategories[type].length
                );

            data.customCategories[type].splice(
                restoreAt < 0 ? data.customCategories[type].length : restoreAt,
                0,
                category
            );

            currentCategory[type] = previousSelection;

            saveData();

            preserveScroll(function () {

                renderChips(type);

                renderContent(type);

            });

            flashRestoreFadeIn([
                Array.from($("#" + type + "Chips").children)
                    .find(chip => chip.dataset.category === category)
            ]);

            toast(`"${category}" category restored`, "success");
        }
    });
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

    const inSelectMode =
        selectMode[type];

    container.classList.toggle(
        "select-mode",
        inSelectMode
    );


    container.innerHTML =
        filtered.map(
            item => `

                <article
                    class="card content-card${selectedIds[type].has(item.id) ? " selected" : ""}"
                    draggable="${inSelectMode ? "false" : "true"}"
                    tabindex="0"
                    data-id="${item.id}"
                    onclick="handleCardClick('${type}', '${item.id}', event)"
                >

                    <div class="card-select-circle" aria-hidden="true"></div>

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

    updateSelectToolbar();

}


/* =====================================================
   MULTI-SELECT — long-press a card to select, like iOS
   Photos, then drag the selection onto the trash button
   (or tap it) to delete everything at once.
   ===================================================== */


function handleCardClick(type, id, event) {

    if (selectMode[type]) {
        event.stopPropagation();
        toggleCardSelection(type, id);
        return;
    }

    openViewModal(type, id);
}


function enterSelectMode(type, id) {

    selectMode[type] = true;
    selectedIds[type] = new Set([id]);

    if (navigator.vibrate) {
        navigator.vibrate(15);
    }

    // Flip the classes on the cards that are already on screen
    // instead of rebuilding the grid. Rebuilding it (renderContent)
    // threw the page back to the top AND meant the select circles /
    // hidden buttons just snapped in with nothing to transition
    // from. See the `.select-mode` rules in style.css.
    updateSelectionUI(type);
}


// Doesn't re-render the cards. If the caller changed the data too
// (e.g. bulkDeleteItems), it calls renderContent() itself.
function exitSelectMode(type) {

    if (!selectMode[type]) {
        return;
    }

    selectMode[type] = false;
    selectedIds[type] = new Set();

    updateSelectionUI(type);
}


// Toggling selection used to call renderContent(), which rebuilds
// every card's HTML from scratch via container.innerHTML = ...
// Replacing the DOM node you just tapped (mid-tap, mid-scroll) is
// what was throwing the page back to the top — some browsers reset
// scroll / yank focus back to <body> when the focused element is
// removed from the DOM under a touch handler. Toggling the
// "selected" class on the existing nodes (no destroy/rebuild) keeps
// the same elements in place, so there's nothing for the browser to
// lose your scroll position over.
function updateSelectionUI(type) {

    const container =
        $("#" + type + "List");

    if (container) {

        const inSelectMode = selectMode[type];

        // Toggling this class is what fades the select circles in/out
        // and the edit/copy buttons out/in (style.css).
        container.classList.toggle("select-mode", inSelectMode);

        container
            .querySelectorAll(".content-card")
            .forEach(el => {
                el.classList.toggle(
                    "selected",
                    selectedIds[type].has(el.dataset.id)
                );

                // Same value renderContent() writes into the markup.
                el.setAttribute(
                    "draggable",
                    inSelectMode ? "false" : "true"
                );
            });
    }

    updateSelectToolbar();
}


function toggleCardSelection(type, id) {

    const set = selectedIds[type];

    if (set.has(id)) {
        set.delete(id);
    } else {
        set.add(id);
    }

    // Deselecting the last card drops you back out of select mode,
    // same as iOS Photos.
    if (set.size === 0) {
        exitSelectMode(type);
        return;
    }

    updateSelectionUI(type);
}


// Selects every card currently on screen — i.e. respecting whatever
// search/category filter renderContent() already applied, not
// every item of that type.
function selectAllVisible(type) {

    const container =
        $("#" + type + "List");

    if (!container) {
        return;
    }

    const ids =
        Array.from(
            container.querySelectorAll(".content-card")
        ).map(el => el.dataset.id);

    selectedIds[type] = new Set(ids);

    updateSelectionUI(type);
}


function updateSelectToolbar() {

    const toolbar = $("#selectToolbar");

    if (!toolbar) {
        return;
    }

    const type =
        selectMode.models
            ? "models"
            : selectMode.scripts
                ? "scripts"
                : null;

    if (!type) {
        toolbar.classList.add("hidden");
        toolbar.dataset.type = "";
        return;
    }

    toolbar.dataset.type = type;
    toolbar.classList.remove("hidden");

    const count = selectedIds[type].size;

    $("#selectToolbarCount").textContent =
        count === 1 ? "1 selected" : `${count} selected`;
}


async function bulkDeleteItems(type, idSet) {

    const ids = Array.from(idSet);

    if (!ids.length) {
        return;
    }

    // Snapshot in original order (each item plus where it sat in
    // data[type]) so Undo can splice everything back where it was,
    // the same idea as the single-item delete below.
    const removedEntries =
        data[type]
            .map((item, index) => ({ item, index }))
            .filter(entry => ids.includes(entry.item.id));

    const confirmed = await confirmDialog({
        icon: "trash",
        title:
            removedEntries.length === 1
                ? `Delete "${removedEntries[0].item.title}"?`
                : `Delete ${removedEntries.length} items?`,
        message: "You'll be able to undo this right after.",
        confirmLabel: "Delete"
    });

    if (!confirmed) {
        return;
    }

    // Snapshots for Undo — same fields deleteItem() keeps, just one
    // per removed model.
    const previousModelTargets = {};
    const hadDeletedModelsEntry = {};
    const previousModelFilter = currentModelFilter;
    let filterWasCleared = false;

    if (type === "models") {

        removedEntries.forEach(({ item }) => {

            previousModelTargets[item.id] =
                data.modelTargets[item.id] || 0;

            hadDeletedModelsEntry[item.id] =
                Object.prototype.hasOwnProperty.call(
                    data.deletedModels,
                    item.id
                );

            data.deletedModels[item.id] = {
                title: item.title,
                target: previousModelTargets[item.id]
            };

        });

    }


    data[type] =
        data[type].filter(
            item => !ids.includes(item.id)
        );


    if (type === "models") {

        ids.forEach(id => delete data.modelTargets[id]);

        if (ids.includes(currentModelFilter)) {
            currentModelFilter = null;
            filterWasCleared = true;
        }

    }


    saveData();

    preserveScroll(function () {

        exitSelectMode(type);

        if (CATEGORIZED_TYPES.includes(type)) {
            renderChips(type);
        }

        // exitSelectMode() no longer re-renders, and the deleted
        // cards still need to leave the grid.
        renderContent(type);

        if (type === "models") {
            renderSales();
        }

    });

    toast(
        removedEntries.length === 1
            ? `"${removedEntries[0].item.title}" deleted`
            : `${removedEntries.length} items deleted`,
        "delete",
        {
            actionLabel: "Undo",
            onAction: function () {

                // Ascending original index so each splice lands the
                // item back where it was relative to what's already
                // been reinserted.
                removedEntries
                    .slice()
                    .sort((a, b) => a.index - b.index)
                    .forEach(({ item, index }) => {

                        const restoreAt =
                            Math.min(index, data[type].length);

                        data[type].splice(restoreAt, 0, item);

                        if (type === "models") {

                            data.modelTargets[item.id] =
                                previousModelTargets[item.id];

                            if (!hadDeletedModelsEntry[item.id]) {
                                delete data.deletedModels[item.id];
                            }

                        }

                    });

                if (type === "models" && filterWasCleared) {
                    currentModelFilter = previousModelFilter;
                }

                saveData();

                // Keep the page where it is instead of jumping to
                // the top when the cards come back.
                preserveScroll(function () {

                    if (CATEGORIZED_TYPES.includes(type)) {
                        renderChips(type);
                    }

                    renderContent(type);

                    if (type === "models") {
                        renderSales();
                    }

                });

                flashRestoreFadeIn(
                    removedEntries.map(
                        ({ item }) =>
                            $("#" + type + "List")
                                .querySelector(`[data-id="${item.id}"]`)
                    )
                );

            }
        }
    );
}


/* ---------- Gesture handling: long-press to enter select mode,
   tap to toggle, drag a selected card onto the trash ---------- */


const CONTENT_HOLD_MS = 500;
const CONTENT_HOLD_MOVE_TOLERANCE = 10;
const SELECT_DRAG_MOVE_THRESHOLD = 8;

let contentHoldState = null;
let selectDragState = null;

// Set for a moment after a long-press fires, so releasing the card
// doesn't also register as the click that opens it (same trick as
// suppressChipClick for category rename).
let suppressContentClick = false;


function cancelContentHold() {

    if (!contentHoldState) {
        return;
    }

    clearTimeout(contentHoldState.timer);
    contentHoldState.card.classList.remove("holding");
    contentHoldState = null;
}


function moveSelectDragGhost(x, y) {

    const ghost = $("#selectDragGhost");

    if (ghost) {
        ghost.style.transform =
            `translate(${x}px, ${y}px) translate(-50%, -140%)`;
    }
}


function isPointOverTrash(x, y) {

    const trashBtn = $("#selectTrashBtn");

    if (!trashBtn || trashBtn.offsetParent === null) {
        return false;
    }

    const rect = trashBtn.getBoundingClientRect();

    return (
        x >= rect.left && x <= rect.right &&
        y >= rect.top && y <= rect.bottom
    );
}


function startSelectDrag(type, x, y) {

    const ghost = $("#selectDragGhost");
    const countEl = $("#selectDragGhostCount");

    if (countEl) {
        countEl.textContent = selectedIds[type].size;
    }

    if (ghost) {
        ghost.classList.remove("hidden");
    }

    moveSelectDragGhost(x, y);
}


function endSelectDrag() {

    const ghost = $("#selectDragGhost");

    if (ghost) {
        ghost.classList.add("hidden");
    }

    const trashBtn = $("#selectTrashBtn");

    if (trashBtn) {
        trashBtn.classList.remove("drag-over");
    }
}


["models", "scripts"].forEach(
    type => {

        const container = $("#" + type + "List");

        if (!container) {
            return;
        }


        container.addEventListener(
            "pointerdown",
            function (event) {

                // Left button / touch / pen only.
                if (
                    event.pointerType === "mouse" &&
                    event.button !== 0
                ) {
                    return;
                }

                const card =
                    event.target.closest(".content-card");

                if (!card || event.target.closest(".card-icon-btn")) {
                    return;
                }

                cancelContentHold();
                suppressContentClick = false;

                const id = card.dataset.id;

                if (selectMode[type]) {

                    // Already selecting — this pointer might just be
                    // a tap (handled by the click listener below) or
                    // it might turn into a drag toward the trash.
                    selectDragState = {
                        type: type,
                        id: id,
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        moved: false
                    };

                    return;
                }

                // Not selecting yet — this could become a long-press
                // that turns it on.
                contentHoldState = {
                    card: card,
                    type: type,
                    id: id,
                    startX: event.clientX,
                    startY: event.clientY,
                    timer: setTimeout(
                        function () {

                            if (!contentHoldState) {
                                return;
                            }

                            contentHoldState = null;
                            card.classList.remove("holding");

                            suppressContentClick = true;

                            setTimeout(
                                function () {
                                    suppressContentClick = false;
                                },
                                400
                            );

                            enterSelectMode(type, id);

                        },
                        CONTENT_HOLD_MS
                    )
                };

                card.classList.add("holding");
            }
        );


        container.addEventListener(
            "pointermove",
            function (event) {

                if (contentHoldState) {

                    const movedFar =
                        Math.abs(event.clientX - contentHoldState.startX) >
                            CONTENT_HOLD_MOVE_TOLERANCE ||
                        Math.abs(event.clientY - contentHoldState.startY) >
                            CONTENT_HOLD_MOVE_TOLERANCE;

                    if (movedFar) {
                        cancelContentHold();
                    }
                }

                if (
                    selectDragState &&
                    selectDragState.pointerId === event.pointerId
                ) {

                    if (!selectDragState.moved) {

                        const dx = event.clientX - selectDragState.startX;
                        const dy = event.clientY - selectDragState.startY;

                        if (Math.hypot(dx, dy) > SELECT_DRAG_MOVE_THRESHOLD) {

                            selectDragState.moved = true;

                            // Dragging an unselected card still sweeps
                            // it (and only it) to the trash.
                            if (!selectedIds[selectDragState.type].has(selectDragState.id)) {
                                selectedIds[selectDragState.type].add(selectDragState.id);
                                preserveScroll(function () {
                                    renderContent(selectDragState.type);
                                });
                            }

                            startSelectDrag(
                                selectDragState.type,
                                event.clientX,
                                event.clientY
                            );
                        }
                    }

                    if (selectDragState.moved) {

                        event.preventDefault();

                        moveSelectDragGhost(event.clientX, event.clientY);

                        const trashBtn = $("#selectTrashBtn");

                        if (trashBtn) {
                            trashBtn.classList.toggle(
                                "drag-over",
                                isPointOverTrash(event.clientX, event.clientY)
                            );
                        }
                    }
                }
            },
            { passive: false }
        );


        function releasePointer(event) {

            cancelContentHold();

            if (
                !selectDragState ||
                selectDragState.pointerId !== event.pointerId
            ) {
                return;
            }

            const wasDragging = selectDragState.moved;
            const type = selectDragState.type;

            endSelectDrag();
            selectDragState = null;

            if (wasDragging && event.type === "pointerup") {

                if (isPointOverTrash(event.clientX, event.clientY)) {
                    bulkDeleteItems(type, selectedIds[type]);
                }

                // A drag shouldn't also register as a select/deselect
                // tap on whatever the pointer happened to end over.
                suppressContentClick = true;

                setTimeout(
                    function () {
                        suppressContentClick = false;
                    },
                    400
                );
            }
        }

        ["pointerup", "pointercancel", "pointerleave"].forEach(
            evtName =>
                container.addEventListener(evtName, releasePointer)
        );

        container.addEventListener("dragstart", cancelContentHold);


        // Capture phase, so this swallows the click that follows a
        // long-press or a drag before openViewModal/toggle would fire.
        container.addEventListener(
            "click",
            function (event) {

                if (!suppressContentClick) {
                    return;
                }

                suppressContentClick = false;

                event.preventDefault();
                event.stopPropagation();
            },
            true
        );

    }
);


window.addEventListener("scroll", cancelContentHold, true);


$("#selectCancelBtn").addEventListener(
    "click",
    function () {

        const type = $("#selectToolbar").dataset.type;

        if (type) {
            exitSelectMode(type);
        }
    }
);


$("#selectAllBtn").addEventListener(
    "click",
    function () {

        const type = $("#selectToolbar").dataset.type;

        if (type) {
            selectAllVisible(type);
        }
    }
);


$("#selectTrashBtn").addEventListener(
    "click",
    function () {

        const type = $("#selectToolbar").dataset.type;

        if (type) {
            bulkDeleteItems(type, selectedIds[type]);
        }
    }
);


// Leaving the Models/Scripts tab (or any tab) drops any select mode
// left running on either grid, so it doesn't linger invisibly.
$$(".nav-btn").forEach(
    button => {
        button.addEventListener(
            "click",
            function () {
                exitSelectMode("models");
                exitSelectMode("scripts");
            }
        );
    }
);


document.addEventListener(
    "keydown",
    function (event) {

        if (event.key !== "Escape") {
            return;
        }

        if (selectMode.models) {
            exitSelectMode("models");
        }

        if (selectMode.scripts) {
            exitSelectMode("scripts");
        }
    }
);


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


                preserveScroll(function () {
                    renderContent(type);
                });
            }
        );

    }
);


/* Scripts search: the icon toggles an inline field open/closed.
   Closing with text still in it clears the field (and re-renders
   the unfiltered list); clicking outside only closes it if it's
   already empty, so an active search doesn't vanish on a stray
   click. */

(function () {

    const box = $("#scriptsSearchBox");
    const toggle = $("#scriptsSearchToggle");
    const input = $("#scriptsSearchInput");

    if (!box || !toggle || !input) {
        return;
    }

    function closeScriptsSearch(clear) {

        if (clear && input.value) {
            input.value = "";
            preserveScroll(function () {
                renderContent("scripts");
            });
        }

        box.classList.remove("open");
    }

    toggle.addEventListener("click", function () {

        if (box.classList.contains("open")) {
            closeScriptsSearch(true);
            return;
        }

        box.classList.add("open");
        input.focus();
    });

    input.addEventListener("keydown", function (event) {

        if (event.key === "Escape") {
            closeScriptsSearch(true);
            toggle.blur();
        }
    });

    document.addEventListener("click", function (event) {

        if (event.target.closest("#scriptsSearchBox")) {
            return;
        }

        if (!input.value) {
            closeScriptsSearch(false);
        }
    });

}());


/* FAQ search: same open/close toggle behavior as the Scripts search,
   but instead of re-rendering a data list it just shows/hides the
   existing question-and-answer items (matching against both the
   question and the answer text), and hides a whole group heading
   if nothing in it matches. */

(function () {

    const box = $("#faqSearchBox");
    const toggle = $("#faqSearchToggle");
    const input = $("#faqSearchInput");

    if (!box || !toggle || !input) {
        return;
    }

    const items = $$("#faq .faq-item");
    const groups = $$("#faq .faq-group");

    function filterFaq(query) {

        const q = query.trim().toLowerCase();

        items.forEach(item => {

            const text = item.textContent.toLowerCase();
            const matches = !q || text.includes(q);

            item.style.display = matches ? "" : "none";
        });

        groups.forEach(group => {

            const hasVisible =
                Array.from(
                    group.querySelectorAll(".faq-item")
                ).some(
                    item => item.style.display !== "none"
                );

            group.style.display = hasVisible ? "" : "none";
        });
    }

    function closeFaqSearch(clear) {

        if (clear && input.value) {
            input.value = "";
            filterFaq("");
        }

        box.classList.remove("open");
    }

    toggle.addEventListener("click", function () {

        if (box.classList.contains("open")) {
            closeFaqSearch(true);
            return;
        }

        box.classList.add("open");
        input.focus();
    });

    input.addEventListener("input", function () {
        filterFaq(input.value);
    });

    input.addEventListener("keydown", function (event) {

        if (event.key === "Escape") {
            closeFaqSearch(true);
            toggle.blur();
        }
    });

    document.addEventListener("click", function (event) {

        if (event.target.closest("#faqSearchBox")) {
            return;
        }

        if (!input.value) {
            closeFaqSearch(false);
        }
    });

}());


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


                // Remember where we were scrolled to on the category
                // we're leaving, so flipping back to it later restores
                // the spot instead of wherever a shorter list clamped
                // the scroll position to.
                const outgoingCategory =
                    currentCategory[type];

                const grid = $("#" + type + "List");

                // Clicking through chips quickly: the category we're
                // "leaving" was never shown, so there's no scroll
                // position to remember for it.
                const midFade =
                    !!grid && grid.classList.contains("fx-out");

                if (outgoingCategory && !midFade) {

                    categoryScrollPositions[type] =
                        categoryScrollPositions[type] || {};

                    categoryScrollPositions[type][outgoingCategory] =
                        getScroller().scrollTop;

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


                const incomingCategory =
                    chip.dataset.category;

                currentCategory[type] =
                    incomingCategory;


                // The old category fades out, the new one fades in.
                fadeSwap(grid, function () {

                    renderContent(type);

                    // Layout for the freshly-rendered list isn't
                    // settled until the next frame, so wait for it
                    // before restoring scroll position.
                    requestAnimationFrame(
                        () => {

                            const saved =
                                (categoryScrollPositions[type] || {})[
                                    incomingCategory
                                ];

                            getScroller().scrollTop =
                                saved || 0;

                        }
                    );

                });

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


/* Keep a page's floating category/quick-nav bar pinned right under
   the sticky top bar, whatever height the top bar ends up being.
   Applies to any page that has both — currently Scripts and FAQ. */
(function () {

    $$(".page").forEach(page => {

        const topbar = page.querySelector(".page-topbar");
        const floatBar = page.querySelector(".floating-chips");

        if (!topbar || !floatBar) {
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

    });

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

    preserveScroll(function () {

        renderContent(type);

        // Model order drives the "Add a sale" list order too.
        if (type === "models") {
            renderSales();
        }

    });
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

    preserveScroll(function () {
        renderChips(type);
    });
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
                                ${escapeHTML(category)}
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


    // Header of the card: badge + label + subtitle follow the type.
    $("#modalEyebrow").textContent =
        type === "models" ? "Models" : "Scripts";

    $("#modalSub").textContent =
        id
            ? "Update the details and save your changes."
            : type === "models"
                ? "Keep their info, preferences and notes in one place."
                : "Save a reusable message you can copy in one click.";

    $("#modalBadge").innerHTML =
        type === "models"
            ? svgIcon(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`)
            : svgIcon(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 8h10"/><path d="M7 12h6"/>`);


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

    // If focus is still inside the modal (e.g. the title field you
    // just typed in) and we hide the modal out from under it, the
    // browser blurs focus back to <body> on its own and some
    // browsers snap the page scroll to the top when that happens.
    // Blurring first, before the modal is hidden, avoids that.
    if (
        document.activeElement &&
        $("#modal").contains(document.activeElement)
    ) {
        document.activeElement.blur();
    }

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

                toast(
                    "Create a category first using “+ Add” above your scripts.",
                    "error"
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

            preserveScroll(function () {
                renderChips(modalType);
            });

        }


        const savedType = modalType;
        const wasEditing = Boolean(editingId);
        const savedTitle = item.title;

        saveData();

        preserveScroll(function () {

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

        });

        const noun = savedType === "models" ? "Model" : "Script";

        toast(
            `${noun} ${wasEditing ? "updated" : "added"}: "${savedTitle}"`,
            "success"
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


async function deleteItem(
    type,
    id
) {

    const itemIndex =
        data[type].findIndex(item => item.id === id);

    if (itemIndex === -1) {
        return;
    }

    const deletedItem = data[type][itemIndex];
    const deletedTitle = deletedItem.title;

    const confirmed = await confirmDialog({
        icon: "trash",
        title: deletedTitle
            ? `Delete "${deletedTitle}"?`
            : "Delete this item?",
        message: "You'll be able to undo this right after.",
        confirmLabel: "Delete"
    });

    if (!confirmed) {
        return;
    }

    // Snapshots for Undo.
    let previousModelTarget;
    let hadDeletedModelsEntry = false;
    const previousModelFilter = currentModelFilter;
    let filterWasCleared = false;

    if (type === "models") {

        previousModelTarget = data.modelTargets[id] || 0;

        hadDeletedModelsEntry =
            Object.prototype.hasOwnProperty.call(data.deletedModels, id);

        // Keep the model's title AND the target it had at the
        // moment of deletion, so past days can still show what
        // percent of target it hit instead of losing that info
        // once modelTargets[id] is deleted below.
        data.deletedModels[id] = {
            title: deletedItem.title,
            target: previousModelTarget
        };

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
            filterWasCleared = true;
        }

    }


    saveData();

    preserveScroll(function () {

        if (
            CATEGORIZED_TYPES.includes(type)
        ) {
            renderChips(type);
        }

        renderContent(type);

        if (type === "models") {
            renderSales();
        }

    });

    toast(
        deletedTitle ? `"${deletedTitle}" deleted` : "Deleted",
        "delete",
        {
            actionLabel: "Undo",
            onAction: function () {

                const restoreAt =
                    Math.min(itemIndex, data[type].length);

                data[type].splice(restoreAt, 0, deletedItem);

                if (type === "models") {

                    data.modelTargets[id] = previousModelTarget;

                    if (!hadDeletedModelsEntry) {
                        delete data.deletedModels[id];
                    }

                    if (filterWasCleared) {
                        currentModelFilter = previousModelFilter;
                    }

                }

                saveData();

                // Keep the page where it is instead of jumping to
                // the top when the card comes back.
                preserveScroll(function () {

                    if (CATEGORIZED_TYPES.includes(type)) {
                        renderChips(type);
                    }

                    renderContent(type);

                    if (type === "models") {
                        renderSales();
                    }

                });

                flashRestoreFadeIn([
                    $("#" + type + "List")
                        .querySelector(`[data-id="${id}"]`)
                ]);

                toast(
                    deletedTitle ? `"${deletedTitle}" restored` : "Item restored",
                    "success"
                );
            }
        }
    );
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

// type: "success" (added/saved/copied — check) | "delete" (removed
// something — trash, same red family as the sidebar trash zone) |
// "notice" (default — a heads-up or something to fix) | "error" (an
// action failed). All four share the same ring (a circle, r=10) with
// a small centered glyph inside, so every toast icon reads at the
// same size and weight — only the glyph and color change by type.
const TOAST_ICONS = {
    success: '<circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-6"/>',
    delete: '<circle cx="12" cy="12" r="10"/><g transform="translate(12 12) scale(0.6) translate(-12 -12)"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M18 7l-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7"/></g>',
    notice: '<path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'
};

// options: { actionLabel, onAction, duration }. Passing actionLabel +
// onAction adds a small button (e.g. "Undo") to the toast; hovering
// it pauses the auto-dismiss so there's time to click it.
function toast(message, type = "notice", options = {}) {

    const stack = $("#toastStack");
    if (!stack) return;

    const iconPath = TOAST_ICONS[type] || TOAST_ICONS.notice;

    const el = document.createElement("div");
    // Namespaced ("toast-<type>") so the type modifier can never collide
    // with an unrelated same-named class elsewhere (e.g. the .delete
    // icon-button class used for remove buttons throughout the app).
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");

    el.innerHTML =
        `<span class="toast-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPath}</svg></span>` +
        `<span class="toast-msg"></span>`;

    el.querySelector(".toast-msg").textContent = message;

    let actionBtn = null;

    if (options.actionLabel && options.onAction) {

        actionBtn = document.createElement("button");
        actionBtn.type = "button";
        actionBtn.className = "toast-action";
        actionBtn.textContent = options.actionLabel;
        el.appendChild(actionBtn);
    }

    stack.appendChild(el);

    requestAnimationFrame(() => el.classList.add("show"));

    const duration = options.duration || (actionBtn ? 5000 : 2200);

    let dismissTimer;

    function removeToast() {

        // Fade out, then collapse so the toasts below glide up
        // instead of jumping when this one is removed.
        el.classList.remove("show");

        el.style.maxHeight = el.offsetHeight + "px";
        void el.offsetHeight;
        el.classList.add("leaving");
        el.style.maxHeight = "0px";

        setTimeout(() => el.remove(), 420);
    }

    function scheduleDismiss() {
        dismissTimer = setTimeout(removeToast, duration);
    }

    if (actionBtn) {

        actionBtn.addEventListener("click", function () {
            clearTimeout(dismissTimer);
            options.onAction();
            removeToast();
        });

        el.addEventListener("mouseenter", () => clearTimeout(dismissTimer));
        el.addEventListener("mouseleave", scheduleDismiss);
    }

    scheduleDismiss();
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
            "block";

        $("#viewModalMeta").textContent =
            "Model";

    }

    $("#viewModalBadge").innerHTML =
        type === "models"
            ? svgIcon(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`)
            : svgIcon(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 8h10"/><path d="M7 12h6"/>`);

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


// Mobile header's Settings menu (settings-group's off-screen on
// phones, so this is the phone equivalent — same actions, own popover).
$("#mobileSettingsBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    $("#mobileSettingsGroup").classList.toggle("open");
});

document.addEventListener("click", function (e) {
    const group = $("#mobileSettingsGroup");
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


$("#reduceMotionToggle").addEventListener(
    "click",
    toggleReduceMotion
);


$("#mobileReduceMotionToggle").addEventListener(
    "click",
    toggleReduceMotion
);


/* The collapse control is a slim line on the sidebar's edge. Click it,
   or drag it across the border: drag left to collapse, right to expand. */
(function initSidebarEdgeHandle() {

    const btn = $("#sidebarCollapseBtn");

    const DRAG_DISTANCE = 30;   // px of travel that counts as a drag
    const CLICK_SLOP = 4;       // less than this is still a click

    let startX = 0;
    let dragging = false;
    let moved = false;
    let triggered = false;
    let suppressClick = false;

    btn.addEventListener("pointerdown", function (e) {

        if (e.button !== 0) return;

        // Stops text from being selected while dragging
        e.preventDefault();

        startX = e.clientX;
        dragging = true;
        moved = false;
        triggered = false;

        btn.setPointerCapture(e.pointerId);
        btn.classList.add("dragging");

    });

    btn.addEventListener("pointermove", function (e) {

        if (!dragging) return;

        const dx = e.clientX - startX;

        if (Math.abs(dx) > CLICK_SLOP) moved = true;

        if (triggered) return;

        const collapsed = $(".app").classList.contains("sidebar-collapsed");

        if ((!collapsed && dx <= -DRAG_DISTANCE) ||
            (collapsed && dx >= DRAG_DISTANCE)) {

            triggered = true;
            toggleSidebarCollapse();

        }

    });

    function endDrag() {

        if (!dragging) return;

        dragging = false;
        btn.classList.remove("dragging");

        // A drag shouldn't also count as a click
        suppressClick = moved;
        setTimeout(function () { suppressClick = false; }, 0);

    }

    btn.addEventListener("pointerup", endDrag);
    btn.addEventListener("pointercancel", endDrag);

    btn.addEventListener("click", function () {

        if (suppressClick) return;

        toggleSidebarCollapse();

    });

})();


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

    toast("Backup downloaded", "success");
}


function isValidImportedData(candidate) {

    if (
        !candidate ||
        typeof candidate !== "object"
    ) {
        return false;
    }

    const hasCoreShape =
        candidate.sales !== null &&
        typeof candidate.sales === "object" &&
        !Array.isArray(candidate.sales) &&
        Array.isArray(candidate.models) &&
        Array.isArray(candidate.scripts);

    return hasCoreShape;
}


function importData(file) {

    const reader = new FileReader();

    reader.onload = async function (event) {

        let parsed;

        try {
            parsed = JSON.parse(event.target.result);
        } catch {

            toast(
                "That file isn't valid JSON. Please pick a backup file exported from this tool.",
                "error"
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

            toast(
                "This doesn't look like a valid Chatter Tool backup file.",
                "error"
            );

            return;
        }

        const confirmed = await confirmDialog({
            title: "Replace all data?",
            message: "Your current sales, history, models and scripts on this device will be replaced with the contents of the backup file. This can't be undone.",
            confirmLabel: "Import & replace"
        });

        if (!confirmed) {
            return;
        }

        data = normalizeData(incoming);

        // A full replace — including sales — needs to overwrite the
        // cloud copy too, not just the local one. saveData()'s normal
        // push deliberately skips sales, so that would leave the old
        // cloud sales in place after an import.
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(data)
        );

        pushFullDataToCloud();

        currentCategory.scripts = "All";
        categoryScrollPositions.scripts = {};
        currentModelFilter = null;

        updateHistory();

        preserveScroll(function () {

            renderSales();

            renderChips("scripts");

            renderContent("models");
            renderContent("scripts");

        });

        toast("Import complete!", "success");
    };

    reader.onerror = function () {

        toast(
            "Couldn't read that file. Please try again.",
            "error"
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


$("#mobileExportDataBtn").addEventListener(
    "click",
    exportData
);


$("#mobileImportDataBtn").addEventListener(
    "click",
    function () {
        $("#mobileImportFileInput").click();
    }
);


$("#mobileImportFileInput").addEventListener(
    "change",
    function (event) {

        const file =
            event.target.files &&
            event.target.files[0];

        if (!file) {
            return;
        }

        importData(file);

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

initReduceMotion();

initSidebarCollapse();

renderAll();

initAuthGate();


// If the app is left open across midnight, "today" quietly becomes
// yesterday — check once a minute and re-render as soon as it does,
// so yesterday's leftover sales get auto-closed and drop into
// History without needing a refresh.
let lastKnownDateKey = getDateKey();

setInterval(function () {

    const key = getDateKey();

    if (key !== lastKnownDateKey) {
        lastKnownDateKey = key;
        preserveScroll(renderAll);
    }

}, 60000);
