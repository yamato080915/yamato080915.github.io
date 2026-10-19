(function() {
	'use strict';
	const $ = id => document.getElementById(id);
	const app = $('registration-app');
	const id = new URL(location.href).searchParams.get('id');
	const api = new TeamRoom.Api();
	const key = `${TeamRoom.PREFIX}registration.${id}`;
	const modeLabels = { peak: '最高ランク', current: '現ランク' };
	let token, timer, cooldownTimer, hydrated = false, stopped = false, canEdit = false;
	let busyLookup = false, busySubmit = false, busyMap = false, cooldownUntil = 0, roomRankMode = 'peak';
	let participant = null, verification = null, refreshController = null, requestVersion = 0;
	let points = null, lastSnapshot = null;
	const editor = $('registration-editor'), editorSummary = $('registration-editor-summary');

	function message(text, error = false) { $('registration-status').textContent = text; $('registration-status').dataset.error = String(error); }
	function updateEditorSummary() {
		const registered = Boolean(participant);
		editor.dataset.collapsible = String(registered);
		editorSummary.setAttribute('aria-disabled', String(!registered));
		$('registration-editor-title').textContent = registered ? '参加者情報（登録済み）' : '参加者情報';
		$('registration-editor-action').textContent = registered
			? (editor.open ? '閉じる' : '参加情報を修正する') : '入力してください';
	}
	function updateEditorState(wasRegistered, firstRender, fill) {
		if (!participant) editor.open = true;
		else if (firstRender || fill || !wasRegistered) editor.open = false;
		updateEditorSummary();
	}
	function rankMessage(text, error = false) {
		const node = $('rank-lookup-result'); node.hidden = false; node.textContent = text; node.dataset.error = String(error);
	}
	function riotInput() { return { gameName: $('p-riot-name').value.trim(), tagline: $('p-riot-tag').value.trim() }; }
	function sameRiotId(a, b) {
		return Boolean(a && b) && a.gameName.trim().toLocaleLowerCase() === b.gameName.trim().toLocaleLowerCase()
			&& a.tagline.trim().toLocaleLowerCase() === b.tagline.trim().toLocaleLowerCase();
	}
	function rankLabel(value) {
		if (!value) return '';
		if (value.tier === 'unranked') return 'ランクなし';
		const tier = value.tier[0].toUpperCase() + value.tier.slice(1);
		return tier + (value.tier === 'radiant' ? '' : ` ${value.div}`);
	}
	function element(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}
	function rankBadge(value) {
		const badge = element('span', 'badge badge-neutral shuffle-rank-badge');
		const label = rankLabel(value);
		if (value.tier !== 'unranked') {
			const image = element('img', 'shuffle-rank-icon');
			const division = value.tier === 'radiant' ? 1 : value.div;
			image.src = `/valorant/static/pictures/rank-icons/${value.tier[0].toUpperCase() + value.tier.slice(1)}/${division}.png`;
			image.alt = '';
			image.setAttribute('aria-hidden', 'true');
			badge.append(image);
		}
		badge.append(element('span', '', label));
		return badge;
	}
	function playerPoint(player) {
		const value = points?.[player.tier]?.[player.div - 1];
		return Number.isFinite(value) ? value : null;
	}
	function directoryPerson(player, selfId, standby = false) {
		const row = element('li', 'list-item shuffle-person shuffle-viewer-person');
		const info = element('div', 'shuffle-person-info');
		info.append(element('strong', '', player.name));
		const badges = element('div', 'shuffle-person-badges');
		if (player.id === selfId) badges.append(element('span', 'badge badge-primary', '自分'));
		if (standby) badges.append(element('span', 'badge badge-neutral', '補充待ち'));
		badges.append(element('span', 'badge badge-neutral', player.riotId
			? `${player.riotId.gameName}#${player.riotId.tagline}` : '旧方式登録'));
		badges.append(rankBadge(player));
		const point = playerPoint(player);
		if (point !== null) badges.append(element('span', 'badge badge-primary', `${point} pts`));
		badges.append(element('span', `badge ${player.vc ? 'badge-success' : 'badge-danger'}`, player.vc ? 'VCあり' : 'VCなし'));
		info.append(badges); row.append(info);
		return row;
	}
	function hideDirectory() {
		$('participant-directory-panel').hidden = true;
		$('participant-result-panel').hidden = true;
		$('team-map-panel').hidden = true;
		$('participant-directory').replaceChildren();
		$('participant-result').replaceChildren();
		$('team-map-options').replaceChildren();
	}
	function mapImage(map) { return `linear-gradient(rgb(15 23 42 / .42), rgb(15 23 42 / .42)), url('/valorant/static/pictures/${map}.png')`; }
	function renderMapSelection(data) {
		const panel = $('team-map-panel'), options = $('team-map-options');
		options.replaceChildren();
		if (!data.participant || !data.teams) { panel.hidden = true; return; }
		const teamIndex = data.teams.findIndex(team => team.members.some(member => member.id === data.participant.id));
		panel.hidden = false;
		if (teamIndex === -1) {
			$('team-map-message').textContent = '補充待ちのため、チーム確定後に希望マップを選択できます。';
			return;
		}
		const selection = data.room.mapSelection;
		const preference = selection.preferences?.[teamIndex] || null;
		if (selection.selectedMap) {
			$('team-map-message').textContent = `決定マップ: ${selection.selectedMap}`;
			return;
		}
		$('team-map-message').textContent = `チーム ${teamIndex + 1} の希望マップを選択してください。チームの誰でも変更でき、最後の選択が反映されます。`;
		for (const map of TeamRoom.MAPS) {
			const button = element('button', 'shuffle-map-option', undefined);
			button.type = 'button'; button.style.backgroundImage = mapImage(map); button.setAttribute('aria-pressed', String(map === preference));
			button.disabled = busyMap; button.append(element('span', '', map));
			button.addEventListener('click', async () => {
				if (busyMap || map === preference) return;
				stopRefresh(); busyMap = true; renderMapSelection(data);
				try {
					const snapshot = await api.request(`/rooms/${id}/team-map-preference`, { method: 'PUT', token, body: { map } });
					render(snapshot, false); message('希望マップを保存しました。');
				} catch (error) { message(error.message, true); }
				finally { busyMap = false; if (lastSnapshot) renderMapSelection(lastSnapshot); schedule(); }
			});
			options.append(button);
		}
	}
	function renderDirectory(data) {
		if (!data.participant) { hideDirectory(); return; }
		$('participant-directory-panel').hidden = false;
		$('participant-result-panel').hidden = false;
		$('participant-directory-count').textContent = String(data.participants.length);
		const teamMemberIds = new Set(data.teams?.flatMap(team => team.members.map(member => member.id)) || []);
		const rows = data.participants.map(player => directoryPerson(player, data.participant.id,
			data.teams !== null && !teamMemberIds.has(player.id)));
		$('participant-directory').replaceChildren(...rows);
		const result = $('participant-result'); result.replaceChildren();
		if (data.teams === null) {
			result.append(element('p', 'shuffle-empty', 'チーム分け結果はまだ確定していません。'));
			return;
		}
		data.teams.forEach((team, index) => {
			const panel = element('section', 'panel');
			const header = element('div', 'panel-header shuffle-heading');
			header.append(element('span', '', `チーム ${index + 1}`));
			const teamPoints = team.members.map(playerPoint);
			const total = teamPoints.every(value => value !== null) ? teamPoints.reduce((sum, value) => sum + value, 0) : null;
			const summary = `${total === null ? '' : `${total} pts ／ `}VCなし ${team.members.filter(player => !player.vc).length}人`;
			header.append(element('span', 'badge badge-neutral', summary));
			const members = element('ul', 'list');
			members.append(...team.members.map(player => directoryPerson(player, data.participant.id)));
			if (team.vacancies) members.append(element('li', 'shuffle-empty', `空き枠: ${team.vacancies}人`));
			panel.append(header, members); result.append(panel);
		});
	}
	function savedVerification() {
		if (!participant?.riotId || participant.rankModeVerified !== roomRankMode || !sameRiotId(participant.riotId, riotInput())) return null;
		return { saved: true, verificationId: null, riotId: participant.riotId, rankMode: participant.rankModeVerified,
			tier: participant.tier, div: participant.div, rankLabel: rankLabel(participant) };
	}
	function matchingVerification() {
		if (verification && verification.rankMode === roomRankMode && sameRiotId(verification.riotId, riotInput())) return verification;
		return savedVerification();
	}
	function formValue() {
		const riotId = riotInput();
		return { name: $('p-name').value.trim(), riotName: riotId.gameName, riotTag: riotId.tagline, vc: $('p-vc').checked, consent: $('p-rank-consent').checked };
	}
	function updateControls() {
		const busy = busyLookup || busySubmit;
		$('registration-fields').disabled = !canEdit || busy;
		const valid = TeamRoom.validateRegistrationInput(formValue());
		const wait = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
		const current = matchingVerification(), saved = Boolean(current?.saved);
		$('rank-lookup-btn').disabled = !canEdit || busy || !valid || wait > 0 || saved;
		$('rank-lookup-btn').textContent = saved ? '保存済みランクを使用' : wait > 0 ? `ランクを取得（${wait}秒）` : (busyLookup ? 'ランクを取得中…' : 'ランクを取得');
		$('registration-submit').disabled = !canEdit || busy || !valid || !current;
	}
	function showVerified(value, reused = false) {
		const label = value.tier === 'unranked' ? rankLabel(value) : (value.rankLabel || rankLabel(value));
		rankMessage(`${modeLabels[value.rankMode] || 'ランク'}: ${label}${reused ? '（保存済み）' : ''}`);
	}
	function reconcileVerification() {
		if (verification && (!sameRiotId(verification.riotId, riotInput()) || verification.rankMode !== roomRankMode)) verification = null;
		const current = matchingVerification();
		if (current) showVerified(current, Boolean(current.saved));
		else rankMessage(`${modeLabels[roomRankMode]}を取得してください。`);
		updateControls();
	}
	function render(data, fill) {
		TeamRoom.validateRegistrationSnapshot(data, id);
		lastSnapshot = data;
		const wasRegistered = Boolean(participant), firstRender = !hydrated;
		const previousMode = roomRankMode;
		roomRankMode = data.room.rankMode; participant = data.participant;
		$('registration-form').dataset.rankMode = roomRankMode;
		$('registration-room').textContent = `募集ID: ${id} ／ 期限: ${new Date(data.room.expiresAt).toLocaleString('ja-JP')}`;
		if (participant && (fill || !hydrated)) {
			$('p-name').value = participant.name; $('p-vc').checked = participant.vc;
			$('p-riot-name').value = participant.riotId?.gameName || '';
			$('p-riot-tag').value = participant.riotId?.tagline || '';
			$('p-rank-consent').checked = Boolean(participant.riotId); verification = null;
		}
		if (previousMode !== roomRankMode && verification?.rankMode !== roomRankMode) verification = null;
		hydrated = true;
		canEdit = data.editable && data.room.status === 'open' && Date.parse(data.room.expiresAt) > Date.now();
		$('registration-submit').textContent = participant ? '登録情報を更新する' : '参加登録する';
		const reason = { closed: '募集は終了しました。情報の修正はできません。', expired: '募集の有効期限が切れました。', removed: '主催者により削除されました。受付中は再登録できます。', locked: 'チーム分けが確定したため、情報の修正はできません。' };
		message(data.reason === 'removed' ? reason.removed
			: canEdit ? (participant ? '登録済みです。現在は情報を修正できます。' : '情報を入力し、ランクを取得して参加登録してください。')
				: (reason[data.reason] || '現在は情報を修正できません。'));
		renderDirectory(data);
		renderMapSelection(data);
		stopped = data.reason === 'removed' || (!participant && data.room.status !== 'open');
		$('registration-retry').hidden = true; updateEditorState(wasRegistered, firstRender, fill); reconcileVerification();
	}
	function schedule() { clearTimeout(timer); if (!busyLookup && !busySubmit && !busyMap && !stopped && !document.hidden) timer = setTimeout(refresh, 5000); }
	async function refresh(fill = false) {
		if (busyLookup || busySubmit || busyMap || refreshController || !token) return;
		clearTimeout(timer);
		const controller = new AbortController(), version = ++requestVersion; refreshController = controller;
		try {
			const data = await api.request(`/rooms/${id}/registration`, { token, signal: controller.signal });
			if (version === requestVersion) render(data, fill);
		} catch (error) {
			if (version !== requestVersion || controller.signal.aborted) return;
			if (error.status >= 400 && error.status < 500) { canEdit = false; updateControls(); }
			message(error.message, true); $('registration-retry').hidden = false;
			if ([401, 403, 404].includes(error.status)) { stopped = true; hideDirectory(); }
		} finally { if (refreshController === controller) refreshController = null; if (version === requestVersion) schedule(); }
	}
	function stopRefresh() { requestVersion++; refreshController?.abort(); refreshController = null; clearTimeout(timer); }
	function startCooldown(seconds) {
		cooldownUntil = Date.now() + Math.max(1, seconds) * 1000; clearInterval(cooldownTimer);
		cooldownTimer = setInterval(() => {
			updateControls();
			if (Date.now() >= cooldownUntil) { clearInterval(cooldownTimer); cooldownTimer = null; }
		}, 250);
	}
	async function loadPoints() {
		try {
			const response = await fetch(app.dataset.pointsUrl, { cache: 'no-cache' });
			if (!response.ok) throw new Error();
			const value = await response.json();
			if (!TeamRoom.TIERS.every(tier => Array.isArray(value[tier])
				&& value[tier].length === (['radiant', 'unranked'].includes(tier) ? 1 : 3)
				&& value[tier].every(Number.isFinite))) throw new Error();
			points = value;
		} catch (_) { points = null; }
		if (lastSnapshot) renderDirectory(lastSnapshot);
	}

	for (const input of [$('p-riot-name'), $('p-riot-tag')]) input.addEventListener('input', reconcileVerification);
	for (const input of [$('p-name'), $('p-vc'), $('p-rank-consent')]) input.addEventListener('input', updateControls);
	$('rank-lookup-btn').addEventListener('click', async () => {
		if (!canEdit || busyLookup || busySubmit || !TeamRoom.validateRegistrationInput(formValue())) return;
		stopRefresh(); busyLookup = true; updateControls(); rankMessage('ランクを取得しています…');
		try {
			const value = formValue();
			const result = TeamRoom.validateRankVerification(await api.lookupRank({ roomId: id, participantToken: token,
				riotName: value.riotName, riotTag: value.riotTag, consent: value.consent }), id);
			verification = result; $('p-riot-name').value = result.riotId.gameName; $('p-riot-tag').value = result.riotId.tagline;
			showVerified(result); message('ランクを確認しました。参加登録できます。');
		} catch (error) {
			verification = null;
			const wait = Math.max(0, Number(error.retryAfter) || 0);
			if (error.status === 429 && wait) startCooldown(wait);
			rankMessage(error.message, true); message('ランクを取得できませんでした。入力内容を確認して再試行してください。', true);
		} finally { busyLookup = false; updateControls(); schedule(); }
	});
	$('registration-form').addEventListener('submit', async event => {
		event.preventDefault();
		const verified = matchingVerification(), value = formValue();
		if (busyLookup || busySubmit || !canEdit || !verified) return;
		if (!TeamRoom.validateRegistrationInput(value)) { message('表示名、Riot ID、VC設定、同意を確認してください。', true); return; }
		stopRefresh(); busySubmit = true; updateControls(); message('登録情報を保存しています…');
		try {
			const body = { ...value, verificationId: verified.saved ? null : verified.verificationId };
			render(await api.request(`/rooms/${id}/registration`, { method: 'PUT', token, body }), true);
			message('登録情報を保存しました。主催者の画面へ順次反映されます。');
		} catch (error) {
			if (['verification_required', 'verification_expired'].includes(error.code)) verification = null;
			message(error.message, true); $('registration-retry').hidden = false;
		} finally { busySubmit = false; reconcileVerification(); schedule(); }
	});
	$('registration-retry').addEventListener('click', () => { stopped = false; refresh(); });
	editorSummary.addEventListener('click', event => {
		if (!participant) { event.preventDefault(); editor.open = true; updateEditorSummary(); }
	});
	editor.addEventListener('toggle', () => {
		if (!participant && !editor.open) editor.open = true;
		updateEditorSummary();
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && !stopped) refresh();
		else stopRefresh();
	});
	if (!TeamRoom.isId(id)) { message('参加URLが不正です。主催者から届いたURLを確認してください。', true); return; }
	try {
		token = localStorage.getItem(key);
		if (token === null) { token = TeamRoom.randomToken(); localStorage.setItem(key, token); }
		if (!TeamRoom.isToken(token)) throw new Error();
	} catch (_) { message('本人確認用の情報を保存できません。ブラウザの保存設定を確認してください。', true); return; }
	loadPoints(); refresh();
})();
