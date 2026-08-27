let pointsData = {};
let players = [];
let standbyPlayers = [];
let lastTeams = null; // 直近のチーム分け結果。null なら「未実施」
let nextPlayerId = 1;

fetch('points.json')
	.then(res => {
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	})
	.then(data => {
		pointsData = data;
	})
	.catch(err => console.error('Error loading points.json:', err));

function getPoint(p) {
	if (!pointsData || !pointsData[p.tier]) return 0;
	if (p.tier === 'radiant') {
		return pointsData[p.tier][0];
	}
	return pointsData[p.tier][p.div - 1] || 0;
}

function createPlayer(name, tier, div, vc) {
	return { id: `player-${nextPlayerId++}`, name, tier, div, vc };
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

/* ---------------- プレイヤーリスト ---------------- */

document.getElementById('add-player-form').addEventListener('submit', function(e) {
	e.preventDefault();
	const name = document.getElementById('p-name').value.trim();
	const tier = document.getElementById('p-tier').value;
	const div = parseInt(document.getElementById('p-div').value);
	const vc = document.getElementById('p-vc').checked;

	players.push(createPlayer(name, tier, div, vc));
	updatePlayerList();

	document.getElementById('p-name').value = '';
	document.getElementById('p-name').focus();
});

function updatePlayerList() {
	const list = document.getElementById('player-list');
	list.innerHTML = '';
	players.forEach((p, index) => {
		const li = document.createElement('li');
		li.className = 'list-item flex items-center justify-between gap-3';
		li.innerHTML = `
			<span><strong>${escapeHtml(p.name)}</strong> <span class="badge badge-neutral ml-2">${p.tier} ${p.div}</span><span class="badge ${p.vc ? 'badge-success' : 'badge-danger'} ml-2">${p.vc ? 'VCあり' : 'VCなし'}</span></span>
		`;

		const delBtn = document.createElement('button');
		delBtn.className = 'button button-danger button-sm shrink-0';
		delBtn.textContent = '削除';
		delBtn.onclick = () => {
			if (lastTeams) {
				// 退出済みとして扱うため、チーム結果からも削除する 
				for (let i = 0; i < lastTeams.length; i++) {
					const memberIndex = lastTeams[i].members.findIndex(member => member.id === p.id);

					if (memberIndex !== -1) {
						leaveMember(i, memberIndex);
						break;
					}
				}
			} else {
				players.splice(index, 1);
			};
			updatePlayerList();
		};
		li.appendChild(delBtn);
		list.appendChild(li);
	});
	document.getElementById('player-count').textContent = players.length;
}

/* ---------------- 途中参加プレイヤーリスト ---------------- */

document.getElementById('add-standby-form').addEventListener('submit', function(e) {
	e.preventDefault();
	const name = document.getElementById('s-name').value.trim();
	const tier = document.getElementById('s-tier').value;
	const div = parseInt(document.getElementById('s-div').value);
	const vc = document.getElementById('s-vc').checked;

	standbyPlayers.push(createPlayer(name, tier, div, vc));
	updateStandbyList();

	document.getElementById('s-name').value = '';
	document.getElementById('s-name').focus();
});

function updateStandbyList() {
	const list = document.getElementById('standby-player-list');
	list.innerHTML = '';
	standbyPlayers.forEach((p, index) => {
		const li = document.createElement('li');
		li.className = 'list-item flex items-center justify-between gap-3';
		li.innerHTML = `
			<span><strong>${escapeHtml(p.name)}</strong> <span class="badge badge-neutral ml-2">${p.tier} ${p.div}</span><span class="badge ${p.vc ? 'badge-success' : 'badge-danger'} ml-2">${p.vc ? 'VCあり' : 'VCなし'}</span></span>
		`;

		const delBtn = document.createElement('button');
		delBtn.className = 'button button-danger button-sm shrink-0';
		delBtn.textContent = '削除';
		delBtn.onclick = () => {
			standbyPlayers.splice(index, 1);
			updateStandbyList();
		};
		li.appendChild(delBtn);
		list.appendChild(li);
	});
	document.getElementById('standby-player-count').textContent = standbyPlayers.length;
}

/* ---------------- チーム結果の描画 ---------------- */

function renderTeams(teams) {
	const resultDiv = document.getElementById('result');
	resultDiv.innerHTML = '';

	teams.forEach((t, i) => {
		const col = document.createElement('div');
		col.className = 'min-w-0';
		const vcNoneCount = t.members.filter(m => !m.vc).length;
		const card = document.createElement('div');
		card.className = 'panel h-full';
		card.innerHTML = `
			<div class="flex items-center justify-between gap-3 bg-slate-950 px-5 py-4 font-semibold text-white">
				<span>チーム ${i + 1} <span class="badge bg-white/15 text-white ml-2">VCなし: ${vcNoneCount}人</span></span>
				<span class="badge bg-brand-500 text-white">合計 ${t.totalPoints} pts</span>
			</div>
			<ul class="list">
				${t.members.map((m, mi) => `
				<li class="list-item flex flex-wrap items-center justify-between gap-3">
					${escapeHtml(m.name)}
					<div class="flex flex-wrap items-center gap-2">
						<span class="badge ${m.vc ? 'badge-success' : 'badge-danger'}">${m.vc ? 'VCあり' : 'VCなし'}</span>
						<span class="badge badge-neutral">${m.tier} ${m.div} (${m.point}pts)</span>
						<button type="button" class="button button-danger button-sm leave-btn" data-team="${i}" data-member="${mi}">退出</button>
					</div>
				</li>`).join('')}
				${t.members.length === 0 ? '<li class="list-item text-center text-slate-500">メンバーがいません</li>' : ''}
			</ul>
		`;
		col.appendChild(card);
		resultDiv.appendChild(col);
	});

	resultDiv.querySelectorAll('.leave-btn').forEach(btn => {
		btn.addEventListener('click', function() {
			const teamIndex = parseInt(this.dataset.team);
			const memberIndex = parseInt(this.dataset.member);
			leaveMember(teamIndex, memberIndex);
		});
	});
}

// チーム結果画面から「退出」ボタンが押されたとき
function leaveMember(teamIndex, memberIndex) {
	const team = lastTeams[teamIndex];
	const member = team.members[memberIndex];
	if (!member) return;

	team.members.splice(memberIndex, 1);
	team.totalPoints -= member.point;
	team.vacancies = (team.vacancies || 0) + 1;

	// プレイヤーリストからも削除(退出済みとして扱う)
	const pIdx = players.findIndex(p => p.id === member.id);
	if (pIdx !== -1) players.splice(pIdx, 1);

	updatePlayerList();
	renderTeams(lastTeams);
}

/* ---------------- 初回シャッフル ---------------- */

function doInitialShuffle() {
	const teamCount = parseInt(document.getElementById('team-count').value);
	const playersWithPoints = players.map(p => ({ ...p, point: getPoint(p) }));
	try {
		const result = TeamBalancer.balanceInitial(playersWithPoints, teamCount);
		lastTeams = result.teams;
		renderTeams(lastTeams);
	} catch (error) {
		alert(error.message);
	}
}

/* ---------------- 退出・途中参加を反映した調整 ---------------- */

function doAdjustment() {
	const totalVacancies = lastTeams.reduce((sum, t) => sum + (t.vacancies || 0), 0);

	if (totalVacancies === 0) {
		alert('退出したプレイヤーがいないため、調整の必要はありません。');
		return;
	}

	if (standbyPlayers.length < totalVacancies) {
		alert(`途中参加プレイヤーが不足しています。あと${totalVacancies - standbyPlayers.length}人必要です。`);
		return;
	}

	const standbyWithPoints = standbyPlayers.map(p => ({ ...p, point: getPoint(p) }));
	try {
		const result = TeamBalancer.fillVacancies(lastTeams, standbyWithPoints);
		const selectedIds = new Set(result.selectedPlayerIds);
		const selectedPlayers = standbyPlayers.filter(player => selectedIds.has(player.id));
		players.push(...selectedPlayers);
		standbyPlayers = standbyPlayers.filter(player => !selectedIds.has(player.id));
		lastTeams = result.teams;
		updatePlayerList();
		updateStandbyList();
		renderTeams(lastTeams);
	} catch (error) {
		alert(error.message);
	}
}

/* ---------------- チーム分け実行ボタン ---------------- */

document.getElementById('shuffle-btn').addEventListener('click', function() {
	if (!pointsData || Object.keys(pointsData).length === 0) {
		alert('ポイントデータを読み込み中です。少々お待ちください。');
		return;
	}

	if (lastTeams) {
		// 2回目以降: 退出・途中参加を反映した調整のみを行う
		doAdjustment();
	} else {
		// 初回: 全プレイヤーからフルシャッフル
		if (players.length === 0) {
			alert('プレイヤーを追加してください');
			return;
		}
		doInitialShuffle();
	}
});

/* ---------------- リセットボタン(最初からやり直す用) ---------------- */

(function addResetButton() {
	const shuffleBtn = document.getElementById('shuffle-btn');
	if (!shuffleBtn) return;

	const resetBtn = document.createElement('button');
	resetBtn.type = 'button';
	resetBtn.id = 'reset-teams-btn';
	resetBtn.className = 'button button-secondary';
	resetBtn.textContent = 'チーム分けをリセット';
	resetBtn.addEventListener('click', function() {
		if (!lastTeams) {
			alert('リセットするチーム分け結果がありません。');
			return;
		}
		if (!confirm('チーム分け結果をリセットし、最初からやり直しますか?')) return;
		lastTeams = null;
		document.getElementById('result').innerHTML = '';
	});

	shuffleBtn.insertAdjacentElement('afterend', resetBtn);
})();
