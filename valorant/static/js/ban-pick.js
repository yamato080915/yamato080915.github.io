const ALL_MAPS = ["Ascent", "Breeze", "Haven", "Lotus", "Split", "Summit", "Sunset"];

function mapBgStyle(map, tint) {
	return `linear-gradient(${tint}, ${tint}), url('/valorant/static/pictures/${map.toLowerCase()}.png')`;
}

// VCT公式ルール(4.6.8 / 4.6.9)に基づく手順定義
// action: "ban" | "pick" | "side" | "remain"
// team: "A" | "B"（sideの場合はサイドを選ぶ側のチーム）
const SEQUENCES = {
	bo3: [
		{ team: "A", action: "ban" },
		{ team: "B", action: "ban" },
		{ team: "A", action: "pick", slot: 1 },
		{ team: "B", action: "side", slot: 1 },
		{ team: "B", action: "pick", slot: 2 },
		{ team: "A", action: "side", slot: 2 },
		{ team: "A", action: "ban" },
		{ team: "B", action: "ban" },
		{ team: null, action: "remain", slot: 3 },
		{ team: "A", action: "side", slot: 3 },
	],
	bo5: [
		{ team: "A", action: "ban" },
		{ team: "B", action: "ban" },
		{ team: "A", action: "pick", slot: 1 },
		{ team: "B", action: "side", slot: 1 },
		{ team: "B", action: "pick", slot: 2 },
		{ team: "A", action: "side", slot: 2 },
		{ team: "A", action: "pick", slot: 3 },
		{ team: "B", action: "side", slot: 3 },
		{ team: "B", action: "pick", slot: 4 },
		{ team: "A", action: "side", slot: 4 },
		{ team: null, action: "remain", slot: 5 },
		{ team: "B", action: "side", slot: 5 },
	],
};

let state = {
	teamNames: { A: "Team A", B: "Team B" },
	remaining: [],
	results: {}, // slot -> { map, pickedBy, sideTeam, side }
	sequence: [],
	stepIndex: 0,
};

const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const processArea = document.getElementById("processArea");
const logArea = document.getElementById("logArea");
const resultArea = document.getElementById("resultArea");
const instructionText = document.getElementById("instructionText");
const actionArea = document.getElementById("actionArea");
const stepCounter = document.getElementById("stepCounter");
const logList = document.getElementById("logList");

function teamLabel(team) {
	return state.teamNames[team] || team;
}

function addLog(html) {
	const li = document.createElement("li");
	li.className = "list-item text-sm text-slate-700";
	li.innerHTML = html;
	logList.appendChild(li);
}

function startProcess() {
	const format = document.getElementById("formatSelect").value;
	state.teamNames.A = document.getElementById("teamAName").value.trim() || "Team A";
	state.teamNames.B = document.getElementById("teamBName").value.trim() || "Team B";
	state.remaining = [...ALL_MAPS];
	state.results = {};
	state.sequence = SEQUENCES[format];
	state.stepIndex = 0;

	logList.innerHTML = "";
	document.getElementById("resultTableBody").innerHTML = "";

	startBtn.classList.add("hidden");
	restartBtn.classList.remove("hidden");
	processArea.classList.remove("hidden");
	logArea.classList.remove("hidden");
	resultArea.classList.add("hidden");

	document.getElementById("formatSelect").disabled = true;
	document.getElementById("teamAName").disabled = true;
	document.getElementById("teamBName").disabled = true;

	runStep();
}

function runStep() {
	if (state.stepIndex >= state.sequence.length) {
		finishProcess();
		return;
	}

	const step = state.sequence[state.stepIndex];
	stepCounter.textContent = `STEP ${state.stepIndex + 1} / ${state.sequence.length}`;
	actionArea.innerHTML = "";

	if (step.action === "ban") {
		instructionText.innerHTML = `<span class="font-bold">${teamLabel(step.team)}</span> は1マップをBANしてください`;
		state.remaining.forEach((map) => {
			const btn = document.createElement("button");
			btn.className = "map-btn map-btn-ban";
			btn.style.backgroundImage = mapBgStyle(map, "rgba(120,0,0,0.55)");
			btn.textContent = map;
			btn.addEventListener("click", () => {
				state.remaining = state.remaining.filter((m) => m !== map);
				addLog(`<span class="badge badge-danger mr-2">BAN</span>${teamLabel(step.team)} が <strong>${map}</strong> をBAN`);
				state.stepIndex++;
				runStep();
			});
			actionArea.appendChild(btn);
		});
	} else if (step.action === "pick") {
		instructionText.innerHTML = `<span class="font-bold">${teamLabel(step.team)}</span> はMap${step.slot}をPICKしてください`;
		state.remaining.forEach((map) => {
			const btn = document.createElement("button");
			btn.className = "map-btn map-btn-pick";
			btn.style.backgroundImage = mapBgStyle(map, "rgba(0,40,120,0.55)");
			btn.textContent = map;
			btn.addEventListener("click", () => {
				state.remaining = state.remaining.filter((m) => m !== map);
				state.results[step.slot] = { map: map, pickedBy: step.team };
				addLog(`<span class="badge badge-primary mr-2">PICK</span>${teamLabel(step.team)} が Map${step.slot} に <strong>${map}</strong> をPICK`);
				state.stepIndex++;
				runStep();
			});
			actionArea.appendChild(btn);
		});
	} else if (step.action === "remain") {
		const map = state.remaining[0];
		state.remaining = [];
		state.results[step.slot] = { map: map, pickedBy: null };
		addLog(`<span class="badge badge-neutral mr-2">残り</span>Map${step.slot} は残りマップの <strong>${map}</strong> に決定`);
		state.stepIndex++;
		runStep();
	} else if (step.action === "side") {
		const mapInfo = state.results[step.slot];
		instructionText.innerHTML = `<span class="font-bold">${teamLabel(step.team)}</span> は Map${step.slot}（<strong>${mapInfo.map}</strong>）のサイドを選択してください`;

		const attackBtn = document.createElement("button");
		attackBtn.className = "button-warning map-btn";
		attackBtn.innerHTML = `<i class="bi bi-crosshair"></i> アタッカー`;
		attackBtn.addEventListener("click", () => chooseSide(step, "attack"));

		const defenseBtn = document.createElement("button");
		defenseBtn.className = "button-info map-btn";
		defenseBtn.innerHTML = `<i class="bi bi-shield"></i> ディフェンダー`;
		defenseBtn.addEventListener("click", () => chooseSide(step, "defense"));

		actionArea.appendChild(attackBtn);
		actionArea.appendChild(defenseBtn);
	}
}

function chooseSide(step, side) {
	const mapInfo = state.results[step.slot];
	mapInfo.sideTeam = step.team;
	mapInfo.side = side;
	const sideLabel = side === "attack" ? "アタッカー" : "ディフェンダー";
	addLog(`<span class="badge bg-cyan-100 text-cyan-800 mr-2">SIDE</span>${teamLabel(step.team)} は Map${step.slot}（${mapInfo.map}）で <strong>${sideLabel}</strong> を選択`);
	state.stepIndex++;
	runStep();
}

function finishProcess() {
	processArea.classList.add("hidden");
	resultArea.classList.remove("hidden");

	document.getElementById("attackHeader").textContent = "アタッカー側";
	document.getElementById("defenseHeader").textContent = "ディフェンダー側";

	const tbody = document.getElementById("resultTableBody");
	tbody.innerHTML = "";

	const slots = Object.keys(state.results).map(Number).sort((a, b) => a - b);
	slots.forEach((slot) => {
		const info = state.results[slot];
		const sideTeam = info.sideTeam; // このチームが選んだ側
		const otherTeam = sideTeam === "A" ? "B" : "A";

		let attackTeam, defenseTeam;
		if (info.side === "attack") {
			attackTeam = sideTeam;
			defenseTeam = otherTeam;
		} else {
			defenseTeam = sideTeam;
			attackTeam = otherTeam;
		}

		const tr = document.createElement("tr");
		const mapCell = document.createElement("td");
		mapCell.className = "map-result-name";
		mapCell.style.backgroundImage = mapBgStyle(info.map, "rgba(0,0,0,0.5)");
		mapCell.textContent = info.map;

		tr.innerHTML = `<td class="font-bold">Map ${slot}</td>`;
		tr.appendChild(mapCell);
		tr.insertAdjacentHTML("beforeend", `
			<td>${teamLabel(attackTeam)}</td>
			<td>${teamLabel(defenseTeam)}</td>
		`);
		tbody.appendChild(tr);
	});
}

function resetAll() {
	startBtn.classList.remove("hidden");
	restartBtn.classList.add("hidden");
	processArea.classList.add("hidden");
	logArea.classList.add("hidden");
	resultArea.classList.add("hidden");
	document.getElementById("formatSelect").disabled = false;
	document.getElementById("teamAName").disabled = false;
	document.getElementById("teamBName").disabled = false;
}

startBtn.addEventListener("click", startProcess);
restartBtn.addEventListener("click", resetAll);
