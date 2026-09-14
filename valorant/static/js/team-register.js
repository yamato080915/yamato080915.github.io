(function() {
	'use strict';
	const $ = id => document.getElementById(id);
	const id = new URL(location.href).searchParams.get('id');
	const api = new TeamRoom.Api();
	const key = `${TeamRoom.PREFIX}registration.${id}`;
	let token, busy = false, timer, hydrated = false, stopped = false, canEdit = false;
	let refreshController = null, requestVersion = 0;
	function message(text, error = false) { $('registration-status').textContent = text; $('registration-status').dataset.error = String(error); }
	function division() { const radiant = $('p-tier').value === 'radiant'; if (radiant) $('p-div').value = '1'; $('p-div').disabled = radiant; }
	function render(data, fill) {
		TeamRoom.validateRegistrationSnapshot(data, id);
		$('registration-form').dataset.rankMode = data.room.rankMode;
		$('registration-room').textContent = `募集ID: ${id} ／ 期限: ${new Date(data.room.expiresAt).toLocaleString('ja-JP')}`;
		if (data.participant && (fill || !hydrated)) {
			$('p-name').value = data.participant.name; $('p-tier').value = data.participant.tier;
			$('p-div').value = data.participant.div; $('p-vc').checked = data.participant.vc;
		}
		hydrated = true;
		canEdit = data.editable && data.room.status === 'open' && Date.parse(data.room.expiresAt) > Date.now();
		$('registration-fields').disabled = !canEdit;
		$('registration-submit').textContent = data.participant ? '登録情報を更新する' : '参加登録する';
		division();
		const reason = { closed: '募集は終了しました。情報の修正はできません。', expired: '募集の有効期限が切れました。', removed: '主催者により削除されました。受付中は再登録できます。サーバーの状態を確認しています。', locked: 'チーム分けが確定したため、情報の修正はできません。' };
		message(canEdit ? (data.participant ? '登録済みです。現在は情報を修正できます。' : '情報を入力して参加登録してください。') : (reason[data.reason] || '現在は情報を修正できません。'));
		stopped = data.room.status !== 'open';
		$('registration-retry').hidden = true;
	}
	async function refresh(fill = false) {
		if (busy || refreshController || !token) return;
		clearTimeout(timer);
		const controller = new AbortController(), version = ++requestVersion;
		refreshController = controller;
		try {
			const data = await api.request(`/rooms/${id}/registration`, { token, signal: controller.signal });
			if (version === requestVersion) render(data, fill);
		}
		catch (error) {
			if (version !== requestVersion || controller.signal.aborted) return;
			if (error.status >= 400 && error.status < 500) { canEdit = false; $('registration-fields').disabled = true; }
			message(error.message, true); $('registration-retry').hidden = false;
			if ([401, 403, 404].includes(error.status)) stopped = true;
		} finally {
			if (refreshController === controller) refreshController = null;
			if (version === requestVersion) schedule();
		}
	}
	function schedule() { clearTimeout(timer); if (!busy && !stopped && !document.hidden) timer = setTimeout(refresh, 5000); }
	$('p-tier').addEventListener('change', division);
	$('registration-form').addEventListener('submit', async event => {
		event.preventDefault();
		if (busy || !canEdit) return;
		const body = { name: $('p-name').value.trim(), tier: $('p-tier').value, div: Number($('p-div').value), vc: $('p-vc').checked };
		if (!TeamRoom.validateRegistration(body)) { message('名前（1〜80文字）、ランク、ディビジョンを確認してください。', true); return; }
		// 定期取得の完了を待たず送信する。中断した古い応答は画面へ反映しない。
		requestVersion++; refreshController?.abort(); refreshController = null;
		clearTimeout(timer); busy = true; $('registration-fields').disabled = true;
		message('登録情報を保存しています…');
		try {
			render(await api.request(`/rooms/${id}/registration`, { method: 'PUT', token, body }), true);
			message('登録情報を保存しました。主催者の画面へ順次反映されます。');
		} catch (error) {
			canEdit = false; message(error.message, true); $('registration-retry').hidden = false;
		} finally { busy = false; schedule(); }
	});
	$('registration-retry').addEventListener('click', () => { stopped = false; refresh(); });
	document.addEventListener('visibilitychange', () => { if (!document.hidden && !stopped) refresh(); else clearTimeout(timer); });
	if (!TeamRoom.isId(id)) { message('参加URLが不正です。主催者から届いたURLを確認してください。', true); return; }
	try {
		token = localStorage.getItem(key);
		if (token === null) { token = TeamRoom.randomToken(); localStorage.setItem(key, token); }
		if (!TeamRoom.isToken(token)) throw new Error();
	} catch (_) { message('本人確認用の情報を保存できません。ブラウザの保存設定を確認してください。', true); return; }
	refresh();
})();
