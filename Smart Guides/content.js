(() => {
  window.__SMART_GUIDES_LOADED__ = window.__SMART_GUIDES_LOADED__ || false;
  if (window.__SMART_GUIDES_LOADED__) {
    // already loaded, do nothing
  } else {
    window.__SMART_GUIDES_LOADED__ = true;

/* Smart Guides Overlay (content.js)
   Fixes:
   - Top ruler numbers reappear by snapping originX to tick grid (nearest 10px)
   - Vertical guides in pixel mode are stored relative to originX (signed px)
   - Context menu always renders above guides (menu re-appended to root)
   - Guide creation only commits once cursor leaves ruler area + movement threshold
*/


const SG = (() => {
  const STORAGE_VERSION = 4;

  const DEFAULT_PREFS = {
    overlayEnabled: true,
    showGuides: true,
    rulersLocked: false,
    originX: 0, // px in top ruler canvas coords (0..usableWidth)
    defaultColour: "rgba(0, 153, 255, 0.95)",
    palette: [
      "rgba(0, 153, 255, 0.95)",
      "rgba(255, 59, 48, 0.95)",
      "rgba(52, 199, 89, 0.95)",
      "rgba(255, 204, 0, 0.95)",
      "rgba(175, 82, 222, 0.95)"
    ],
    groups: [
      { id: "default", name: "Default", colour: "rgba(0, 153, 255, 0.95)" },
      { id: "layout", name: "Layout", colour: "rgba(52, 199, 89, 0.95)" },
      { id: "type", name: "Typography", colour: "rgba(175, 82, 222, 0.95)" }
    ]
  };

  // Guides:
  // axis "x" (vertical): { unit:"ratio"|"px", value:number }
  //   - unit:"px" means signed px relative to originX (0 at origin)
  // axis "y" (horizontal): { unit:"px", value:number } value in usable coords (below top ruler)
  let guides = [];
  let prefs = { ...DEFAULT_PREFS };

  let root, topRuler, leftRuler, origin, menu, lockBtn;
  let overlayMounted = false;

  let dragState = null;
  const MOVE_THRESHOLD_PX = 6;

  function uid() {
    return "sg_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function roundTo(n, step) {
    return Math.round(n / step) * step;
  }

  function rulerSize() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--sg-ruler-size").trim();
    const n = parseInt(String(v).replace("px", ""), 10);
    return Number.isFinite(n) ? n : 24;
  }

  function usableWidth() {
    return Math.max(0, window.innerWidth - rulerSize());
  }

  function usableHeight() {
    return Math.max(0, window.innerHeight - rulerSize());
  }

  function originXClamped() {
    const uw = usableWidth();
    return clamp(prefs.originX || 0, 0, Math.max(0, uw));
  }

  function siteKey() {
    return `smartGuides:${location.origin}`;
  }

  async function loadPrefs() {
    const res = await chrome.storage.sync.get(["smartGuidesPrefsV1"]);
    const stored = res.smartGuidesPrefsV1;
    prefs = stored && typeof stored === "object" ? { ...DEFAULT_PREFS, ...stored } : { ...DEFAULT_PREFS };
    document.documentElement.style.setProperty("--sg-line", prefs.defaultColour);
  }

  async function savePrefs(partial) {
    prefs = { ...prefs, ...partial };
    await chrome.storage.sync.set({ smartGuidesPrefsV1: prefs });
    document.documentElement.style.setProperty("--sg-line", prefs.defaultColour);
  }

  async function loadGuides() {
    const res = await chrome.storage.local.get([siteKey()]);
    const payload = res[siteKey()];
    if (!payload || !Array.isArray(payload.guides)) {
      guides = [];
      return;
    }

    guides = payload.guides.map((g) => {
      if (g.axis === "x") {
        // older shape: pos -> px from left usable area. Convert to origin-relative px.
        if (typeof g.pos === "number" && typeof g.value !== "number") {
          const ox = originXClamped();
          return {
            id: g.id || uid(),
            axis: "x",
            locked: !!g.locked,
            unit: "px",
            value: (g.pos - ox),
            colour: g.colour,
            groupId: g.groupId || "default"
          };
        }
        // new shape
        return {
          id: g.id || uid(),
          axis: "x",
          locked: !!g.locked,
          unit: g.unit || "ratio",
          value: typeof g.value === "number" ? g.value : 0.5,
          colour: g.colour,
          groupId: g.groupId || "default"
        };
      }

      const y = typeof g.pos === "number" ? g.pos : (typeof g.value === "number" ? g.value : 100);
      return {
        id: g.id || uid(),
        axis: "y",
        locked: !!g.locked,
        unit: "px",
        value: y,
        colour: g.colour,
        groupId: g.groupId || "default"
      };
    });
  }

  async function saveGuides() {
    await chrome.storage.local.set({
      [siteKey()]: { version: STORAGE_VERSION, guides }
    });
  }

  function sizeCanvases() {
    const rs = rulerSize();
    topRuler.width = Math.max(0, window.innerWidth - rs);
    topRuler.height = rs;

    leftRuler.width = rs;
    leftRuler.height = Math.max(0, window.innerHeight - rs);
  }

  function updateReserveSpace() {
    // Only reserve space when rulers are locked visible.
    if (prefs.rulersLocked) document.documentElement.classList.add("sg-reserve-space");
    else document.documentElement.classList.remove("sg-reserve-space");
  }

  function ensureRoot() {
    if (root) return;

    root = document.createElement("div");
    root.id = "sg-root";

    origin = document.createElement("div");
    origin.id = "sg-origin";

    lockBtn = document.createElement("div");
    lockBtn.id = "sg-lock";
    lockBtn.title = "Lock ruler visibility";
    lockBtn.textContent = prefs.rulersLocked ? "🔒" : "🔓";
    origin.appendChild(lockBtn);

    topRuler = document.createElement("canvas");
    topRuler.id = "sg-top-ruler";

    leftRuler = document.createElement("canvas");
    leftRuler.id = "sg-left-ruler";

    menu = document.createElement("div");
    menu.id = "sg-menu";
    menu.style.display = "none";

    root.appendChild(origin);
    root.appendChild(topRuler);
    root.appendChild(leftRuler);
    root.appendChild(menu);

    document.documentElement.appendChild(root);

    sizeCanvases();
    drawRulers();

    window.addEventListener("resize", () => {
      if (!overlayMounted) return;
      sizeCanvases();
      drawRulers();
      renderGuides();
    }, { passive: true });

let lastScrollY = window.scrollY;
let scrollEndTimer = null;

window.addEventListener("scroll", () => {
  if (!overlayMounted) return;

  // Ignore horizontal scroll completely (it should not affect rulers)
  const dy = window.scrollY - lastScrollY;
  if (dy === 0) return;

  lastScrollY = window.scrollY;

  // Debounce: only redraw after scrolling stops
  if (scrollEndTimer) clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => {
    // draw only the left ruler here
    drawLeftRulerOnly();
  }, 80);
}, { passive: true, capture: true });
	
	
	/* Vertical Flash Replacement End */
	
	
    origin.addEventListener("contextmenu", (e) => e.preventDefault());
    topRuler.addEventListener("contextmenu", (e) => e.preventDefault());
    leftRuler.addEventListener("contextmenu", (e) => e.preventDefault());

    origin.addEventListener("contextmenu", (e) => openGlobalMenu(e.clientX, e.clientY));
    topRuler.addEventListener("contextmenu", (e) => openGlobalMenu(e.clientX, e.clientY));
    leftRuler.addEventListener("contextmenu", (e) => openGlobalMenu(e.clientX, e.clientY));

    lockBtn.addEventListener("pointerdown", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const locked = !prefs.rulersLocked;
      await savePrefs({ rulersLocked: locked });

      lockBtn.textContent = locked ? "🔒" : "🔓";
      root.classList.toggle("sg-rulers-locked", locked);
      if (!locked) root.classList.remove("sg-rulers-active");

      updateReserveSpace();
      drawRulers();
      renderGuides();
    });

    document.addEventListener("pointermove", (e) => {
      if (!overlayMounted) return;
      if (prefs.rulersLocked) return;

      const nearTop = e.clientY >= 0 && e.clientY <= 5;
      const nearLeft = e.clientX >= 0 && e.clientX <= 5;
      root.classList.toggle("sg-rulers-active", nearTop || nearLeft);
    }, { passive: true });

    document.addEventListener("pointerdown", (e) => {
      if (!overlayMounted) return;
      if (menu.style.display === "none") return;
      const path = e.composedPath?.() || [];
      if (!path.includes(menu)) hideMenu();
    }, { capture: true });

    document.addEventListener("keydown", (e) => {
      if (!overlayMounted) return;
      if (e.key === "Escape") cancelDrag();
    });

    topRuler.addEventListener("pointerdown", onTopRulerPointerDown);
    leftRuler.addEventListener("pointerdown", onLeftRulerPointerDown);

    root.classList.toggle("sg-rulers-locked", !!prefs.rulersLocked);
  }

  function drawLeftRulerOnly() {
    const rs = rulerSize();

    const rulerBg = "rgba(20, 20, 20, 0.75)";
    const rulerFg = "rgba(255, 255, 255, 0.8)";
    const rulerFgDim = "rgba(255, 255, 255, 0.45)";
    const font = "10px " + (getComputedStyle(document.documentElement).getPropertyValue("--sg-font").trim() || "Arial");

    const ctx = leftRuler.getContext("2d");
    ctx.clearRect(0, 0, leftRuler.width, leftRuler.height);
    ctx.fillStyle = rulerBg;
    ctx.fillRect(0, 0, leftRuler.width, leftRuler.height);
    ctx.font = font;

    const offsetY = window.scrollY;

    for (let y = 0; y < leftRuler.height; y += 10) {
      const pageY = y + offsetY;
      const is100 = pageY % 100 === 0;
      const is50 = pageY % 50 === 0;
      const w = is100 ? Math.round(rs * 0.5) : is50 ? Math.round(rs * 0.38) : Math.round(rs * 0.25);

      ctx.strokeStyle = is100 ? rulerFg : rulerFgDim;
      ctx.beginPath();
      ctx.moveTo(rs, y + 0.5);
      ctx.lineTo(rs - w, y + 0.5);
      ctx.stroke();

      if (is100) {
        ctx.save();
        ctx.translate(Math.round(rs * 0.55), y + Math.min(12, Math.round(rs * 0.55)));
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = rulerFg;
        ctx.fillText(String(pageY), 0, 0);
        ctx.restore();
      }
    }
  }


  function drawRulers() {
    const rs = rulerSize();
    const ox = originXClamped();

    const rulerBg = "rgba(20, 20, 20, 0.75)";
    const rulerFg = "rgba(255, 255, 255, 0.8)";
    const rulerFgDim = "rgba(255, 255, 255, 0.45)";
    const font = "10px " + (getComputedStyle(document.documentElement).getPropertyValue("--sg-font").trim() || "Arial");

    // Top ruler: values relative to originX, supports negatives.
	// Top ruler: values relative to originX, supports negatives, smooth originX.
	{
	  const ctx = topRuler.getContext("2d");
	  ctx.clearRect(0, 0, topRuler.width, topRuler.height);
	  ctx.fillStyle = rulerBg;
	  ctx.fillRect(0, 0, topRuler.width, topRuler.height);
	  ctx.font = font;

	  // Ticks every 10px
	  for (let x = 0; x < topRuler.width; x += 10) {
	    const rel = x - ox; // can be fractional during drag
	    const is100 = Math.round(rel) % 100 === 0;
	    const is50 = Math.round(rel) % 50 === 0;
	    const h = is100 ? Math.round(rs * 0.5) : is50 ? Math.round(rs * 0.38) : Math.round(rs * 0.25);

	    ctx.strokeStyle = is100 ? rulerFg : rulerFgDim;
	    ctx.beginPath();
	    ctx.moveTo(x + 0.5, rs);
	    ctx.lineTo(x + 0.5, rs - h);
	    ctx.stroke();
	  }

	  // Labels at exact multiples of 100 relative to origin (no flashing)
	  // rel = x - ox, so x = ox + rel
	  const relLeft = -ox;
	  const relRight = topRuler.width - ox;
	  let first = Math.ceil(relLeft / 100) * 100;

	  for (let rel = first; rel <= relRight; rel += 100) {
	    const x = ox + rel;
	    if (x < 0 || x > topRuler.width - 1) continue;
	    ctx.fillStyle = rulerFg;
	    ctx.fillText(String(rel), x + 2, Math.min(10, rs - 2));
	  }

	  // Origin marker
	  ctx.strokeStyle = "rgba(255,255,255,0.45)";
	  ctx.beginPath();
	  ctx.moveTo(ox + 0.5, 0);
	  ctx.lineTo(ox + 0.5, rs);
	  ctx.stroke();
	}

    // Left ruler
    {
      const ctx = leftRuler.getContext("2d");
      ctx.clearRect(0, 0, leftRuler.width, leftRuler.height);
      ctx.fillStyle = rulerBg;
      ctx.fillRect(0, 0, leftRuler.width, leftRuler.height);
      ctx.font = font;

      const offsetY = window.scrollY;

      for (let y = 0; y < leftRuler.height; y += 10) {
        const pageY = y + offsetY;
        const is100 = pageY % 100 === 0;
        const is50 = pageY % 50 === 0;
        const w = is100 ? Math.round(rs * 0.5) : is50 ? Math.round(rs * 0.38) : Math.round(rs * 0.25);

        ctx.strokeStyle = is100 ? rulerFg : rulerFgDim;
        ctx.beginPath();
        ctx.moveTo(rs, y + 0.5);
        ctx.lineTo(rs - w, y + 0.5);
        ctx.stroke();

        if (is100) {
          ctx.save();
          ctx.translate(Math.round(rs * 0.55), y + Math.min(12, Math.round(rs * 0.55)));
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = rulerFg;
          ctx.fillText(String(pageY), 0, 0);
          ctx.restore();
        }
      }
    }
  }

  function mountOverlay() {
    ensureRoot();
    overlayMounted = true;

    root.style.display = prefs.overlayEnabled ? "block" : "none";
    root.classList.toggle("sg-rulers-locked", !!prefs.rulersLocked);
    if (lockBtn) lockBtn.textContent = prefs.rulersLocked ? "🔒" : "🔓";

	updateReserveSpace();
	renderGuides();

	/* 
	// Snap stored originX to tick grid so labels render immediately
	
	const snapped = Math.round(originXClamped() / 10) * 10;
	if (snapped !== prefs.originX) {
	  prefs.originX = snapped;
	  savePrefs({ originX: snapped });
	}
	*/
	drawRulers();
  }

  function unmountOverlay() {
    overlayMounted = false;
    document.documentElement.classList.remove("sg-reserve-space");
    hideMenu();
    if (root) root.style.display = "none";
  }

  function toggleOverlay() {
    prefs.overlayEnabled = !prefs.overlayEnabled;
    savePrefs({ overlayEnabled: prefs.overlayEnabled });
    if (prefs.overlayEnabled) mountOverlay();
    else unmountOverlay();
  }

  function hideMenu() {
    menu.style.display = "none";
    menu.innerHTML = "";
  }

  function showMenuAt(x, y, items) {
    // Ensure menu is the last child so it sits above guides
    if (root && menu && menu.parentElement === root) root.appendChild(menu);

    menu.innerHTML = "";
    for (const item of items) {
      if (item.type === "sep") {
        const sep = document.createElement("div");
        sep.className = "sg-menu-sep";
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement("div");
      row.className = "sg-menu-item";
      row.textContent = item.label;

      if (item.badge) {
        const badge = document.createElement("span");
        badge.className = "sg-badge";
        badge.textContent = item.badge;
        row.appendChild(badge);
      }
      if (item.dot) {
        const dot = document.createElement("span");
        dot.className = "sg-colour-dot";
        dot.style.background = item.dot;
        row.appendChild(dot);
      }
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideMenu();
        item.onClick?.();
      });
      menu.appendChild(row);
    }

    menu.style.display = "block";
    const rect = menu.getBoundingClientRect();
    const px = clamp(x, 8, window.innerWidth - rect.width - 8);
    const py = clamp(y, 8, window.innerHeight - rect.height - 8);
    menu.style.left = `${px}px`;
    menu.style.top = `${py}px`;
  }

  function openGlobalMenu(x, y) {
    const items = [
      {
        label: prefs.showGuides ? "Hide all guides" : "Show all guides",
        onClick: async () => {
          await savePrefs({ showGuides: !prefs.showGuides });
          renderGuides();
        }
      },
      { type: "sep" },
      {
        label: "Lock all guides",
        onClick: async () => {
          guides = guides.map((g) => ({ ...g, locked: true }));
          await saveGuides();
          renderGuides();
        }
      },
      {
        label: "Unlock all guides",
        onClick: async () => {
          guides = guides.map((g) => ({ ...g, locked: false }));
          await saveGuides();
          renderGuides();
        }
      },
      { type: "sep" },
      {
        label: "Clear all guides",
        onClick: async () => {
          guides = [];
          await saveGuides();
          renderGuides();
        }
      }
    ];
    showMenuAt(x, y, items);
  }

  function guideColour(guide) {
    if (guide.colour) return guide.colour;
    if (guide.groupId) {
      const grp = prefs.groups.find((g) => g.id === guide.groupId);
      if (grp?.colour) return grp.colour;
    }
    return prefs.defaultColour;
  }

  function xFromGuide(g) {
    const rs = rulerSize();
    const uw = usableWidth();
    const ox = originXClamped();

    if (g.unit === "ratio") {
      const span = Math.max(1, uw - ox);
      return rs + ox + (clamp(g.value, 0, 1) * span);
    }

    // px is signed relative to originX
    const xUsable = ox + g.value; // g.value can be negative
    return rs + clamp(xUsable, 0, uw);
  }

  function guideModelFromClientX(clientX, pixelMode) {
    const rs = rulerSize();
    const uw = usableWidth();
    const ox = originXClamped();

    const xInUsable = clamp(clientX - rs, 0, uw);

	if (xInUsable < ox) {
	  return { unit: "px", value: (xInUsable - ox) }; // negative
	}

	const span = Math.max(1, uw - ox);
	const ratio = clamp((xInUsable - ox) / span, 0, 1);
	return { unit: "ratio", value: ratio };
  }

  function renderGuides() {
    if (!root) return;

    root.querySelectorAll(".sg-guide").forEach((el) => el.remove());
    if (!prefs.overlayEnabled || !prefs.showGuides) return;

    for (const g of guides) {
      const el = document.createElement("div");
      el.className = `sg-guide ${g.axis === "x" ? "sg-vertical" : "sg-horizontal"} ${g.locked ? "sg-locked" : ""}`;
      el.dataset.guideId = g.id;
      el.style.background = guideColour(g);

      if (g.axis === "x") {
        el.style.left = `${Math.round(xFromGuide(g))}px`;
      } else {
        const rs = rulerSize();
        el.style.top = `${Math.round(rs + clamp(g.value, 0, usableHeight()))}px`;
      }

      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGuideMenu(g.id, e.clientX, e.clientY);
      });

      const handle = document.createElement("div");
      handle.className = "sg-guide-handle";
      el.appendChild(handle);

      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (g.locked) return;
        beginMoveGuide(g.id, e);
      });

      root.appendChild(el);
    }
  }

  function openGuideMenu(guideId, x, y) {
    const g = guides.find((gg) => gg.id === guideId);
    if (!g) return;

    const lockLabel = g.locked ? "Unlock guide" : "Lock guide";
    const isX = g.axis === "x";
    const unitBadge = isX ? (g.unit === "ratio" ? "Responsive" : "Pixels") : "Pixels";

    const items = [
      {
        label: lockLabel,
        badge: unitBadge,
        onClick: async () => {
          g.locked = !g.locked;
          await saveGuides();
          renderGuides();
        }
      },
      {
        label: "Delete guide",
        onClick: async () => {
          guides = guides.filter((xx) => xx.id !== guideId);
          await saveGuides();
          renderGuides();
        }
      },
      { type: "sep" }
    ];

    if (isX) {
      items.push({
        label: g.unit === "ratio" ? "Switch to pixel mode" : "Switch to responsive mode",
        onClick: async () => {
          const uw = usableWidth();
          const ox = originXClamped();

          if (g.unit === "ratio") {
            // Convert to signed px relative to origin
            const xUsable = clamp(xFromGuide(g) - rulerSize(), 0, uw);
            g.unit = "px";
            g.value = xUsable - ox;
          } else {
            // Convert to ratio relative to origin
            const span = Math.max(1, uw - ox);
            const ratio = clamp((clamp(ox + g.value, 0, uw) - ox) / span, 0, 1);
            g.unit = "ratio";
            g.value = ratio;
          }

          await saveGuides();
          renderGuides();
        }
      });
      items.push({ type: "sep" });
    }

    items.push(
      {
        label: "Reset to default colour",
        onClick: async () => {
          delete g.colour;
          g.groupId = "default";
          await saveGuides();
          renderGuides();
        }
      },
      { type: "sep" },
      ...prefs.palette.slice(0, 5).map((col) => ({
        label: "Set colour",
        badge: col.replace("rgba(", "").replace(")", ""),
        dot: col,
        onClick: async () => {
          g.colour = col;
          await saveGuides();
          renderGuides();
        }
      })),
      { type: "sep" },
      ...prefs.groups.slice(0, 5).map((grp) => ({
        label: "Assign group",
        badge: grp.name,
        dot: grp.colour,
        onClick: async () => {
          g.groupId = grp.id;
          delete g.colour;
          await saveGuides();
          renderGuides();
        }
      }))
    );

    showMenuAt(x, y, items);
  }

  function cancelDrag() {
    if (!dragState) return;
    if (dragState.ghostEl) dragState.ghostEl.remove();
    dragState = null;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
  }

  function onTopRulerPointerDown(e) {
    if (!prefs.rulersLocked && !root.classList.contains("sg-rulers-active")) return;
    if (e.button !== 0) return;
    hideMenu();

    // SHIFT: set originX so that 0 is under cursor, snapped to tick grid
    if (e.shiftKey) {
      beginOriginDrag(e);
      return;
    }

    // TOP ruler creates horizontal guide, only commits after leaving ruler area
    beginCreateGuide("y", e, false);
  }

  function onLeftRulerPointerDown(e) {
    if (!prefs.rulersLocked && !root.classList.contains("sg-rulers-active")) return;
    if (e.button !== 0) return;
    hideMenu();

    // LEFT ruler creates vertical guide, only commits after leaving ruler area
    const pixelMode = !!e.altKey;
    beginCreateGuide("x", e, pixelMode);
  }

  function beginOriginDrag(e) {
    dragState = { type: "origin" };
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);

    // Apply immediately on click-down too
    applyOriginFromEvent(e);
  }

  function applyOriginFromEvent(e) {
    const rs = rulerSize();
    const xOnRuler = clamp(e.clientX - rs, 0, usableWidth());
    // Snap origin to 10px grid so ticks and labels align (restores top numbers)
    prefs.originX = xOnRuler; // smooth, per-pixel
    drawRulers();
    renderGuides();
  }

  function beginCreateGuide(axis, e, pixelMode) {
    dragState = {
      type: "create",
      axis,
      pixelMode,
      startMouse: { x: e.clientX, y: e.clientY },
      moved: false,
      inRulerArea: true,
      ghostEl: makeGhost(axis)
    };
    updateCreateGhost(e);
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
  }

  function beginMoveGuide(guideId, e) {
    const g = guides.find((gg) => gg.id === guideId);
    if (!g) return;

    dragState = {
      type: "move",
      guideId,
      axis: g.axis,
      pixelMode: !!e.altKey
    };
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
  }

  function makeGhost(axis) {
    const el = document.createElement("div");
    el.className = `sg-guide ${axis === "x" ? "sg-vertical" : "sg-horizontal"}`;
    el.style.opacity = "0.55";
    el.style.background = prefs.defaultColour;
    root.appendChild(el);
    return el;
  }

  function updateCreateGhost(e) {
    if (!dragState?.ghostEl || dragState.type !== "create") return;

    const rs = rulerSize();

    if (dragState.axis === "x") {
      const model = guideModelFromClientX(e.clientX, dragState.pixelMode || !!e.altKey);
      const x = xFromGuide({ axis: "x", unit: model.unit, value: model.value });
      dragState.ghostEl.style.left = `${Math.round(x)}px`;
    } else {
      const yInUsable = clamp(e.clientY - rs, 0, usableHeight());
      dragState.ghostEl.style.top = `${Math.round(rs + yInUsable)}px`;
    }
  }

  function onDragMove(e) {
    if (!dragState) return;

    const rs = rulerSize();

    if (dragState.type === "origin") {
      applyOriginFromEvent(e);
      return;
    }

    if (dragState.type === "create") {
      const dx = e.clientX - dragState.startMouse.x;
      const dy = e.clientY - dragState.startMouse.y;
      const dist = Math.sqrt((dx * dx) + (dy * dy));
      if (dist >= MOVE_THRESHOLD_PX) dragState.moved = true;

      // Determine whether cursor has left the ruler area for this drag
      if (dragState.axis === "x") dragState.inRulerArea = e.clientX <= rs;
      else dragState.inRulerArea = e.clientY <= rs;

      updateCreateGhost(e);
      return;
    }

    if (dragState.type === "move") {
      const g = guides.find((gg) => gg.id === dragState.guideId);
      if (!g || g.locked) return;

      if (g.axis === "x") {
        const model = guideModelFromClientX(e.clientX, dragState.pixelMode || !!e.altKey);
        g.unit = model.unit;
        g.value = model.value;
      } else {
        g.unit = "px";
        g.value = clamp(e.clientY - rs, 0, usableHeight());
      }

      renderGuides();
    }
  }

  async function onDragEnd(e) {
    if (!dragState) return;

    const rs = rulerSize();

    if (dragState.type === "origin") {
      applyOriginFromEvent(e);
      await savePrefs({ originX: originXClamped() });

      dragState = null;
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("pointerup", onDragEnd, true);
      return;
    }

    if (dragState.type === "create") {
      const shouldCreate = dragState.moved && !dragState.inRulerArea;
      dragState.ghostEl?.remove();

      if (shouldCreate) {
        if (dragState.axis === "x") {
          const model = guideModelFromClientX(e.clientX, dragState.pixelMode || !!e.altKey);
          guides.push({
            id: uid(),
            axis: "x",
            locked: false,
            unit: model.unit,
            value: model.value,
            groupId: "default"
          });
        } else {
          guides.push({
            id: uid(),
            axis: "y",
            locked: false,
            unit: "px",
            value: clamp(e.clientY - rs, 0, usableHeight()),
            groupId: "default"
          });
        }

        await saveGuides();
        renderGuides();
      }

      dragState = null;
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("pointerup", onDragEnd, true);
      return;
    }

    if (dragState.type === "move") {
      await saveGuides();
      dragState = null;
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("pointerup", onDragEnd, true);
      return;
    }

    dragState = null;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
  }

  async function init() {
    await loadPrefs();
    await loadGuides();

    if (prefs.overlayEnabled) mountOverlay();
    else unmountOverlay();

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "SG_TOGGLE_OVERLAY") toggleOverlay();
    });
  }

  return { init };
})();

SG.init();
  }
})();