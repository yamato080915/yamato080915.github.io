
let pointsData = {};
let players = [];

fetch('points.json')
	.then(res => res.json())
	.then(data => {
		pointsData = data;
	})
	.catch(err => console.error('Error loading points.json:', err));

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
			players.splice(index, 1);
			updatePlayerList();
		};
		li.appendChild(delBtn);
		list.appendChild(li);
	});
	document.getElementById('player-count').textContent = players.length;
}

document.getElementById('shuffle-btn').addEventListener('click', function() {
	const teamCount = parseInt(document.getElementById('team-count').value);
	if(players.length === 0) {
		alert('プレイヤーを追加してください');
		return;
	}
	if(!pointsData || Object.keys(pointsData).length === 0) {
		alert('ポイントデータを読み込み中です。少々お待ちください。');
		return;
	}
	
	const playersWithPoints = players.map(p => {
		let pts = 0;
		if (p.tier === 'radiant') {
			pts = pointsData[p.tier][0];
		} else {
			pts = pointsData[p.tier][p.div - 1] || 0;
		}
		return { ...p, point: pts };
	});

	let bestTeams = null;
	let bestScore = { diff: Infinity, vcDiff: Infinity };

	for (let sim = 0; sim < 5000; sim++) {
		let shuffled = [...playersWithPoints].sort(() => Math.random() - 0.5);
		shuffled.sort((a, b) => b.point - a.point);
		
		let teams = Array.from({length: teamCount}, () => ({ members: [], totalPoints: 0 }));
		
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
	
	const resultDiv = document.getElementById('result');
	resultDiv.innerHTML = '';
	
	bestTeams.forEach((t, i) => {
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
				${t.members.map(m => `
				<li class="list-group-item d-flex justify-content-between align-items-center">
					${m.name}
					<div>
						<span class="badge ${m.vc ? 'bg-success' : 'bg-danger'} me-1">${m.vc ? 'VCあり' : 'VCなし'}</span>
						<span class="badge bg-light text-dark border">${m.tier} ${m.div} (${m.point}pts)</span>
					</div>
				</li>`).join('')}
				${t.members.length === 0 ? '<li class="list-group-item text-muted text-center">メンバーがいません</li>' : ''}
			</ul>
		`;
		col.appendChild(card);
		resultDiv.appendChild(col);
	});
});