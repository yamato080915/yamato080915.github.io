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
