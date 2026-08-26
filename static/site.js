document.addEventListener("DOMContentLoaded", () => {
	const toggle = document.getElementById("nav-toggle");
	const menu = document.getElementById("nav-menu");
	if (!toggle || !menu) return;

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
});
