let pointsData = {};
let players = [];
let standbyPlayers = [];
let lastTeams = null; // 直近のチーム分け結果。null なら「未実施」

fetch('points.json')
	.then(res => res.json())
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

/* ---------------- プレイヤーリスト ---------------- */

document.getElementById('add-player-form').addEventListener('submit', function(e) {
	e.preventDefault();
	const name = document.getElementById('p-name').value;
	const tier = document.getElementById('p-tier').value;
	const div = parseInt(document.getElementById('p-div').value);
	const vc = document.getElementById('p-vc').checked;

	players.push({ name, tier, div, vc });
	updatePlayerList();

	document.getElementById('p-name').value = '';
	document.getElementById('p-name').focus();
});

function updatePlayerList() {
	const list = document.getElementById('player-list');
	list.innerHTML = '';
	players.forEach((p, index) => {
		const li = document.createElement('li');
		li.className = 'list-group-item d-flex justify-content-between align-items-center';
		li.innerHTML = `
			<span><strong>${p.name}</strong> <span class="badge bg-secondary ms-2">${p.tier} ${p.div}</span><span class="badge ${p.vc ? 'bg-success' : 'bg-danger'} ms-2">${p.vc ? 'VCあり' : 'VCなし'}</span></span>
		`;

		const delBtn = document.createElement('button');
		delBtn.className = 'btn btn-danger btn-sm';
		delBtn.textContent = '削除';
		delBtn.onclick = () => {
			if (lastTeams) {
				// 退出済みとして扱うため、チーム結果からも削除する 
				for (let i = 0; i < lastTeams.length; i++) {
					const memberIndex = lastTeams[i].members.findIndex(member =>
						member.name === p.name &&
						member.tier === p.tier &&
						member.div === p.div &&
						member.vc === p.vc
					);

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
	const name = document.getElementById('s-name').value;
	const tier = document.getElementById('s-tier').value;
	const div = parseInt(document.getElementById('s-div').value);
	const vc = document.getElementById('s-vc').checked;

	standbyPlayers.push({ name, tier, div, vc });
	updateStandbyList();

	document.getElementById('s-name').value = '';
	document.getElementById('s-name').focus();
});

function updateStandbyList() {
	const list = document.getElementById('standby-player-list');
	list.innerHTML = '';
	standbyPlayers.forEach((p, index) => {
		const li = document.createElement('li');
		li.className = 'list-group-item d-flex justify-content-between align-items-center';
		li.innerHTML = `
			<span><strong>${p.name}</strong> <span class="badge bg-secondary ms-2">${p.tier} ${p.div}</span><span class="badge ${p.vc ? 'bg-success' : 'bg-danger'} ms-2">${p.vc ? 'VCあり' : 'VCなし'}</span></span>
		`;

		const delBtn = document.createElement('button');
		delBtn.className = 'btn btn-danger btn-sm';
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
		col.className = 'col-lg-6 mb-3';
		const vcNoneCount = t.members.filter(m => !m.vc).length;
		const card = document.createElement('div');
		card.className = 'card h-100';
		card.innerHTML = `
			<div class="card-header bg-dark text-white d-flex justify-content-between align-items-center">
				<span>チーム ${i + 1} <span class="badge bg-secondary ms-2">VCなし: ${vcNoneCount}人</span></span>
				<span class="badge bg-primary rounded-pill">合計 ${t.totalPoints} pts</span>
			</div>
			<ul class="list-group list-group-flush">
				${t.members.map((m, mi) => `
				<li class="list-group-item d-flex justify-content-between align-items-center">
					${m.name}
					<div>
						<span class="badge ${m.vc ? 'bg-success' : 'bg-danger'} me-1">${m.vc ? 'VCあり' : 'VCなし'}</span>
						<span class="badge bg-light text-dark border me-1">${m.tier} ${m.div} (${m.point}pts)</span>
						<button type="button" class="btn btn-outline-danger btn-sm leave-btn" data-team="${i}" data-member="${mi}">退出</button>
					</div>
				</li>`).join('')}
				${t.members.length === 0 ? '<li class="list-group-item text-muted text-center">メンバーがいません</li>' : ''}
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
	const pIdx = players.findIndex(p =>
		p.name === member.name && p.tier === member.tier && p.div === member.div && p.vc === member.vc
	);
	if (pIdx !== -1) players.splice(pIdx, 1);

	updatePlayerList();
	renderTeams(lastTeams);
}

/* ---------------- 初回シャッフル ---------------- */

function doInitialShuffle() {
	const teamCount = parseInt(document.getElementById('team-count').value);

	const playersWithPoints = players.map(p => ({ ...p, point: getPoint(p) }));

	let bestTeams = null;
	let bestScore = { diff: Infinity, vcDiff: Infinity };

	for (let sim = 0; sim < 5000; sim++) {
		let shuffled = [...playersWithPoints].sort(() => Math.random() - 0.5);
		shuffled.sort((a, b) => b.point - a.point);

		let teams = Array.from({ length: teamCount }, () => ({ members: [], totalPoints: 0, vacancies: 0 }));

		for (const p of shuffled) {
			let targetTeam = null;
			let minPts = Infinity;

			for (const t of teams) {
				if (t.members.length < 5 && t.totalPoints < minPts) {
					minPts = t.totalPoints;
					targetTeam = t;
				}
			}

			if (!targetTeam) {
				for (const t of teams) {
					if (t.totalPoints < minPts) {
						minPts = t.totalPoints;
						targetTeam = t;
					}
				}
			}

			targetTeam.members.push(p);
			targetTeam.totalPoints += p.point;
		}

		let ptsArr = teams.map(t => t.totalPoints);
		let maxP = Math.max(...ptsArr);
		let minP = Math.min(...ptsArr);
		let diff = maxP - minP;

		let vcArr = teams.map(t => t.members.filter(m => !m.vc).length);
		let maxVc = Math.max(...vcArr);
		let minVc = Math.min(...vcArr);
		let vcDiff = maxVc - minVc;

		if (diff < bestScore.diff || (diff === bestScore.diff && vcDiff < bestScore.vcDiff)) {
			bestScore = { diff, vcDiff };
			bestTeams = JSON.parse(JSON.stringify(teams));
		}

		if (bestScore.diff === 0 && bestScore.vcDiff <= 1) break;
	}

	lastTeams = bestTeams;
	renderTeams(lastTeams);
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

	// 途中参加プレイヤーにポイントを付与
	const standbyWithPoints = standbyPlayers.map(p => ({ ...p, point: getPoint(p) }));

	const baseTotals = lastTeams.map(t => t.totalPoints);
	const baseVcNone = lastTeams.map(t => t.members.filter(m => !m.vc).length);
	const baseSlots = lastTeams.map(t => t.vacancies || 0);

	let bestAssignment = null; // [{ teamIndex, player }, ...] totalVacancies件
	let bestScore = { diff: Infinity, vcDiff: Infinity };

	for (let sim = 0; sim < 5000; sim++) {
		// 途中参加プレイヤーの中から必要人数分をランダムに選出
		let pool = [...standbyWithPoints].sort(() => Math.random() - 0.5);
		let selected = pool.slice(0, totalVacancies);
		selected.sort((a, b) => b.point - a.point);

		let remainingSlots = [...baseSlots];
		let runningTotals = [...baseTotals];
		let runningVcNone = [...baseVcNone];
		let assignment = [];

		for (const p of selected) {
			// 空き枠が残っていて、かつ現在の合計ポイントが最も低いチームに割り当てる
			let targetIndex = -1;
			let minPts = Infinity;
			for (let i = 0; i < lastTeams.length; i++) {
				if (remainingSlots[i] > 0 && runningTotals[i] < minPts) {
					minPts = runningTotals[i];
					targetIndex = i;
				}
			}
			if (targetIndex === -1) break;

			remainingSlots[targetIndex]--;
			runningTotals[targetIndex] += p.point;
			if (!p.vc) runningVcNone[targetIndex]++;
			assignment.push({ teamIndex: targetIndex, player: p });
		}

		const maxP = Math.max(...runningTotals);
		const minP = Math.min(...runningTotals);
		const diff = maxP - minP;

		const maxVc = Math.max(...runningVcNone);
		const minVc = Math.min(...runningVcNone);
		const vcDiff = maxVc - minVc;

		if (diff < bestScore.diff || (diff === bestScore.diff && vcDiff < bestScore.vcDiff)) {
			bestScore = { diff, vcDiff };
			bestAssignment = assignment;
		}

		if (bestScore.diff === 0 && bestScore.vcDiff <= 1) break;
	}

	if (!bestAssignment || bestAssignment.length < totalVacancies) {
		alert('調整に失敗しました。もう一度お試しください。');
		return;
	}

	// 採用されたプレイヤーをチームへ反映
	bestAssignment.forEach(({ teamIndex, player }) => {
		lastTeams[teamIndex].members.push(player);
		lastTeams[teamIndex].totalPoints += player.point;
		lastTeams[teamIndex].vacancies -= 1;

		// プレイヤーリストへ追加
		players.push({ name: player.name, tier: player.tier, div: player.div, vc: player.vc });

		// 途中参加リストから除去(不採用の人はそのまま残る)
		const sIdx = standbyPlayers.findIndex(sp =>
			sp.name === player.name && sp.tier === player.tier && sp.div === player.div && sp.vc === player.vc
		);
		if (sIdx !== -1) standbyPlayers.splice(sIdx, 1);
	});

	updatePlayerList();
	updateStandbyList();
	renderTeams(lastTeams);
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
	resetBtn.className = 'btn btn-outline-secondary ms-2';
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