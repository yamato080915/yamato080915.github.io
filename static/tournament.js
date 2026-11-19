(function () {
	"use strict";

	const SCHEMA_VERSION = 1;
	const INDEX_KEY = "tournaments.index.v1";
	const EVENT_PREFIX = "tournament.v1.";
	const POWER_COUNTS = [2, 4, 8, 16, 32];

	const dashboardScreen = document.getElementById("dashboard-screen");
	const eventScreen = document.getElementById("event-screen");
	const tournamentList = document.getElementById("tournament-list");
	const createPanel = document.getElementById("create-panel");
	const createForm = document.getElementById("create-form");
	const createErrors = document.getElementById("create-errors");
	const appAlert = document.getElementById("app-alert");
	const eventContent = document.getElementById("event-content");
	const formatSelect = document.getElementById("event-format");
	const teamNamesInput = document.getElementById("team-names");
	const qualifierSelect = document.getElementById("qualifier-count");
	const prelimModeSelect = document.getElementById("prelim-mode");
	const blockCountSelect = document.getElementById("block-count");

	let activeEvent = null;
	let dragPayload = null;
	let selectedSwapItem = null;

	function escapeHtml(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	function uid() {
		if (window.crypto && typeof window.crypto.randomUUID === "function") {
			return window.crypto.randomUUID();
		}
		return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	function shuffle(values) {
		const result = [...values];
		for (let i = result.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[result[i], result[j]] = [result[j], result[i]];
		}
		return result;
	}

	function parseJson(value, fallback) {
		try {
			const parsed = JSON.parse(value);
			return parsed ?? fallback;
		} catch (_) {
			return fallback;
		}
	}

	function loadIndex() {
		const value = parseJson(localStorage.getItem(INDEX_KEY), []);
		return Array.isArray(value) ? value : [];
	}

	function writeIndex(index) {
		localStorage.setItem(INDEX_KEY, JSON.stringify(index));
	}

	function eventStorageKey(id) {
		return `${EVENT_PREFIX}${id}`;
	}

	function loadEvent(id) {
		const value = parseJson(localStorage.getItem(eventStorageKey(id)), null);
		if (!value || value.schemaVersion !== SCHEMA_VERSION) return null;
		return value;
	}

	function formatLabel(format) {
		return {
			single: "シングルエリミネーション",
			double: "ダブルエリミネーション",
			round1: "1回総当たり",
			round2: "2回総当たり",
		}[format] || format;
	}

	function phaseLabel(phase) {
		return {
			"group-setup": "ブロック調整",
			group: "予選進行中",
			"bracket-setup": "本戦組み合わせ",
			bracket: "本戦進行中",
			league: "総当たり進行中",
			complete: "終了",
		}[phase] || "準備中";
	}

	function saveEvent(event) {
		try {
			event.updatedAt = new Date().toISOString();
			localStorage.setItem(eventStorageKey(event.id), JSON.stringify(event));
			const index = loadIndex().filter((item) => item.id !== event.id);
			index.push({
				id: event.id,
				name: event.name,
				format: event.format,
				phase: event.phase,
				updatedAt: event.updatedAt,
			});
			index.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
			writeIndex(index);
		} catch (error) {
			showAlert("保存に失敗しました。ブラウザの保存容量を確認してください。", "danger");
			console.error(error);
		}
	}

	function removeEvent(id) {
		localStorage.removeItem(eventStorageKey(id));
		writeIndex(loadIndex().filter((item) => item.id !== id));
	}

	function showAlert(message, type = "success") {
		appAlert.className = type === "danger" ? "notice notice-danger" : "notice notice-success";
		appAlert.textContent = message;
		appAlert.classList.remove("hidden");
		window.setTimeout(() => appAlert.classList.add("hidden"), 4200);
	}

	function eventProgressText(event) {
		const matches = allPlayableMatches(event);
		if (!matches.length) return phaseLabel(event.phase);
		const completed = matches.filter((match) => match.status === "complete").length;
		return `${phaseLabel(event.phase)}・${completed}/${matches.length}試合確定`;
	}

	function allPlayableMatches(event) {
		return [
			...(event.groupMatches || []),
			...(event.leagueMatches || []),
			...((event.bracket && event.bracket.matches) || []),
		];
	}

	function renderDashboard() {
		dashboardScreen.classList.remove("hidden");
		eventScreen.classList.add("hidden");
		activeEvent = null;
		const index = loadIndex();
		const validItems = [];

		index.forEach((item) => {
			const event = loadEvent(item.id);
			if (event) validItems.push({ item, event });
		});
		if (validItems.length !== index.length) {
			writeIndex(validItems.map(({ item }) => item));
		}

		if (!validItems.length) {
			tournamentList.innerHTML = `
				<div>
					<div class="empty-events">
						<i class="bi bi-diagram-3"></i>
						<h3 class="text-lg font-bold">保存された大会はありません</h3>
						<p class="mb-0 text-slate-500">「大会を作成」から最初の大会を始めましょう。</p>
					</div>
				</div>`;
			return;
		}

		tournamentList.innerHTML = validItems.map(({ event }) => `
			<div class="min-w-0">
				<div class="saved-event-card bg-white">
					<div class="p-5">
						<div class="mb-3 flex items-start justify-between gap-2">
							<div>
								<span class="badge badge-neutral mb-2">${escapeHtml(formatLabel(event.format))}</span>
								<h3 class="mb-1 text-lg font-bold">${escapeHtml(event.name)}</h3>
								<div class="text-sm text-slate-500">${event.teams.length}チーム・${escapeHtml(eventProgressText(event))}</div>
							</div>
							<button type="button" class="button button-danger button-sm" data-action="delete-dashboard" data-event-id="${escapeHtml(event.id)}" aria-label="${escapeHtml(event.name)}を削除"><i class="bi bi-trash"></i></button>
						</div>
						<div class="mb-3 text-sm text-slate-500">最終更新 ${escapeHtml(formatDate(event.updatedAt))}</div>
						<button type="button" class="button button-primary w-full" data-action="open-event" data-event-id="${escapeHtml(event.id)}">大会を再開</button>
					</div>
				</div>
			</div>`).join("");
	}

	function formatDate(value) {
		try {
			return new Intl.DateTimeFormat("ja-JP", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			}).format(new Date(value));
		} catch (_) {
			return "-";
		}
	}

	function openEvent(id) {
		const event = loadEvent(id);
		if (!event) {
			showAlert("大会データを読み込めませんでした。", "danger");
			renderDashboard();
			return;
		}
		activeEvent = event;
		dashboardScreen.classList.add("hidden");
		eventScreen.classList.remove("hidden");
		renderEvent();
	}

	function showCreatePanel() {
		createForm.reset();
		document.getElementById("base-bo").value = "3";
		document.getElementById("final-bo").value = "5";
		document.getElementById("third-place").checked = true;
		createErrors.classList.add("hidden");
		createPanel.classList.remove("hidden");
		updateCreateOptions();
		document.getElementById("event-name").focus();
	}

	function hideCreatePanel() {
		createPanel.classList.add("hidden");
	}

	function teamNamesFromInput() {
		return teamNamesInput.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
	}

	function validBlockCounts(teamCount, qualifierCount) {
		if (!teamCount || !qualifierCount) return [];
		return Array.from({ length: qualifierCount }, (_, i) => i + 1).filter((blocks) => {
			if (qualifierCount % blocks !== 0) return false;
			const smallestGroup = Math.floor(teamCount / blocks);
			const quota = qualifierCount / blocks;
			return smallestGroup >= 2 && smallestGroup >= quota;
		});
	}

	function updateCreateOptions() {
		const format = formatSelect.value;
		const knockout = format === "single" || format === "double";
		const single = format === "single";
		document.querySelectorAll(".knockout-option").forEach((el) => el.classList.toggle("hidden", !knockout));
		document.querySelectorAll(".single-option").forEach((el) => el.classList.toggle("hidden", !single));

		const names = teamNamesFromInput();
		document.getElementById("team-count-preview").textContent = names.length;
		if (!knockout) return;

		const previousQualifier = Number(qualifierSelect.value);
		const options = POWER_COUNTS.filter((count) => count <= names.length);
		qualifierSelect.innerHTML = options.length
			? options.map((count) => `<option value="${count}">${count}チーム</option>`).join("")
			: '<option value="">チームを2件以上入力してください</option>';
		if (options.includes(previousQualifier)) qualifierSelect.value = String(previousQualifier);
		else if (options.length) qualifierSelect.value = String(options[options.length - 1]);

		const qualifierCount = Number(qualifierSelect.value);
		const previousMode = prelimModeSelect.value;
		if (!qualifierCount) {
			prelimModeSelect.innerHTML = '<option value="">本戦進出数を選択してください</option>';
		} else if (qualifierCount < names.length) {
			prelimModeSelect.innerHTML = '<option value="yes">ブロック予選あり（必須）</option>';
		} else {
			prelimModeSelect.innerHTML = '<option value="no">予選なし</option><option value="yes">ブロック予選あり</option>';
			if (previousMode === "yes") prelimModeSelect.value = "yes";
		}
		updateBlockOptions();

		const thirdPlace = document.getElementById("third-place");
		thirdPlace.disabled = qualifierCount < 4;
		if (qualifierCount < 4) thirdPlace.checked = false;
	}

	function updateBlockOptions() {
		const names = teamNamesFromInput();
		const qualifierCount = Number(qualifierSelect.value);
		const usePrelim = prelimModeSelect.value === "yes";
		const wrap = document.getElementById("block-count-wrap");
		wrap.classList.toggle("hidden", !usePrelim);
		if (!usePrelim) return;

		const previous = Number(blockCountSelect.value);
		const counts = validBlockCounts(names.length, qualifierCount);
		blockCountSelect.innerHTML = counts.map((count) => `<option value="${count}">${count}ブロック</option>`).join("");
		if (counts.includes(previous)) blockCountSelect.value = String(previous);
		const selected = Number(blockCountSelect.value);
		const quota = selected ? qualifierCount / selected : 0;
		document.getElementById("block-count-hint").textContent = selected
			? `各ブロック上位${quota}チームが本戦進出`
			: "有効なブロック数がありません";
	}

	function validateCreateForm() {
		const errors = [];
		const name = document.getElementById("event-name").value.trim();
		const names = teamNamesFromInput();
		if (!name) errors.push("大会名を入力してください。");
		if (names.length < 2 || names.length > 32) errors.push("チーム数は2〜32にしてください。");
		if (names.some((teamName) => teamName.length > 40)) errors.push("チーム名は40文字以内にしてください。");
		const normalized = names.map((teamName) => teamName.toLocaleLowerCase("ja-JP"));
		if (new Set(normalized).size !== normalized.length) errors.push("同じチーム名を重複して登録できません。");

		const knockout = formatSelect.value === "single" || formatSelect.value === "double";
		if (knockout) {
			const qualifierCount = Number(qualifierSelect.value);
			if (!POWER_COUNTS.includes(qualifierCount) || qualifierCount > names.length) errors.push("本戦進出数を選択してください。");
			if (prelimModeSelect.value === "yes" && !validBlockCounts(names.length, qualifierCount).includes(Number(blockCountSelect.value))) {
				errors.push("有効な予選ブロック数を選択してください。");
			}
		}
		return errors;
	}

	function initializeCompetition(event) {
		event.groups = [];
		event.groupMatches = [];
		event.leagueMatches = [];
		event.bracketSeeds = [];
		event.bracket = null;
		event.qualificationDraws = {};
		event.qualifiers = [];

		if (event.format === "round1" || event.format === "round2") {
			event.phase = "league";
			event.leagueMatches = scheduleRoundRobin(
				event.teams.map((team) => team.id),
				event.format === "round2" ? 2 : 1,
				"league",
				null,
				event.settings.baseBo
			);
			return;
		}

		if (event.settings.usePrelim) {
			event.phase = "group-setup";
			event.groups = drawGroups(event.teams.map((team) => team.id), event.settings.blockCount);
		} else {
			event.phase = "bracket-setup";
			event.bracketSeeds = shuffle(event.teams.map((team) => team.id));
		}
	}

	function drawGroups(teamIds, blockCount) {
		const pool = shuffle(teamIds);
		const groups = Array.from({ length: blockCount }, (_, index) => ({
			id: `group-${index + 1}`,
			name: `Block ${String.fromCharCode(65 + index)}`,
			teamIds: [],
		}));
		pool.forEach((teamId, index) => groups[index % blockCount].teamIds.push(teamId));
		return groups;
	}

	function scheduleRoundRobin(teamIds, cycles, prefix, blockId, bestOf) {
		const list = [...teamIds];
		if (list.length % 2 === 1) list.push(null);
		const size = list.length;
		const rounds = [];
		let rotation = [...list];

		for (let round = 0; round < size - 1; round++) {
			const pairs = [];
			for (let i = 0; i < size / 2; i++) {
				const a = rotation[i];
				const b = rotation[size - 1 - i];
				if (a && b) pairs.push([a, b]);
			}
			rounds.push(pairs);
			rotation = [rotation[0], rotation[size - 1], ...rotation.slice(1, size - 1)];
		}

		const matches = [];
		for (let cycle = 0; cycle < cycles; cycle++) {
			rounds.forEach((pairs, roundIndex) => {
				pairs.forEach((pair, pairIndex) => {
					const sides = cycle % 2 === 0 ? pair : [pair[1], pair[0]];
					matches.push({
						id: `${prefix}-${blockId || "all"}-${cycle + 1}-${roundIndex + 1}-${pairIndex + 1}-${uid()}`,
						kind: prefix,
						blockId,
						cycle: cycle + 1,
						round: roundIndex + 1,
						teamAId: sides[0],
						teamBId: sides[1],
						bestOf,
						maps: Array.from({ length: bestOf }, () => ({ a: "", b: "" })),
						status: "ready",
						winnerId: null,
					});
				});
			});
		}
		return matches;
	}

	function createTournament() {
		const errors = validateCreateForm();
		if (errors.length) {
			createErrors.innerHTML = `<ul class="mb-0">${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`;
			createErrors.classList.remove("hidden");
			return;
		}

		const format = formatSelect.value;
		const teamNames = teamNamesFromInput();
		const event = {
			schemaVersion: SCHEMA_VERSION,
			id: uid(),
			name: document.getElementById("event-name").value.trim(),
			format,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			teams: teamNames.map((name) => ({ id: uid(), name })),
			settings: {
				baseBo: Number(document.getElementById("base-bo").value),
				finalBo: format === "single" || format === "double" ? Number(document.getElementById("final-bo").value) : null,
				thirdPlace: format === "single" && document.getElementById("third-place").checked,
				qualifierCount: format === "single" || format === "double" ? Number(qualifierSelect.value) : null,
				usePrelim: format === "single" || format === "double" ? prelimModeSelect.value === "yes" : false,
				blockCount: (format === "single" || format === "double") && prelimModeSelect.value === "yes" ? Number(blockCountSelect.value) : null,
			},
		};

		initializeCompetition(event);
		saveEvent(event);
		hideCreatePanel();
		openEvent(event.id);
	}

	function getTeam(event, id) {
		return event.teams.find((team) => team.id === id) || null;
	}

	function teamName(event, id, fallback = "未確定") {
		const team = getTeam(event, id);
		return team ? team.name : fallback;
	}

	function renderEvent() {
		if (!activeEvent) return;
		if (activeEvent.bracket && (activeEvent.phase === "bracket" || activeEvent.phase === "complete")) {
			const matches = activeEvent.bracket.matches;
			const grandFinal = matches.find((match) => match.id === activeEvent.bracket.grandFinalId);
			const placementMatches = matches.filter((match) => match.section === "placement");
			activeEvent.phase = grandFinal && grandFinal.status === "complete" && placementMatches.every((match) => match.status === "complete") ? "complete" : "bracket";
		}
		if ((activeEvent.format === "round1" || activeEvent.format === "round2") && (activeEvent.phase === "league" || activeEvent.phase === "complete")) {
			activeEvent.phase = activeEvent.leagueMatches.length > 0 && activeEvent.leagueMatches.every((match) => match.status === "complete") ? "complete" : "league";
		}
		document.getElementById("event-title").textContent = activeEvent.name;
		document.getElementById("event-format-badge").textContent = formatLabel(activeEvent.format);
		document.getElementById("event-phase-badge").textContent = phaseLabel(activeEvent.phase);
		document.getElementById("event-summary").textContent = `${activeEvent.teams.length}チーム・通常 BO${activeEvent.settings.baseBo}${activeEvent.settings.finalBo ? `・決勝指定 BO${activeEvent.settings.finalBo}` : ""}・自動保存`;

		if (activeEvent.phase === "group-setup") renderGroupSetup();
		else if (activeEvent.phase === "group") renderGroupStage();
		else if (activeEvent.phase === "bracket-setup") renderBracketSetup();
		else if (activeEvent.phase === "bracket") renderBracket();
		else if (activeEvent.phase === "league") renderLeague();
		else if (activeEvent.phase === "complete" && (activeEvent.format === "round1" || activeEvent.format === "round2")) renderLeague();
		else if (activeEvent.phase === "complete") renderBracket();
	}

	function renderGroupSetup() {
		selectedSwapItem = null;
		eventContent.innerHTML = `
			<div class="phase-banner mb-4">
				<p class="section-kicker mb-1">GROUP DRAW</p>
				<h3 class="mb-2 text-lg font-bold">予選ブロックを確認</h3>
				<p class="mb-0 text-slate-500">チームを別のチームへドラッグすると、所属ブロックを直接入れ替えられます。タッチ操作では2チームを順に選択してください。</p>
			</div>
			<div class="group-grid mb-4">
				${activeEvent.groups.map((group) => `
					<div class="panel event-card">
						<div class="panel-header flex items-center justify-between">
							<strong>${escapeHtml(group.name)}</strong>
							<span class="badge badge-success">上位${activeEvent.settings.qualifierCount / activeEvent.settings.blockCount}チーム進出</span>
						</div>
						<div class="panel-body">
							${group.teamIds.map((teamId) => `<div class="team-chip draggable-team" draggable="true" tabindex="0" role="button" aria-pressed="false" data-action="select-swap-item" data-drag-scope="group" data-team-id="${escapeHtml(teamId)}" aria-label="${escapeHtml(teamName(activeEvent, teamId))}を別のチームと入れ替え"><span class="flex min-w-0 items-center"><i class="bi bi-grip-vertical drag-grip mr-2" aria-hidden="true"></i><strong class="truncate">${escapeHtml(teamName(activeEvent, teamId))}</strong></span><span class="badge badge-neutral">DRAG</span></div>`).join("")}
						</div>
					</div>`).join("")}
			</div>
			<div class="flex flex-wrap justify-between gap-2">
				<button type="button" class="button button-secondary" data-action="redraw-groups"><i class="bi bi-shuffle"></i>再抽選</button>
				<button type="button" class="button button-primary button-lg" data-action="start-groups"><i class="bi bi-play-fill"></i>予選を開始</button>
			</div>`;
	}

	function startGroupStage() {
		activeEvent.groupMatches = activeEvent.groups.flatMap((group) => scheduleRoundRobin(
			group.teamIds,
			1,
			"group",
			group.id,
			activeEvent.settings.baseBo
		));
		activeEvent.phase = "group";
		saveEvent(activeEvent);
		renderEvent();
	}

	function analyzeMapMatch(match) {
		const target = Math.floor(match.bestOf / 2) + 1;
		let winsA = 0;
		let winsB = 0;
		let processed = 0;
		let error = "";
		for (const map of match.maps) {
			if (map.a === "" || map.b === "") break;
			const a = Number(map.a);
			const b = Number(map.b);
			if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
				error = "ラウンド数は0以上の整数で入力してください。";
				break;
			}
			if (a === b) {
				error = "1マップのラウンド数は同点にできません。";
				break;
			}
			if (a > b) winsA++;
			else winsB++;
			processed++;
			if (winsA === target || winsB === target) {
				return { decided: true, winnerSide: winsA === target ? "A" : "B", winsA, winsB, processed, error: "" };
			}
		}
		return { decided: false, winnerSide: null, winsA, winsB, processed, error };
	}

	function mapTotals(match) {
		const analysis = analyzeMapMatch(match);
		let roundsA = 0;
		let roundsB = 0;
		for (let index = 0; index < analysis.processed; index++) {
			roundsA += Number(match.maps[index].a);
			roundsB += Number(match.maps[index].b);
		}
		return { ...analysis, roundsA, roundsB };
	}

	function renderRoundRobinMatch(match) {
		const analysis = analyzeMapMatch(match);
		const visibleMaps = analysis.decided ? analysis.processed : Math.min(match.bestOf, analysis.processed + 1);
		const teamA = teamName(activeEvent, match.teamAId);
		const teamB = teamName(activeEvent, match.teamBId);
		const complete = match.status === "complete";
		return `
			<div class="match-card ${complete ? "match-complete" : "match-ready"}" data-match-card="${escapeHtml(match.id)}">
				<div class="match-heading">
					<span>第${match.round}節${match.cycle > 1 ? `・第${match.cycle}戦` : ""}</span>
					<span class="badge ${complete ? "badge-success" : "badge-primary"}">${complete ? `${analysis.winsA}-${analysis.winsB} 確定` : `BO${match.bestOf}`}</span>
				</div>
				<div class="match-body">
					<div class="mb-2 flex justify-between gap-2">
						<strong class="truncate">${escapeHtml(teamA)}</strong><span>vs</span><strong class="truncate text-right">${escapeHtml(teamB)}</strong>
					</div>
					${Array.from({ length: visibleMaps }, (_, index) => {
						const map = match.maps[index];
						return `<div class="map-score-row">
							<span class="text-xs text-slate-500">MAP ${index + 1}</span>
							<input type="number" min="0" step="1" class="field-control py-1.5 text-sm" aria-label="${escapeHtml(teamA)} Map ${index + 1} ラウンド数" value="${escapeHtml(map.a)}" data-action="round-score" data-match-id="${escapeHtml(match.id)}" data-map-index="${index}" data-side="a" ${complete ? "disabled" : ""}>
							<span class="text-center">-</span>
							<input type="number" min="0" step="1" class="field-control py-1.5 text-sm" aria-label="${escapeHtml(teamB)} Map ${index + 1} ラウンド数" value="${escapeHtml(map.b)}" data-action="round-score" data-match-id="${escapeHtml(match.id)}" data-map-index="${index}" data-side="b" ${complete ? "disabled" : ""}>
						</div>`;
					}).join("")}
					${analysis.error ? `<div class="match-error">${escapeHtml(analysis.error)}</div>` : ""}
					<div class="mt-3 flex justify-end">
						${complete
							? `<button type="button" class="button button-secondary button-sm" data-action="edit-round-match" data-match-id="${escapeHtml(match.id)}">結果を修正</button>`
							: `<button type="button" class="button button-primary button-sm" data-action="confirm-round-match" data-match-id="${escapeHtml(match.id)}" ${analysis.decided ? "" : "disabled"}>勝敗を確定</button>`}
					</div>
				</div>
			</div>`;
	}

	function standingsFor(teamIds, matches) {
		const stats = new Map(teamIds.map((teamId) => [teamId, {
			teamId, played: 0, wins: 0, losses: 0, mapWins: 0, mapLosses: 0, roundsFor: 0, roundsAgainst: 0, h2hWins: 0,
		}]));
		const completed = matches.filter((match) => match.status === "complete");
		completed.forEach((match) => {
			const totals = mapTotals(match);
			const a = stats.get(match.teamAId);
			const b = stats.get(match.teamBId);
			if (!a || !b) return;
			a.played++;
			b.played++;
			a.mapWins += totals.winsA;
			a.mapLosses += totals.winsB;
			b.mapWins += totals.winsB;
			b.mapLosses += totals.winsA;
			a.roundsFor += totals.roundsA;
			a.roundsAgainst += totals.roundsB;
			b.roundsFor += totals.roundsB;
			b.roundsAgainst += totals.roundsA;
			if (match.winnerId === a.teamId) {
				a.wins++;
				b.losses++;
			} else {
				b.wins++;
				a.losses++;
			}
		});

		const entries = [...stats.values()].map((entry) => ({
			...entry,
			mapDiff: entry.mapWins - entry.mapLosses,
			roundDiff: entry.roundsFor - entry.roundsAgainst,
		}));

		const clusters = new Map();
		entries.forEach((entry) => {
			const key = `${entry.wins}|${entry.mapDiff}|${entry.roundDiff}`;
			if (!clusters.has(key)) clusters.set(key, []);
			clusters.get(key).push(entry);
		});
		clusters.forEach((cluster) => {
			if (cluster.length < 2) return;
			const ids = new Set(cluster.map((entry) => entry.teamId));
			completed.forEach((match) => {
				if (!ids.has(match.teamAId) || !ids.has(match.teamBId)) return;
				const winner = cluster.find((entry) => entry.teamId === match.winnerId);
				if (winner) winner.h2hWins++;
			});
		});

		entries.sort((a, b) =>
			b.wins - a.wins ||
			b.mapDiff - a.mapDiff ||
			b.roundDiff - a.roundDiff ||
			b.h2hWins - a.h2hWins ||
			teamName(activeEvent, a.teamId).localeCompare(teamName(activeEvent, b.teamId), "ja")
		);
		let rank = 0;
		let previous = null;
		entries.forEach((entry, index) => {
			if (!previous || !sameRankKey(previous, entry)) rank = index + 1;
			entry.rank = rank;
			previous = entry;
		});
		return entries;
	}

	function sameRankKey(a, b) {
		return a.wins === b.wins && a.mapDiff === b.mapDiff && a.roundDiff === b.roundDiff && a.h2hWins === b.h2hWins;
	}

	function renderStandings(teamIds, matches, qualifiedIds = new Set(), lotteryIds = new Set()) {
		const standings = standingsFor(teamIds, matches);
		return `
			<div class="table-wrap">
				<table class="data-table standing-table mb-0">
					<thead><tr><th>順位</th><th>チーム</th><th>試合</th><th>勝</th><th>敗</th><th>マップ</th><th>差</th><th>ラウンド</th><th>差</th></tr></thead>
					<tbody>${standings.map((entry) => `
						<tr class="${qualifiedIds.has(entry.teamId) ? "qualified-row" : ""} ${lotteryIds.has(entry.teamId) ? "lottery-row" : ""}">
							<td><span class="rank-number">${entry.rank}</span></td>
							<td class="font-semibold">${escapeHtml(teamName(activeEvent, entry.teamId))}${qualifiedIds.has(entry.teamId) ? ' <span class="badge badge-success ml-1">進出</span>' : ""}</td>
							<td>${entry.played}</td><td>${entry.wins}</td><td>${entry.losses}</td>
							<td>${entry.mapWins}-${entry.mapLosses}</td><td>${signed(entry.mapDiff)}</td>
							<td>${entry.roundsFor}-${entry.roundsAgainst}</td><td>${signed(entry.roundDiff)}</td>
						</tr>`).join("")}</tbody>
				</table>
			</div>`;
	}

	function signed(number) {
		return number > 0 ? `+${number}` : String(number);
	}

	function renderGroupStage() {
		const allComplete = activeEvent.groupMatches.length > 0 && activeEvent.groupMatches.every((match) => match.status === "complete");
		eventContent.innerHTML = `
			<div class="phase-banner mb-4">
				<p class="section-kicker mb-1">QUALIFIERS</p>
				<h3 class="mb-2 text-lg font-bold">予選総当たり</h3>
				<p class="mb-0 text-slate-500">全試合の結果が確定すると、本戦進出チームと組み合わせを生成できます。</p>
			</div>
			${activeEvent.groups.map((group) => {
				const matches = activeEvent.groupMatches.filter((match) => match.blockId === group.id);
				return `<section class="panel standing-card mb-4">
					<div class="panel-header flex items-center justify-between gap-3"><strong>${escapeHtml(group.name)}</strong><span class="badge badge-success">上位${activeEvent.settings.qualifierCount / activeEvent.settings.blockCount}チーム進出</span></div>
					<div class="panel-body">${renderStandings(group.teamIds, matches)}</div>
					<div class="panel-body border-t border-slate-200"><div class="grid gap-3 lg:grid-cols-2">${matches.map((match) => `<div class="min-w-0">${renderRoundRobinMatch(match)}</div>`).join("")}</div></div>
				</section>`;
			}).join("")}
			<div class="flex justify-end">
				<button type="button" class="button button-primary button-lg" data-action="finalize-groups" ${allComplete ? "" : "disabled"}><i class="bi bi-diagram-3"></i>本戦組み合わせを生成</button>
			</div>`;
	}

	function qualificationForGroup(group) {
		const matches = activeEvent.groupMatches.filter((match) => match.blockId === group.id);
		const rankings = standingsFor(group.teamIds, matches);
		const quota = activeEvent.settings.qualifierCount / activeEvent.settings.blockCount;
		const selected = [];
		const lotteryPool = new Set();
		let index = 0;
		while (index < rankings.length && selected.length < quota) {
			const cluster = [rankings[index]];
			let cursor = index + 1;
			while (cursor < rankings.length && sameRankKey(rankings[index], rankings[cursor])) {
				cluster.push(rankings[cursor]);
				cursor++;
			}
			const remaining = quota - selected.length;
			if (cluster.length <= remaining) {
				selected.push(...cluster);
			} else {
				cluster.forEach((entry) => lotteryPool.add(entry.teamId));
				const existing = activeEvent.qualificationDraws[group.id];
				let chosenIds;
				if (existing && existing.pool.length === cluster.length && existing.pool.every((id) => lotteryPool.has(id))) {
					chosenIds = existing.selected;
				} else {
					chosenIds = shuffle(cluster.map((entry) => entry.teamId)).slice(0, remaining);
					activeEvent.qualificationDraws[group.id] = { pool: cluster.map((entry) => entry.teamId), selected: chosenIds };
				}
				selected.push(...cluster.filter((entry) => chosenIds.includes(entry.teamId)));
			}
			index = cursor;
		}
		return { rankings, selected, lotteryPool };
	}

	function standardSeedOrder(size) {
		let order = [1, 2];
		while (order.length < size) {
			const nextSize = order.length * 2;
			order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
		}
		return order;
	}

	function buildQualifiedSeeds(entries, groupCount) {
		const size = entries.length;
		const slotOrder = standardSeedOrder(size);
		if (groupCount === 1) {
			const ranked = [...entries].sort((a, b) => a.rank - b.rank);
			return slotOrder.map((seed) => ranked[seed - 1].teamId);
		}

		let best = null;
		let bestRematches = Infinity;
		for (let attempt = 0; attempt < 400; attempt++) {
			const byRank = new Map();
			entries.forEach((entry) => {
				if (!byRank.has(entry.rank)) byRank.set(entry.rank, []);
				byRank.get(entry.rank).push(entry);
			});
			const ranked = [...byRank.keys()].sort((a, b) => a - b).flatMap((rank) => shuffle(byRank.get(rank)));
			const slots = slotOrder.map((seed) => ranked[seed - 1]);
			let rematches = 0;
			for (let i = 0; i < slots.length; i += 2) {
				if (slots[i].groupId === slots[i + 1].groupId) rematches++;
			}
			if (rematches < bestRematches) {
				bestRematches = rematches;
				best = slots.map((entry) => entry.teamId);
				if (rematches === 0) break;
			}
		}
		return best;
	}

	function finalizeGroups() {
		if (!activeEvent.groupMatches.every((match) => match.status === "complete")) return;
		const qualifierEntries = [];
		activeEvent.groups.forEach((group) => {
			const result = qualificationForGroup(group);
			result.selected.forEach((entry) => qualifierEntries.push({
				teamId: entry.teamId,
				rank: entry.rank,
				groupId: group.id,
			}));
		});
		activeEvent.qualifiers = qualifierEntries.map((entry) => entry.teamId);
		activeEvent.bracketSeeds = buildQualifiedSeeds(qualifierEntries, activeEvent.groups.length);
		activeEvent.phase = "bracket-setup";
		activeEvent.bracket = null;
		saveEvent(activeEvent);
		renderEvent();
	}

	function renderBracketSetup() {
		const direct = !activeEvent.settings.usePrelim;
		selectedSwapItem = null;
		eventContent.innerHTML = `
			<div class="phase-banner mb-4">
				<p class="section-kicker mb-1">MAIN DRAW</p>
				<h3 class="mb-2 text-lg font-bold">本戦組み合わせを確認</h3>
				<p class="mb-0 text-slate-500">チームを別のチームへドラッグすると、本戦枠を直接入れ替えられます。タッチ操作では2チームを順に選択してください。</p>
			</div>
			${direct ? "" : `<div class="placement-rules mb-4">
				<div class="placement-rules-icon"><i class="bi bi-stars" aria-hidden="true"></i></div>
				<div><strong>予選結果を反映した推奨配置です</strong><p class="mb-0 mt-1">各ブロックの上位チームを優先し、同順位内を抽選したうえで、同じブロック同士が初戦で再戦しないよう可能な限り調整しています。必要な場合だけドラッグして変更してください。</p></div>
			</div>`}
			<div class="mb-4 grid gap-4">
				<div>
					<div class="panel event-card h-full"><div class="panel-header"><strong>本戦枠</strong></div><div class="panel-body slot-list">
						${activeEvent.bracketSeeds.map((teamId, index) => `<div class="slot-row draggable-team" draggable="true" tabindex="0" role="button" aria-pressed="false" data-action="select-swap-item" data-drag-scope="bracket" data-team-id="${escapeHtml(teamId)}" data-position="${index}" aria-label="本戦枠${index + 1}の${escapeHtml(teamName(activeEvent, teamId))}を別のチームと入れ替え"><span class="slot-number">${index + 1}</span><span class="flex min-w-0 items-center"><i class="bi bi-grip-vertical drag-grip mr-2" aria-hidden="true"></i><strong class="truncate">${escapeHtml(teamName(activeEvent, teamId))}</strong></span></div>`).join("")}
					</div></div>
				</div>
			</div>
			<div class="flex flex-wrap justify-between gap-2">
				<div class="flex flex-wrap gap-2">${activeEvent.settings.usePrelim ? '<button type="button" class="button button-warning" data-action="reopen-groups"><i class="bi bi-pencil"></i>予選結果を修正</button>' : ""}${direct ? '<button type="button" class="button button-secondary" data-action="redraw-bracket"><i class="bi bi-shuffle"></i>再抽選</button>' : ""}</div>
				<button type="button" class="button button-primary button-lg" data-action="start-bracket"><i class="bi bi-play-fill"></i>本戦を開始</button>
			</div>`;
	}

	function swapTeamItems(scope, firstTeamId, secondTeamId) {
		if (!activeEvent || !firstTeamId || !secondTeamId || firstTeamId === secondTeamId) return false;
		if (scope === "group") {
			const firstGroup = activeEvent.groups.find((group) => group.teamIds.includes(firstTeamId));
			const secondGroup = activeEvent.groups.find((group) => group.teamIds.includes(secondTeamId));
			if (!firstGroup || !secondGroup) return false;
			const firstIndex = firstGroup.teamIds.indexOf(firstTeamId);
			const secondIndex = secondGroup.teamIds.indexOf(secondTeamId);
			firstGroup.teamIds[firstIndex] = secondTeamId;
			secondGroup.teamIds[secondIndex] = firstTeamId;
		} else if (scope === "bracket") {
			const firstIndex = activeEvent.bracketSeeds.indexOf(firstTeamId);
			const secondIndex = activeEvent.bracketSeeds.indexOf(secondTeamId);
			if (firstIndex < 0 || secondIndex < 0) return false;
			[activeEvent.bracketSeeds[firstIndex], activeEvent.bracketSeeds[secondIndex]] = [activeEvent.bracketSeeds[secondIndex], activeEvent.bracketSeeds[firstIndex]];
		} else {
			return false;
		}
		saveEvent(activeEvent);
		renderEvent();
		return true;
	}

	function selectSwapItem(item) {
		const payload = { scope: item.dataset.dragScope, teamId: item.dataset.teamId };
		if (!selectedSwapItem || selectedSwapItem.scope !== payload.scope) {
			document.querySelectorAll(".draggable-team.swap-selected").forEach((element) => {
				element.classList.remove("swap-selected");
				element.setAttribute("aria-pressed", "false");
			});
			selectedSwapItem = payload;
			item.classList.add("swap-selected");
			item.setAttribute("aria-pressed", "true");
			return;
		}
		if (selectedSwapItem.teamId === payload.teamId) {
			selectedSwapItem = null;
			item.classList.remove("swap-selected");
			item.setAttribute("aria-pressed", "false");
			return;
		}
		const first = selectedSwapItem;
		selectedSwapItem = null;
		swapTeamItems(payload.scope, first.teamId, payload.teamId);
	}

	function source(type, matchId, teamId) {
		return { type, matchId: matchId || null, teamId: teamId || null };
	}

	function bracketMatch(label, section, displayRound, sourceA, sourceB, bestOf) {
		return {
			id: uid(), label, section, displayRound, sourceA, sourceB, bestOf,
			status: "waiting", scoreA: "", scoreB: "", winnerId: null, loserId: null,
		};
	}

	function generateSingleBracket(event) {
		const size = event.bracketSeeds.length;
		const rounds = Math.log2(size);
		const matches = [];
		const upperRounds = [];
		for (let round = 1; round <= rounds; round++) {
			const count = size / Math.pow(2, round);
			const roundMatches = [];
			for (let index = 0; index < count; index++) {
				let sourceA;
				let sourceB;
				if (round === 1) {
					sourceA = source("seed", null, event.bracketSeeds[index * 2]);
					sourceB = source("seed", null, event.bracketSeeds[index * 2 + 1]);
				} else {
					sourceA = source("winner", upperRounds[round - 2][index * 2].id);
					sourceB = source("winner", upperRounds[round - 2][index * 2 + 1].id);
				}
				const isFinal = round === rounds;
				const label = isFinal ? "Grand Final" : round === rounds - 1 ? `Semifinal ${index + 1}` : `Round ${round} - Match ${index + 1}`;
				const match = bracketMatch(label, "upper", isFinal ? "Grand Final" : `Round ${round}`, sourceA, sourceB, isFinal ? event.settings.finalBo : event.settings.baseBo);
				roundMatches.push(match);
				matches.push(match);
			}
			upperRounds.push(roundMatches);
		}

		if (event.settings.thirdPlace && size >= 4) {
			const semifinals = upperRounds[rounds - 2];
			matches.push(bracketMatch("3位決定戦", "placement", "3位決定戦", source("loser", semifinals[0].id), source("loser", semifinals[1].id), event.settings.finalBo));
		}
		return { type: "single", matches, grandFinalId: upperRounds[rounds - 1][0].id };
	}

	function generateDoubleBracket(event) {
		const size = event.bracketSeeds.length;
		const rounds = Math.log2(size);
		const matches = [];
		const upperRounds = [];

		for (let round = 1; round <= rounds; round++) {
			const count = size / Math.pow(2, round);
			const roundMatches = [];
			for (let index = 0; index < count; index++) {
				const sourceA = round === 1 ? source("seed", null, event.bracketSeeds[index * 2]) : source("winner", upperRounds[round - 2][index * 2].id);
				const sourceB = round === 1 ? source("seed", null, event.bracketSeeds[index * 2 + 1]) : source("winner", upperRounds[round - 2][index * 2 + 1].id);
				const isUpperFinal = round === rounds;
				const match = bracketMatch(isUpperFinal ? "Upper Final" : `Upper R${round} - M${index + 1}`, "upper", isUpperFinal ? "Upper Final" : `Upper Round ${round}`, sourceA, sourceB, event.settings.baseBo);
				roundMatches.push(match);
				matches.push(match);
			}
			upperRounds.push(roundMatches);
		}

		const lowerRounds = [];
		if (rounds >= 2) {
			const firstLower = [];
			for (let index = 0; index < size / 4; index++) {
				const match = bracketMatch(`Lower R1 - M${index + 1}`, "lower", "Lower Round 1", source("loser", upperRounds[0][index * 2].id), source("loser", upperRounds[0][index * 2 + 1].id), event.settings.baseBo);
				firstLower.push(match);
				matches.push(match);
			}
			lowerRounds.push(firstLower);

			for (let upperRound = 2; upperRound <= rounds; upperRound++) {
				const previous = lowerRounds[lowerRounds.length - 1];
				const upper = upperRounds[upperRound - 1];
				const evenRoundNumber = upperRound * 2 - 2;
				const evenRound = [];
				for (let index = 0; index < upper.length; index++) {
					const isLowerFinal = upperRound === rounds;
					const match = bracketMatch(
						isLowerFinal ? "Lower Final" : `Lower R${evenRoundNumber} - M${index + 1}`,
						"lower",
						isLowerFinal ? "Lower Final" : `Lower Round ${evenRoundNumber}`,
						source("winner", previous[index].id),
						source("loser", upper[upper.length - 1 - index].id),
						isLowerFinal ? event.settings.finalBo : event.settings.baseBo
					);
					evenRound.push(match);
					matches.push(match);
				}
				lowerRounds.push(evenRound);

				if (upperRound < rounds) {
					const consolidation = [];
					for (let index = 0; index < evenRound.length / 2; index++) {
						const roundNumber = evenRoundNumber + 1;
						const match = bracketMatch(`Lower R${roundNumber} - M${index + 1}`, "lower", `Lower Round ${roundNumber}`, source("winner", evenRound[index * 2].id), source("winner", evenRound[index * 2 + 1].id), event.settings.baseBo);
						consolidation.push(match);
						matches.push(match);
					}
					lowerRounds.push(consolidation);
				}
			}
		}

		const upperFinal = upperRounds[rounds - 1][0];
		const lowerChampionSource = rounds === 1 ? source("loser", upperFinal.id) : source("winner", lowerRounds[lowerRounds.length - 1][0].id);
		const grandFinal = bracketMatch("Grand Final", "grand", "Grand Final", source("winner", upperFinal.id), lowerChampionSource, event.settings.finalBo);
		matches.push(grandFinal);
		return { type: "double", matches, grandFinalId: grandFinal.id };
	}

	function startBracket() {
		activeEvent.bracket = activeEvent.format === "single" ? generateSingleBracket(activeEvent) : generateDoubleBracket(activeEvent);
		activeEvent.phase = "bracket";
		saveEvent(activeEvent);
		renderEvent();
	}

	function sourceTeamId(event, sourceInfo) {
		if (!sourceInfo) return null;
		if (sourceInfo.type === "seed") return sourceInfo.teamId;
		const match = event.bracket.matches.find((item) => item.id === sourceInfo.matchId);
		if (!match || match.status !== "complete") return null;
		return sourceInfo.type === "winner" ? match.winnerId : match.loserId;
	}

	function bracketTeams(match) {
		return [sourceTeamId(activeEvent, match.sourceA), sourceTeamId(activeEvent, match.sourceB)];
	}

	function renderBracketMatch(match) {
		const [teamAId, teamBId] = bracketTeams(match);
		const ready = Boolean(teamAId && teamBId);
		const complete = match.status === "complete";
		const stateClass = complete ? "match-complete" : ready ? "match-ready" : "match-waiting";
		return `<div class="match-card ${stateClass}">
			<div class="match-heading"><span>${escapeHtml(match.label)}</span><span class="badge ${complete ? "badge-success" : ready ? "badge-primary" : "badge-neutral"}">${complete ? `${match.scoreA}-${match.scoreB}` : ready ? `BO${match.bestOf}` : "待機中"}</span></div>
			<div class="match-body">
				<div class="match-team ${complete && match.winnerId === teamAId ? "winner" : ""}"><span class="match-team-name">${escapeHtml(teamName(activeEvent, teamAId))}</span><input type="number" min="0" class="field-control py-1.5 text-center text-sm" value="${escapeHtml(match.scoreA)}" data-action="bracket-score" data-match-id="${escapeHtml(match.id)}" data-side="A" ${!ready || complete ? "disabled" : ""}></div>
				<div class="match-team ${complete && match.winnerId === teamBId ? "winner" : ""}"><span class="match-team-name">${escapeHtml(teamName(activeEvent, teamBId))}</span><input type="number" min="0" class="field-control py-1.5 text-center text-sm" value="${escapeHtml(match.scoreB)}" data-action="bracket-score" data-match-id="${escapeHtml(match.id)}" data-side="B" ${!ready || complete ? "disabled" : ""}></div>
				<div class="mt-3 flex justify-end">${complete
					? `<button type="button" class="button button-secondary button-sm" data-action="edit-bracket-match" data-match-id="${escapeHtml(match.id)}">結果を修正</button>`
					: `<button type="button" class="button button-primary button-sm" data-action="confirm-bracket-match" data-match-id="${escapeHtml(match.id)}" ${ready ? "" : "disabled"}>勝敗を確定</button>`}</div>
			</div>
		</div>`;
	}

	function renderBracketSection(title, matches) {
		if (!matches.length) return "";
		const groups = [];
		matches.forEach((match) => {
			let group = groups.find((item) => item.name === match.displayRound);
			if (!group) {
				group = { name: match.displayRound, matches: [] };
				groups.push(group);
			}
			group.matches.push(match);
		});
		return `<section class="mb-4"><h3 class="mb-3 text-lg font-bold">${escapeHtml(title)}</h3><div class="bracket-scroll"><div class="bracket-lane">${groups.map((group) => `<div class="bracket-round"><div class="bracket-round-title">${escapeHtml(group.name)}</div>${group.matches.map(renderBracketMatch).join("")}</div>`).join("")}</div></div></section>`;
	}

	function renderBracket() {
		const matches = activeEvent.bracket.matches;
		const grandFinal = matches.find((match) => match.id === activeEvent.bracket.grandFinalId);
		const placementMatches = matches.filter((match) => match.section === "placement");
		const tournamentComplete = grandFinal && grandFinal.status === "complete" && placementMatches.every((match) => match.status === "complete");
		activeEvent.phase = tournamentComplete ? "complete" : "bracket";
		const champion = grandFinal && grandFinal.status === "complete" ? grandFinal.winnerId : null;
		eventContent.innerHTML = `
			${champion ? `<div class="champion-card mb-4"><p class="section-kicker mb-2">CHAMPION</p><div class="winner-name"><i class="bi bi-trophy-fill mr-2 text-amber-400"></i>${escapeHtml(teamName(activeEvent, champion))}</div><p class="mb-0 mt-2 text-white/60">${escapeHtml(activeEvent.name)} 優勝</p></div>` : `<div class="phase-banner mb-4"><p class="section-kicker mb-1">PLAYOFFS</p><h3 class="mb-2 text-lg font-bold">本戦</h3><p class="mb-0 text-slate-500">対戦相手が確定した試合から結果を入力できます。</p></div>`}
			${renderBracketSection(
				activeEvent.format === "double" ? "Upper Bracket" : "Tournament Bracket",
				activeEvent.format === "double"
					? matches.filter((match) => match.section === "upper" || match.section === "grand")
					: matches.filter((match) => match.section === "upper")
			)}
			${renderBracketSection("Lower Bracket", matches.filter((match) => match.section === "lower"))}
			${renderBracketSection("順位決定戦", matches.filter((match) => match.section === "placement"))}
			${activeEvent.settings.usePrelim ? '<div class="mt-4"><button type="button" class="button button-warning" data-action="reopen-groups"><i class="bi bi-pencil"></i>予選結果を修正</button></div>' : ""}`;
		if (activeEvent.phase === "complete") saveEvent(activeEvent);
	}

	function renderLeague() {
		const completed = activeEvent.leagueMatches.filter((match) => match.status === "complete").length;
		const allComplete = completed === activeEvent.leagueMatches.length;
		const rounds = new Map();
		activeEvent.leagueMatches.forEach((match) => {
			const key = `${match.cycle}-${match.round}`;
			if (!rounds.has(key)) rounds.set(key, []);
			rounds.get(key).push(match);
		});
		if (allComplete && activeEvent.phase !== "complete") {
			activeEvent.phase = "complete";
			saveEvent(activeEvent);
		}
		eventContent.innerHTML = `
			<div class="phase-banner mb-4"><p class="section-kicker mb-1">ROUND ROBIN</p><h3 class="mb-2 text-lg font-bold">総当たり戦</h3><p class="mb-0 text-slate-500">${completed}/${activeEvent.leagueMatches.length}試合が確定しています。</p></div>
			<section class="panel standing-card mb-4"><div class="panel-header"><strong>順位表</strong></div><div class="panel-body">${renderStandings(activeEvent.teams.map((team) => team.id), activeEvent.leagueMatches)}</div></section>
			<section><h3 class="mb-3 text-lg font-bold">対戦日程</h3>${[...rounds.entries()].map(([key, matches], index) => {
				const [cycle, round] = key.split("-");
				const groupComplete = matches.every((match) => match.status === "complete");
				const shouldOpen = !groupComplete && [...rounds.entries()].slice(0, index).every(([, prior]) => prior.every((match) => match.status === "complete"));
				return `<details class="panel event-card mb-3" ${shouldOpen || allComplete ? "open" : ""}><summary class="panel-header flex cursor-pointer items-center justify-between"><strong>第${round}節${Number(cycle) > 1 ? `・第${cycle}戦` : ""}</strong><span class="badge ${groupComplete ? "badge-success" : "badge-neutral"}">${matches.filter((match) => match.status === "complete").length}/${matches.length}</span></summary><div class="panel-body"><div class="grid gap-3 lg:grid-cols-2">${matches.map((match) => `<div class="min-w-0">${renderRoundRobinMatch(match)}</div>`).join("")}</div></div></details>`;
			}).join("")}</section>`;
	}

	function findRoundMatch(id) {
		return [...(activeEvent.groupMatches || []), ...(activeEvent.leagueMatches || [])].find((match) => match.id === id);
	}

	function confirmRoundMatch(id) {
		const match = findRoundMatch(id);
		if (!match) return;
		const result = analyzeMapMatch(match);
		if (!result.decided || result.error) return;
		match.status = "complete";
		match.winnerId = result.winnerSide === "A" ? match.teamAId : match.teamBId;
		saveEvent(activeEvent);
		renderEvent();
	}

	function editRoundMatch(id) {
		const match = findRoundMatch(id);
		if (!match) return;
		match.status = "ready";
		match.winnerId = null;
		if (activeEvent.phase === "complete" && activeEvent.format.startsWith("round")) activeEvent.phase = "league";
		saveEvent(activeEvent);
		renderEvent();
	}

	function confirmBracketMatch(id) {
		const match = activeEvent.bracket.matches.find((item) => item.id === id);
		if (!match) return;
		const [teamAId, teamBId] = bracketTeams(match);
		const a = Number(match.scoreA);
		const b = Number(match.scoreB);
		const target = Math.floor(match.bestOf / 2) + 1;
		const valid = Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && ((a === target && b < target) || (b === target && a < target));
		if (!valid) {
			showAlert(`BO${match.bestOf}は、勝者が${target}マップ先取となるスコアを入力してください。`, "danger");
			return;
		}
		match.winnerId = a > b ? teamAId : teamBId;
		match.loserId = a > b ? teamBId : teamAId;
		match.status = "complete";
		saveEvent(activeEvent);
		renderEvent();
	}

	function dependentMatches(matchId) {
		return activeEvent.bracket.matches.filter((match) =>
			(match.sourceA && match.sourceA.matchId === matchId) || (match.sourceB && match.sourceB.matchId === matchId)
		);
	}

	function clearMatchAndDependents(matchId, visited = new Set()) {
		if (visited.has(matchId)) return;
		visited.add(matchId);
		dependentMatches(matchId).forEach((match) => clearMatchAndDependents(match.id, visited));
		const match = activeEvent.bracket.matches.find((item) => item.id === matchId);
		if (match) {
			match.status = "waiting";
			match.scoreA = "";
			match.scoreB = "";
			match.winnerId = null;
			match.loserId = null;
		}
	}

	function editBracketMatch(id) {
		const dependents = dependentMatches(id);
		if (dependents.length && !window.confirm("この結果を修正すると、影響する後続試合の結果も消去されます。続けますか？")) return;
		clearMatchAndDependents(id);
		activeEvent.phase = "bracket";
		saveEvent(activeEvent);
		renderEvent();
	}

	function reopenGroups() {
		const hasBracketResults = activeEvent.bracket && activeEvent.bracket.matches.some((match) => match.status === "complete");
		if (hasBracketResults && !window.confirm("予選結果を修正すると、本戦の組み合わせと全結果が消去されます。続けますか？")) return;
		activeEvent.phase = "group";
		activeEvent.bracket = null;
		activeEvent.bracketSeeds = [];
		activeEvent.qualifiers = [];
		activeEvent.qualificationDraws = {};
		saveEvent(activeEvent);
		renderEvent();
	}

	document.getElementById("show-create-btn").addEventListener("click", showCreatePanel);
	document.getElementById("cancel-create-btn").addEventListener("click", hideCreatePanel);
	document.getElementById("cancel-create-secondary").addEventListener("click", hideCreatePanel);
	formatSelect.addEventListener("change", updateCreateOptions);
	teamNamesInput.addEventListener("input", updateCreateOptions);
	qualifierSelect.addEventListener("change", updateCreateOptions);
	prelimModeSelect.addEventListener("change", updateBlockOptions);
	blockCountSelect.addEventListener("change", updateBlockOptions);
	createForm.addEventListener("submit", (event) => {
		event.preventDefault();
		createTournament();
	});

	tournamentList.addEventListener("click", (event) => {
		const button = event.target.closest("[data-action]");
		if (!button) return;
		const id = button.dataset.eventId;
		if (button.dataset.action === "open-event") openEvent(id);
		if (button.dataset.action === "delete-dashboard") {
			const stored = loadEvent(id);
			if (stored && window.confirm(`「${stored.name}」を削除します。この端末から大会データが消去されます。よろしいですか？`)) {
				removeEvent(id);
				renderDashboard();
				showAlert("大会を削除しました。", "success");
			}
		}
	});

	document.getElementById("back-dashboard-btn").addEventListener("click", renderDashboard);
	document.getElementById("delete-event-btn").addEventListener("click", () => {
		if (!activeEvent) return;
		if (window.confirm(`「${activeEvent.name}」を削除します。この端末から大会データが消去されます。よろしいですか？`)) {
			removeEvent(activeEvent.id);
			renderDashboard();
			showAlert("大会を削除しました。", "success");
		}
	});

	document.getElementById("reset-event-btn").addEventListener("click", () => {
		if (!activeEvent) return;
		if (!window.confirm(`「${activeEvent.name}」の試合結果と抽選をすべてリセットします。ほかの大会には影響しません。続けますか？`)) return;
		initializeCompetition(activeEvent);
		saveEvent(activeEvent);
		renderEvent();
		showAlert("この大会をリセットしました。", "success");
	});

	eventContent.addEventListener("change", (event) => {
		const input = event.target.closest("[data-action]");
		if (!input || !activeEvent) return;
		if (input.dataset.action === "round-score") {
			const match = findRoundMatch(input.dataset.matchId);
			if (!match) return;
			match.maps[Number(input.dataset.mapIndex)][input.dataset.side] = input.value;
			saveEvent(activeEvent);
			renderEvent();
		}
		if (input.dataset.action === "bracket-score") {
			const match = activeEvent.bracket.matches.find((item) => item.id === input.dataset.matchId);
			if (!match) return;
			if (input.dataset.side === "A") match.scoreA = input.value;
			else match.scoreB = input.value;
			saveEvent(activeEvent);
		}
	});

	eventContent.addEventListener("click", (event) => {
		const button = event.target.closest("[data-action]");
		if (!button || !activeEvent) return;
		const action = button.dataset.action;
		if (action === "select-swap-item") selectSwapItem(button);
		if (action === "redraw-groups") {
			activeEvent.groups = drawGroups(activeEvent.teams.map((team) => team.id), activeEvent.settings.blockCount);
			saveEvent(activeEvent);
			renderEvent();
		}
		if (action === "start-groups") startGroupStage();
		if (action === "confirm-round-match") confirmRoundMatch(button.dataset.matchId);
		if (action === "edit-round-match") editRoundMatch(button.dataset.matchId);
		if (action === "finalize-groups") finalizeGroups();
		if (action === "redraw-bracket") {
			activeEvent.bracketSeeds = shuffle(activeEvent.bracketSeeds);
			saveEvent(activeEvent);
			renderEvent();
		}
		if (action === "start-bracket") startBracket();
		if (action === "confirm-bracket-match") confirmBracketMatch(button.dataset.matchId);
		if (action === "edit-bracket-match") editBracketMatch(button.dataset.matchId);
		if (action === "reopen-groups") reopenGroups();
	});

	eventContent.addEventListener("keydown", (event) => {
		const item = event.target.closest('[data-action="select-swap-item"]');
		if (!item || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		selectSwapItem(item);
	});

	eventContent.addEventListener("dragstart", (event) => {
		const item = event.target.closest(".draggable-team");
		if (!item) return;
		dragPayload = { scope: item.dataset.dragScope, teamId: item.dataset.teamId };
		item.classList.add("is-dragging");
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", item.dataset.teamId);
	});

	eventContent.addEventListener("dragover", (event) => {
		const target = event.target.closest(".draggable-team");
		if (!target || !dragPayload || target.dataset.dragScope !== dragPayload.scope || target.dataset.teamId === dragPayload.teamId) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		document.querySelectorAll(".draggable-team.drag-over").forEach((element) => element.classList.remove("drag-over"));
		target.classList.add("drag-over");
	});

	eventContent.addEventListener("drop", (event) => {
		const target = event.target.closest(".draggable-team");
		if (!target || !dragPayload || target.dataset.dragScope !== dragPayload.scope) return;
		event.preventDefault();
		const payload = dragPayload;
		dragPayload = null;
		swapTeamItems(payload.scope, payload.teamId, target.dataset.teamId);
	});

	eventContent.addEventListener("dragend", () => {
		dragPayload = null;
		document.querySelectorAll(".draggable-team.is-dragging, .draggable-team.drag-over").forEach((element) => element.classList.remove("is-dragging", "drag-over"));
	});

	renderDashboard();
	updateCreateOptions();
})();
