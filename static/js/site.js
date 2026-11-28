(() => {
	const root = document.documentElement;
	const overlay = document.getElementById("page-loading-overlay");
	if (!overlay) return;

	const minimumDisplayMs = 150;
	let visibleSince = performance.now();
	let hideTimer = null;
	let skipPageHide = false;
	let skipPageHideTimer = null;
	window.pageLoadingInitialized = true;

	const show = () => {
		window.clearTimeout(hideTimer);
		root.classList.add("page-loading");
		visibleSince = performance.now();
	};

	const hide = () => {
		window.clearTimeout(hideTimer);
		root.classList.remove("page-loading");
	};

	const hideAfterReady = () => {
		const remaining = Math.max(0, minimumDisplayMs - (performance.now() - visibleSince));
		hideTimer = window.setTimeout(hide, remaining);
	};

	document.addEventListener("click", event => {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (!(event.target instanceof Element)) return;
		const link = event.target.closest("a[href]");
		if (!link) return;

		const target = link.getAttribute("target");
		if (target && target.toLowerCase() !== "_self") return;
		if (link.hasAttribute("download")) {
			skipPageHide = true;
		} else {
			let destination;
			try {
				destination = new URL(link.href, location.href);
			} catch {
				return;
			}
			if (destination.protocol !== "http:" && destination.protocol !== "https:") return;

			if (destination.origin !== location.origin) {
				skipPageHide = true;
			} else {
				const samePage = destination.pathname === location.pathname && destination.search === location.search;
				if (samePage && destination.hash) return;
				skipPageHide = false;
				window.clearTimeout(skipPageHideTimer);
				show();
				return;
			}
		}

		window.clearTimeout(skipPageHideTimer);
		skipPageHideTimer = window.setTimeout(() => { skipPageHide = false; }, 2000);
	});

	window.addEventListener("pagehide", () => {
		if (skipPageHide) {
			skipPageHide = false;
			window.clearTimeout(skipPageHideTimer);
			return;
		}
		show();
	});

	window.addEventListener("pageshow", event => {
		if (event.persisted) hide();
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", hideAfterReady, { once: true });
	} else {
		hideAfterReady();
	}
})();

// R and G encode the inward surface normal. Neutral grey leaves the centre undistorted.
function createNavRimMap(width, height, cornerRadius) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	const rim = 6;
	const radius = Math.min(cornerRadius, width / 2, height / 2);
	const pixels = ctx.createImageData(width, height);
	const neutral = new Uint32Array(pixels.data.buffer);
	neutral.fill(0xff808080);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			// Skip the entire flat span on long horizontal bars.
			if (y >= rim && y < height - rim && x >= radius + rim && x < width - radius - rim) {
				x = Math.ceil(width - radius - rim) - 1;
				continue;
			}
			const dx = x + 0.5 - width / 2;
			const dy = y + 0.5 - height / 2;
			const qx = Math.abs(dx) - (width / 2 - radius);
			const qy = Math.abs(dy) - (height / 2 - radius);
			const nx = Math.max(qx, 0);
			const ny = Math.max(qy, 0);
			const length = Math.hypot(nx, ny);
			const depth = radius - length - Math.min(Math.max(qx, qy), 0);
			if (!length || depth < -1 || depth >= rim) continue;
			const gain = 127 * (1 - Math.max(depth, 0) / rim) ** 2;
			const i = 4 * (y * width + x);
			pixels.data[i] = 128 - Math.sign(dx) * nx / length * gain;
			pixels.data[i + 1] = 128 - Math.sign(dy) * ny / length * gain;
		}
	}
	ctx.putImageData(pixels, 0, 0);
	return canvas.toDataURL();
}

function initNavGlass(nav, menuToggle, closeMenu) {
	const panel = document.getElementById("glass-settings");
	const triggers = nav.querySelectorAll("[data-glass-settings]");
	const transparency = document.getElementById("glass-transparency");
	const refraction = document.getElementById("glass-refraction");
	const map = document.getElementById("nav-glass-map");
	const bend = document.getElementById("nav-glass-bend");
	const support = document.getElementById("glass-support");
	const reduceTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
	const storageKey = "yamato080915.nav-glass.v1";
	const defaults = () => reduceTransparency.matches
		? { transparency: 0, refraction: 0 }
		: { transparency: 75, refraction: 40 };
	const validPercent = value => Number.isInteger(value) && value >= 0 && value <= 100;
	let saved = null;
	let opener = null;
	let mapReady = false;
	// Some engines accept the URL syntax but do not render SVG backdrop filters.
	const chromium = /(?:Chrome|Chromium)\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
	let canRefract = chromium && typeof ResizeObserver !== "undefined" && CSS.supports("backdrop-filter", 'url("#nav-glass-lens")');

	function applyValues() {
		const clear = Number(transparency.value);
		const strength = Number(refraction.value);
		nav.style.setProperty("--glass-tint", String(1 - clear / 100));
		if (canRefract && mapReady && clear > 0) {
			bend.setAttribute("scale", String(strength * 0.32));
			nav.style.setProperty("--glass-optics", 'url("#nav-glass-lens")');
		} else {
			nav.style.removeProperty("--glass-optics");
		}
		for (const input of [transparency, refraction]) {
			const valueText = input.value + "%";
			panel.querySelector('output[for="' + input.id + '"]').value = valueText;
			input.setAttribute("aria-valuetext", valueText);
		}
	}

	function showPreferences() {
		const values = saved || defaults();
		transparency.value = values.transparency;
		refraction.value = values.refraction;
		applyValues();
	}

	function restore() {
		try {
			const values = JSON.parse(localStorage.getItem(storageKey));
			saved = validPercent(values?.transparency) && validPercent(values?.refraction) ? values : null;
		} catch {
			// If storage is blocked, keep the settings selected on this page.
		}
		showPreferences();
	}

	function reflectSupport() {
		refraction.disabled = !canRefract;
		support.hidden = canRefract;
		if (!canRefract) refraction.setAttribute("aria-describedby", support.id);
	}

	restore();
	reflectSupport();
	if (canRefract) {
		const observer = new ResizeObserver(() => {
			const width = nav.clientWidth;
			const height = nav.clientHeight;
			if (!width || !height) return;
			try {
				const image = createNavRimMap(width, height, parseFloat(getComputedStyle(nav).borderTopLeftRadius));
				if (!image) throw new Error("No canvas context");
				for (const region of [map.parentElement, map]) {
					region.setAttribute("width", width);
					region.setAttribute("height", height);
				}
				map.setAttribute("href", image);
				mapReady = true;
			} catch {
				canRefract = false;
				reflectSupport();
				observer.disconnect();
			}
			applyValues();
		});
		observer.observe(nav);
	}

	for (const input of [transparency, refraction]) {
		input.addEventListener("input", applyValues);
		input.addEventListener("change", () => {
			saved = { transparency: Number(transparency.value), refraction: Number(refraction.value) };
			try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* ページ内では保持する。 */ }
		});
	}
	document.getElementById("glass-reset").addEventListener("click", () => {
		saved = null;
		try { localStorage.removeItem(storageKey); } catch { /* ページ内ではリセットする。 */ }
		showPreferences();
	});
	reduceTransparency.addEventListener("change", () => { if (!saved) showPreferences(); });
	window.addEventListener("pageshow", event => { if (event.persisted) restore(); });
	window.addEventListener("storage", event => { if (event.key === storageKey || event.key === null) restore(); });

	function closePanel(returnFocus) {
		if (panel.hidden) return;
		panel.hidden = true;
		triggers.forEach(button => button.setAttribute("aria-expanded", "false"));
		if (returnFocus) {
			const target = opener?.getClientRects().length ? opener : menuToggle.getClientRects().length ? menuToggle : triggers[0];
			target.focus();
		}
	}
	triggers.forEach(button => button.addEventListener("click", () => {
		if (!panel.hidden) return closePanel(true);
		opener = button;
		closeMenu();
		panel.hidden = false;
		triggers.forEach(trigger => trigger.setAttribute("aria-expanded", "true"));
		transparency.focus();
	}));
	document.getElementById("glass-close").addEventListener("click", () => closePanel(true));
	document.addEventListener("keydown", event => { if (event.key === "Escape") closePanel(true); });
	document.addEventListener("click", event => {
		if (!panel.hidden && !panel.contains(event.target) && !event.target.closest("[data-glass-settings]")) closePanel(false);
	});
}

document.addEventListener("DOMContentLoaded", () => {
	const loadingImageUrl = "/static/loading.svg";
	window.createLoadingIndicator = (label = "読み込んでいます…", className = "loading-inline") => {
		const wrapper = document.createElement("span");
		wrapper.className = className;
		wrapper.setAttribute("role", "status");
		wrapper.setAttribute("aria-live", "polite");
		const image = document.createElement("img");
		image.src = loadingImageUrl;
		image.alt = "";
		image.setAttribute("aria-hidden", "true");
		const text = document.createElement("span");
		text.textContent = label;
		wrapper.append(image, text);
		return wrapper;
	};

	const toggle = document.getElementById("nav-toggle");
	const menu = document.getElementById("nav-menu");
	if (toggle && menu) {
		const closeMenu = () => {
			menu.classList.add("hidden");
			toggle.setAttribute("aria-expanded", "false");
		};

		toggle.addEventListener("click", () => {
			const willOpen = menu.classList.contains("hidden");
			menu.classList.toggle("hidden", !willOpen);
			toggle.setAttribute("aria-expanded", String(willOpen));
		});

		menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
		initNavGlass(toggle.closest("nav"), toggle, closeMenu);
		window.addEventListener("resize", () => {
			if (window.innerWidth >= 768) closeMenu();
		});
	}

	const modal = document.getElementById("notification-modal");
	if (!modal) return;

	const notificationId = modal.dataset.notificationId;
	const storageKey = "yamato080915.read-notification-ids";
	let previousFocus = null;

	const readNotificationIds = () => {
		try {
			const stored = window.localStorage.getItem(storageKey);
			const parsed = stored ? JSON.parse(stored) : [];
			return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
		} catch {
			return [];
		}
	};

	const markAsRead = () => {
		try {
			const readIds = readNotificationIds();
			if (!readIds.includes(notificationId)) {
				window.localStorage.setItem(storageKey, JSON.stringify([...readIds, notificationId]));
			}
		} catch {
			// localStorageが利用できなくても、通知は閉じられるようにする。
		}
	};

	const closeNotification = () => {
		markAsRead();
		modal.classList.add("hidden");
		modal.setAttribute("aria-hidden", "true");
		document.body.classList.remove("notification-modal-open");
		if (previousFocus instanceof HTMLElement) previousFocus.focus();
	};

	if (!notificationId || readNotificationIds().includes(notificationId)) return;

	previousFocus = document.activeElement;
	modal.classList.remove("hidden");
	modal.removeAttribute("aria-hidden");
	document.body.classList.add("notification-modal-open");
	const firstCloseButton = modal.querySelector("[data-notification-close]");
	if (firstCloseButton instanceof HTMLElement) firstCloseButton.focus();
	modal.querySelectorAll("[data-notification-close]").forEach((element) => {
		element.addEventListener("click", closeNotification);
	});
	modal.addEventListener("click", (event) => {
		if (event.target === modal) closeNotification();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !modal.classList.contains("hidden")) closeNotification();
	});
});
