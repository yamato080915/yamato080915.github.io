(function() {
	'use strict';
	const $ = id => document.getElementById(id);
	const app = $('team-shuffle-app');
	let manager, busy = false, syncing = false, timer, halted = false, pointsReady = false, renderKey = '', replacingExpired = false;
	const labels = { open: '受付中', closed: '募集終了', expired: '期限切れ' };
	function status(message, error = false) {
		$('sync-status').textContent = message;
		$('sync-status').dataset.error = String(error);
	}
	function element(tag, className, text) {
		const el = document.createElement(tag);
		if (className) el.className = className;
		if (text !== undefined) el.textContent = text;
		return el;
	}
	function person(p, inTeam = false) {
		const row = element('li', 'list-item shuffle-person');
		const info = element('div', 'shuffle-person-info');
		info.append(element('strong', '', p.name));
		const badges = element('div', 'shuffle-person-badges');
		const tier = p.tier[0].toUpperCase() + p.tier.slice(1);
		badges.append(element('span', 'badge badge-neutral', tier + (p.tier === 'radiant' ? '' : ' ' + p.div)));
		badges.append(element('span', 'badge ' + (p.vc ? 'badge-success' : 'badge-danger'), p.vc ? 'VCあり' : 'VCなし'));
		const accepting = manager.state.room.status === 'open' && Date.parse(manager.state.room.expiresAt) > Date.now();
		badges.append(element('span', 'badge badge-neutral', !accepting ? '受付終了' : p.editLocked ? '情報確定' : '修正可能'));
		info.append(badges); row.append(info);
		const remove = element('button', 'button button-danger button-sm', inTeam ? '退出' : '削除');
		remove.type = 'button'; remove.dataset.removeId = p.id;
		remove.setAttribute('aria-label', p.name + (inTeam ? 'を退出扱いにする' : 'を削除'));
		remove.addEventListener('click', () => {
			if (!confirm(p.name + 'を削除・退出扱いにしますか？\n参加者本人による再編集はできなくなります。')) return;
			perform(() => manager.remove(p.id));
		});
		row.append(remove); return row;
	}
	function list(id, players, empty) {
		const node = $(id); node.replaceChildren(...players.map(p => person(p)));
		if (!players.length) node.append(element('li', 'shuffle-empty', empty));
	}
	function controls() {
		const s = manager?.state;
		const unavailable = busy || !s || halted || replacingExpired;
		const pending = Boolean(s?.pending);
		$('copy-url-btn').disabled = !s || replacingExpired;
		$('close-room-btn').disabled = unavailable || pending || s.room.status !== 'open' || Date.parse(s.room.expiresAt) <= Date.now();
		$('new-room-btn').disabled = busy || halted || pending;
		$('retry-sync-btn').disabled = busy || syncing || halted;
		$('team-count').disabled = unavailable || pending || Boolean(s?.lastTeams);
		$('shuffle-btn').disabled = unavailable || pending || !pointsReady || (!s.lastTeams && !s.players.length);
		$('reset-teams-btn').disabled = unavailable || pending || !s?.lastTeams;
		app.querySelectorAll('[data-remove-id]').forEach(button => { button.disabled = unavailable || pending; });
	}
	function render() {
		const s = manager?.state;
		if (!s) { controls(); return; }
		if (replacingExpired) {
			$('room-id').textContent = '新しい募集を発行中…';
			$('room-state').textContent = '更新中';
			$('room-expiry').textContent = '—';
			$('registration-url').value = '';
			$('player-count').textContent = '0';
			$('standby-player-count').textContent = '0';
			list('player-list', [], '新しい募集を準備しています。');
			list('standby-player-list', [], '補充待ちの参加者はいません。');
			$('result').replaceChildren(); renderKey = '';
			controls(); return;
		}
		$('room-id').textContent = s.room.id;
		$('room-state').textContent = labels[s.room.status];
		$('room-expiry').textContent = new Date(s.room.expiresAt).toLocaleString('ja-JP');
		const url = new URL(app.dataset.registerUrl, location.origin);
		url.searchParams.set('id', s.room.id);
		$('registration-url').value = url.href;
		if (document.activeElement !== $('team-count')) $('team-count').value = s.teamCount;
		const key = JSON.stringify([s.room.id, s.room.status, s.players, s.standbyPlayers, s.lastTeams]);
		if (renderKey !== key) {
			renderKey = key;
			$('player-count').textContent = s.players.length;
			$('standby-player-count').textContent = s.standbyPlayers.length;
			list('player-list', s.players, '参加URLを共有して登録を待ちましょう。');
			list('standby-player-list', s.standbyPlayers, '補充待ちの参加者はいません。');
			$('result').replaceChildren();
			if (s.lastTeams) s.lastTeams.forEach((team, index) => {
				const panel = element('div', 'panel');
				const header = element('div', 'panel-header shuffle-heading');
				header.append(element('span', '', 'チーム ' + (index + 1)));
				header.append(element('span', 'badge badge-neutral', team.totalPoints + ' pts ／ VCなし ' + team.members.filter(p => !p.vc).length + '人'));
				const members = element('ul', 'list');
				members.append(...team.members.map(p => person(p, true)));
				if (team.vacancies) members.append(element('li', 'shuffle-empty', '空き枠: ' + team.vacancies + '人'));
				panel.append(header, members); $('result').append(panel);
			});
		}
		controls();
	}
	function schedule() {
		clearTimeout(timer);
		if (!document.hidden && !busy && !halted && (replacingExpired || !manager?.state || manager.state.pending || manager.state.room.status === 'open')) {
			timer = setTimeout(refresh, 5000);
		}
	}
	function synchronized() {
		const s = manager.state;
		if (!pointsReady) status('ランクポイントを取得できないためチーム分けを停止しています。ページを再読み込みしてください。', true);
		else status(s?.room.status === 'open' ? '最終取得: ' + new Date().toLocaleTimeString('ja-JP') + ' ／ 5秒ごとに更新しています。' : '受付は終了しています。一覧・結果を保持し、チーム分けや補充を続けられます。');
	}
	function failed(error) {
		status(error.message + (manager?.state?.pending ? '\n確定結果を確認中です。再取得で復旧します。' : ''), true);
		if ([401, 403, 404].includes(error.status)) {
			status('募集を取得できません。保存データを保持しています。ページを再読み込みして再確認してください。', true);
			halted = true;
		}
	}
	async function refresh() {
		if (busy || syncing || halted) return;
		if (replacingExpired) return replaceExpired();
		if (!manager?.state || manager.state.pending) return perform(() => manager.sync(), '保存した結果を確認しています…');
		clearTimeout(timer); syncing = true; controls();
		try {
			const updated = await manager.sync();
			if (!busy && updated !== false) synchronized();
		} catch (error) { if (!busy) failed(error); }
		finally { syncing = false; if (!busy) { render(); schedule(); } }
	}
	function replaceExpired() {
		return perform(async () => {
			await manager.start();
			replacingExpired = false;
		}, '保存期間を過ぎたため、新しい募集を発行しています…');
	}
	async function perform(action, message = '処理しています…') {
		if (busy || halted) return;
		clearTimeout(timer); busy = true; manager.cancelSync(); controls(); status(message);
		try {
			await action();
			synchronized();
		} catch (error) { failed(error); }
		finally { busy = false; render(); schedule(); }
	}
	$('copy-url-btn').addEventListener('click', async () => {
		try { await navigator.clipboard.writeText($('registration-url').value); status('参加URLをコピーしました。'); }
		catch (_) { $('registration-url').focus(); $('registration-url').select(); status('参加URLを選択しました。コピーして共有してください。'); }
	});
	$('retry-sync-btn').addEventListener('click', refresh);
	$('close-room-btn').addEventListener('click', () => {
		if (confirm('募集を終了しますか？\n新規登録と情報修正を停止します。一覧と結果は保持されます。受付は再開できません。')) perform(() => manager.close());
	});
	$('new-room-btn').addEventListener('click', () => {
		if (manager.state && !confirm('現在の募集を終了し、新しい募集を作成しますか？\n新しい画面では参加者・チーム結果が空になり、参加URLも変わります。')) return;
		perform(() => manager.newRoom());
	});
	$('shuffle-btn').addEventListener('click', () => perform(() => manager.shuffle(), 'チーム分けを確定しています…'));
	$('reset-teams-btn').addEventListener('click', () => {
		if (confirm('チーム分け結果をリセットしますか？\n全員を通常参加へ戻し、受付中なら情報を再び修正できるようにします。')) perform(() => manager.reset());
	});
	$('team-count').addEventListener('change', async () => {
		if (busy || halted) return;
		const count = Number($('team-count').value);
		try { await manager.setTeamCount(count); }
		catch (error) { failed(error); }
		finally { if (!busy) { render(); schedule(); } }
	});
	document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); else clearTimeout(timer); });
	window.addEventListener('storage', event => { if (event.key?.startsWith(TeamRoom.PREFIX)) refresh(); });
	async function init() {
		try {
			manager = new TeamRoom.RoomManager({
				api: new TeamRoom.Api(), storage: localStorage, balancer: TeamBalancer,
				withLock: task => navigator.locks ? navigator.locks.request('valorant-team-shuffle-host', task) : task()
			});
			manager.restore();
			replacingExpired = Boolean(manager.state && (
				manager.state.room.status === 'expired'
				|| Date.parse(manager.state.room.expiresAt) <= Date.now()
			));
			render();
		} catch (error) { halted = true; status(error.message, true); controls(); return; }
		try {
			const response = await fetch(app.dataset.pointsUrl, { cache: 'no-cache' });
			if (!response.ok) throw new Error();
			const points = await response.json();
			if (!TeamRoom.TIERS.every(tier => Array.isArray(points[tier]) && points[tier].length === (tier === 'radiant' ? 1 : 3) && points[tier].every(Number.isFinite))) throw new Error();
			manager.points = points; pointsReady = true;
		} catch (_) {
			status('ランクポイントを取得できません。ページを再読み込みしてください。', true);
			// 募集・参加者の取得は継続し、チーム分けのみ無効にする。
		}
		if (replacingExpired) await replaceExpired();
		else if (manager.state && !manager.state.pending) {
			await refresh();
			// ブラウザ時計では期限内でも、サーバーが期限切れと判定した場合に対応する。
			if (manager.state.room.status === 'expired') {
				replacingExpired = true; render(); await replaceExpired();
			}
		}
		else await perform(() => manager.start(), '募集を準備しています…');
		if (!pointsReady) status('参加者情報は取得できますが、ランクポイントを取得できないためチーム分けを停止しています。ページを再読み込みしてください。', true);
	}
	init();
})();
