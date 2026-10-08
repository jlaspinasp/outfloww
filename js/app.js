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


// Model photos: only accept our own small data-URL images.
const MODEL_IMAGE_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// Default model picture (no photo): a soft person silhouette.
const MODEL_SILHOUETTE_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>';

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
    // Model photos: { "<modelId>": "data:image/jpeg;base64,..." } — small
    // square thumbnails made in the New/Edit Model form. "" = no photo.
    modelImages: {},
    // Shift used only in the "Copy for logout" text (24h "HH:MM")
    logoutShift: { start: "16:00", end: "00:00", cover: false },
    // Custom first line of the logout text ("" = use the default)
    logoutTitle: "",
    // Show the floating quick add (+) button (Settings), synced per account
    showQuickAdd: true
};


// Load saved data
function normalizeQuickAddPos(p) {

    if (!p || typeof p !== "object") {
        return null;
    }

    const dx = Number(p.dx);
    const dy = Number(p.dy);

    if (!isFinite(dx) || !isFinite(dy)) {
        return null;
    }

    return {
        h: p.h === "l" ? "l" : "r",
        dx: Math.min(5000, Math.max(0, dx)),
        v: p.v === "t" ? "t" : "b",
        dy: Math.min(5000, Math.max(0, dy))
    };
}


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

    // Model photos (see defaultData).
    obj.modelImages = obj.modelImages || {};

    // Theme choice, synced across devices ("light" | "dark" | null = not chosen yet).
    obj.theme = (obj.theme === "light" || obj.theme === "dark") ? obj.theme : null;

    // Quick sale button position, synced across devices:
    // { h: "l"|"r", dx: px from that side, v: "t"|"b", dy: px from that edge }
    obj.quickAddPos = normalizeQuickAddPos(obj.quickAddPos);

    // Floating quick add button on/off (Settings). Default on.
    obj.showQuickAdd = obj.showQuickAdd !== false;

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

// Set while a sale is being removed from inside History, so the
// redraw that follows leaves the list's scroll position alone
// (expandHistoryRow() would otherwise scroll the open day into view).
let holdHistoryScroll = false;

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
    check: svgIcon(`<polyline points="20 6 9 17 4 12"/>`),
    trash: svgIcon(`<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`),
    alertTriangle: svgIcon(`<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>`),
    info: svgIcon(`<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/>`),
    open: svgIcon(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`)
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

    const stored = localStorage.getItem(THEME_KEY);
    const saved = stored === "dark" ? "dark" : "light";

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


/* =====================================================
   QUICK ADD BUTTON (Settings)
   Shows or hides the floating quick add (+) button. On by default.
   Saved in the account's data (data.showQuickAdd), so it syncs across
   devices. Only Reduce motion stays in local storage.
   ===================================================== */

function isQuickAddEnabled() {

    return !data || data.showQuickAdd !== false;

}


function applyQuickAddSetting() {

    const on = isQuickAddEnabled();

    ["#quickAddToggle", "#mobileQuickAddToggle"].forEach(
        function (selector) {

            const btn = $(selector);

            if (btn) {
                btn.setAttribute("aria-checked", String(on));
            }

        }
    );

    // The quick add code decides whether the button is on screen.
    document.dispatchEvent(new CustomEvent("quickAddVisibilitySync"));

}


function toggleQuickAddSetting() {

    data.showQuickAdd = !isQuickAddEnabled();

    saveData();

    applyQuickAddSetting();

}


const SIDEBAR_KEY = "chatterTool_sidebarCollapsed";
const SIDEBAR_ANIM_MS = 180;   // matches the sidebar's CSS width transition
let mainSlideAnim = null;


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
    const main = $(".main");

    const next = !app.classList.contains("sidebar-collapsed");

    localStorage.setItem(SIDEBAR_KEY, String(next));

    // Desktop only (the phone has a bottom tab bar, no collapsing), and
    // not when the person has asked for reduced motion.
    const canAnimate =
        main &&
        typeof main.animate === "function" &&
        window.matchMedia("(min-width: 701px)").matches &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        document.documentElement.getAttribute("data-reduce-motion") !== "true";

    if (!canAnimate) {
        applySidebarCollapsed(next);
        return;
    }

    // FLIP: the page gets its FINAL layout in one go (the sidebar is out
    // of the flow, see "SIDEBAR: OUT OF FLOW" in style.css), so text and
    // cards reflow once instead of on every frame of a width animation.
    // Then .main is slid from where it was to where it is, using a
    // transform, which the browser runs on the compositor.
    //   First: where .main visually is right now (mid-slide included)
    const first = main.getBoundingClientRect().left;

    if (mainSlideAnim) {
        mainSlideAnim.cancel();
        mainSlideAnim = null;
    }

    //   Last: apply the new state; reading the position lays out once
    applySidebarCollapsed(next);

    const last = main.getBoundingClientRect().left;
    const delta = first - last;

    //   Invert + Play
    if (delta !== 0) {

        mainSlideAnim = main.animate(
            [
                { transform: "translateX(" + delta + "px)" },
                { transform: "translateX(0)" }
            ],
            { duration: SIDEBAR_ANIM_MS, easing: "ease" }
        );

        mainSlideAnim.onfinish = mainSlideAnim.oncancel = function () {
            mainSlideAnim = null;
        };

    }

}


function toggleTheme() {

    const current =
        document.documentElement.getAttribute("data-theme") === "light"
            ? "light"
            : "dark";

    const next = current === "light" ? "dark" : "light";

    localStorage.setItem(THEME_KEY, next);

    applyTheme(next);

    // Saved with the rest of the account data so every device follows.
    data.theme = next;
    saveData();

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
        const closeBtn = $("#closeConfirmModal");

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
            if (closeBtn) closeBtn.removeEventListener("click", onCancel);

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
        if (closeBtn) closeBtn.addEventListener("click", onCancel);
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
            setEmojiPickerOpen(false);
            validate();
            input.focus();
            input.select();
        }

        function close() {

            // Blur before hiding so the page doesn't jump (see closeModal).
            if (document.activeElement && modal.contains(document.activeElement)) {
                document.activeElement.blur();
            }

            setEmojiPickerOpen(false);

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

                // First Escape closes the emoji popover, the next the window.
                if (isEmojiPickerOpen()) {
                    setEmojiPickerOpen(false);
                    return;
                }

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

        // With Reduce motion on there is no animation, so animationend
        // would never fire and the class would be left on the element.
        if (reduceMotion()) {
            el.classList.remove("restore-fade-in");
            return;
        }

        el.addEventListener(
            "animationend",
            function handler(event) {
                // animationend bubbles: ignore children's animations.
                if (event.target !== el) {
                    return;
                }
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

// Snapshotting the whole data object (photos included) is a big
// JSON.stringify; do it when the browser is idle instead of right
// when a write finishes, which could land in the middle of a tap.
function rememberPushed() {
    const run = function () { lastPushedJSON = JSON.stringify(data); };
    if (window.requestIdleCallback) {
        requestIdleCallback(run, { timeout: 2000 });
    } else {
        setTimeout(run, 0);
    }
}
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


// Tells parts of the app that keep their own copy of the sales numbers
// (the quick-add (+) panel's "net today" and recent list) that sales
// were added, removed or replaced somewhere else — on the Sales page,
// in History, or from another device.
function notifySalesChanged() {
    document.dispatchEvent(new CustomEvent("salesChanged"));
}


// Keeps the Models page (month target, pace, last-7-days chart) live
// whenever sales or targets change anywhere in the app. Bursts of
// changes are batched into a single redraw.
let modelsRefreshQueued = false;

function refreshModelsList() {

    if (modelsRefreshQueued) {
        return;
    }

    modelsRefreshQueued = true;

    requestAnimationFrame(function () {
        modelsRefreshQueued = false;
        preserveScroll(() => renderContent("models"));
    });
}

document.addEventListener("salesChanged", refreshModelsList);


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
                rememberPushed();
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
            rememberPushed();
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
                rememberPushed();
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
            rememberPushed();
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
            rememberPushed();
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
                const seedTheme = localStorage.getItem(THEME_KEY);

                if (!data.theme && (seedTheme === "light" || seedTheme === "dark")) {
                    data.theme = seedTheme;
                }

                cloudDocRef.set(data).then(function () {
                    rememberPushed();
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

            // Theme: the account's choice wins. If the account has none yet
            // but this device has an explicit one, share it with the account.
            let shareTheme = false;
            const localTheme = localStorage.getItem(THEME_KEY);

            if (data.theme) {
                localStorage.setItem(THEME_KEY, data.theme);
                applyTheme(data.theme);
            } else if (localTheme === "light" || localTheme === "dark") {
                data.theme = localTheme;
                shareTheme = true;
            }

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(data)
            );

            preserveScroll(renderAll);

            isApplyingRemoteData = false;
            lastPushedJSON = remoteJSON;

            if (shareTheme) {
                saveData();
            }

            document.dispatchEvent(new CustomEvent("quickAddPosSync"));

            notifySalesChanged();

            applyQuickAddSetting();

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

    applyQuickAddSetting();

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

        $$(".profile-group.open").forEach(g => g.classList.remove("open"));

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

        const profileBtn = $("#settingsBtn");
        (profileBtn || signOutBtn).focus();

    }

    signOutBtn.addEventListener("click", openSignOutConfirm);
    mobileSignOutBtn.addEventListener("click", function () {

        // Close the popover it lives in before showing the modal.
        const group = $("#mobileSettingsGroup");
        if (group) group.classList.remove("open");

        openSignOutConfirm();

    });

    cancelSignOut.addEventListener("click", closeSignOutConfirm);

    const closeSignOutModalBtn = $("#closeSignOutModal");
    if (closeSignOutModalBtn) {
        closeSignOutModalBtn.addEventListener("click", closeSignOutConfirm);
    }

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

                // New to this device: start from the light default until the
                // account's own saved theme (if any) arrives.
                localStorage.removeItem(THEME_KEY);
                applyTheme("light");

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

            // Dark mode belongs to the account that chose it. Anyone not
            // signed in (signing out, or opening the app signed out) gets
            // the light default.
            localStorage.removeItem(THEME_KEY);
            applyTheme("light");

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
        // openHistoryModal's preserveScroll re-pins the page scroll
        // position across two animation frames (undoing browsers'
        // own scroll-to-top on the re-render); wait out both of
        // those before scrolling to the day, or that second pin
        // snaps the scroll back to the top right after we set it.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                expandAllHistoryRowsForDate(dateKey);
            });
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

    return getAutoAvatarColor(id);
}

// The generated pastel for a model (what "Auto" colour means).
function getAutoAvatarColor(id) {

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

function selectModel(modelId, options) {

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

        // Picked from the "Add a sale" switcher: drop the cursor straight
        // into the amount box (it's only enabled once renderSales has run,
        // so this has to happen after it) — type the number and hit Enter.
        if (nextId !== null && options && options.focusAmount) {

            const amountInput = $("#saleAmount");

            if (amountInput && !amountInput.disabled) {
                amountInput.focus({ preventScroll: true });
            }
        }
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

    // The picker was removed from the Add a sale card, so there may be
    // nothing to render into.
    if (!$("#modelPickerList")) {
        return;
    }

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


// The target picker button was removed from the Add a sale card for now
// (it is moving to the Models page), so these listeners only attach if
// the elements exist.
if ($("#openModelPicker")) $("#openModelPicker").addEventListener(
    "click",
    function () {

        preserveScroll(renderModelPickerList);

        $("#modelPickerList").classList.toggle(
            "hidden"
        );
    }
);


if ($("#modelPickerList")) $("#modelPickerList").addEventListener(
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

        const pickerList = $("#modelPickerList");

        if (pickerList) {
            pickerList.classList.add("hidden");
        }
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
                ? ""
                : "Select a model first";

        if (!activeModel) {
            saleAmountInput.value = "";
        }
    }

    if (addSaleBtn) {

        addSaleBtn.disabled = !activeModel;

        if (activeModel) {
            addSaleBtn.style.setProperty(
                "--model-deep",
                getModelDeepColor(getAvatarColor(activeModel.id))
            );
            addSaleBtn.classList.add("model-themed");
        } else {
            addSaleBtn.style.removeProperty("--model-deep");
            addSaleBtn.classList.remove("model-themed");
        }

        addSaleBtn.title =
            activeModel
                ? ""
                : "Select a model to add a sale";
    }

    // The username tag button is locked the same way until a model is
    // selected, and its popover closes if it was open.
    const usernameToggle = $("#addUsernameToggle");

    if (usernameToggle) {

        usernameToggle.disabled = !activeModel;

        usernameToggle.title =
            activeModel
                ? (usernameToggle.dataset.enabledTitle || "Tag the next sale with a username")
                : "Select a model to tag a username";

        if (!activeModel) {
            $("#addUsernamePopover").classList.add("hidden");
        }
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
        renderTargetProgress(net, { patch: !!(options && options.patchBreakdown) });
    }


    // Individual sales — only shown when a model is selected
    const listed = activeModel ? visible : [];

    // Remember where the list was scrolled (and how many rows it had) so
    // a removal can put it back instead of jumping to the bottom.
    const salesListEl = $("#salesList");

    const prevListScroll =
        options && typeof options.listScroll === "number"
            ? options.listScroll
            : salesListEl.scrollTop;

    const prevListCount =
        lastSalesRender.modelId === currentModelFilter
            ? lastSalesRender.count
            : null;

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


    // Keep the list scrolled to the latest sale (new sale, switching
    // model, first render) — but when a sale was just REMOVED from the
    // model that's already showing, leave the scroll where it was. The
    // browser clamps it if the list got shorter, so a list sitting at
    // the bottom stays at the bottom.
    const removedFromList =
        prevListCount !== null &&
        listed.length < prevListCount;

    salesListEl.scrollTop =
        removedFromList
            ? prevListScroll
            : salesListEl.scrollHeight;


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


function renderTargetProgress(net, options) {

    // The per-model breakdown always stays visible now — model
    // selection (for logging a sale) no longer swaps it away.
    $("#targetProgress").classList.add("hidden");
    $("#targetBreakdownWrap").classList.add("active");

    renderTargetBreakdown(options);
}


// Where each "on fire" tier of a model's name starts (percent of target),
// hottest first. Raise or lower the numbers to make the effects kick in
// later or sooner.
const FIRE_TIERS = [
    { tier: 5, from: 230, emoji: "🔥🔥🔥" },
    { tier: 4, from: 185, emoji: "🔥🔥" },
    { tier: 3, from: 150, emoji: "🔥" },
    { tier: 2, from: 120, emoji: "🟠" },
    { tier: 1, from: 100, emoji: "✨" }
];

// Embers are real little elements (not a background that slides around),
// so each one animates on its own timing with transform/opacity only,
// which the browser can run on the GPU. Each tier gets its own count and
// motion style (see "ON FIRE" in style.css).
const FIRE_FX_COUNT = { 2: 4, 3: 3, 4: 5, 5: 7 };

function fireFxHTML(tier) {
    const n = FIRE_FX_COUNT[tier] || 0;
    return n
        ? `<span class="fire-fx" aria-hidden="true">${"<i></i>".repeat(n)}</span>`
        : "";
}

// Used when a name crosses into another tier without being rebuilt.
function setFireFx(titleEl, tier) {
    const old = titleEl.querySelector(":scope > .fire-fx");
    if (old) old.remove();
    const html = fireFxHTML(tier);
    if (html) titleEl.insertAdjacentHTML("beforeend", html);
}

// ---- Smooth tier-to-tier transitions ----
// When a name moves to another fire tier, a snapshot of its old look is
// laid on top and fades out, so colour, glow and embers blend into the
// new tier instead of switching instantly. Skipping tiers (1 -> 3) steps
// through the ones in between (1 -> 2 -> 3). This uses the Web Animations
// API on purpose: unlike CSS animations/transitions, it is not switched
// off by the Reduce motion settings, so these blends always play.
const FIRE_STEP_MS = 800;

function getTitleTier(title) {
    const m = /on-fire-(\d)/.exec(title.className);
    return m ? Number(m[1]) : 0;
}

function applyFireTier(title, tier) {
    const keep = title.classList.contains("fit-measure") ? " fit-measure" : "";
    title.className = "target-breakdown-title" +
        (tier ? ` on-fire on-fire-${tier}` : "") + keep;
    setFireFx(title, tier);
}

function makeFireGhost(title) {
    const parent = title.parentElement;
    if (!parent || !title.offsetWidth) return null;

    const ghost = title.cloneNode(true);
    ghost.classList.add("fire-ghost");
    ghost.setAttribute("aria-hidden", "true");

    ghost.style.position = "absolute";
    ghost.style.left = title.offsetLeft + "px";
    ghost.style.top = title.offsetTop + "px";
    ghost.style.width = title.offsetWidth + "px";
    ghost.style.height = title.offsetHeight + "px";
    ghost.style.boxSizing = "border-box";
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";

    parent.appendChild(ghost);
    return ghost;
}

function clearFireTransition(title) {
    clearTimeout(title._fireTimer);
    (title._fireGhosts || []).forEach(g => g.remove());
    title._fireGhosts = [];
}

function transitionFireTier(title, toTier) {

    clearFireTransition(title);

    const fromTier = getTitleTier(title);

    if (fromTier === toTier) return;

    // Every tier on the way, one step at a time (up or down).
    const path = [];
    const dir = toTier > fromTier ? 1 : -1;
    for (let t = fromTier + dir; t !== toTier + dir; t += dir) {
        path.push(t);
    }

    const runStep = function (i) {

        if (i >= path.length || !title.isConnected) return;

        const ghost = makeFireGhost(title);

        applyFireTier(title, path[i]);

        if (ghost) {

            title._fireGhosts.push(ghost);

            const fade = ghost.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                { duration: FIRE_STEP_MS, easing: "ease-in-out", fill: "forwards" }
            );

            fade.onfinish = function () { ghost.remove(); };
        }

        title._fireTimer = setTimeout(function () {
            runStep(i + 1);
        }, FIRE_STEP_MS);
    };

    runStep(0);
}

function renderTargetBreakdown(options) {

    // Which look a row is in: fire tier + (no target / hit / in progress).
    // While this stays the same, a sale only changes numbers, so the row
    // can be updated in place instead of being destroyed and rebuilt.
    const stateOf = percent => {
        let tier = 0;
        if (percent !== null) {
            const f = FIRE_TIERS.find(t => percent >= t.from);
            if (f) tier = f.tier;
        }
        return tier + "|" + (percent === null ? "n" : percent >= 100 ? "h" : "p");
    };

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


    const box = $("#targetBreakdown");

    const buildRowHTML = ({ model, net, target, percent }) => {

            const hit = percent !== null && percent >= 100;
            const displayPercent =
                percent === null ? 0 : Math.min(percent, 100);

            // The further a model blows past its target, the hotter
            // its name burns in the list. Each tier has its own effect
            // (see "ON FIRE" in style.css); the percentages that start
            // each tier are in FIRE_TIERS, so they are easy to change.
            //   0–99%   normal
            //   tier 1  ✨ target hit: gold shine
            //   tier 2  🟠 warm amber glow
            //   tier 3  🔥 flames + embers
            //   tier 4  🔥🔥 blaze
            //   tier 5  🔥🔥🔥 inferno
            let fireTier = 0;
            let fireEmoji = "";
            if (percent !== null) {
                const found = FIRE_TIERS.find(t => percent >= t.from);
                if (found) {
                    fireTier = found.tier;
                    fireEmoji = found.emoji;
                }
            }
            const fireClass = fireTier ? ` on-fire on-fire-${fireTier}` : "";

            const rowColor = getAvatarColor(model.id);
            const ink = getRowInk(rowColor);

            return `
                <div class="target-breakdown-row${model.id === currentModelFilter ? " selected" : ""}${model.id === deselectingModelId ? " deselecting" : ""}${model.id === selectingModelId ? " selecting" : ""}" data-model="${model.id}" data-state="${stateOf(percent)}" style="--badge-color:${rowColor};--row-deep:${getModelDeepColor(rowColor)};--row-strong:${ink.strong};--row-muted:${ink.muted};--row-radio-border:${ink.radioBorder};--row-radio-bg:${ink.radioBg};--row-track-bg:${ink.trackBg};--row-track-fill:${ink.trackFill}" title="${model.id === currentModelFilter ? `Selected — adding sales for ${escapeHTML(model.title)}` : "Use the switcher above to select this model"}">

                    ${getModelAvatarHTML("lg", model.id)}

                    <div class="target-breakdown-body">

                        <div class="target-breakdown-head">
                            <span class="target-breakdown-name">
                                <span class="target-breakdown-title${fireClass}">${escapeHTML(model.title)}${fireFxHTML(fireTier)}</span>
                            </span>
                            ${percent === null || hit
                                ? `<span class="target-breakdown-status">${percent === null ? "No target" : "🎉 Hit"}</span>`
                                : ""}
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

                        <div class="target-breakdown-label">Sales target</div>

                        <div class="target-breakdown-figures">
                            <span class="target-breakdown-percent">${percent === null ? 0 : percent}%</span>
                            <span class="target-breakdown-amounts">${target > 0 ? `${money(net)} / ${money(target)}` : `${money(net)} net`}</span>
                        </div>

                        <div class="progress-track">
                            <div
                                class="progress-fill${hit ? " hit" : ""}"
                                style="width:${displayPercent}%"
                            ></div>
                        </div>

                    </div>

                </div>
            `;
    };

    // Fast path (used when adding / deleting a sale): same models in the
    // same order -> patch text and bar width, and only rebuild a row if
    // its fire tier or hit state actually changed.
    if (options && options.patch) {

        const existing = Array.from(box.children)
            .filter(el => el.classList.contains("target-breakdown-row"));

        const sameShape =
            existing.length === rows.length &&
            rows.every((r, i) => existing[i].dataset.model === r.model.id);

        if (sameShape) {

            const replaced = [];

            rows.forEach((r, i) => {

                const el = existing[i];

                // Crossing a threshold (100%, 120%, 150%...) changes the
                // fire tier / hit label. Swap just those classes on the
                // existing elements. Rebuilding the whole row here was the
                // stutter: every layer of the fire effect got recreated.
                const newState = stateOf(r.percent);

                if (el.dataset.state !== newState) {

                    el.dataset.state = newState;

                    const title = el.querySelector(".target-breakdown-title");
                    const tier = Number(newState.split("|")[0]);

                    if (title) {
                        transitionFireTier(title, tier);
                    }

                    const fillEl = el.querySelector(".progress-fill");
                    if (fillEl) {
                        fillEl.classList.toggle("hit", r.percent !== null && r.percent >= 100);
                    }

                    // "No target" / "Hit" label next to the name
                    const wantText = r.percent === null
                        ? "No target"
                        : r.percent >= 100 ? "🎉 Hit" : "";
                    let statusEl = el.querySelector(".target-breakdown-status");

                    if (wantText && !statusEl) {
                        statusEl = document.createElement("span");
                        statusEl.className = "target-breakdown-status";
                        const nameEl = el.querySelector(".target-breakdown-name");
                        if (nameEl) nameEl.after(statusEl);
                    }
                    if (statusEl) {
                        if (wantText) {
                            statusEl.textContent = wantText;
                        } else {
                            statusEl.remove();
                        }
                    }

                    // The label can change how much room the name has.
                    replaced.push(el);
                }

                const pctEl = el.querySelector(".target-breakdown-percent");
                const amtEl = el.querySelector(".target-breakdown-amounts");
                const fill = el.querySelector(".progress-fill");

                const pctText = (r.percent === null ? 0 : r.percent) + "%";
                const amtText = r.target > 0
                    ? `${money(r.net)} / ${money(r.target)}`
                    : `${money(r.net)} net`;
                const width = (r.percent === null ? 0 : Math.min(r.percent, 100)) + "%";

                if (pctEl && pctEl.textContent !== pctText) pctEl.textContent = pctText;
                if (amtEl && amtEl.textContent !== amtText) amtEl.textContent = amtText;
                if (fill && fill.style.width !== width) fill.style.width = width;
            });

            if (replaced.length) {
                fitTargetBreakdownTitles(replaced);
            }

            return;
        }
    }

    // Full rebuild (first render, model added/removed/reordered, etc.)
    box.innerHTML = rows.map(buildRowHTML).join("");

    fitTargetBreakdownTitles();
    sizeModelRows();
    renderModelSwitcher();
}


// A model's picture: its uploaded photo when it has one (set in the
// New/Edit Model form), otherwise a soft person silhouette.
function getModelAvatarHTML(size, modelId) {

    const src = modelId ? getModelImage(modelId) : "";

    if (src) {
        return `<span class="model-avatar model-avatar-${size} has-image" aria-hidden="true"><img src="${src}" alt="" draggable="false"></span>`;
    }

    return `<span class="model-avatar model-avatar-${size}" aria-hidden="true">${MODEL_SILHOUETTE_SVG}</span>`;
}


// A deeper shade of a model's own colour (same hue) — used for the
// "Add Sale" button while that model is selected.
function getModelDeepColor(colorStr) {

    const { r, g, b } = parseColorToRgb(colorStr);
    const { h, s } = rgbToHsl(r, g, b);

    // Greys / whites stay neutral instead of turning into a random hue.
    const sat = s < 8 ? s : Math.min(Math.max(s, 28), 55);
    const c = hslToRgb(h, sat, 30);

    return `rgb(${c.r}, ${c.g}, ${c.b})`;
}


function renderModelSwitcher() {

    const box = $("#modelSwitcher");

    if (!box) {
        return;
    }

    box.classList.toggle("hidden", data.models.length === 0);

    // Rebuilding the pills empties the row, which snaps its sideways
    // scroll back to 0 — remember it so selecting a pill doesn't jump.
    const prevScroll = box.scrollLeft;

    box.innerHTML = data.models.map(model => {

        const color = getAvatarColor(model.id);
        const ink = getRowInk(color);
        const on = model.id === currentModelFilter;

        return `
            <button type="button" class="model-chip${on ? " selected" : ""}" data-model="${model.id}" draggable="true" style="--chip-color:${color};--chip-ink:${ink.strong}" aria-pressed="${on}" title="${on ? "Deselect" : "Select"} ${escapeHTML(model.title)}">
                ${getModelAvatarHTML("sm", model.id)}
                <span class="model-chip-name" data-text="${escapeHTML(model.title)}">${escapeHTML(model.title)}</span>
            </button>
        `;
    }).join("");

    box.scrollLeft = prevScroll;

    // Only scroll when the selected pill is actually cut off, and
    // measure against the row itself (offsetLeft is relative to a
    // different parent, which made the old maths nudge the row).
    const active = box.querySelector(".model-chip.selected");

    if (active) {
        const boxRect = box.getBoundingClientRect();
        const chipRect = active.getBoundingClientRect();

        if (chipRect.left < boxRect.left) {
            box.scrollLeft += chipRect.left - boxRect.left - 8;
        } else if (chipRect.right > boxRect.right) {
            box.scrollLeft += chipRect.right - boxRect.right + 8;
        }
    }
}


$("#modelSwitcher").addEventListener(
    "click",
    function (event) {

        const chip = event.target.closest(".model-chip");

        if (!chip) {
            return;
        }

        // Tapping the selected chip again deselects it
        // (the badge next to "Sales" still clears it too).
        selectModel(
            chip.classList.contains("selected")
                ? null
                : chip.dataset.model,
            { focusAmount: true }
        );
    }
);


// Long model names shrink to fit their row instead of getting cut
// off or stretching the "Add a sale" card. Font-size only — the
// card's width and layout never change.
function fitTargetBreakdownTitles(onlyRows) {

    const MAX_FONT = 27;
    const MIN_FONT = 13;

    const roots = onlyRows || [$("#targetBreakdown")];
    const titles = [];

    roots.forEach(root => {
        root.querySelectorAll(".target-breakdown-title:not(.fire-ghost)")
            .forEach(t => titles.push(t));
    });

    titles.forEach(title => {

        // The on-fire glow and embers are pseudo-elements that stick
        // out past the name; they must not count as the name being
        // too wide, or every burning name shrinks to the minimum.
        title.classList.add("fit-measure");
        title.style.fontSize = MAX_FONT + "px";

        // Most names fit at full size: one measurement and done.
        if (title.scrollWidth > title.clientWidth) {

            // Otherwise binary-search the largest size that fits
            // (about 4 measurements instead of up to 14).
            let lo = MIN_FONT;
            let hi = MAX_FONT - 1;

            while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                title.style.fontSize = mid + "px";
                if (title.scrollWidth > title.clientWidth) {
                    hi = mid - 1;
                } else {
                    lo = mid;
                }
            }

            title.style.fontSize = lo + "px";
        }

        title.classList.remove("fit-measure");
    });
}


// One fixed height for every model row: the height at which exactly 3 rows
// fill the room the Add a sale card has for the list (the card is as tall
// as the Today's sales card beside it). Measured, not hard-coded, so it
// stays right if the card's other contents change size.
let modelRowSizing = false;

function sizeModelRows() {

    const wrap = $("#targetBreakdownWrap");
    const box = $("#targetBreakdown");

    if (!wrap || !box || modelRowSizing) {
        return;
    }

    // Hidden tab: nothing to measure. The ResizeObserver below tries
    // again when the Sales page is shown.
    if (!wrap.classList.contains("active") || wrap.offsetParent === null) {
        return;
    }

    // Stacked layout (narrow screens): the card isn't stretched to match
    // anything, so rows just use their natural height.
    if (window.matchMedia("(max-width: 980px)").matches) {
        box.style.removeProperty("--model-row-h");
        return;
    }

    const firstRow = box.querySelector(".target-breakdown-row");

    if (!firstRow) {
        return;
    }

    modelRowSizing = true;

    const before = box.style.getPropertyValue("--model-row-h");

    // Natural height of a row (what its content needs).
    box.style.setProperty("--model-row-h", "auto");
    const natural = firstRow.offsetHeight;

    // Collapse the rows so the list takes exactly the room left over in
    // the stretched card.
    box.style.setProperty("--model-row-h", "0px");
    const room = wrap.getBoundingClientRect().height;

    const cs = getComputedStyle(box);
    const gap = parseFloat(cs.rowGap) || 8;
    const pad =
        (parseFloat(cs.paddingTop) || 0) +
        (parseFloat(cs.paddingBottom) || 0);

    const each = Math.floor((room - pad - gap * 2) / 3);
    const height = Math.max(natural, each);

    box.style.setProperty("--model-row-h", height + "px");

    modelRowSizing = false;

    return before !== height + "px";
}

// Names are shrunk to fit the card (fitTargetBreakdownTitles), so when the
// card's WIDTH changes (sidebar collapsed / expanded, window resized) they
// have to be fitted again, or they stay too small / get cut off with "...".
let lastModelWrapWidth = 0;
let modelRefitFrame = 0;

if (window.ResizeObserver && $("#targetBreakdownWrap")) {
    new ResizeObserver(function (entries) {

        requestAnimationFrame(sizeModelRows);

        const entry = entries[entries.length - 1];
        const width = Math.round(entry.contentRect.width);

        // 0 = the Sales tab is hidden; the refit on show handles that.
        if (width > 0 && width !== lastModelWrapWidth) {

            lastModelWrapWidth = width;

            cancelAnimationFrame(modelRefitFrame);
            modelRefitFrame = requestAnimationFrame(function () {
                try {
                    fitTargetBreakdownTitles();
                } catch (err) {}
            });
        }

    }).observe($("#targetBreakdownWrap"));
}

window.addEventListener("resize", function () {
    sizeModelRows();
});


// Selecting a model is done from the switcher at the top of the card
// (renderModelSwitcher above) — clicking a row here does nothing on
// purpose, and the rows themselves can't be dragged. Reordering models
// is done by dragging the pills in the switcher instead:

let switcherDragId = null;

function clearSwitcherDragMarks() {

    $$("#modelSwitcher .model-chip.dragging, #modelSwitcher .model-chip.drag-over")
        .forEach(el => el.classList.remove("dragging", "drag-over"));
}

$("#modelSwitcher").addEventListener(
    "dragstart",
    function (event) {

        const chip = event.target.closest(".model-chip");

        if (!chip) {
            return;
        }

        switcherDragId = chip.dataset.model;

        chip.classList.add("dragging");

        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", switcherDragId);
    }
);

$("#modelSwitcher").addEventListener(
    "dragover",
    function (event) {

        if (!switcherDragId) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";

        const box = event.currentTarget;
        const chip = event.target.closest(".model-chip");

        $$("#modelSwitcher .model-chip.drag-over")
            .forEach(el => el.classList.remove("drag-over"));

        if (chip && chip.dataset.model !== switcherDragId) {
            chip.classList.add("drag-over");
        }

        // When the row scrolls sideways, dragging near an edge scrolls it.
        const rect = box.getBoundingClientRect();

        if (event.clientX < rect.left + 40) {
            box.scrollLeft -= 14;
        } else if (event.clientX > rect.right - 40) {
            box.scrollLeft += 14;
        }
    }
);

$("#modelSwitcher").addEventListener(
    "drop",
    function (event) {

        if (!switcherDragId) {
            return;
        }

        event.preventDefault();

        const chip = event.target.closest(".model-chip");
        const dragId = switcherDragId;

        switcherDragId = null;
        clearSwitcherDragMarks();

        if (!chip) {
            return;
        }

        // Re-saves the order and redraws the switcher and the list.
        reorderItem("models", dragId, chip.dataset.model);
    }
);

$("#modelSwitcher").addEventListener(
    "dragend",
    function () {

        switcherDragId = null;
        clearSwitcherDragMarks();
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

        refreshModelsList();

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

    // Remembered so the "select a model first" tooltip can be swapped
    // back when a model gets selected.
    toggle.dataset.enabledTitle =
        armedUsername
            ? `${usernameTypeLabel(armedUsernameType)} — ${armedUsername} (next sale — click to change)`
            : "Tag the next sale with a username";

    if (!toggle.disabled) {
        toggle.title = toggle.dataset.enabledTitle;
    }
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
    .querySelectorAll("#addUsernamePopover .username-type-btn")
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


// Show the × in the username box only while it has text (same idea
// as the search boxes' clear button).
function syncSaleTagClear() {

    $("#saleTagWrap").classList.toggle(
        "has-value",
        !!$("#saleTagField").value
    );
}

$("#saleTagField").addEventListener(
    "input",
    syncSaleTagClear
);

$("#saleTagClear").addEventListener(
    "click",
    function () {

        $("#saleTagField").value = "";

        syncSaleTagClear();

        $("#saleTagField").focus();
    }
);


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

            syncSaleTagClear();

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

        const hadTag = Boolean(armedUsername);

        setArmedUsername(
            username,
            armedUsernameType
        );

        $("#addUsernamePopover").classList.add("hidden");

        if (username) {

            toast(
                `${usernameTypeLabel(armedUsernameType)} tag set: ${username}`,
                "success"
            );

        } else if (hadTag) {

            toast("Username tag removed.");
        }

        // Straight on to the amount. (It's locked until a model is
        // selected, and a locked input can't take focus.)
        const amountInput = $("#saleAmount");

        if (amountInput && !amountInput.disabled) {
            amountInput.focus();
        }
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


let saleBtnDoneTimer = null;

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


        // Sound first so it isn't held up by the redraw.
        playKaching();

        updateHistory();

        // Only the numbers changed, so patch the model rows in place.
        preserveScroll(() => renderSales({ patchBreakdown: true }));

        notifySalesChanged();

        toast("Sale added!", "success");

        // Same "Added" check feedback as the Quick sale button.
        const saleBtn = $("#addSaleBtn");
        saleBtn.classList.add("done");
        clearTimeout(saleBtnDoneTimer);
        saleBtnDoneTimer = setTimeout(function () {
            saleBtn.classList.remove("done");
        }, 1000);

        $("#saleAmount").focus();

        // Let the browser paint the new sale, THEN do the heavy
        // bookkeeping (JSON.stringify of everything + sync writes).
        requestAnimationFrame(function () {
            setTimeout(function () {
                saveData();
                pushSaleAdded(dateKey, sale);
            }, 0);
        });
    }
);


/* =====================================================
   QUICK SALE (floating button + popover, every tab except Sales)
   -----------------------------------------------------
   Logs a sale from any tab without leaving it. The sale itself is
   built exactly like the Sales page form builds one (same fields,
   same tag handling, sound, history/progress refresh, save + sync);
   the model is the very same selection the Sales page uses
   (currentModelFilter): picking or un-picking a model here picks or
   un-picks it there too, and the other way round.
   ===================================================== */

(function () {

    const fab = $("#quickAddFab");
    const panel = $("#quickAddPanel");
    const backdrop = $("#quickAddBackdrop");
    const form = $("#quickAddForm");
    const closeBtn = $("#quickAddClose");
    const modelsBox = $("#quickAddModels");
    const noModels = $("#quickAddNoModels");
    const amountInput = $("#quickAddAmount");
    const tagBtn = $("#quickAddTagBtn");
    const tagDrawer = $("#quickAddUsernamePopover");
    const tagSet = $("#quickAddTagSet");
    const tagWrap = $("#quickAddTagWrap");
    const tagField = $("#quickAddTagField");
    const tagClear = $("#quickAddTagClear");
    const submitBtn = $("#quickAddSubmit");
    const recentList = $("#quickAddRecentList");
    const recentEmpty = $("#quickAddRecentEmpty");
    const recentCount = $("#quickAddRecentCount");
    const footLabel = $("#quickAddFootLabel");
    const footFig = $("#quickAddFootFig");
    const track = $("#quickAddTrack");
    const fill = $("#quickAddFill");
    const segBtns = Array.from(panel ? panel.querySelectorAll(".username-type-btn") : []);
    const salesPage = $("#sales");
    const authGate = $("#authGate");

    if (!fab || !panel || !backdrop || !form || !amountInput || !submitBtn) {
        return;
    }

    let isOpen = false;
    let salesNeedsRefit = false;
    let doneTimer = null;
    let recentTimer = null;

    function isTouch() {
        return window.matchMedia("(pointer: coarse)").matches;
    }


    /* ---------- Model chips ---------- */

    function renderChips() {

        const models = data.models || [];

        modelsBox.hidden = models.length === 0;
        noModels.hidden = models.length > 0;

        modelsBox.innerHTML = models.map(function (model) {

            const color = getAvatarColor(model.id);
            const ink = getRowInk(color);
            const on = model.id === currentModelFilter;

            return `<button type="button" class="qa-chip${on ? " selected" : ""}" data-model="${model.id}" aria-pressed="${on}" style="--chip-color:${color};--chip-ink:${ink.strong}" title="${escapeHTML(model.title)}">${getModelAvatarHTML("sm", model.id)}<span class="qa-chip-name">${escapeHTML(model.title)}</span></button>`;

        }).join("");
    }

    // Same rule as the Sales page pills: tapping the selected model
    // again un-selects it. It goes through selectModel(), so the Sales
    // page, its badge and this window can never disagree.
    function toggleModel(id, focusAmount) {

        selectModel(currentModelFilter === id ? null : id);

        syncChips();
        syncControls();

        if (focusAmount && currentModelFilter && !amountInput.disabled) {
            amountInput.focus({ preventScroll: true });
        }
    }

    function syncChips() {

        modelsBox.querySelectorAll(".qa-chip").forEach(function (chip) {
            const on = chip.dataset.model === currentModelFilter;
            chip.classList.toggle("selected", on);
            chip.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    modelsBox.addEventListener("click", function (event) {

        const chip = event.target.closest(".qa-chip");

        if (chip) {
            toggleModel(chip.dataset.model, true);
        }
    });


    /* ---------- Locked until a model is chosen; today's net ---------- */

    function currentModel() {
        return currentModelFilter ? getModelById(currentModelFilter) : null;
    }

    function syncControls() {

        const model = currentModel();
        const on = !!model;

        amountInput.disabled = !on;
        amountInput.placeholder = on ? "0.00" : "Select a model first";

        if (!on) {
            amountInput.value = "";
        }

        tagBtn.disabled = !on;
        syncTagButton();
        submitBtn.disabled = !on;
        submitBtn.classList.toggle("model-themed", on);

        if (on) {
            panel.style.setProperty(
                "--model-deep",
                getModelDeepColor(getAvatarColor(model.id))
            );
        } else {
            panel.style.removeProperty("--model-deep");
            setTagOpen(false);
        }

        updateSummary();
        renderRecent(false);
    }

    function updateSummary() {

        const model = currentModel();

        if (!model) {
            footLabel.textContent = "Net today";
            footFig.textContent = "—";
            track.classList.add("is-off");
            fill.style.width = "0%";
            fill.classList.remove("hit");
            return;
        }

        // Same numbers the model rows on the Sales page show.
        const todayKey = getDateKey();

        const sales = getTodaySales().filter(function (sale) {
            return sale.modelId === model.id && !isSaleClosed(todayKey, sale);
        });

        const net = getTotal(sales) * NET_RATE;
        const target = (data.modelTargets && data.modelTargets[model.id]) || 0;
        const percent = target > 0 ? Math.round((net / target) * 100) : null;

        footLabel.textContent = model.title + " · net today";

        footFig.textContent =
            target > 0
                ? `${money(net)} / ${money(target)}`
                : `${money(net)} net`;

        track.classList.toggle("is-off", target <= 0);
        fill.style.width = (percent === null ? 0 : Math.min(percent, 100)) + "%";
        fill.classList.toggle("hit", percent !== null && percent >= 100);
    }


    /* ---------- Recent sales (chosen model, latest first, today only) ---------- */

    const RECENT_MAX = 4;

    function whenLabel(time) {

        const minutes = Math.floor((Date.now() - time) / 60000);

        if (minutes < 1) {
            return "Just now";
        }

        if (minutes < 60) {
            return minutes + "m ago";
        }

        const d = new Date(time);

        return formatShiftTime(
            d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0")
        );
    }

    function renderRecent(animateNew) {

        const model = currentModel();
        const todayKey = getDateKey();

        // Same rule as Today's sales: sales already settled in a saved
        // shift are not listed.
        const all = model
            ? getTodaySales().filter(function (sale) {
                return sale.modelId === model.id && !isSaleClosed(todayKey, sale);
            })
            : [];

        const latest = all
            .slice()
            .sort(function (a, b) { return b.time - a.time; })
            .slice(0, RECENT_MAX);

        recentCount.textContent = all.length ? all.length + " today" : "";

        recentEmpty.hidden = all.length > 0;
        recentList.hidden = all.length === 0;

        if (!all.length) {
            recentEmpty.textContent = model
                ? "No sales for " + model.title + " yet today."
                : "Select a model to see its recent sales.";
        }

        recentList.innerHTML = latest.map(function (sale, i) {

            const tag = escapeHTML(sale.buyerUsername || "");

            const badge =
                sale.tip
                    ? `<span class="sale-tag-badge tip" title="Tip — ${tag}">${ICONS.heart}Tip</span>`
                    : sale.outsideShift
                        ? `<span class="sale-tag-badge outside" title="Outside shift — ${tag}">${ICONS.clock}Outside</span>`
                        : "";

            return `<li class="qa-sale${animateNew && i === 0 ? " is-new" : ""}" data-time="${sale.time}"><span class="qa-sale-time">${whenLabel(sale.time)}</span>${badge}<span class="qa-sale-amount">${money(sale.amount)}</span><button type="button" class="delete" title="Remove this sale" aria-label="Remove ${money(sale.amount)} sale">${ICONS.x}</button></li>`;

        }).join("");
    }

    // Removing a sale does exactly what the Sales page's delete button does.
    function removeSale(time, row) {

        const model = currentModel();

        if (!model) {
            return;
        }

        const dateKey = getDateKey();
        const sales = data.sales[dateKey] || [];

        const index = sales.findIndex(function (sale) {
            return sale.time === time && sale.modelId === model.id;
        });

        if (index === -1) {
            renderRecent(false);
            return;
        }

        const removed = sales.splice(index, 1)[0];

        updateHistory();

        saveData();

        pushSaleRemoved(dateKey, removed);

        toast(`${money(removed.amount)} sale removed`, "delete");

        preserveScroll(() => renderSales({ patchBreakdown: true }));

        salesNeedsRefit = true;

        updateSummary();

        if (row && !reduceMotion()) {

            row.classList.add("is-out");

            setTimeout(function () {
                renderRecent(false);
            }, 200);

        } else {
            renderRecent(false);
        }
    }

    recentList.addEventListener("click", function (event) {

        const btn = event.target.closest(".delete");
        const row = btn ? btn.closest(".qa-sale") : null;

        if (!btn || !row || row.classList.contains("is-out")) {
            return;
        }

        removeSale(Number(row.dataset.time), row);
    });


    /* ---------- Username tag: the Sales page's popover, same rules ---------- */

    function setTagOpen(open) {
        tagDrawer.classList.toggle("hidden", !open);
        tagBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function syncTagButton() {

        const armed = Boolean(armedUsername);

        tagBtn.classList.toggle("active", armed);
        tagBtn.classList.toggle("armed-outside", armed && armedUsernameType === "outside");
        tagBtn.setAttribute("aria-pressed", armed ? "true" : "false");

        tagBtn.title = tagBtn.disabled
            ? "Select a model to tag a username"
            : armed
                ? `${usernameTypeLabel(armedUsernameType)} \u2014 ${armedUsername} (next sale \u2014 click to change)`
                : "Tag the next sale with a username";
    }

    function syncTagClear() {
        tagWrap.classList.toggle("has-value", !!tagField.value);
    }

    // The popover always shows the tag that is currently armed (shared
    // with the Sales page), and starts closed.
    function syncTagUI() {
        setUsernameTypeUI(armedUsernameType || "tip");
        tagField.value = armedUsername || "";
        syncTagClear();
        setTagOpen(false);
        syncTagButton();
    }

    // "Set": arm the typed username for the next sale, close the popover
    // and drop straight into the amount box (same as the Sales page).
    function commitTag() {

        const username = tagField.value.trim();
        const hadTag = Boolean(armedUsername);

        setArmedUsername(username, armedUsernameType);
        setTagOpen(false);
        syncTagButton();

        if (username) {
            toast(
                `${usernameTypeLabel(armedUsernameType)} tag set: ${username}`,
                "success"
            );
        } else if (hadTag) {
            toast("Username tag removed.");
        }

        if (!amountInput.disabled) {
            amountInput.focus({ preventScroll: true });
        }
    }

    tagBtn.addEventListener("click", function () {

        const opening = tagDrawer.classList.contains("hidden");

        if (opening) {
            setUsernameTypeUI(armedUsernameType);
            tagField.value = armedUsername || "";
            syncTagClear();
        }

        setTagOpen(opening);

        if (opening) {
            tagField.focus({ preventScroll: true });
        }
    });

    segBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
            setUsernameTypeUI(btn.dataset.usernameType);
            tagField.focus({ preventScroll: true });
        });
    });

    tagField.addEventListener("input", syncTagClear);

    tagField.addEventListener("keydown", function (event) {
        // Enter means "Set", exactly like submitting the Sales page popover.
        if (event.key === "Enter") {
            event.preventDefault();
            commitTag();
        }
    });

    tagSet.addEventListener("click", commitTag);

    tagClear.addEventListener("click", function () {
        tagField.value = "";
        syncTagClear();
        tagField.focus({ preventScroll: true });
    });

    // Click anywhere else in the window and the popover closes.
    document.addEventListener("click", function (event) {

        if (tagDrawer.classList.contains("hidden")) {
            return;
        }

        if (event.target.closest("#quickAddPanel .outside-shift-picker")) {
            return;
        }

        setTagOpen(false);
    });


    /* ---------- Add the sale ---------- */

    form.addEventListener("submit", function (event) {

        event.preventDefault();

        const model = currentModel();

        if (!model) {
            toast("Select a model first.");
            return;
        }

        const amount = Number(amountInput.value);

        if (!amount || amount <= 0) {
            amountInput.focus({ preventScroll: true });
            return;
        }

        if (amount > 200) {

            toast(
                "The maximum amount for a single sale is $200.",
                "error"
            );

            return;
        }

        const dateKey = getDateKey();

        if (!data.sales[dateKey]) {
            data.sales[dateKey] = [];
        }

        const sale = {
            amount: amount,
            time: Date.now(),
            modelId: model.id
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

        amountInput.value = "";

        // The tag is for exactly one sale.
        setArmedUsername(null);
        syncTagUI();

        playKaching();

        updateHistory();

        // Only the numbers changed, so patch the model rows in place.
        preserveScroll(() => renderSales({ patchBreakdown: true }));

        toast("Sale added for " + model.title, "success");

        // The Sales page was hidden while this happened: have it re-fit
        // its model names the next time it is shown.
        salesNeedsRefit = true;

        updateSummary();
        renderRecent(true);

        submitBtn.classList.add("done");
        clearTimeout(doneTimer);
        doneTimer = setTimeout(function () {
            submitBtn.classList.remove("done");
        }, 1000);

        // Ready for the next amount (phones keep the keyboard as it is).
        if (!isTouch()) {
            amountInput.focus({ preventScroll: true });
        }

        requestAnimationFrame(function () {
            setTimeout(function () {
                saveData();
                pushSaleAdded(dateKey, sale);
            }, 0);
        });
    });


    /* ---------- Movable button: drag anywhere, stays where you drop it ---------- */

    const FAB_SIZE = 52;
    const POS_KEY = "chatterTool_quickAddPos";
    const PHONE_QUERY = "(max-width: 700px)";

    // Where the button is, remembered as pixel distances from the nearest
    // side and the nearest top/bottom edge (h: "l" or "r", v: "t" or "b").
    // Screen resizes (phone address bar, rotating, window resizing) never
    // change this; the button only gets nudged on screen if it would
    // otherwise fall off. Default = bottom-right corner.
    let place = { h: "r", dx: 0, v: "b", dy: 0 };
    let legacy = null;
    let localPlaced = false;
    let cur = { x: 0, y: 0 };
    let drag = null;
    let suppressClick = false;

    try {

        const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");

        if (saved) {
            localPlaced = true;
        }

        if (saved && saved.h && saved.v &&
            typeof saved.dx === "number" && typeof saved.dy === "number") {

            place = {
                h: saved.h === "l" ? "l" : "r",
                dx: Math.max(0, saved.dx),
                v: saved.v === "t" ? "t" : "b",
                dy: Math.max(0, saved.dy)
            };

        } else if (saved && typeof saved.y === "number") {

            // Older saves: fractions (or a left/right edge). Converted to
            // the new format right after metrics() exists.
            legacy = {
                x: typeof saved.x === "number" ? saved.x : (saved.edge === "left" ? 0 : 1),
                y: saved.y
            };
        }

    } catch (err) {}

    // The account's synced position (if any) wins over this device's copy.
    if (typeof data !== "undefined" && data && data.quickAddPos) {
        place = Object.assign({}, data.quickAddPos);
        legacy = null;
    }

    // Reads the phone's notch / home-bar insets as real pixels.
    const probe = document.createElement("div");

    probe.style.cssText =
        "position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;" +
        "padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)";

    document.body.appendChild(probe);

    function metrics() {

        const vw = document.documentElement.clientWidth || window.innerWidth;
        const vh = window.innerHeight;
        const cs = getComputedStyle(probe);
        const safeT = parseFloat(cs.paddingTop) || 0;
        const safeB = parseFloat(cs.paddingBottom) || 0;
        const phone = window.matchMedia(PHONE_QUERY).matches;
        const m = phone ? 16 : 24;

        const minY = m + safeT;
        const maxY = Math.max(minY, vh - FAB_SIZE - m - safeB - (phone ? 64 : 0));

        return {
            vw: vw,
            vh: vh,
            phone: phone,
            m: m,
            minX: m,
            maxX: Math.max(m, vw - FAB_SIZE - m),
            minY: minY,
            maxY: maxY
        };
    }

    function clamp(n, lo, hi) {
        return Math.min(hi, Math.max(lo, n));
    }

    function applyPosition() {

        const k = metrics();

        if (legacy) {

            const fx = clamp(legacy.x, 0, 1);
            const fy = clamp(legacy.y, 0, 1);
            const lx = fx * (k.maxX - k.minX);
            const ly = fy * (k.maxY - k.minY);

            place = {
                h: fx < 0.5 ? "l" : "r",
                dx: fx < 0.5 ? lx : (k.maxX - k.minX) - lx,
                v: fy < 0.5 ? "t" : "b",
                dy: fy < 0.5 ? ly : (k.maxY - k.minY) - ly
            };

            legacy = null;
            savePosition(false);
        }

        const x = place.h === "l" ? k.minX + place.dx : k.maxX - place.dx;
        const y = place.v === "t" ? k.minY + place.dy : k.maxY - place.dy;

        // Clamped only for display; the saved spot is left untouched so it
        // returns to exactly where you left it when there's room again.
        cur = {
            x: clamp(x, k.minX, k.maxX),
            y: clamp(y, k.minY, k.maxY)
        };

        fab.style.translate = "";   // clears a drag offset (see pointermove)
        fab.style.left = cur.x + "px";
        fab.style.top = cur.y + "px";
        fab.style.right = "auto";
        fab.style.bottom = "auto";
    }

    // Puts the popover next to the button: above it when the button is in
    // the lower half of the screen, below it otherwise. Phones use the
    // bottom sheet from the stylesheet instead.
    function placePanel() {

        const k = metrics();

        if (k.phone) {

            ["left", "right", "top", "bottom", "maxHeight", "transformOrigin"].forEach(function (prop) {
                panel.style[prop] = "";
            });

            panel.style.removeProperty("--qa-shift");
            return;
        }

        const gap = 10;
        const width = panel.offsetWidth || 352;
        const fromLeft = cur.x + FAB_SIZE / 2 < k.vw / 2;

        const left = clamp(
            fromLeft ? cur.x : cur.x + FAB_SIZE - width,
            k.m,
            Math.max(k.m, k.vw - width - k.m)
        );

        const above = cur.y + FAB_SIZE / 2 > k.vh / 2;

        panel.style.left = left + "px";
        panel.style.right = "auto";

        if (above) {

            panel.style.top = "auto";
            panel.style.bottom = (k.vh - cur.y + gap) + "px";
            panel.style.maxHeight = clamp(cur.y - gap - k.m, 220, 640) + "px";
            panel.style.transformOrigin = "bottom " + (fromLeft ? "left" : "right");
            panel.style.setProperty("--qa-shift", "10px");

        } else {

            panel.style.bottom = "auto";
            panel.style.top = (cur.y + FAB_SIZE + gap) + "px";
            panel.style.maxHeight = clamp(k.vh - cur.y - FAB_SIZE - gap - k.m, 220, 640) + "px";
            panel.style.transformOrigin = "top " + (fromLeft ? "left" : "right");
            panel.style.setProperty("--qa-shift", "-10px");
        }
    }

    // toCloud = false for quiet local-only saves (old-format conversion).
    function savePosition(toCloud) {

        try {
            localStorage.setItem(POS_KEY, JSON.stringify(place));
        } catch (err) {}

        localPlaced = true;

        if (toCloud !== false) {

            data.quickAddPos = Object.assign({}, place);
            saveData();
        }
    }

    // Another device moved the button (or this account's saved spot just
    // arrived): follow it. If the account has none yet but this device
    // does, share this device's spot with the account.
    function syncFromData() {

        if (drag) {
            return;
        }

        if (data && data.quickAddPos) {

            place = Object.assign({}, data.quickAddPos);
            legacy = null;

            try {
                localStorage.setItem(POS_KEY, JSON.stringify(place));
            } catch (err) {}

            localPlaced = true;
            applyPosition();

            if (isOpen) {
                placePanel();
            }

        } else if (localPlaced && !legacy) {

            data.quickAddPos = Object.assign({}, place);
            saveData();
        }
    }

    document.addEventListener("quickAddPosSync", syncFromData);

    // Sales changed outside this panel: keep its numbers live too.
    document.addEventListener("salesChanged", function () {
        updateSummary();
        renderRecent(false);
    });

    fab.addEventListener("pointerdown", function (event) {

        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }

        const rect = fab.getBoundingClientRect();

        drag = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offX: event.clientX - rect.left,
            offY: event.clientY - rect.top,
            moved: false
        };

        try {
            fab.setPointerCapture(event.pointerId);
        } catch (err) {}
    });

    fab.addEventListener("pointermove", function (event) {

        if (!drag || event.pointerId !== drag.id) {
            return;
        }

        if (!drag.moved) {

            // A small wobble while tapping is still a tap.
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) {
                return;
            }

            drag.moved = true;

            fab.classList.add("dragging");

            if (isOpen) {
                closePanel(false);
            }
        }

        const k = metrics();

        // Moved with the `translate` property (compositor-friendly, no
        // layout per pointer move) relative to the committed spot (`cur`).
        // left/top are only written once, when the drag ends. `translate`
        // is separate from `transform`, so the hover / drag scale is intact.
        drag.x = clamp(event.clientX - drag.offX, k.minX, k.maxX);
        drag.y = clamp(event.clientY - drag.offY, k.minY, k.maxY);

        fab.style.translate = (drag.x - cur.x) + "px " + (drag.y - cur.y) + "px";
    });

    function endDrag(event) {

        if (!drag || event.pointerId !== drag.id) {
            return;
        }

        const moved = drag.moved;
        const dropX = drag.x;
        const dropY = drag.y;

        drag = null;

        try {
            fab.releasePointerCapture(event.pointerId);
        } catch (err) {}

        if (!moved) {
            return;
        }

        // The browser still sends a click after a drag: ignore that one.
        suppressClick = true;

        setTimeout(function () {
            suppressClick = false;
        }, 60);

        // Where it was dropped (tracked exactly, instead of reading the
        // rect, which includes the drag scale and so was a few px off).
        const k = metrics();

        const toLeft = Math.max(0, dropX - k.minX);
        const toRight = Math.max(0, k.maxX - dropX);
        const toTop = Math.max(0, dropY - k.minY);
        const toBottom = Math.max(0, k.maxY - dropY);

        place = {
            h: toLeft <= toRight ? "l" : "r",
            dx: Math.min(toLeft, toRight),
            v: toTop <= toBottom ? "t" : "b",
            dy: Math.min(toTop, toBottom)
        };

        savePosition();

        fab.classList.remove("dragging");

        applyPosition();
    }

    fab.addEventListener("pointerup", endDrag);
    fab.addEventListener("pointercancel", endDrag);

    window.addEventListener("resize", function () {

        applyPosition();

        if (isOpen) {
            placePanel();
        }
    });

    applyPosition();


    /* ---------- Open / close ---------- */

    function openPanel() {

        // Wake the sound output now, while you pick a model and type
        // the amount, so the sale's kaching isn't the one that gets lost.
        primeKaching();

        if (isOpen) {
            return;
        }

        isOpen = true;

        // The model is whatever is selected on the Sales page (or
        // nothing), exactly like the Sales page itself.
        renderChips();
        syncControls();
        syncTagUI();

        placePanel();
        renderRecent(false);

        clearInterval(recentTimer);
        recentTimer = setInterval(function () {
            renderRecent(false);
        }, 15000);

        panel.classList.add("open");
        backdrop.classList.add("open");
        fab.classList.add("open");
        fab.setAttribute("aria-expanded", "true");

        requestAnimationFrame(function () {

            if (!amountInput.disabled) {
                amountInput.focus({ preventScroll: true });
                return;
            }

            const first = modelsBox.querySelector(".qa-chip");

            if (first) {
                first.focus({ preventScroll: true });
            }
        });
    }

    function closePanel(restoreFocus) {

        if (!isOpen) {
            return;
        }

        isOpen = false;

        setTagOpen(false);

        clearInterval(recentTimer);

        panel.classList.remove("open");
        backdrop.classList.remove("open");
        fab.classList.remove("open");
        fab.setAttribute("aria-expanded", "false");

        if (restoreFocus) {
            fab.focus({ preventScroll: true });
        }
    }

    fab.addEventListener("click", function () {

        if (suppressClick) {
            suppressClick = false;
            return;
        }

        if (isOpen) {
            closePanel(true);
        } else {
            openPanel();
        }
    });

    closeBtn.addEventListener("click", function () {
        closePanel(true);
    });

    backdrop.addEventListener("click", function () {
        closePanel(false);
    });

    document.addEventListener("keydown", function (event) {

        if (isOpen && event.key === "Escape") {
            closePanel(true);
        }
    });


    /* ---------- Only on tabs other than Sales ---------- */

    function refitSalesPage() {

        try {
            fitTargetBreakdownTitles();
        } catch (err) {}

        try {
            fitTodaySalesName();
        } catch (err) {}
    }

    function syncVisibility() {

        const onSales =
            !!salesPage &&
            salesPage.classList.contains("active") &&
            !salesPage.classList.contains("leaving");

        const signedOut =
            !!authGate && !authGate.classList.contains("hidden");

        const show = !onSales && !signedOut && isQuickAddEnabled();

        fab.classList.toggle("is-hidden", !show);

        if (!show && isOpen) {
            closePanel(false);
        }

        if (onSales && salesNeedsRefit) {
            salesNeedsRefit = false;
            setTimeout(refitSalesPage, 80);
        }
    }

    const watcher = new MutationObserver(syncVisibility);

    document.addEventListener("quickAddVisibilitySync", syncVisibility);

    if (salesPage) {
        watcher.observe(salesPage, { attributes: true, attributeFilter: ["class"] });
    }

    if (authGate) {
        watcher.observe(authGate, { attributes: true, attributeFilter: ["class"] });
    }

    syncVisibility();


    /* ---------- Phones: keep the sheet above the on-screen keyboard ---------- */

    if (window.visualViewport) {

        const vv = window.visualViewport;

        const placeAboveKeyboard = function () {

            const covered = Math.max(
                0,
                window.innerHeight - vv.height - vv.offsetTop
            );

            panel.style.setProperty("--qa-kb", covered + "px");
        };

        vv.addEventListener("resize", placeAboveKeyboard);
        vv.addEventListener("scroll", placeAboveKeyboard);
    }

})();


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

    // Where the list was scrolled when the button was pressed, so the
    // rebuild afterwards can restore it.
    const listScrollBefore =
        $("#salesList").scrollTop;


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
        notifySalesChanged();
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
            preserveScroll(() => renderSales({
                patchBreakdown: true,
                listScroll: listScrollBefore
            }));
        }, 220);

        return;
    }

    preserveScroll(() => renderSales({
        patchBreakdown: true,
        listScroll: listScrollBefore
    }));
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


// History redraws on every sales change (including ones that arrive
// from another device). Redrawing used to collapse whichever day was
// open; this keeps it open so the list updates live in place.
function renderHistory() {

    const reopenKey = expandedHistoryDate;

    // A redraw (a sale arriving from another device, etc.) rebuilds
    // the open day's sales list; keep it where it was scrolled.
    const openList = reopenKey
        ? document.querySelector(
            `[data-breakdown="${reopenKey}"] .history-detail-sales-list`
        )
        : null;
    const openListPos = openList ? openList.scrollTop : null;

    renderHistoryList();

    if (
        reopenKey &&
        !$("#historyModal").classList.contains("hidden") &&
        $(`[data-breakdown="${reopenKey}"]`)
    ) {
        expandHistoryRow(reopenKey);

        const list = document.querySelector(
            `[data-breakdown="${reopenKey}"] .history-detail-sales-list`
        );

        if (list && openListPos !== null) {
            list.scrollTop = openListPos;
        }
    }
}


function renderHistoryList() {

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

                    <span class="history-sale-amount">
                        ${money(sale.amount)}
                    </span>

                    <span class="history-sale-user">
                        ${sale.buyerUsername ? escapeHTML(sale.buyerUsername) : ""}
                    </span>

                    <span class="history-sale-tag">
                        ${
                            sale.tip
                                ? `<span class="sale-tag-badge tip" title="Tip${sale.buyerUsername ? " — " + escapeHTML(sale.buyerUsername) : ""}">${ICONS.heart}Tip</span>`
                                : sale.outsideShift
                                    ? `<span class="sale-tag-badge outside" title="Outside shift${sale.buyerUsername ? " — " + escapeHTML(sale.buyerUsername) : ""}">${ICONS.clock}Outside</span>`
                                    : ""
                        }
                    </span>

                    <span class="sale-net">
                        ${money(sale.net)} net
                    </span>

                    <button
                        type="button"
                        class="delete history-sale-delete"
                        data-time="${sale.time}"
                        title="Remove sale"
                        aria-label="Remove sale"
                    >
                        ${ICONS.x}
                    </button>

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


// Returns true when the text made it to the clipboard. Success is
// silent now (callers flash their own button instead — see
// flashCopySwap); a failed copy still toasts, since there's nothing
// else on screen to tell the person it didn't work.
async function copyLogoutText(dateKey, shift, scope) {

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

    if (!copied) {
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

    if (row && !holdHistoryScroll) {
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

// When a date is opened (clicked, or picked from the trend bars) its
// sales list starts scrolled all the way down, at the latest sale.
// Called right after the breakdown is un-hidden so it has a height.
function scrollHistorySalesToBottom(breakdown) {

    const list = breakdown &&
        breakdown.querySelector(".history-detail-sales-list");

    if (!list) {
        return;
    }

    const toBottom = () => {
        list.scrollTop = list.scrollHeight;
    };

    toBottom();
    requestAnimationFrame(toBottom);
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


// Removing a saved sale from inside History. The sale is taken out of
// the day's list (and synced like any other removal), and its time is
// dropped from the saved shift that settled it, so the shift row,
// totals and target % all update. A shift left with no sales
// disappears from History.
function removeHistorySale(rowKey, time) {

    const meta = historyRowMeta[rowKey];

    if (!meta || currentModelFilter === null) {
        return;
    }

    const dateKey = meta.dateKey;
    const modelId = currentModelFilter;
    const sales = data.sales[dateKey] || [];

    const index = sales.findIndex(
        sale => sale.time === time && sale.modelId === modelId
    );

    if (index === -1) {
        return;
    }

    const removed = sales.splice(index, 1)[0];

    // Take the sale out of whichever saved shift covered it.
    const byModel = (data.closedShifts || {})[dateKey];

    if (byModel && Array.isArray(byModel[modelId])) {

        byModel[modelId].forEach(record => {
            record.times = (record.times || []).filter(t => t !== time);
        });

        byModel[modelId] = byModel[modelId].filter(
            record => record.times.length > 0
        );
    }

    // Keep the day's combined history record in step (updateHistory()
    // only ever refreshes today's).
    const existing = data.history.findIndex(item => item.date === dateKey);

    if (existing !== -1) {

        if (!sales.length) {

            data.history.splice(existing, 1);

        } else {

            const rec = data.history[existing];
            const gross = getTotal(sales);
            const net = gross * NET_RATE;

            rec.gross = gross;
            rec.net = net;
            rec.count = sales.length;
            rec.targetPercent = getTargetPercent(net, rec.target);
        }
    }

    updateHistory();

    saveData();

    pushSaleRemoved(dateKey, removed);

    toast(`${money(removed.amount)} sale removed`, "delete");

    // renderSales() redraws History, which keeps the same day open
    // (and drops it if removing that sale emptied it).
    // The History list is its own scroller (#historyList). Rebuilding
    // it resets its scrollTop, so pin it back to where it was. The
    // browser clamps the value if the list got shorter.
    const historyScroller = $("#historyList");
    const historyScrollPos = historyScroller.scrollTop;

    // The day's sales list (max-height, scrolls on its own) is rebuilt
    // too, so remember its scroll as well and re-find it afterwards.
    const salesListSelector =
        `[data-breakdown="${rowKey}"] .history-detail-sales-list`;
    const salesListEl = document.querySelector(salesListSelector);
    const salesListPos = salesListEl ? salesListEl.scrollTop : 0;

    holdHistoryScroll = true;

    preserveScroll(() => renderSales({ patchBreakdown: true }));

    const restoreHistoryScroll = () => {
        historyScroller.scrollTop = historyScrollPos;

        const list = document.querySelector(salesListSelector);

        if (list) {
            list.scrollTop = salesListPos;
        }
    };

    restoreHistoryScroll();

    requestAnimationFrame(() => {
        restoreHistoryScroll();
        requestAnimationFrame(() => {
            restoreHistoryScroll();
            holdHistoryScroll = false;
        });
    });

    notifySalesChanged();
}


// Two taps to remove: the first arms the button (it turns red and
// shows a bin), the second removes. It disarms itself after 3 seconds.
$("#historyList").addEventListener(
    "click",
    event => {

        const btn = event.target.closest(".history-sale-delete");

        if (!btn) {
            return;
        }

        event.stopPropagation();

        if (!btn.classList.contains("confirm")) {

            btn.classList.add("confirm");
            btn.innerHTML = ICONS.trash;
            btn.title = "Click again to remove";
            btn.setAttribute("aria-label", "Click again to remove this sale");

            clearTimeout(btn._disarmTimer);

            btn._disarmTimer = setTimeout(() => {
                btn.classList.remove("confirm");
                btn.innerHTML = ICONS.x;
                btn.title = "Remove sale";
                btn.setAttribute("aria-label", "Remove sale");
            }, 3000);

            return;
        }

        clearTimeout(btn._disarmTimer);

        const holder = btn.closest("[data-breakdown]");

        if (!holder) {
            return;
        }

        removeHistorySale(
            holder.dataset.breakdown,
            Number(btn.dataset.time)
        );
    }
);


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
        scrollHistorySalesToBottom(breakdown);

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

    // "nearest" was leaving the row pinned to the very bottom edge of
    // the modal whenever the list already roughly filled the visible
    // area (nothing left above to scroll past) — the row itself
    // counted as "in view" even though the breakdown that just
    // expanded below it was cut off by the modal's footer. Aligning
    // to the top of the modal instead guarantees the row AND its
    // breakdown have room to show underneath.
    rows[0].scrollIntoView({ block: "start" });
    rows[0].focus({ preventScroll: true });
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

        // A day with several shifts opened together (from the Overview
        // bars) has no single "current" shift, so no logout button.
        // Clicking one of those open shifts should pick it: keep it
        // open, minimize the day's other shifts, and bring the button
        // up for it — rather than closing everything.
        const calendarDate = row.dataset.calendarDate;

        const siblingRows =
            calendarDate
                ? Array.from(
                    document.querySelectorAll(
                        `.history-row[data-calendar-date="${calendarDate}"]`
                    )
                ).filter(other => other !== row)
                : [];

        const dayOpenedTogether =
            !isHidden &&
            expandedHistoryDate === null &&
            siblingRows.some(other => {

                const otherBreakdown =
                    $(`[data-breakdown="${other.dataset.date}"]`);

                return otherBreakdown &&
                    !otherBreakdown.classList.contains("hidden") &&
                    !otherBreakdown.classList.contains("fx-closing");
            });

        if (dayOpenedTogether) {

            siblingRows.forEach(other => {

                const otherBreakdown =
                    $(`[data-breakdown="${other.dataset.date}"]`);

                if (otherBreakdown) {
                    hideHistoryBreakdown(otherBreakdown);
                }
            });

            expandedHistoryDate = dateKey;
            updateCopyLogoutButton();

            // Shifts above the clicked one collapsing would push it up
            // the screen. Don't scroll to it — just hold it exactly
            // where it was clicked while the others fold away.
            let scroller = row.parentElement;

            while (scroller && scroller !== document.body) {

                const overflowY =
                    getComputedStyle(scroller).overflowY;

                if (
                    (overflowY === "auto" || overflowY === "scroll") &&
                    scroller.scrollHeight > scroller.clientHeight
                ) {
                    break;
                }

                scroller = scroller.parentElement;
            }

            if (!scroller || scroller === document.body) {
                scroller = document.scrollingElement;
            }

            const topBefore = row.getBoundingClientRect().top;
            const holdUntil = performance.now() + HISTORY_BREAKDOWN_OUT_MS + 80;

            (function holdPosition() {

                const drift =
                    row.getBoundingClientRect().top - topBefore;

                if (drift) {
                    scroller.scrollTop += drift;
                }

                if (performance.now() < holdUntil) {
                    requestAnimationFrame(holdPosition);
                }
            })();

            return;
        }

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
            scrollHistorySalesToBottom(breakdown);
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


// Shows the whole shape of the logout text, not just the title — the
// rest of it (model, shift, totals) is stand-in placeholders since
// this is Settings, not an actual shift.
function renderLogoutTitlePreview() {

    const title = cleanLogoutTitle($("#logoutTitleInput").value) ||
        DEFAULT_LOGOUT_TITLE;

    $("#logoutTitlePreview").textContent =
        `${title}\n\n` +
        `[MODEL NAME] -\n\n` +
        `Shift Time: [SHIFT TIME]\n` +
        `Date: [DATE]\n` +
        `Subscriptions - $\n` +
        `MM Sales - $\n` +
        `Tips + Messages - $0.00 net`;
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

// The picker is shared by every field that has an .emoji-toggle next
// to it (logout title, category name, ...). Whichever field's toggle
// was last clicked is "active" — that's where emoji taps land and
// whose button the popover is positioned against.
let activeEmojiField = null;


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


// Puts the popover just under the active field's emoji button (right
// edges lined up), or above it when there isn't room below.
function positionEmojiPicker() {

    if (!activeEmojiField) {
        return;
    }

    const picker = $("#emojiPicker");
    const toggle = activeEmojiField.toggle.getBoundingClientRect();

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

    $$(".emoji-toggle").forEach(btn =>
        btn.setAttribute("aria-expanded", "false")
    );

    if (open && activeEmojiField) {
        activeEmojiField.toggle.setAttribute("aria-expanded", "true");
        positionEmojiPicker();
    }
}


function isEmojiPickerOpen() {
    return !$("#emojiPicker").classList.contains("hidden");
}


// Wires up one text input + its .emoji-toggle button to the shared
// picker. maxLength caps the field (graphemes, matching what's
// already enforced elsewhere for it); onInsert runs after every emoji
// drop (e.g. to refresh a live preview or re-validate the field).
// The field's own cursor position is remembered on every keystroke/
// click/blur, because some browsers reset it once the input loses
// focus (e.g. after tapping the picker).
function bindEmojiField(input, toggle, options) {

    options = options || {};

    const field = {
        input,
        toggle,
        maxLength: options.maxLength || Infinity,
        onInsert: options.onInsert || function () {},
        caret: { start: input.value.length, end: input.value.length }
    };

    field.remember = function () {
        field.caret = {
            start: input.selectionStart ?? input.value.length,
            end: input.selectionEnd ?? input.value.length
        };
    };

    ["input", "keyup", "click", "blur"].forEach(type =>
        input.addEventListener(type, field.remember)
    );

    toggle.addEventListener("click", function () {

        if (activeEmojiField === field && isEmojiPickerOpen()) {
            setEmojiPickerOpen(false);
            return;
        }

        activeEmojiField = field;
        setEmojiPickerOpen(true);
    });

    return field;
}


// Drops an emoji into whichever field is active, at its remembered
// cursor (or over its selection), unless that would push it past its
// length limit.
function insertActiveEmoji(emoji) {

    if (!activeEmojiField) {
        return;
    }

    const { input, maxLength, caret, onInsert } = activeEmojiField;

    const next =
        input.value.slice(0, caret.start) + emoji + input.value.slice(caret.end);

    if (splitGraphemes(next).length > maxLength) {
        return;
    }

    input.value = next;

    const pos = caret.start + emoji.length;

    activeEmojiField.caret = { start: pos, end: pos };

    input.setSelectionRange(pos, pos);

    onInsert();
}


buildEmojiPicker();

const logoutEmojiField = bindEmojiField(
    $("#logoutTitleInput"),
    $("#logoutEmojiToggle"),
    { maxLength: LOGOUT_TITLE_MAX, onInsert: renderLogoutTitlePreview }
);

bindEmojiField(
    $("#categoryName"),
    $("#categoryEmojiToggle"),
    { maxLength: CATEGORY_NAME_MAX, onInsert: () => $("#categoryName").dispatchEvent(new Event("input")) }
);

// Tapping anywhere else in the window closes the popover.
document.addEventListener("pointerdown", function (event) {

    if (
        isEmojiPickerOpen() &&
        !event.target.closest("#emojiPicker") &&
        !event.target.closest(".emoji-toggle")
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

// Any scrollable ancestor (a modal card, mainly) moving the active
// field's button re-anchors the popover. Capture-phase because scroll
// events don't bubble.
document.addEventListener("scroll", function () {

    if (isEmojiPickerOpen()) {
        positionEmojiPicker();
    }

}, true);

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
        insertActiveEmoji(btn.dataset.emoji);
    }
});


function openLogoutTitleModal() {

    // Close whichever settings popover the click came from.
    $$(".profile-group.open, .mobile-settings-group.open")
        .forEach(group => group.classList.remove("open"));

    $("#logoutTitleInput").value = data.logoutTitle || "";

    setEmojiPickerOpen(false);

    logoutEmojiField.caret = {
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

// Clearing the field entirely and saving is how you reset to the
// default — there's no separate "Reset" button. cleanLogoutTitle("")
// yields "", and the submit handler below already treats a blank (or
// default-matching) title as "use the default".

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
        copyLogoutText(dateKey, draft, "live").then(
            function (copied) {
                if (copied) {
                    flashCopySwap($("#copyShiftLogoutBtn"));
                }
            }
        );
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
        "live"
    );

    if (!copied) {
        // Nothing was copied, so nothing is saved or cleared.
        $("#confirmShiftSave").disabled = false;
        return;
    }

    if (times.length) {
        saveShiftToHistory(pending, times);
    }

    toast("Copied for logout", "success");

    closeShiftSaveConfirm();

    closeShiftModal();
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


const closeShiftSaveModalBtn = $("#closeShiftSaveModal");
if (closeShiftSaveModalBtn) {
    closeShiftSaveModalBtn.addEventListener(
        "click",
        closeShiftSaveConfirm
    );
}


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
    async function () {

        if (!expandedHistoryDate) {
            return;
        }

        const meta = historyRowMeta[expandedHistoryDate];

        const copied =
            meta
                ? await copyLogoutText(meta.dateKey, meta.shift, meta.times)
                : await copyLogoutText(expandedHistoryDate);

        if (copied) {
            flashCopySwap($("#copyLogoutBtn"));
        }

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

        notifySalesChanged();

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

                    notifySalesChanged();

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
                    $("#settingsBtn") && $("#settingsBtn").closest(".profile-group");

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
                        { top: top, behavior: reduceMotion() ? "auto" : "smooth" }
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

const ICON_CHECK = ICONS.check;

const ICON_COPY = ICONS.copy;

const ICON_OPEN = ICONS.open;


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


    // No "All" chip: with nothing selected the list shows everything.
    $("#" + type + "Chips").innerHTML =
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


/* =====================================================
   MODEL CARD (Models tab)
   Models get their own roster layout: photo first, then
   name, daily target and month-to-date target progress. The wrapper
   keeps the same classes/attributes as every other content
   card, so drag-to-reorder, long-press select and the open /
   edit buttons all keep working unchanged.
   ===================================================== */

function formatModelTarget(target) {

    const n = Number(target) || 0;

    if (n <= 0) {
        return "";
    }

    return Number.isInteger(n) ? moneyShort(n) : money(n);
}


/* Month-to-date figures for a model card. The monthly target is the
   daily target x the days in this month (same rule the Monthly trend
   uses), and progress is net earnings, like every other target.
   Also returns the last 7 days (oldest first, today last) and the
   month-end pace: net so far / days gone x days in the month, compared
   with where the target says she should be by today. */
function getModelMonthStats(modelId) {

    const today = getDateKey();
    const monthKey = getPeriodKey(today, "month");
    const monthDays = daysInMonthKey(monthKey);
    const dayOfMonth = Number(today.slice(8, 10));
    const dailyTarget = Number(data.modelTargets && data.modelTargets[modelId]) || 0;
    const target = dailyTarget * monthDays;

    const netByDate = {};
    let monthNet = 0;

    computeModelDailyRows(modelId, false).forEach(row => {

        netByDate[row.date] = (netByDate[row.date] || 0) + row.net;

        if (row.date.slice(0, 7) === monthKey) {
            monthNet += row.net;
        }
    });

    const week = [];

    for (let i = 6; i >= 0; i--) {
        const key = addPeriod(today, "day", -i);
        week.push({ key, net: netByDate[key] || 0, isToday: i === 0 });
    }

    const weekNet = week.reduce((sum, day) => sum + day.net, 0);

    // A pace from the first day or two is mostly noise, so wait for day 3.
    let projected = null;
    let paceDelta = null;
    let expectedNet = null;

    if (monthNet > 0 && dayOfMonth >= 3) {
        projected = (monthNet / dayOfMonth) * monthDays;
    }

    if (target > 0) {
        expectedNet = target * (dayOfMonth / monthDays);
        paceDelta = monthNet - expectedNet;
    }

    return {
        monthNet,
        todayNet: netByDate[today] || 0,
        target,
        dailyTarget,
        percent: target > 0 ? Math.round((monthNet / target) * 100) : null,
        dayOfMonth,
        monthDays,
        projected,
        paceDelta,
        expectedNet,
        week,
        weekNet
    };
}


// "On pace for $8,400" plus, when there is a target, how far ahead of or
// behind the target pace she is. Always one row, so cards line up.
function renderModelPace(stats) {

    if (stats.monthNet <= 0) {
        return `<div class="mc-pace is-idle"><span>No sales yet</span></div>`;
    }

    if (stats.projected === null) {
        return `<div class="mc-pace is-idle"><span>Pace from day 3</span></div>`;
    }

    let chip = "";

    if (stats.paceDelta !== null) {

        const gap = Math.round(Math.abs(stats.paceDelta));

        if (gap < 1) {
            chip = `<span class="mc-pace-chip is-ahead" title="Right on target pace">On target</span>`;
        } else if (stats.paceDelta > 0) {
            chip = `<span class="mc-pace-chip is-ahead" title="Ahead of target pace by ${moneyShort(gap)}"><span class="mc-long">${moneyShort(gap)} ahead</span><span class="mc-short">+${moneyShort(gap)}</span></span>`;
        } else {
            chip = `<span class="mc-pace-chip is-behind" title="Behind target pace by ${moneyShort(gap)}"><span class="mc-long">${moneyShort(gap)} behind</span><span class="mc-short">\u2212${moneyShort(gap)}</span></span>`;
        }
    }

    // With a target the pill is the useful part, so show only it (the
    // projected total stays in the hover title). Without a target there is
    // no pill, so fall back to the "Pace $X" text.
    const projTitle = `Projected month-end total: ${moneyShort(stats.projected)}, from this month's average per day so far`;

    if (chip) {
        return `
        <div class="mc-pace is-chip-only" title="${projTitle}">
            <span class="mc-pace-text">Pace</span>
            ${chip}
        </div>`;
    }

    return `
        <div class="mc-pace" title="${projTitle}">
            <span class="mc-pace-text">Pace <strong>${moneyShort(stats.projected)}</strong></span>
        </div>`;
}


function renderModelMonthBlock(stats) {

    const monthName = new Date().toLocaleDateString(undefined, { month: "short" });

    if (stats.percent === null) {
        return `
            <div class="mc-month is-none">
                <div class="mc-month-head">
                    <span class="mc-month-label">${monthName}</span>
                    <span class="mc-month-pct">${money(stats.monthNet)}</span>
                </div>
                ${renderModelPace(stats)}
            </div>`;
    }

    const fill = Math.max(0, Math.min(100, stats.percent));
    const expected = Math.max(0, Math.min(100, (stats.dayOfMonth / stats.monthDays) * 100));

    return `
        <div class="mc-month${stats.percent >= 100 ? " is-hit" : ""}">
            <div class="mc-month-head">
                <span class="mc-month-label">${monthName} target</span>
                <span class="mc-month-pct">${stats.percent}%</span>
            </div>
            <div class="mc-month-bar" role="progressbar"
                 aria-label="${monthName} target progress"
                 aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fill}">
                <span style="width: ${fill}%"></span>
                <i class="mc-month-tick" style="left: ${expected.toFixed(1)}%"
                   title="Target pace for today: ${money(stats.expectedNet)}"></i>
            </div>
            <div class="mc-month-meta">
                <span><strong>${moneyShort(stats.monthNet)}</strong> of ${moneyShort(stats.target)}</span>
            </div>
            ${renderModelPace(stats)}
        </div>`;
}


// Net per day for the last 7 days, in the model's own colour. The dashed
// line is her daily target, so a bar that reaches it hit the target.
// Today's bar is lighter because the day isn't finished.
function renderModelWeekBlock(stats) {

    const week = stats.week;
    const maxNet = Math.max.apply(null, week.map(day => day.net));
    const scale = Math.max(maxNet, stats.dailyTarget) || 1;

    const longDay = key => new Date(key + "T00:00:00")
        .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

    const narrowDay = key => new Date(key + "T00:00:00")
        .toLocaleDateString(undefined, { weekday: "narrow" });

    const bars = week.map(day => {

        const ratio = day.net > 0 ? Math.min(1, day.net / scale) : 0;

        // With a target set: a finished day under it is a miss (red),
        // and a day at or over it is a hit. Today isn't judged yet.
        const hasTarget = stats.dailyTarget > 0;
        const missed = hasTarget && !day.isToday && day.net < stats.dailyTarget;
        const hit = hasTarget && day.net >= stats.dailyTarget;

        const verdict = missed
            ? " · missed target"
            : hit ? " · hit target" : "";

        return `<span class="mc-bar${day.net > 0 ? "" : " is-empty"}${day.isToday ? " is-today" : ""}${missed ? " is-miss" : ""}${hit ? " is-hit" : ""}"
                      style="--r: ${ratio.toFixed(4)}"
                      title="${longDay(day.key)} · ${money(day.net)}${day.isToday ? " so far" : ""}${verdict}"></span>`;
    }).join("");

    const labels = week.map(day =>
        `<span${day.isToday ? ` class="is-today"` : ""}>${narrowDay(day.key)}</span>`
    ).join("");

    const targetLine = stats.dailyTarget > 0
        ? `<i class="mc-chart-target" style="--r: ${Math.min(1, stats.dailyTarget / scale).toFixed(4)}"
              title="Daily target ${money(stats.dailyTarget)}"></i>`
        : "";

    const summary = week
        .map(day => `${longDay(day.key)} ${money(day.net)}`)
        .join(", ");

    return `
        <div class="mc-week">
            <div class="mc-week-head">
                <span>Last 7 days</span>
                <span class="mc-week-total">${moneyShort(stats.weekNet)}</span>
            </div>
            <div class="mc-chart" role="img" aria-label="Net sales per day, last 7 days: ${summary}">
                ${targetLine}
                ${bars}
            </div>
            <div class="mc-days" aria-hidden="true">${labels}</div>
        </div>`;
}


function renderModelCard(item, selected, inSelectMode) {

    const color = getAvatarColor(item.id);
    const deep = getModelDeepColor(color);
    const photo = getModelImage(item.id);
    const target = formatModelTarget(data.modelTargets && data.modelTargets[item.id]);

    const monthly = getModelMonthStats(item.id);

    const picture = photo
        ? `<img src="${photo}" alt="" draggable="false" loading="lazy">`
        : MODEL_SILHOUETTE_SVG;

    return `

        <article
            class="card content-card static-card model-card${selected ? " selected" : ""}"
            style="--m-color: ${color}; --m-deep: ${deep};"
            draggable="${inSelectMode ? "false" : "true"}"
            tabindex="0"
            data-id="${item.id}"
            onclick="handleCardClick('models', '${item.id}', event)"
        >

            <div class="card-select-circle" aria-hidden="true"></div>

            <div class="mc-photo${photo ? "" : " is-empty"}">

                ${picture}

                <div class="card-actions-top">
                    <button
                        class="card-icon-btn card-open-btn"
                        type="button"
                        title="Open"
                        aria-label="Open"
                        onclick="
                            event.stopPropagation();
                            openViewModal('models', '${item.id}')
                        "
                    >
                        ${ICON_OPEN}
                    </button>
                    <button
                        class="card-icon-btn card-edit-btn"
                        type="button"
                        title="Edit"
                        aria-label="Edit"
                        onclick="
                            event.stopPropagation();
                            editItem('models', '${item.id}')
                        "
                    >
                        ${ICON_EDIT}
                    </button>
                </div>

            </div>

            <div class="mc-body">

                <h3>${escapeHTML(item.title)}</h3>

                <div class="mc-target${target ? "" : " is-none"}">
                    ${target
                        ? `<span class="mc-target-fig">${target}</span><span class="mc-target-unit">daily target</span>`
                        : `<span class="mc-target-unit">No daily target</span>`}
                </div>

                ${renderModelMonthBlock(monthly)}

                ${renderModelWeekBlock(monthly)}

            </div>

        </article>

    `;
}


/* =====================================================
   SCRIPT CARDS: only fade the preview when it is actually cut off.
   Short scripts get no fade at all. A ResizeObserver also covers the
   Scripts tab being hidden at render time (size 0) and window resizes.
   ===================================================== */

const scriptFadeObserver =
    typeof ResizeObserver === "function"
        ? new ResizeObserver(entries =>
              entries.forEach(entry => flagClippedScript(entry.target)))
        : null;

function flagClippedScript(el) {
    el.classList.toggle("is-clipped", el.scrollHeight > el.clientHeight + 1);
}

function watchScriptFades() {
    document
        .querySelectorAll("#scriptsList .content-text-inner")
        .forEach(el => {
            if (scriptFadeObserver) scriptFadeObserver.observe(el);
            else flagClippedScript(el);
        });
}


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


    const isScripts = type === "scripts";

    if (type === "models") {

        container.innerHTML =
            filtered.map(
                item => renderModelCard(
                    item,
                    selectedIds[type].has(item.id),
                    inSelectMode
                )
            ).join("");

        $("#modelsEmpty").style.display =
            filtered.length ? "none" : "flex";

        updateSelectToolbar();

        return;
    }

    container.innerHTML =
        filtered.map(
            item => `

                <article
                    class="card content-card static-card${selectedIds[type].has(item.id) ? " selected" : ""}"
                    draggable="${inSelectMode ? "false" : "true"}"
                    tabindex="0"
                    data-id="${item.id}"
                    onclick="handleCardClick('${type}', '${item.id}', event)"
                >

                    <div class="card-select-circle" aria-hidden="true"></div>

                    <div class="card-actions-top">
                        <button
                            class="card-icon-btn card-open-btn"
                            type="button"
                            title="Open"
                            aria-label="Open"
                            onclick="
                                event.stopPropagation();
                                openViewModal(
                                    '${type}',
                                    '${item.id}'
                                )
                            "
                        >
                            ${ICON_OPEN}
                        </button>
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
                    </div>

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

                    ${
                        isScripts
                            ? `<div class="content-text"><div class="content-text-inner">${escapeHTML(item.text)}</div></div>`
                            : `<div class="content-text">${escapeHTML(item.text)}</div>`
                    }

                    ${
                        isScripts
                            ? `
                                <button
                                    type="button"
                                    class="card-copy-bar"
                                    title="Copy this script's text"
                                    aria-label="Copy this script's text"
                                    onclick="
                                        event.stopPropagation();
                                        handleCopyBarClick(
                                            '${type}',
                                            '${item.id}',
                                            event
                                        )
                                    "
                                >
                                    <span class="card-copy-bar-state card-copy-bar-idle">
                                        ${ICON_COPY}
                                        <span>Copy</span>
                                    </span>
                                    <span class="card-copy-bar-state card-copy-bar-done">
                                        ${ICON_CHECK}
                                        <span>Copied</span>
                                    </span>
                                </button>
                            `
                            : ""
                    }

                </article>

            `
        ).join("");


    const emptyEl = $("#" + type + "Empty");

    // Something is saved but nothing matches the search/category.
    emptyEl.classList.toggle("is-filtered", list.length > 0);

    emptyEl.style.display =
        filtered.length
            ? "none"
            : (type === "scripts" ? "flex" : "block");

    if (type === "scripts") watchScriptFades();

    updateSelectToolbar();

}


/* =====================================================
   MULTI-SELECT — long-press a card to select, like iOS
   Photos, then drag the selection onto the trash button
   (or tap it) to delete everything at once.
   ===================================================== */


// Neither Models nor Scripts open or copy from a click on the card
// body any more — opening is the dedicated open icon (openViewModal,
// wired directly in the template) and editing is the edit icon
// beside it. The only thing a card click still does is toggle
// selection while in select mode.
function handleCardClick(type, id, event) {

    if (selectMode[type]) {
        event.stopPropagation();
        toggleCardSelection(type, id);
    }

}


/* =====================================================
   SCRIPT CARD: COPY
   The card body does nothing when clicked — opening is the
   dedicated open icon (top-right corner, wired straight to
   openViewModal in the template) and copying is this dedicated bar
   pinned to the bottom of the card (see .card-copy-bar in
   style.css). Models share the same open/edit icons but have no
   copy bar.
   ===================================================== */

async function handleCopyBarClick(type, id, event) {

    const bar =
        (event && event.currentTarget) ||
        (event && event.target && event.target.closest(".card-copy-bar"));

    // Release focus from the search box (or any input) first. A focused
    // input is what makes the browser refuse the clipboard write.
    const active = document.activeElement;

    if (
        active &&
        active !== document.body &&
        typeof active.blur === "function" &&
        /^(INPUT|TEXTAREA)$/.test(active.tagName)
    ) {
        active.blur();
    }

    await copyItem(type, id);

    flashCopyBar(bar);
}


// Swaps the bar's icon/label to a "Copied" state briefly — the bar
// IS the dedicated copy area, so the feedback lives there too.
function flashCopyBar(bar) {

    if (!bar) {
        return;
    }

    bar.classList.add("copied");

    clearTimeout(bar._copyBarTimer);

    bar._copyBarTimer = setTimeout(
        function () {
            bar.classList.remove("copied");
        },
        1400
    );
}


// Same idle/done swap as flashCopyBar above, for a plain .btn that
// opted into .copy-swap-btn (the "Copy for logout" buttons) instead
// of a toast.
function flashCopySwap(btn) {

    if (!btn) {
        return;
    }

    btn.classList.add("copied");

    clearTimeout(btn._copySwapTimer);

    btn._copySwapTimer = setTimeout(
        function () {
            btn.classList.remove("copied");
        },
        1400
    );
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
const CONTENT_HOLD_VISUAL_DELAY_MS = 120;
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
    clearTimeout(contentHoldState.visualTimer);
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

                if (
                    !card ||
                    event.target.closest(".card-icon-btn") ||
                    event.target.closest(".card-copy-bar")
                ) {
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
                // that turns it on. Don't shrink the card right away:
                // a plain tap releases well inside CONTENT_HOLD_VISUAL_DELAY_MS,
                // so only a press that's actually lingering gets the
                // "about to select" feedback.
                contentHoldState = {
                    card: card,
                    type: type,
                    id: id,
                    startX: event.clientX,
                    startY: event.clientY,
                    visualTimer: setTimeout(
                        function () {
                            card.classList.add("holding");
                        },
                        CONTENT_HOLD_VISUAL_DELAY_MS
                    ),
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


/* Clear (×) button inside every search field: shows once there's
   text, clears it, and re-fires "input" so whatever's already
   listening on that field (the scripts re-render above, or the
   FAQ filter below) runs exactly as if the person had deleted the
   text themselves. */

$$(".scripts-search-input").forEach(
    input => {

        const box = input.closest(".scripts-search");
        const clearBtn = box
            ? box.querySelector(".scripts-search-clear")
            : null;

        if (!box || !clearBtn) {
            return;
        }

        function syncHasValue() {
            box.classList.toggle("has-value", !!input.value);
        }

        input.addEventListener("input", syncHasValue);
        syncHasValue();

        clearBtn.addEventListener("click", function () {

            input.value = "";
            syncHasValue();

            input.dispatchEvent(
                new Event("input", { bubbles: true })
            );

            input.focus();

        });

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
            input.dispatchEvent(
                new Event("input", { bubbles: true })
            );
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
   if nothing in it matches.

   Matching is "idea-based": an exact substring match still always
   counts (old behavior), but on top of that each query word is also
   expanded to close synonyms ("night mode" also finds "dark mode",
   "signout" also finds "sign out") and to close typo matches against
   the words that actually appear in the FAQ ("sinc" still finds
   "sync"). An item matches if enough of the query's words are found
   this way, so the box tolerates different wording, not just typos.

   On top of that: word forms ("deleting" finds "delete", "copied" finds
   "copy"), results sorted best-first inside each section, the matched
   words highlighted in the questions, a short list of answers opening
   by itself, Enter jumping to the top result, and a "did you mean"
   empty state. */

(function () {

    const box = $("#faqSearchBox");
    const toggle = $("#faqSearchToggle");
    const input = $("#faqSearchInput");

    if (!box || !toggle || !input) {
        return;
    }

    const items = $$("#faq .faq-item");
    const groups = $$("#faq .faq-group");

    const resultsEl = $("#faqResults");
    const emptyEl = $("#faqEmpty");
    const emptyQueryEl = $("#faqEmptyQuery");
    const emptySuggestBtn = $("#faqEmptySuggest");

    // When a search narrows down to this many answers or fewer, they
    // open on their own so the answer is already on screen.
    const AUTO_OPEN_MAX = 3;

    // Groups of interchangeable words/phrases for this FAQ's topics,
    // so searching for one finds items that only use another.
    const SYNONYM_GROUPS = [
        [
            "dark mode", "light mode", "night mode", "dark", "light",
            "theme", "appearance"
        ],
        ["reorder", "rearrange", "move", "drag", "sort", "order"],
        ["delete", "remove", "erase", "clear", "get rid of", "throw away"],
        ["undo", "revert", "bring back", "reverse"],
        ["sale", "sales", "earning", "earnings", "income", "money"],
        ["target", "goal", "quota"],
        ["ppv", "ppvs"],
        ["tip", "tips", "outside shift"],
        ["history", "past days", "previous", "old"],
        ["shift", "close shift", "session"],
        ["sign out", "log out", "logout", "signout"],
        ["overview", "summary", "totals"],
        ["script", "scripts", "message", "template"],
        [
            "category", "categories", "chip", "chips", "tag", "tags",
            "folder"
        ],
        ["backup", "back up", "export", "save a copy", "download"],
        ["restore", "import", "recover"],
        [
            "sync", "synchronize", "synchronise", "across devices",
            "another device", "multiple devices"
        ],
        ["reduce motion", "animation", "animations", "motion"],
        ["bulk", "multiple", "more than one", "several", "many"],
        ["add", "create", "new"],
        ["edit", "change", "update"],
        ["model", "models", "creator", "creators"],
        [
            "photo", "photos", "picture", "pictures", "image", "avatar",
            "pic", "profile picture"
        ],
        [
            "fire", "flames", "flame", "on fire", "inferno", "blaze",
            "embers", "ember", "sparkle", "sparkles", "spark", "sparks",
            "glow", "burning", "heat", "shine"
        ],
        [
            "quick sale", "quick add", "floating button", "plus button",
            "shortcut"
        ],
        ["gross", "before fees"],
        ["net", "after fees", "take home"],

        // ---- added with the monthly target / FAQ refresh ----
        ["monthly", "month", "months", "per month", "this month", "month to date"],
        ["percentage", "percent", "progress", "progress bar"],
        ["card", "cards", "tile", "tiles"],
        ["notes", "note", "info", "information", "preferences", "details"],
        ["sidebar", "side bar", "navigation", "nav", "collapse", "expand", "hide", "minimize"],
        ["sign in", "log in", "login", "signin", "continue with google"],
        [
            "offline", "internet", "connection", "network", "wifi",
            "no internet", "disconnected"
        ],
        ["private", "privacy", "secure", "security", "who can see", "visible", "safe"],
        ["average", "avg"],
        ["color", "colour", "colors", "colours", "shade", "swatch"],
        ["trash", "bin", "drop to delete", "recycle bin"],
        [
            "select mode", "long press", "press and hold", "hold",
            "select all", "multi select"
        ],
        ["phone", "mobile", "iphone", "android", "small screen"],
        ["mistake", "wrong", "accident", "accidentally", "oops", "by mistake"],
        ["dash", "dashes", "blank", "empty", "missing"],
        ["limit", "maximum", "max", "cap"],
        ["username", "user name", "handle", "buyer"],
        ["forget", "forgot", "forgotten"],
        ["sound", "audio", "noise", "ching"],
        ["toast", "notification", "notifications", "popup", "alert"],
        ["copy", "copied", "clipboard", "paste"],
        ["snappier", "faster", "slow", "lag", "laggy", "performance"],
        ["contact", "support", "email"],
        ["chart", "graph", "bars", "trend", "trends", "stats", "statistics"],
    ];

    const synonymLookup = new Map();
    SYNONYM_GROUPS.forEach(group => {
        group.forEach(term => {
            synonymLookup.set(term, group);
        });
    });

    // Multi-word idioms only (e.g. "get rid of", "bring back", "back up"),
    // checked against the raw query below so a colloquial phrase like
    // "how do I get rid of a model" is recognized even though its
    // individual words ("get", "rid") aren't meaningful on their own.
    const PHRASE_KEYS = SYNONYM_GROUPS
        .flatMap(group => group.filter(term => term.includes(" ")));

    const STOPWORDS = new Set([
        "a", "an", "the", "is", "are", "do", "does", "did", "i", "my", "me",
        "to", "of", "for", "in", "on", "how", "what", "can", "it", "its",
        "and", "or", "with", "when", "where", "why", "this", "that", "be",
        "was", "were", "will", "if", "im", "youre"
    ]);

    function tokenize(str) {
        return (str.toLowerCase().match(/[a-z0-9']+/g) || [])
            .filter(w => w.length > 1 && !STOPWORDS.has(w));
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Small capped edit distance, used only to catch minor typos.
    // Swapping two neighbouring letters ("sycn", "shfit") counts as a
    // single slip rather than two.
    function editDistance(a, b, max) {

        if (Math.abs(a.length - b.length) > max) {
            return max + 1;
        }

        let beforePrev = null;
        let prevRow = [];
        for (let j = 0; j <= b.length; j++) {
            prevRow[j] = j;
        }

        for (let i = 1; i <= a.length; i++) {
            const row = [i];
            for (let j = 1; j <= b.length; j++) {
                row[j] = a[i - 1] === b[j - 1]
                    ? prevRow[j - 1]
                    : 1 + Math.min(prevRow[j - 1], prevRow[j], row[j - 1]);

                if (
                    beforePrev &&
                    i > 1 && j > 1 &&
                    a[i - 1] === b[j - 2] &&
                    a[i - 2] === b[j - 1]
                ) {
                    row[j] = Math.min(row[j], beforePrev[j - 2] + 1);
                }
            }
            beforePrev = prevRow;
            prevRow = row;
        }

        return prevRow[b.length];
    }

    // Precompute each item's searchable text/tokens once. (items is a
    // NodeList, so wrap it in Array.from before mapping.)
    const itemData = Array.from(items).map((item, index) => {
        const text = item.textContent.toLowerCase();

        // The question text is kept separate from the full item text
        // (question + answer) so a match can be scored higher when
        // it's what the item is actually about, not just something
        // the answer happens to mention in passing.
        const titleEl = item.querySelector(".faq-q span");
        const titleOriginal = titleEl ? titleEl.textContent : "";
        const titleText = titleOriginal.toLowerCase();

        return {
            item,
            index,
            text,
            tokens: tokenize(text),
            titleEl,
            titleOriginal,
            titleText,
            titleTokens: tokenize(titleText),
            visible: true,
            highlighted: false,
            autoOpened: false,
            score: 0
        };
    });

    // Vocabulary of real words used across the FAQ, for typo matching.
    const vocab = new Set();
    itemData.forEach(d => d.tokens.forEach(t => vocab.add(t)));

    // Plural / past-tense / -ing forms of a word that really are used
    // somewhere in the FAQ ("deleting" -> "delete", "model" -> "models",
    // "copy" -> "copied"). Only forms that exist in the FAQ (or are
    // known synonym terms) come back, so this never invents words.
    function wordForms(word) {

        const out = new Set();

        function add(candidate) {
            if (
                candidate.length >= 3 &&
                candidate !== word &&
                (vocab.has(candidate) || synonymLookup.has(candidate))
            ) {
                out.add(candidate);
            }
        }

        if (word.length < 3) {
            return out;
        }

        const last = word[word.length - 1];

        // Down to the base form.
        if (word.endsWith("ies") || word.endsWith("ied")) {
            add(word.slice(0, -3) + "y");
        }

        if (word.endsWith("ing")) {
            const stem = word.slice(0, -3);
            add(stem);
            add(stem + "e");
            if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
                add(stem.slice(0, -1));
            }
        }

        if (word.endsWith("ed")) {
            const stem = word.slice(0, -2);
            add(stem);
            add(stem + "e");
            if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
                add(stem.slice(0, -1));
            }
        }

        if (word.endsWith("es")) {
            add(word.slice(0, -2));
            add(word.slice(0, -1));
        }

        if (word.endsWith("s") && !word.endsWith("ss")) {
            add(word.slice(0, -1));
        }

        // Up to the common inflections.
        add(word + "s");
        add(word + "es");
        add(word + "ed");
        add(word + "d");
        add(word + "ing");
        add(word + last + "ed");
        add(word + last + "ing");

        if (word.endsWith("e")) {
            add(word.slice(0, -1) + "ing");
        }

        if (word.endsWith("y")) {
            add(word.slice(0, -1) + "ies");
            add(word.slice(0, -1) + "ied");
        }

        return out;
    }

    // Every way a single query word could show up: itself, its other
    // word forms, the synonyms of those, and any real FAQ word that's a
    // close typo match for it.
    function expandWord(word) {

        const variants = new Set([word]);

        const forms = wordForms(word);
        forms.forEach(f => variants.add(f));

        // Synonyms of the word and of its base forms.
        Array.from(variants).forEach(v => {
            const syns = synonymLookup.get(v);
            if (syns) {
                syns.forEach(s => variants.add(s));
            }
        });

        // Only worth fuzzy-matching if the query word isn't already a
        // real word in the FAQ -- if it is, it's not a typo of
        // anything, and fuzzy-matching it anyway just risks landing on
        // an unrelated real word that happens to be one letter off
        // ("sale" and "same", "shift" and "shirt").
        if (word.length >= 4 && !vocab.has(word)) {
            vocab.forEach(vocabWord => {
                if (vocabWord.length >= 4 &&
                    !variants.has(vocabWord) &&
                    editDistance(word, vocabWord, 1) <= 1) {
                    variants.add(vocabWord);
                }
            });
        }

        return variants;
    }

    function textHasTerm(d, term) {
        return term.includes(" ")
            ? d.text.includes(term)
            : d.tokens.includes(term);
    }

    // Same check, scoped to just the question (not the answer below it).
    function titleHasTerm(d, term) {
        return term.includes(" ")
            ? d.titleText.includes(term)
            : d.titleTokens.includes(term);
    }

    // How many of the query's "concepts" (see filterFaq) are found,
    // checked with `has` so it can be pointed at either the question
    // alone or the whole item.
    function countConceptHits(concepts, has) {
        let hits = 0;
        concepts.forEach(variants => {
            if (Array.from(variants).some(has)) {
                hits++;
            }
        });
        return hits;
    }

    // ---------- Result presentation ----------

    // Highlights the words that made a question match, inside the
    // question text only (answers are left exactly as written).
    function applyHighlights(terms) {

        const re = terms.length
            ? new RegExp(
                "(^|[^a-z0-9'])(" +
                terms.map(escapeRegExp).join("|") +
                ")(?![a-z0-9'])",
                "gi"
            )
            : null;

        itemData.forEach(d => {

            if (!d.titleEl) {
                return;
            }

            if (!re || !d.visible) {
                if (d.highlighted) {
                    d.titleEl.textContent = d.titleOriginal;
                    d.highlighted = false;
                }
                return;
            }

            const text = d.titleOriginal;
            let out = "";
            let last = 0;
            let found = false;
            let m;

            re.lastIndex = 0;

            while ((m = re.exec(text)) !== null) {
                const start = m.index + m[1].length;
                out += escapeHtml(text.slice(last, start)) +
                    "<mark>" + escapeHtml(m[2]) + "</mark>";
                last = start + m[2].length;
                found = true;
                if (re.lastIndex === m.index) {
                    re.lastIndex++;
                }
            }

            if (found) {
                d.titleEl.innerHTML = out + escapeHtml(text.slice(last));
                d.highlighted = true;
            } else if (d.highlighted) {
                d.titleEl.textContent = d.titleOriginal;
                d.highlighted = false;
            }
        });
    }

    function setItemOpen(d, open) {

        d.item.classList.toggle("open", open);

        const q = d.item.querySelector(".faq-q");
        if (q) {
            q.setAttribute("aria-expanded", open ? "true" : "false");
        }
    }

    // Nearest real FAQ word for each word of the query that isn't one
    // (two letters off is fine here, since nothing matched at all).
    function suggestQuery(query) {

        const words = query.toLowerCase().match(/[a-z0-9']+/g) || [];
        let changed = false;

        const fixed = words.map(w => {

            if (
                w.length < 4 ||
                vocab.has(w) ||
                STOPWORDS.has(w) ||
                synonymLookup.has(w) ||
                wordForms(w).size
            ) {
                return w;
            }

            let best = null;
            const maxSlip = w.length <= 5 ? 1 : 2;
            let bestDistance = maxSlip + 1;

            vocab.forEach(v => {
                if (v.length >= 4) {
                    const dist = editDistance(w, v, maxSlip);
                    if (dist < bestDistance) {
                        bestDistance = dist;
                        best = v;
                    }
                }
            });

            if (best) {
                changed = true;
                return best;
            }

            return w;
        });

        return changed ? fixed.join(" ") : "";
    }

    function showResultsUi(query, matchedCount) {

        if (resultsEl) {
            if (query && matchedCount > 0) {
                resultsEl.textContent =
                    matchedCount === 1
                        ? "1 answer found"
                        : matchedCount + " answers found";
                resultsEl.hidden = false;
            } else {
                resultsEl.textContent = "";
                resultsEl.hidden = true;
            }
        }

        if (emptyEl) {

            const showEmpty = !!query && matchedCount === 0;

            emptyEl.hidden = !showEmpty;

            if (showEmpty) {

                if (emptyQueryEl) {
                    emptyQueryEl.textContent = query;
                }

                if (emptySuggestBtn) {

                    const suggestion = suggestQuery(query);

                    if (suggestion && suggestion !== query.toLowerCase()) {
                        emptySuggestBtn.textContent =
                            "Search for \u201c" + suggestion + "\u201d instead";
                        emptySuggestBtn.dataset.query = suggestion;
                        emptySuggestBtn.hidden = false;
                    } else {
                        emptySuggestBtn.hidden = true;
                        delete emptySuggestBtn.dataset.query;
                    }
                }
            }
        }
    }

    // Best matches first: inside each section, and the sections
    // themselves ordered by their best match, so the most relevant
    // answer is the first thing you see. Clearing the search puts
    // everything back in its original order.
    function reorderGroups(searching) {

        const groupList = Array.from(groups);

        groupList.forEach(group => {

            const list = group.querySelector(".faq-list");

            if (!list) {
                return;
            }

            const members = itemData.filter(d => group.contains(d.item));

            members.sort((a, b) =>
                searching
                    ? (b.score - a.score) || (a.index - b.index)
                    : a.index - b.index
            );

            const current = Array.from(list.children)
                .filter(el => members.some(d => d.item === el));

            const unchanged = current.length === members.length &&
                current.every((el, i) => el === members[i].item);

            if (!unchanged) {
                members.forEach(d => list.appendChild(d.item));
            }
        });

        const content = groupList.length ? groupList[0].parentNode : null;

        if (!content) {
            return;
        }

        const bestScore = group => itemData.reduce(
            (best, d) =>
                d.visible && group.contains(d.item)
                    ? Math.max(best, d.score)
                    : best,
            0
        );

        const ordered = groupList.slice().sort((a, b) =>
            searching
                ? (bestScore(b) - bestScore(a)) ||
                  (groupList.indexOf(a) - groupList.indexOf(b))
                : groupList.indexOf(a) - groupList.indexOf(b)
        );

        const currentGroups = Array.from(content.children)
            .filter(el => groupList.includes(el));

        const same = currentGroups.length === ordered.length &&
            currentGroups.every((el, i) => el === ordered[i]);

        if (!same) {

            // Keep the "no answers" message last.
            const anchor = emptyEl && emptyEl.parentNode === content
                ? emptyEl
                : null;

            ordered.forEach(group => content.insertBefore(group, anchor));
        }
    }

    function filterFaq(query) {

        const q = query.trim().toLowerCase();

        if (!q) {

            itemData.forEach(d => {
                d.visible = true;
                d.score = 0;
                d.item.style.display = "";
                if (d.autoOpened) {
                    setItemOpen(d, false);
                    d.autoOpened = false;
                }
            });

            groups.forEach(g => { g.style.display = ""; });

            reorderGroups(false);
            applyHighlights([]);
            showResultsUi("", 0);
            return;
        }

        // An idiom ("get rid of", "back up") is one concept, not the
        // sum of its individual words -- "get" and "rid" mean nothing
        // matched on their own, so they're pulled out of the plain
        // query text before tokenizing it, and the idiom's synonym
        // group is added back as a single concept in its place. This
        // also de-dupes: "reduce motion" is both a phrase and (via
        // "motion") an ordinary word, but it should only ever count
        // once.
        const idiomKeys = PHRASE_KEYS.filter(key => q.includes(key));
        const idiomGroupSet = new Set(idiomKeys.map(key => synonymLookup.get(key)));

        let remainder = q;
        idiomKeys.forEach(key => { remainder = remainder.split(key).join(" "); });

        const queryWords = tokenize(remainder);
        const concepts = queryWords.map(expandWord)
            .concat(Array.from(idiomGroupSet, group => new Set(group)));

        // Two passes. A single concept ("sync", "ppv", "get rid of" on
        // its own) is left to match anywhere in the item, same as
        // before -- with only one concept there's nothing to
        // disambiguate it against. From two concepts up, a search is
        // really asking about a specific question, so pass 1 only
        // looks at the question text itself: does some item's question
        // cover every one of the query's concepts? If so, only those
        // on-topic questions are shown -- this is what stops a search
        // like "delete a model" from also surfacing every other item
        // that happens to separately mention "model" and a delete-ish
        // word ("remove a sale", "clear sales history", a model
        // mentioned in passing while explaining scripts...). Pass 2
        // (the old whole-item behavior) only kicks in as a fallback,
        // when nothing's question fully covers the query, so
        // differently-worded questions can still be found.
        let titleMatchExists = false;

        itemData.forEach(d => {
            d._titleHits = countConceptHits(
                concepts,
                term => titleHasTerm(d, term)
            );
            d._titleMatch = concepts.length >= 2 &&
                d._titleHits === concepts.length;
            if (d._titleMatch) {
                titleMatchExists = true;
            }
        });

        // Require a real majority of the query's concepts to be found
        // (as themselves, a synonym, or a close typo match) — e.g. a
        // 2-concept query needs both accounted for, not just one, or
        // very common words ("script", "delete") on their own would
        // surface almost the entire FAQ.
        const needHits = Math.ceil(concepts.length * 0.6);

        const matched = [];

        itemData.forEach(d => {

            const exactMatch = d.text.includes(q);
            const wordHits = countConceptHits(
                concepts,
                term => textHasTerm(d, term)
            );
            let matches;

            if (exactMatch) {
                matches = true;
            } else if (concepts.length >= 2 && titleMatchExists) {
                matches = d._titleMatch;
            } else {
                matches = concepts.length > 0 && wordHits >= needHits;
            }

            d.visible = matches;
            d.item.style.display = matches ? "" : "none";

            // Relevance: the question being about the search beats
            // the answer merely mentioning it.
            d.score =
                (d.titleText.includes(q) ? 100 : 0) +
                (exactMatch ? 40 : 0) +
                d._titleHits * 10 +
                wordHits;

            if (matches) {
                matched.push(d);
            }
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

        // Best matches first within each section.
        reorderGroups(true);

        // A short list of results opens by itself; anything opened
        // this way closes again when the search changes or is cleared
        // (answers the person opened themselves are never touched).
        const autoOpen = new Set(
            matched.length > 0 && matched.length <= AUTO_OPEN_MAX
                ? matched
                : []
        );

        itemData.forEach(d => {
            if (d.autoOpened && !autoOpen.has(d)) {
                setItemOpen(d, false);
                d.autoOpened = false;
            }
        });

        autoOpen.forEach(d => {
            if (!d.item.classList.contains("open")) {
                setItemOpen(d, true);
                d.autoOpened = true;
            }
        });

        // Highlight whatever made the questions match.
        const terms = new Set();

        concepts.forEach(variants => {
            variants.forEach(v => {
                if (v.length >= 2) {
                    terms.add(v);
                }
            });
        });

        if (q.length >= 2) {
            terms.add(q);
        }

        applyHighlights(
            Array.from(terms).sort((a, b) => b.length - a.length)
        );

        showResultsUi(query.trim(), matched.length);
    }

    function closeFaqSearch(clear) {

        if (clear && input.value) {
            input.value = "";
            input.dispatchEvent(
                new Event("input", { bubbles: true })
            );
        }

        box.classList.remove("open");
    }

    // Opening or closing an answer by hand takes it out of the
    // search's hands for good.
    itemData.forEach(d => {
        const q = d.item.querySelector(".faq-q");
        if (q) {
            q.addEventListener("click", function () {
                d.autoOpened = false;
            });
        }
    });

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
            return;
        }

        // Enter jumps to the best match and opens it.
        if (event.key === "Enter" && input.value.trim()) {

            const top = itemData
                .filter(d => d.visible)
                .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0];

            if (top) {

                event.preventDefault();

                if (!top.item.classList.contains("open")) {
                    setItemOpen(top, true);
                }

                top.item.scrollIntoView({
                    block: "center",
                    behavior:
                        document.documentElement.getAttribute("data-reduce-motion") === "true"
                            ? "auto"
                            : "smooth"
                });
            }
        }
    });

    if (emptySuggestBtn) {
        emptySuggestBtn.addEventListener("click", function () {

            const suggestion = emptySuggestBtn.dataset.query;

            if (!suggestion) {
                return;
            }

            input.value = suggestion;
            input.dispatchEvent(
                new Event("input", { bubbles: true })
            );
            input.focus();
        });
    }

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

                // Clicking the selected chip again unselects it, which
                // shows everything (there is no separate "All" chip).
                const incomingCategory =
                    chip.dataset.category === outgoingCategory
                        ? "All"
                        : chip.dataset.category;

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


                if (incomingCategory !== "All") {
                    chip.classList.add(
                        "active"
                    );
                }

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
   MODEL PROFILE FIELDS
   Photo, colour and daily target, edited right in the New/Edit
   Model form. The form works on a draft (modelDraft) and only writes
   to data.modelImages / modelColors / modelTargets when Save is hit.
   "" means "none": no photo, automatic colour, no target. (Values are
   blanked rather than deleted so the cloud merge-sync clears them too.)
   ===================================================== */

let modalNewId = null;
let modelDraft = null;   // { id, image, color }

const MODEL_PHOTO_W = 800;            // high-res, matches the card's 5:6 frame
const MODEL_PHOTO_H = 960;
const MODEL_PHOTO_MIN_W = 480;        // never shrink below this
const MODEL_PHOTO_MAX_FILE_MB = 15;   // refuse absurdly large files

// All photos live inside the one Firestore document (hard limit 1 MiB),
// so each new photo is encoded to fit the room that is left.
const MODEL_PHOTO_MAX_CHARS = 150000;   // ~110 KB per photo at most
const MODEL_DOC_BUDGET_CHARS = 940000;  // leave headroom under 1,048,576


// The stored photo for a model, or "" (also rejects anything that isn't
// one of our own small data-URL images).
function getModelImage(modelId) {

    const src = data.modelImages && data.modelImages[modelId];

    return (typeof src === "string" && MODEL_IMAGE_RE.test(src))
        ? src
        : "";
}


// WebP is ~30% smaller than JPEG at the same quality. Browsers that
// can't encode it silently return PNG, so detect that once.
const MODEL_PHOTO_WEBP = (function () {
    try {
        return document.createElement("canvas")
            .toDataURL("image/webp").indexOf("data:image/webp") === 0;
    } catch (e) { return false; }
})();


// Draws the source crop at w x h. Shrinks in halves first when the
// source is much bigger than the target, which keeps edges crisp
// (one big jump can look jagged or soft).
function drawModelPhoto(img, sx, sy, sw, sh, w, h) {

    let src = img, ssx = sx, ssy = sy, ssw = sw, ssh = sh;

    while (ssw / w > 2) {

        const nw = Math.round(ssw / 2);
        const nh = Math.round(ssh / 2);
        const step = document.createElement("canvas");

        step.width = nw;
        step.height = nh;

        const sctx = step.getContext("2d");
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = "high";
        sctx.drawImage(src, ssx, ssy, ssw, ssh, 0, 0, nw, nh);

        src = step; ssx = 0; ssy = 0; ssw = nw; ssh = nh;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");

    // PNGs with transparency would turn black as JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, ssx, ssy, ssw, ssh, 0, 0, w, h);

    return canvas;
}


// Centre-crop to the card's 5:6 portrait frame and encode as the best
// image that fits the room left in the document: start at full size and
// high quality, then lower the quality, then the size, only as needed.
// Rejects with Error("budget") if even the smallest version won't fit.
function readModelPhoto(file, modelId) {

    return new Promise(function (resolve, reject) {

        const url = URL.createObjectURL(file);
        const img = new Image();

        img.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error("decode"));
        };

        img.onload = function () {

            URL.revokeObjectURL(url);

            const nw = img.naturalWidth, nh = img.naturalHeight;

            if (!nw || !nh) {
                reject(new Error("empty"));
                return;
            }

            // Room left in the document, not counting this model's current photo.
            const current = (data.modelImages && data.modelImages[modelId]) || "";
            const used = JSON.stringify(data).length - current.length;
            const budget = Math.min(MODEL_PHOTO_MAX_CHARS, MODEL_DOC_BUDGET_CHARS - used);

            const ratio = MODEL_PHOTO_W / MODEL_PHOTO_H;

            let sw = nw, sh = nw / ratio;
            if (sh > nh) { sh = nh; sw = nh * ratio; }

            const sx = (nw - sw) / 2, sy = (nh - sh) / 2;

            const mime = MODEL_PHOTO_WEBP ? "image/webp" : "image/jpeg";
            const qualities = [0.86, 0.8, 0.74, 0.68, 0.62, 0.56];

            // Never upscale a small source.
            let w = Math.min(MODEL_PHOTO_W, Math.round(sw));

            while (w >= MODEL_PHOTO_MIN_W || w === Math.round(sw)) {

                const h = Math.round(w / ratio);
                const canvas = drawModelPhoto(img, sx, sy, sw, sh, w, h);

                for (let i = 0; i < qualities.length; i++) {

                    const out = canvas.toDataURL(mime, qualities[i]);

                    if (out.length <= budget) {
                        resolve(out);
                        return;
                    }
                }

                if (w <= MODEL_PHOTO_MIN_W) break;

                w = Math.max(MODEL_PHOTO_MIN_W, Math.round(w * 0.88));
            }

            reject(new Error("budget"));
        };

        img.src = url;
    });
}


function renderModelColorRow() {

    const current = (modelDraft && modelDraft.color || "").toLowerCase();

    $("#modelColorRow").innerHTML = `
        <button
            type="button"
            id="modelColorTrigger"
            class="model-color-trigger"
            aria-haspopup="true"
            aria-expanded="false"
        >
            <span class="model-color-dot" id="modelColorDot"></span>
            <span class="model-color-label" id="modelColorLabel"></span>
            <svg class="model-color-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>

        <div id="modelColorPopover" class="model-color-popover hidden">
            <button
                type="button"
                class="model-color-swatch model-color-auto${current === "" ? " active" : ""}"
                data-color=""
                title="Automatic color"
            >Auto</button>
            ${MODEL_SWATCHES.map(color => `
                <button
                    type="button"
                    class="model-color-swatch${color.toLowerCase() === current ? " active" : ""}"
                    style="background:${color}"
                    data-color="${color}"
                    title="${color}"
                    aria-label="${color}"
                ></button>
            `).join("")}
            <div class="model-color-custom-row">
                <label for="modelColorCustom">Custom</label>
                <input
                    type="color"
                    id="modelColorCustom"
                    class="model-color-custom"
                    title="Custom color"
                    aria-label="Custom color"
                    value="${/^#[0-9a-f]{6}$/.test(current) ? current : "#ffd6e0"}"
                >
            </div>
        </div>
    `;

    updateModelColorActive();
}


function setModelColorPopover(open) {

    const pop = $("#modelColorPopover");
    const trigger = $("#modelColorTrigger");

    if (!pop || !trigger) {
        return;
    }

    pop.classList.toggle("hidden", !open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
}


// Highlights the picked swatch (or the custom picker when the colour
// isn't one of the swatches).
function updateModelColorActive() {

    if (!modelDraft) {
        return;
    }

    const current = (modelDraft.color || "").toLowerCase();
    const swatches = MODEL_SWATCHES.map(color => color.toLowerCase());

    $$("#modelColorRow .model-color-swatch").forEach(btn => {
        btn.classList.toggle(
            "active",
            (btn.dataset.color || "").toLowerCase() === current
        );
    });

    const custom = $("#modelColorCustom");

    if (custom) {
        custom.classList.toggle(
            "active",
            current !== "" && !swatches.includes(current)
        );
    }

    // The one-line trigger shows the current colour.
    const dot = $("#modelColorDot");
    const label = $("#modelColorLabel");

    if (dot) {
        dot.style.background =
            current || getAutoAvatarColor(modelDraft.id);
    }

    if (label) {
        label.textContent =
            current === "" ? "Auto" : current.toUpperCase();
    }
}


// Redraws the photo preview (photo or tinted silhouette) and buttons.
function renderModelProfileFields() {

    if (!modelDraft) {
        return;
    }

    const color = modelDraft.color || getAutoAvatarColor(modelDraft.id);
    const preview = $("#modelPhotoPreview");

    preview.style.background = color;
    preview.style.color = getRowInk(color).muted;
    preview.classList.toggle("has-image", !!modelDraft.image);

    preview.innerHTML = modelDraft.image
        ? `<img src="${modelDraft.image}" alt="">`
        : MODEL_SILHOUETTE_SVG;

    $("#modelPhotoUploadBtn").textContent =
        modelDraft.image ? "Change photo" : "Upload photo";

    $("#modelPhotoRemoveBtn").style.display =
        modelDraft.image ? "" : "none";

    updateModelColorActive();
}


function setupModelProfileFields(isModel, id) {

    $("#modelPhotoField").style.display = isModel ? "" : "none";
    $("#modelExtrasField").style.display = isModel ? "" : "none";

    if (!isModel || !id) {
        modelDraft = null;
        return;
    }

    modelDraft = {
        id: id,
        image: getModelImage(id),
        color: (data.modelColors && data.modelColors[id]) || ""
    };

    const target = Number(data.modelTargets[id]) || 0;

    $("#modelTargetInput").value = target > 0 ? target : "";

    renderModelColorRow();
    renderModelProfileFields();
}


// Writes the draft to the real data. Called by the form's submit
// handler, before saveData().
function applyModelProfile(modelId, target) {

    if (!modelDraft || modelDraft.id !== modelId) {
        return;
    }

    // Colour ("" = automatic)
    if (modelDraft.color) {
        data.modelColors[modelId] = modelDraft.color;
    } else if (data.modelColors[modelId]) {
        data.modelColors[modelId] = "";
    }

    // Photo ("" = none)
    if (modelDraft.image) {
        data.modelImages[modelId] = modelDraft.image;
    } else if (data.modelImages[modelId]) {
        data.modelImages[modelId] = "";
    }

    // Daily target (0 = none)
    const before = Number(data.modelTargets[modelId]) || 0;

    if (target > 0) {
        data.modelTargets[modelId] = target;
    } else if (before > 0) {
        data.modelTargets[modelId] = 0;
    }

    // History rows show "% of target", so they need a refresh.
    if (target !== before) {
        updateHistory();
    }
}


$("#modelPhotoUploadBtn").addEventListener(
    "click",
    function () {
        $("#modelPhotoInput").click();
    }
);

$("#modelPhotoRemoveBtn").addEventListener(
    "click",
    function () {

        if (!modelDraft) {
            return;
        }

        modelDraft.image = "";
        renderModelProfileFields();
    }
);

$("#modelPhotoInput").addEventListener(
    "change",
    async function () {

        const file = this.files && this.files[0];

        // Reset so choosing the same file again still fires "change".
        this.value = "";

        if (!file || !modelDraft) {
            return;
        }

        if (!/^image\//.test(file.type)) {
            toast("Pick an image file (JPG or PNG)", "error");
            return;
        }

        if (file.size > MODEL_PHOTO_MAX_FILE_MB * 1024 * 1024) {
            toast(`That photo is too large (max ${MODEL_PHOTO_MAX_FILE_MB} MB)`, "error");
            return;
        }

        const draftAtStart = modelDraft;

        try {

            const src = await readModelPhoto(file, draftAtStart.id);

            // The form may have been closed while the photo loaded.
            if (modelDraft !== draftAtStart) {
                return;
            }

            modelDraft.image = src;
            renderModelProfileFields();

        } catch (error) {

            if (error && error.message === "budget") {
                toast("Not enough room for another photo. Remove or shrink another model's photo first.", "error");
            } else {
                toast("Couldn't read that image. Try a JPG or PNG.", "error");
            }
        }
    }
);

$("#modelColorRow").addEventListener(
    "click",
    function (event) {

        if (event.target.closest("#modelColorTrigger")) {

            setModelColorPopover(
                $("#modelColorPopover").classList.contains("hidden")
            );
            return;
        }

        const btn = event.target.closest(".model-color-swatch");

        if (!btn || !modelDraft) {
            return;
        }

        modelDraft.color = btn.dataset.color || "";
        renderModelProfileFields();
        setModelColorPopover(false);
    }
);

// Click anywhere else, or Escape, closes the colour popover.
document.addEventListener("click", function (event) {

    const pop = $("#modelColorPopover");

    if (
        pop &&
        !pop.classList.contains("hidden") &&
        !event.target.closest("#modelColorRow")
    ) {
        setModelColorPopover(false);
    }
});

document.addEventListener("keydown", function (event) {

    const pop = $("#modelColorPopover");

    if (
        event.key === "Escape" &&
        pop &&
        !pop.classList.contains("hidden")
    ) {
        event.stopPropagation();
        setModelColorPopover(false);
    }
}, true);

$("#modelColorRow").addEventListener(
    "input",
    function (event) {

        if (!modelDraft || event.target.id !== "modelColorCustom") {
            return;
        }

        modelDraft.color = event.target.value;

        // Only updates classes/preview; the row itself isn't rebuilt,
        // so the native colour picker stays open while dragging.
        renderModelProfileFields();
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

    // A new model gets its id now (not at save time) so the colour
    // preview in the form matches what it will really be.
    modalNewId =
        type === "models" && !id
            ? crypto.randomUUID()
            : null;


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

        $("#itemLabelInput").placeholder =
            "e.g. Sophia";

        $("#contentTextLabel").textContent =
            "Info & notes";

        $("#contentText").placeholder =
            "Platform/handle, preferences, boundaries, rates, birthday, anything worth remembering...";

    } else {

        $("#contentTitleLabel").textContent =
            "Title";

        $("#itemLabelInput").placeholder =
            "e.g. New Subscriber Greeting";

        $("#contentTextLabel").textContent =
            "Text";

        $("#contentText").placeholder =
            "Write your message here...";

    }


    $("#itemLabelInput").value =
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


    // Photo / colour / target fields exist for models only.
    setupModelProfileFields(
        type === "models",
        id || modalNewId
    );

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


    $("#itemLabelInput").focus();
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
    modalNewId = null;
    modelDraft = null;
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


        // Models: check the optional daily target before anything is
        // saved. Blank = no target.
        let profileTarget = 0;

        if (modalType === "models" && modelDraft) {

            const rawTarget = $("#modelTargetInput").value.trim();

            if (rawTarget !== "") {

                profileTarget = Number(rawTarget);

                if (!isFinite(profileTarget) || profileTarget <= 0) {

                    toast(
                        "Enter a target above $0, or leave it blank",
                        "error"
                    );

                    return;
                }
            }
        }


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
                modalNewId ||
                crypto.randomUUID(),

            title:
                $("#itemLabelInput")
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


        // Saving never changes the category filter: you stay on the
        // screen you're on. (If the script moved to another category it
        // simply drops out of this view.)


        // Photo, colour and target chosen in the form.
        if (modalType === "models") {
            applyModelProfile(item.id, profileTarget);
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

// Plain <audio> elements only (no Web Audio). The sound file is fetched
// once into memory, and a small pool of elements is kept ready: each one is
// rewound as soon as it finishes, so playing is just "play()" with no seek
// and no waiting. Rapid sales use the next free element, so they overlap
// instead of cutting each other off.
//
// After a long quiet spell (e.g. you were chatting in another window),
// Safari can leave old audio elements attached to an output that no longer
// makes sound -- the tab still shows the speaker icon, but nothing is
// heard. So after a quiet spell, the first click or key press throws the
// old elements away and builds brand new ones, before the sale is added.
const KACHING_VOLUME = 0.6;
const KACHING_POOL_SIZE = 3;
const KACHING_STALE_MS = 2 * 60 * 1000;   // quiet this long -> fresh elements

let kachingSrc = "kaching.wav";
let kachingPool = [];
let kachingNext = 0;
let kachingPrimer = null;
let kachingLastOutput = Date.now();

function makeKachingEl() {
    const el = new Audio();
    el.preload = "auto";
    el.volume = KACHING_VOLUME;
    el.src = kachingSrc;
    el.addEventListener("ended", function () {
        try { el.currentTime = 0; } catch {}   // ready for next time
    });
    try { el.load(); } catch {}
    return el;
}

function discardKachingEl(el) {
    try {
        el.pause();
        el.removeAttribute("src");
        el.load();
    } catch {}
}

function buildKachingPool() {
    const oldPool = kachingPool;
    const oldPrimer = kachingPrimer;

    kachingPool = [];
    for (let i = 0; i < KACHING_POOL_SIZE; i++) {
        kachingPool.push(makeKachingEl());
    }
    kachingNext = 0;
    kachingPrimer = makeKachingEl();

    oldPool.forEach(discardKachingEl);
    if (oldPrimer) discardKachingEl(oldPrimer);
}

(function prepareKaching() {
    buildKachingPool();   // usable straight away, straight from the file

    // Then swap to an in-memory copy so playing never waits on the network.
    try {
        fetch("kaching.wav")
            .then(r => r.blob())
            .then(function (blob) {
                if (!blob.type) blob = new Blob([blob], { type: "audio/wav" });
                kachingSrc = URL.createObjectURL(blob);
                buildKachingPool();
            })
            .catch(() => {});
    } catch {}
})();

// Wake the computer's audio output with a split second of silence, so the
// real sound that follows isn't swallowed while it wakes up. Also called
// when the Quick sale window opens.
function primeKaching() {
    const el = kachingPrimer;
    if (!el || !el.paused) return;
    try {
        el.volume = 0;
        el.currentTime = 0;
        const finish = function () {
            try { el.pause(); el.currentTime = 0; } catch {}
        };
        const p = el.play();
        if (p && p.then) {
            p.then(function () { setTimeout(finish, 60); }).catch(() => {});
        } else {
            setTimeout(finish, 60);
        }
    } catch {}
}

// Quiet for a while? Start over with fresh elements.
function refreshKaching() {
    if (Date.now() - kachingLastOutput < KACHING_STALE_MS) return;
    kachingLastOutput = Date.now();
    buildKachingPool();
    primeKaching();
}

// Safari only lets audio start from a real click or key press, so the
// refresh happens on your first one (typing the amount counts), which is
// always before the sale itself.
["pointerdown", "mousedown", "click", "touchend", "keydown"].forEach(function (type) {
    document.addEventListener(type, refreshKaching, { capture: true, passive: true });
});

// Coming back from the back/forward cache or switching audio devices
// (headphones in/out) also means the old elements can't be trusted.
window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
        kachingLastOutput = 0;
    }
});

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", function () {
        kachingLastOutput = 0;
    });
}

function playKaching() {
    try {
        // Safety net in case the sale is the very first thing you touch.
        refreshKaching();

        let el = null;

        for (let i = 0; i < kachingPool.length; i++) {
            const idx = (kachingNext + i) % kachingPool.length;
            const candidate = kachingPool[idx];
            if (candidate.paused || candidate.ended) {
                el = candidate;
                kachingNext = (idx + 1) % kachingPool.length;
                break;
            }
        }

        // All busy (very fast sales): restart the next one in line.
        if (!el) {
            el = kachingPool[kachingNext];
            kachingNext = (kachingNext + 1) % kachingPool.length;
        }

        kachingLastOutput = Date.now();
        el.volume = KACHING_VOLUME;
        if (el.currentTime > 0) el.currentTime = 0;

        const p = el.play();
        if (p && p.catch) p.catch(() => {});
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


    const plain = item.text;

    const html =
        "<span style=\"font-size:16px;font-family:inherit;\">" +
        plain
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>") +
        "</span>";

    // Try each way of reaching the clipboard in turn. The modern API
    // can be refused (e.g. while the search box still has focus or the
    // tap's "user gesture" has been used up), so fall back to the
    // hidden-textarea copy before ever resorting to a pop-up.
    let copied = false;

    try {

        if (
            navigator.clipboard &&
            window.ClipboardItem &&
            navigator.clipboard.write
        ) {

            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/plain": new Blob([plain], { type: "text/plain" }),
                    "text/html": new Blob([html], { type: "text/html" })
                })
            ]);

            copied = true;
        }

    } catch {
        copied = false;
    }

    if (!copied) {

        try {

            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(plain);
                copied = true;
            }

        } catch {
            copied = false;
        }
    }

    if (!copied) {
        copied = copyTextLegacy(plain);
    }

    if (!copied) {
        prompt(
            "Copy this text:",
            plain
        );
    }

    return copied;
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

    // A model with a photo shows it in the badge; otherwise the usual icon.
    const badgePhoto =
        type === "models" ? getModelImage(item.id) : "";

    $("#viewModalBadge").classList.toggle("has-image", !!badgePhoto);

    $("#viewModalBadge").innerHTML =
        badgePhoto
            ? `<img src="${badgePhoto}" alt="" draggable="false">`
            : type === "models"
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
    $("#settingsBtn").closest(".profile-group").classList.toggle("open");
});

document.addEventListener("click", function (e) {
    const group = $("#settingsBtn").closest(".profile-group");
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


$("#quickAddToggle").addEventListener(
    "click",
    toggleQuickAddSetting
);


$("#mobileQuickAddToggle").addEventListener(
    "click",
    toggleQuickAddSetting
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

        applyQuickAddSetting();

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
applyQuickAddSetting();

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


/* =====================================================
   PROFILE: avatar + name
   Uses the Google account's profile picture; if there isn't one (or it
   fails to load) the avatar falls back to the person's initials.
   ===================================================== */

(function initProfile() {

    let photo = null;
    let displayName = "Account";

    const group = $("#profileGroup");
    const menuBtn = $("#settingsBtn");

    function initialsOf(name) {
        const parts = name.split(/[\s._\-+]+/).filter(Boolean);
        if (!parts.length) return "?";
        const first = Array.from(parts[0])[0];
        const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : "";
        return (first + last).toUpperCase();
    }

    function paint(el) {
        el.querySelector(".avatar-initials").textContent = initialsOf(displayName);
        const img = el.querySelector("img");
        img.onerror = function () {
            img.hidden = true;
            el.classList.remove("has-photo");
        };
        if (photo) {
            if (img.getAttribute("src") !== photo) img.src = photo;
            img.hidden = false;
        } else {
            img.removeAttribute("src");
            img.hidden = true;
        }
        el.classList.toggle("has-photo", !!photo);
    }

    function render() {
        $$("[data-avatar]").forEach(paint);
        ["#profileBtnName", "#profileName", "#mobileProfileName"].forEach(function (s) {
            const n = $(s);
            if (n) n.textContent = displayName;
        });
    }

    auth.onAuthStateChanged(function (user) {

        if (!user) {
            photo = null;
            displayName = "Account";
            render();
            return;
        }

        displayName = user.displayName || (user.email || "").split("@")[0] || "Account";

        // Google serves a 96px image by default; ask for a sharper one.
        photo = user.photoURL
            ? user.photoURL.replace(/=s\d+-c$/, "=s192-c")
            : null;

        render();

    });

    new MutationObserver(function () {
        menuBtn.setAttribute("aria-expanded", String(group.classList.contains("open")));
    }).observe(group, { attributes: true, attributeFilter: ["class"] });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && group.classList.contains("open")) {
            group.classList.remove("open");
            menuBtn.focus();
        }
    });

})();

/* =====================================================
   FOOTER COPYRIGHT YEAR
   Shows the current year, so it rolls over by itself each January.
   ===================================================== */

(function updateFooterYear() {

    const el = document.getElementById("footerCopy");

    if (el) {
        el.textContent =
            `© ${new Date().getFullYear()} Outfloww. All rights reserved.`;
    }
})();
