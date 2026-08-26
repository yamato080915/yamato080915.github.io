const MAPS = [
	"abyss", "ascent", "bind", "breeze", "corrode", "fracture", "haven", "icebox", "lotus", "pearl", "split", "summit", "sunset"
];
const ITEM_HEIGHT = 90;

function mapImageUrl(map) {
	return `url('/valorant/static/pictures/${map.toLowerCase()}.png')`;
}

const mapListEl = document.getElementById("mapList");
const slotStrip = document.getElementById("slotStrip");
const hintText = document.getElementById("hintText");
const pickBtn = document.getElementById("pickBtn");
const resetBtn = document.getElementById("resetBtn");

// チェックボックス一覧を生成
MAPS.forEach((map) => {
	const col = document.createElement("div");
		col.className = "min-w-0";

	const wrapper = document.createElement("div");
		wrapper.className = "map-option";
	wrapper.id = `wrap-${map}`;
	wrapper.style.backgroundImage = mapImageUrl(map);

	const tint = document.createElement("div");
		tint.className = "map-option-tint";
	
	const input = document.createElement("input");
		input.className = "map-option-input size-4 rounded border-white/70 text-valorant focus:ring-red-300";
	input.type = "checkbox";
	input.id = `ban-${map}`;
	input.value = map;
	input.addEventListener("change", () => {
		wrapper.classList.toggle("banned", input.checked);
	});

	const label = document.createElement("label");
		label.className = "map-option-label capitalize";
	label.setAttribute("for", `ban-${map}`);
	label.textContent = map;

	wrapper.appendChild(tint);
	wrapper.appendChild(input);
	wrapper.appendChild(label);
	col.appendChild(wrapper);
	mapListEl.appendChild(col);
});

function getBannedMaps() {
	return MAPS.filter((map) => document.getElementById(`ban-${map}`).checked);
}

function pickRandomMap() {
	const banned = getBannedMaps();
	const candidates = MAPS.filter((map) => !banned.includes(map));

	if (candidates.length === 0) {
		hintText.innerHTML = `<span class="font-medium text-red-700"><i class="bi bi-exclamation-triangle"></i> 全てのマップがBANされています</span>`;
		return;
	}

	pickBtn.disabled = true;
	resetBtn.disabled = true;
	hintText.textContent = "抽選中…";

	const chosen = candidates[Math.floor(Math.random() * candidates.length)];

	// スロット演出用に、候補マップをランダムに並べたリストを作り、
	// 最後の要素を当選マップにする
	const REEL_LENGTH = 24;
	const reel = [];
	for (let i = 0; i < REEL_LENGTH - 1; i++) {
		reel.push(candidates[Math.floor(Math.random() * candidates.length)]);
	}
	reel.push(chosen);

	// ストリップを再構築し、アニメーションなしで先頭位置に戻す
	slotStrip.style.transition = "none";
	slotStrip.style.transform = "translateY(0)";
	slotStrip.innerHTML = "";
	reel.forEach((map) => {
		const item = document.createElement("div");
		item.className = "slot-item";
		item.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), ${mapImageUrl(map)}`;
		item.textContent = map;
		slotStrip.appendChild(item);
	});

	// 強制リフロー後、減速しながら最後の項目まで回転させる
	void slotStrip.offsetHeight;
	const targetY = -(ITEM_HEIGHT * (reel.length - 1));
	slotStrip.style.transition = "transform 2.4s cubic-bezier(0.15, 0.85, 0.25, 1)";
	slotStrip.style.transform = `translateY(${targetY}px)`;

	slotStrip.addEventListener("transitionend", function onEnd() {
		slotStrip.removeEventListener("transitionend", onEnd);
		hintText.innerHTML = `選ばれたマップ: <strong class="capitalize text-slate-950">${chosen}</strong>`;
		pickBtn.disabled = false;
		resetBtn.disabled = false;
	}, { once: true });
}

function resetBans() {
	MAPS.forEach((map) => {
		const input = document.getElementById(`ban-${map}`);
		input.checked = false;
		document.getElementById(`wrap-${map}`).classList.remove("banned");
	});
	slotStrip.style.transition = "none";
	slotStrip.style.transform = "translateY(0)";
	slotStrip.innerHTML = `<div class="slot-item">?</div>`;
	hintText.textContent = "「マップを選ぶ」ボタンを押してください";
}

pickBtn.addEventListener("click", pickRandomMap);
resetBtn.addEventListener("click", resetBans);
