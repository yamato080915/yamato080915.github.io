(function(root, factory) {
	'use strict';
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	if (root) root.TeamBalancer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
	'use strict';

	const DEFAULT_RESTARTS = 128;
	const MAX_LOCAL_PASSES = 40;
	const MAX_CANDIDATES = 10;
	const EPSILON = 1e-9;

	function createSeededRng(seed) {
		let state = seed >>> 0;
		return function() {
			state += 0x6d2b79f5;
			let value = state;
			value = Math.imul(value ^ (value >>> 15), value | 1);
			value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
			return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
		};
	}

	function shuffle(values, rng) {
		const result = [...values];
		for (let i = result.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[result[i], result[j]] = [result[j], result[i]];
		}
		return result;
	}

	function randomInt(min, max, rng) {
		return min + Math.floor(rng() * (max - min + 1));
	}

	function validatePlayers(players, label) {
		if (!Array.isArray(players)) throw new Error(`${label}が不正です。`);
		const ids = new Set();
		for (const player of players) {
			if (!player || typeof player.id !== 'string' || player.id.length === 0) {
				throw new Error(`${label}のプレイヤーIDが不正です。`);
			}
			if (ids.has(player.id)) throw new Error(`${label}に重複したプレイヤーIDがあります。`);
			if (!Number.isFinite(player.point)) throw new Error(`${label}のポイントが不正です。`);
			if (typeof player.vc !== 'boolean') throw new Error(`${label}のVC設定が不正です。`);
			if (player.teamGroupId !== undefined && player.teamGroupId !== null
				&& (typeof player.teamGroupId !== 'string' || player.teamGroupId.length === 0)) {
				throw new Error(`${label}の同チームグループが不正です。`);
			}
			ids.add(player.id);
		}
		return ids;
	}

	function getTargetSizes(playerCount, teamCount) {
		const baseSize = Math.floor(playerCount / teamCount);
		const largerTeams = playerCount % teamCount;
		return Array.from({ length: teamCount }, (_, index) => baseSize + (index < largerTeams ? 1 : 0));
	}

	function scoreFromTotals(pointTotals, vcNoneTotals) {
		const pointMax = Math.max(...pointTotals);
		const pointMin = Math.min(...pointTotals);
		const pointMean = pointTotals.reduce((sum, value) => sum + value, 0) / pointTotals.length;
		const vcMean = vcNoneTotals.reduce((sum, value) => sum + value, 0) / vcNoneTotals.length;
		return {
			pointSpread: pointMax - pointMin,
			pointDeviation: pointTotals.reduce((sum, value) => sum + Math.abs(value - pointMean), 0),
			vcDeviation: vcNoneTotals.reduce((sum, value) => sum + Math.abs(value - vcMean), 0),
			vcSpread: Math.max(...vcNoneTotals) - Math.min(...vcNoneTotals)
		};
	}
		
	function evaluateTeams(teams) {
		return scoreFromTotals(
			teams.map(team => team.members.reduce((sum, player) => sum + player.point, 0)),
			teams.map(team => team.members.filter(player => !player.vc).length)
		);
	}

	function compareScores(left, right) {
		for (const key of ['pointSpread', 'pointDeviation', 'vcDeviation']) {
			const difference = left[key] - right[key];
			if (Math.abs(difference) > EPSILON) return difference < 0 ? -1 : 1;
		}
		return 0;
	}

	function feasibleVcWindows(baseCounts, slots, minNoVc, maxNoVc) {
		const maximumFinalCount = Math.max(...baseCounts.map((count, index) => count + slots[index]));
		for (let spread = 0; spread <= maximumFinalCount; spread++) {
			const windows = [];
			for (let lower = 0; lower + spread <= maximumFinalCount; lower++) {
				const upper = lower + spread;
				const minimumAdds = [];
				const maximumAdds = [];
				let valid = true;
				for (let i = 0; i < baseCounts.length; i++) {
					const minimum = Math.max(0, lower - baseCounts[i]);
					const maximum = Math.min(slots[i], upper - baseCounts[i]);
					if (maximum < minimum) {
						valid = false;
						break;
					}
					minimumAdds.push(minimum);
					maximumAdds.push(maximum);
				}
				if (!valid) continue;
				const minimumTotal = minimumAdds.reduce((sum, value) => sum + value, 0);
				const maximumTotal = maximumAdds.reduce((sum, value) => sum + value, 0);
				const totalMin = Math.max(minNoVc, minimumTotal);
				const totalMax = Math.min(maxNoVc, maximumTotal);
				if (totalMin <= totalMax) {
					windows.push({ spread, minimumAdds, maximumAdds, totalMin, totalMax });
				}
			}
			if (windows.length > 0) return windows;
		}
		throw new Error('VC人数を割り当てられる構成がありません。');
	}

	function createAdditionTargets(window, rng) {
		const targetTotal = randomInt(window.totalMin, window.totalMax, rng);
		const additions = [...window.minimumAdds];
		let remaining = targetTotal - additions.reduce((sum, value) => sum + value, 0);
		while (remaining > 0) {
			const available = additions
				.map((value, index) => value < window.maximumAdds[index] ? index : -1)
				.filter(index => index !== -1);
			const index = available[Math.floor(rng() * available.length)];
			additions[index]++;
			remaining--;
		}
		return additions;
	}

	function buildTeamsForNoVcTargets(players, targetSizes, targetVcNone, rng) {
		const vcNonePool = shuffle(players.filter(player => !player.vc), rng);
		const vcPool = shuffle(players.filter(player => player.vc), rng);
		const teams = targetSizes.map((size, index) => {
			const vcNoneCount = targetVcNone[index];
			const members = [
				...vcNonePool.splice(0, vcNoneCount),
				...vcPool.splice(0, size - vcNoneCount)
			];
			return { members: shuffle(members, rng), totalPoints: 0, vacancies: 0 };
		});
		refreshTeamTotals(teams);
		return teams;
	}

	function buildInitialCandidate(players, targetSizes, windows, rng) {
		const window = windows[Math.floor(rng() * windows.length)];
		return buildTeamsForNoVcTargets(players, targetSizes, createAdditionTargets(window, rng), rng);
	}

	function refreshTeamTotals(teams) {
		for (const team of teams) {
			team.totalPoints = team.members.reduce((sum, player) => sum + player.point, 0);
		}
	}

	function improveInitialCandidate(teams, vcSpreadLimit, rng) {
		let score = evaluateTeams(teams);
		for (let pass = 0; pass < MAX_LOCAL_PASSES; pass++) {
			let bestScore = score;
			let bestMoves = [];
			for (let a = 0; a < teams.length; a++) {
				for (let b = a + 1; b < teams.length; b++) {
					for (let ai = 0; ai < teams[a].members.length; ai++) {
						for (let bi = 0; bi < teams[b].members.length; bi++) {
							const left = teams[a].members[ai];
							const right = teams[b].members[bi];
							if (left.id === right.id) continue;
							[teams[a].members[ai], teams[b].members[bi]] = [right, left];
							const nextScore = evaluateTeams(teams);
							[teams[a].members[ai], teams[b].members[bi]] = [left, right];
							if (nextScore.vcSpread > vcSpreadLimit) continue;
							const comparison = compareScores(nextScore, bestScore);
							if (comparison < 0) {
								bestScore = nextScore;
								bestMoves = [{ a, b, ai, bi }];
							} else if (comparison === 0 && compareScores(nextScore, score) < 0) {
								bestMoves.push({ a, b, ai, bi });
							}
						}
					}
				}
			}
			if (bestMoves.length === 0 || compareScores(bestScore, score) >= 0) break;
			const move = bestMoves[Math.floor(rng() * bestMoves.length)];
			const left = teams[move.a].members[move.ai];
			teams[move.a].members[move.ai] = teams[move.b].members[move.bi];
			teams[move.b].members[move.bi] = left;
			score = bestScore;
		}
		refreshTeamTotals(teams);
		return score;
	}

	function teamSignature(teams, preserveOrder) {
		const signatures = teams.map(team => team.members.map(player => player.id).sort().join(','));
		if (!preserveOrder) signatures.sort();
		return signatures.join('|');
	}

	function keepCandidate(candidates, candidate, preserveOrder) {
		const signature = teamSignature(candidate.teams, preserveOrder);
		if (candidates.some(existing => existing.signature === signature)) return;
		candidates.push({ ...candidate, signature });
		candidates.sort((left, right) => compareScores(left.score, right.score));
		if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
	}

	function chooseCandidate(candidates, rng) {
		if (candidates.length === 0) throw new Error('チーム分けの候補を作成できませんでした。');
		const best = candidates[0];
		const eligible = candidates.filter(candidate =>
			candidate.score.pointSpread <= best.score.pointSpread + 1 + EPSILON &&
			candidate.score.pointDeviation <= best.score.pointDeviation * 1.1 + 2 + EPSILON
		);
		return eligible[Math.floor(rng() * eligible.length)];
	}

	function groupedPlayers(players) {
		const groups = new Map();
		for (const player of players) {
			const key = player.teamGroupId ? `group:${player.teamGroupId}` : `player:${player.id}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(player);
		}
		return [...groups.entries()].map(([key, members]) => {
			if (key.startsWith('group:') && (members.length < 2 || members.length > 5)) {
				throw new Error('同チームグループは2〜5人で設定してください。');
			}
			return { key, members, size: members.length };
		});
	}

	function teamsFromGroups(groupAssignments, capacities) {
		return groupAssignments.map((groups, index) => {
			const members = groups.flatMap(group => group.members);
			return {
				members,
				totalPoints: members.reduce((sum, player) => sum + player.point, 0),
				vacancies: capacities[index] - members.length
			};
		});
	}

	function evaluateGroupedTeams(teams) {
		const sizes = teams.map(team => team.members.length);
		const meanSize = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
		return {
			sizeSpread: Math.max(...sizes) - Math.min(...sizes),
			sizeDeviation: sizes.reduce((sum, size) => sum + Math.abs(size - meanSize), 0),
			...evaluateTeams(teams)
		};
	}

	function compareGroupedScores(left, right) {
		for (const key of ['sizeSpread', 'sizeDeviation', 'pointSpread', 'pointDeviation', 'vcSpread', 'vcDeviation']) {
			const difference = left[key] - right[key];
			if (Math.abs(difference) > EPSILON) return difference < 0 ? -1 : 1;
		}
		return 0;
	}

	function buildGroupedCandidate(groups, capacities, rng) {
		if (groups.length < capacities.length) return null;
		const assignments = capacities.map(() => []);
		const sizes = capacities.map(() => 0);
		const orderedGroups = shuffle(groups, rng).sort((left, right) => right.size - left.size);

		for (const group of orderedGroups) {
			let bestScore = null;
			let bestIndexes = [];
			for (let index = 0; index < assignments.length; index++) {
				if (sizes[index] + group.size > capacities[index]) continue;
				assignments[index].push(group);
				sizes[index] += group.size;
				const score = evaluateGroupedTeams(teamsFromGroups(assignments, capacities));
				assignments[index].pop();
				sizes[index] -= group.size;
				const comparison = bestScore === null ? -1 : compareGroupedScores(score, bestScore);
				if (comparison < 0) {
					bestScore = score;
					bestIndexes = [index];
				} else if (comparison === 0) {
					bestIndexes.push(index);
				}
			}
			if (bestIndexes.length === 0) return null;
			const selectedIndex = bestIndexes[Math.floor(rng() * bestIndexes.length)];
			assignments[selectedIndex].push(group);
			sizes[selectedIndex] += group.size;
		}

		if (assignments.some(team => team.length === 0)) return null;
		return assignments;
	}

	function improveGroupedCandidate(assignments, capacities, rng) {
		let score = evaluateGroupedTeams(teamsFromGroups(assignments, capacities));
		for (let pass = 0; pass < MAX_LOCAL_PASSES; pass++) {
			let bestScore = score;
			let bestMoves = [];
			const sizes = assignments.map(team => team.reduce((sum, group) => sum + group.size, 0));

			for (let from = 0; from < assignments.length; from++) {
				for (let to = 0; to < assignments.length; to++) {
					if (from === to) continue;
					for (let fromIndex = 0; fromIndex < assignments[from].length; fromIndex++) {
						const group = assignments[from][fromIndex];
						if (assignments[from].length > 1 && sizes[to] + group.size <= capacities[to]) {
							assignments[from].splice(fromIndex, 1);
							assignments[to].push(group);
							const nextScore = evaluateGroupedTeams(teamsFromGroups(assignments, capacities));
							assignments[to].pop();
							assignments[from].splice(fromIndex, 0, group);
							const comparison = compareGroupedScores(nextScore, bestScore);
							if (comparison < 0) {
								bestScore = nextScore;
								bestMoves = [{ type: 'move', from, to, fromIndex }];
							} else if (comparison === 0 && compareGroupedScores(nextScore, score) < 0) {
								bestMoves.push({ type: 'move', from, to, fromIndex });
							}
						}

						for (let toIndex = 0; toIndex < assignments[to].length; toIndex++) {
							const other = assignments[to][toIndex];
							if (sizes[from] - group.size + other.size > capacities[from]
								|| sizes[to] - other.size + group.size > capacities[to]) continue;
							assignments[from][fromIndex] = other;
							assignments[to][toIndex] = group;
							const nextScore = evaluateGroupedTeams(teamsFromGroups(assignments, capacities));
							assignments[from][fromIndex] = group;
							assignments[to][toIndex] = other;
							const comparison = compareGroupedScores(nextScore, bestScore);
							if (comparison < 0) {
								bestScore = nextScore;
								bestMoves = [{ type: 'swap', from, to, fromIndex, toIndex }];
							} else if (comparison === 0 && compareGroupedScores(nextScore, score) < 0) {
								bestMoves.push({ type: 'swap', from, to, fromIndex, toIndex });
							}
						}
					}
				}
			}

			if (bestMoves.length === 0 || compareGroupedScores(bestScore, score) >= 0) break;
			const move = bestMoves[Math.floor(rng() * bestMoves.length)];
			if (move.type === 'move') {
				const [group] = assignments[move.from].splice(move.fromIndex, 1);
				assignments[move.to].push(group);
			} else {
				[assignments[move.from][move.fromIndex], assignments[move.to][move.toIndex]] =
					[assignments[move.to][move.toIndex], assignments[move.from][move.fromIndex]];
			}
			score = bestScore;
		}
		return score;
	}

	function keepGroupedCandidate(candidates, candidate) {
		const signature = teamSignature(candidate.teams, false);
		if (candidates.some(existing => existing.signature === signature)) return;
		candidates.push({ ...candidate, signature });
		candidates.sort((left, right) => compareGroupedScores(left.score, right.score));
		if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
	}

	function findGroupedBalance(players, teamCount, options) {
		const settings = options || {};
		const rng = settings.rng || Math.random;
		const restarts = settings.restarts == null ? DEFAULT_RESTARTS : settings.restarts;
		const capacities = settings.capacities || Array(teamCount).fill(5);
		const groups = groupedPlayers(players);
		if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 100) {
			throw new Error('チーム数は2〜100で指定してください。');
		}
		if (!Array.isArray(capacities) || capacities.length !== teamCount
			|| capacities.some(capacity => !Number.isInteger(capacity) || capacity < 1 || capacity > 5)) {
			throw new Error('チームの人数上限が不正です。');
		}
		if (players.length < teamCount) throw new Error('チーム数は参加人数以下にしてください。');
		if (players.length > capacities.reduce((sum, capacity) => sum + capacity, 0)) {
			throw new Error('チーム数を増やすか、グループを見直してください。');
		}
		if (!Number.isInteger(restarts) || restarts < 1) throw new Error('探索回数が不正です。');
		if (groups.length < teamCount) return null;

		const candidates = [];
		for (let restart = 0; restart < restarts; restart++) {
			const assignments = buildGroupedCandidate(groups, capacities, rng);
			if (!assignments) continue;
			const score = improveGroupedCandidate(assignments, capacities, rng);
			keepGroupedCandidate(candidates, {
				teams: teamsFromGroups(assignments, capacities),
				score
			});
		}
		if (candidates.length === 0) return null;

		const best = candidates[0];
		const eligible = candidates.filter(candidate =>
			candidate.score.sizeSpread === best.score.sizeSpread
			&& candidate.score.sizeDeviation <= best.score.sizeDeviation + EPSILON
			&& candidate.score.pointSpread <= best.score.pointSpread + 1 + EPSILON
			&& candidate.score.pointDeviation <= best.score.pointDeviation * 1.1 + 2 + EPSILON
		);
		return eligible[Math.floor(rng() * eligible.length)];
	}

	function balanceGrouped(players, teamCount, options) {
		const result = findGroupedBalance(players, teamCount, options);
		if (!result) {
			throw new Error('同チームグループを維持して編成できません。チーム数を増やすか、グループを見直してください。');
		}
		return {
			teams: result.teams.map(team => ({ ...team, vacancies: 0, members: [...team.members] })),
			score: { ...result.score }
		};
	}

	function balanceInitial(players, teamCount, options) {
		const settings = options || {};
		const rng = settings.rng || Math.random;
		const restarts = settings.restarts == null ? DEFAULT_RESTARTS : settings.restarts;
		validatePlayers(players, 'プレイヤーリスト');
		if (!Number.isInteger(teamCount) || teamCount < 2) throw new Error('チーム数は2以上の整数で指定してください。');
		if (players.length < teamCount) throw new Error('チーム数は参加人数以下にしてください。');
		if (players.length > teamCount * 5) throw new Error('1チーム5人を超えます。チーム数を増やしてください。');
		if (players.some(player => player.teamGroupId)) {
			return balanceGrouped(players, teamCount, { ...settings, rng, restarts });
		}
		if (!Number.isInteger(restarts) || restarts < 1) throw new Error('探索回数が不正です。');

		const targetSizes = getTargetSizes(players.length, teamCount);
		const vcNoneCount = players.filter(player => !player.vc).length;
		const windows = feasibleVcWindows(
			Array(teamCount).fill(0),
			targetSizes,
			vcNoneCount,
			vcNoneCount
		);
		const vcSpreadLimit = windows[0].spread;
		const candidates = [];
		for (let restart = 0; restart < restarts; restart++) {
			const teams = buildInitialCandidate(players, targetSizes, windows, rng);
			const score = improveInitialCandidate(teams, vcSpreadLimit, rng);
			keepCandidate(candidates, { teams, score }, false);
		}
		const chosen = chooseCandidate(candidates, rng);
		return {
			teams: chosen.teams.map(team => ({ ...team, members: [...team.members] })),
			score: { ...chosen.score },
			vcSpreadLimit,
			candidateCount: candidates.length
		};
	}

	function buildAdjustmentCandidate(baseTeams, standbyPlayers, windows, rng) {
		const window = windows[Math.floor(rng() * windows.length)];
		const targetNoVcAdds = createAdditionTargets(window, rng);
		const noVcPool = shuffle(standbyPlayers.filter(player => !player.vc), rng);
		const vcPool = shuffle(standbyPlayers.filter(player => player.vc), rng);
		const assigned = baseTeams.map((team, index) => {
			const noVcCount = targetNoVcAdds[index];
			return shuffle([
				...noVcPool.splice(0, noVcCount),
				...vcPool.splice(0, team.vacancies - noVcCount)
			], rng);
		});
		return { assigned, unselected: shuffle([...noVcPool, ...vcPool], rng) };
	}

	function adjustmentTeams(baseTeams, assigned) {
		return baseTeams.map((team, index) => {
			const members = [...team.members, ...assigned[index]];
			return {
				members,
				totalPoints: members.reduce((sum, player) => sum + player.point, 0),
				vacancies: 0
			};
		});
	}

	function improveAdjustmentCandidate(baseTeams, state, vcSpreadLimit, rng) {
		let teams = adjustmentTeams(baseTeams, state.assigned);
		let score = evaluateTeams(teams);
		for (let pass = 0; pass < MAX_LOCAL_PASSES; pass++) {
			let bestScore = score;
			let bestMoves = [];

			for (let a = 0; a < state.assigned.length; a++) {
				for (let b = a + 1; b < state.assigned.length; b++) {
					for (let ai = 0; ai < state.assigned[a].length; ai++) {
						for (let bi = 0; bi < state.assigned[b].length; bi++) {
							const left = state.assigned[a][ai];
							const right = state.assigned[b][bi];
							[state.assigned[a][ai], state.assigned[b][bi]] = [right, left];
							const nextScore = evaluateTeams(adjustmentTeams(baseTeams, state.assigned));
							[state.assigned[a][ai], state.assigned[b][bi]] = [left, right];
							if (nextScore.vcSpread > vcSpreadLimit) continue;
							const comparison = compareScores(nextScore, bestScore);
							if (comparison < 0) {
								bestScore = nextScore;
								bestMoves = [{ type: 'swap', a, b, ai, bi }];
							} else if (comparison === 0 && compareScores(nextScore, score) < 0) {
								bestMoves.push({ type: 'swap', a, b, ai, bi });
							}
						}
					}
				}
			}

			for (let teamIndex = 0; teamIndex < state.assigned.length; teamIndex++) {
				for (let memberIndex = 0; memberIndex < state.assigned[teamIndex].length; memberIndex++) {
					for (let standbyIndex = 0; standbyIndex < state.unselected.length; standbyIndex++) {
						const selected = state.assigned[teamIndex][memberIndex];
						const waiting = state.unselected[standbyIndex];
						state.assigned[teamIndex][memberIndex] = waiting;
						state.unselected[standbyIndex] = selected;
						const nextScore = evaluateTeams(adjustmentTeams(baseTeams, state.assigned));
						state.assigned[teamIndex][memberIndex] = selected;
						state.unselected[standbyIndex] = waiting;
						if (nextScore.vcSpread > vcSpreadLimit) continue;
						const comparison = compareScores(nextScore, bestScore);
						if (comparison < 0) {
							bestScore = nextScore;
							bestMoves = [{ type: 'replace', teamIndex, memberIndex, standbyIndex }];
						} else if (comparison === 0 && compareScores(nextScore, score) < 0) {
							bestMoves.push({ type: 'replace', teamIndex, memberIndex, standbyIndex });
						}
					}
				}
			}

			if (bestMoves.length === 0 || compareScores(bestScore, score) >= 0) break;
			const move = bestMoves[Math.floor(rng() * bestMoves.length)];
			if (move.type === 'swap') {
				const left = state.assigned[move.a][move.ai];
				state.assigned[move.a][move.ai] = state.assigned[move.b][move.bi];
				state.assigned[move.b][move.bi] = left;
			} else {
				const selected = state.assigned[move.teamIndex][move.memberIndex];
				state.assigned[move.teamIndex][move.memberIndex] = state.unselected[move.standbyIndex];
				state.unselected[move.standbyIndex] = selected;
			}
			score = bestScore;
		}
		teams = adjustmentTeams(baseTeams, state.assigned);
		return { teams, score };
	}

	function fillFixedVacancies(baseTeams, standbyPlayers, rng, restarts) {
		const totalVacancies = baseTeams.reduce((sum, team) => sum + team.vacancies, 0);
		if (totalVacancies === 0) {
			const teams = adjustmentTeams(baseTeams, baseTeams.map(() => []));
			return { teams, selectedPlayerIds: [], score: evaluateTeams(teams), vcSpreadLimit: 0, candidateCount: 1 };
		}
		const standbyIds = new Set(standbyPlayers.map(player => player.id));
		const availableNoVc = standbyPlayers.filter(player => !player.vc).length;
		const availableVc = standbyPlayers.length - availableNoVc;
		const minimumSelectedNoVc = Math.max(0, totalVacancies - availableVc);
		const maximumSelectedNoVc = Math.min(totalVacancies, availableNoVc);
		const baseVcNone = baseTeams.map(team => team.members.filter(player => !player.vc).length);
		const slots = baseTeams.map(team => team.vacancies);
		const windows = feasibleVcWindows(
			baseVcNone,
			slots,
			minimumSelectedNoVc,
			maximumSelectedNoVc
		);
		const vcSpreadLimit = windows[0].spread;
		const candidates = [];
		for (let restart = 0; restart < restarts; restart++) {
			const state = buildAdjustmentCandidate(baseTeams, standbyPlayers, windows, rng);
			const result = improveAdjustmentCandidate(baseTeams, state, vcSpreadLimit, rng);
			keepCandidate(candidates, result, true);
		}
		const chosen = chooseCandidate(candidates, rng);
		const selectedPlayerIds = chosen.teams
			.flatMap(team => team.members)
			.filter(player => standbyIds.has(player.id))
			.map(player => player.id);
		return {
			teams: chosen.teams.map(team => ({ ...team, members: [...team.members] })),
			selectedPlayerIds,
			score: { ...chosen.score },
			vcSpreadLimit,
			candidateCount: candidates.length
		};
	}

	function rebalanceFlexibleTeamsWithGroups(baseTeams, standbyPlayers, rng, restarts) {
		const capacities = baseTeams.map(team => team.members.length + team.vacancies);
		const existingPlayers = baseTeams.flatMap(team => team.members);
		const standbySlots = baseTeams.reduce((sum, team) => sum + team.vacancies, 0);
		const availableNoVc = standbyPlayers.filter(player => !player.vc);
		const availableVc = standbyPlayers.filter(player => player.vc);
		const minimumNoVc = Math.max(0, standbySlots - availableVc.length);
		const maximumNoVc = Math.min(standbySlots, availableNoVc.length);
		const candidates = [];

		for (let restart = 0; restart < restarts; restart++) {
			const selectedNoVcCount = randomInt(minimumNoVc, maximumNoVc, rng);
			const selectedPlayers = [
				...shuffle(availableNoVc, rng).slice(0, selectedNoVcCount),
				...shuffle(availableVc, rng).slice(0, standbySlots - selectedNoVcCount)
			];
			const balance = findGroupedBalance(
				[...existingPlayers, ...selectedPlayers],
				baseTeams.length,
				{ rng, restarts: 1, capacities }
			);
			if (!balance) continue;
			const selectedIds = new Set(selectedPlayers.map(player => player.id));
			const selectedPlayerIds = balance.teams
				.flatMap(team => team.members)
				.filter(player => selectedIds.has(player.id))
				.map(player => player.id);
			keepGroupedCandidate(candidates, { ...balance, selectedPlayerIds });
		}

		if (candidates.length === 0) {
			throw new Error('同チームグループを維持して補充できません。チーム固定またはグループ設定を見直してください。');
		}
		const chosen = candidates[0];
		return {
			teams: chosen.teams.map((team, index) => ({
				...team,
				vacancies: capacities[index] - team.members.length,
				members: [...team.members]
			})),
			selectedPlayerIds: [...chosen.selectedPlayerIds],
			score: { ...chosen.score },
			vcSpreadLimit: chosen.score.vcSpread,
			candidateCount: candidates.length
		};
	}

	function rebalanceFlexibleTeams(baseTeams, standbyPlayers, rng, restarts) {
		const targetSizes = baseTeams.map(team => team.members.length + team.vacancies);
		const existingPlayers = baseTeams.flatMap(team => team.members);
		const standbySlots = baseTeams.reduce((sum, team) => sum + team.vacancies, 0);
		if (existingPlayers.some(player => player.teamGroupId) || standbyPlayers.some(player => player.teamGroupId)) {
			return rebalanceFlexibleTeamsWithGroups(baseTeams, standbyPlayers, rng, restarts);
		}
		const availableNoVc = standbyPlayers.filter(player => !player.vc).length;
		const availableVc = standbyPlayers.length - availableNoVc;
		const existingNoVc = existingPlayers.filter(player => !player.vc).length;
		const minimumSelectedNoVc = Math.max(0, standbySlots - availableVc);
		const maximumSelectedNoVc = Math.min(standbySlots, availableNoVc);
		const windows = feasibleVcWindows(
			Array(baseTeams.length).fill(0),
			targetSizes,
			existingNoVc + minimumSelectedNoVc,
			existingNoVc + maximumSelectedNoVc
		);
		const vcSpreadLimit = windows[0].spread;
		const candidates = [];
		for (let restart = 0; restart < restarts; restart++) {
			const window = windows[Math.floor(rng() * windows.length)];
			const targetNoVc = createAdditionTargets(window, rng);
			const selectedNoVcCount = targetNoVc.reduce((sum, value) => sum + value, 0) - existingNoVc;
			const noVcPool = shuffle(standbyPlayers.filter(player => !player.vc), rng);
			const vcPool = shuffle(standbyPlayers.filter(player => player.vc), rng);
			const selectedStandby = [
				...noVcPool.slice(0, selectedNoVcCount),
				...vcPool.slice(0, standbySlots - selectedNoVcCount)
			];
			const candidateTeams = buildTeamsForNoVcTargets(
				[...existingPlayers, ...selectedStandby],
				targetSizes,
				targetNoVc,
				rng
			);
			const score = improveInitialCandidate(candidateTeams, vcSpreadLimit, rng);
			keepCandidate(candidates, {
				teams: candidateTeams,
				score,
				selectedPlayerIds: selectedStandby.map(player => player.id)
			}, true);
		}
		const chosen = chooseCandidate(candidates, rng);
		return {
			teams: chosen.teams.map(team => ({ ...team, members: [...team.members] })),
			selectedPlayerIds: [...chosen.selectedPlayerIds],
			score: { ...chosen.score },
			vcSpreadLimit,
			candidateCount: candidates.length
		};
	}

	function fillVacancies(teams, standbyPlayers, options) {
		const settings = options || {};
		const rng = settings.rng || Math.random;
		const restarts = settings.restarts == null ? DEFAULT_RESTARTS : settings.restarts;
		if (!Array.isArray(teams) || teams.length < 2 || teams.some(team => !team || !Array.isArray(team.members))) {
			throw new Error('チーム分け結果が不正です。');
		}
		const existingPlayers = teams.flatMap(team => team.members);
		const existingIds = validatePlayers(existingPlayers, '既存チーム');
		const standbyIds = validatePlayers(standbyPlayers, '途中参加リスト');
		for (const id of standbyIds) {
			if (existingIds.has(id)) throw new Error('既存チームと途中参加リストに同じプレイヤーがいます。');
		}
		if (!Number.isInteger(restarts) || restarts < 1) throw new Error('探索回数が不正です。');

		const baseTeams = teams.map(team => {
			const vacancies = team.vacancies || 0;
			if (!Number.isInteger(vacancies) || vacancies < 0 || team.members.length + vacancies > 5) {
				throw new Error('チームの空き枠が不正です。');
			}
			return { members: [...team.members], vacancies };
		});
		const totalVacancies = baseTeams.reduce((sum, team) => sum + team.vacancies, 0);
		if (totalVacancies === 0) throw new Error('退出したプレイヤーがいないため、調整の必要はありません。');
		if (standbyPlayers.length < totalVacancies) {
			throw new Error(`途中参加プレイヤーが不足しています。あと${totalVacancies - standbyPlayers.length}人必要です。`);
		}

		const requestedFixed = settings.fixedTeamIndexes == null
			? baseTeams.map((_, index) => index)
			: settings.fixedTeamIndexes;
		if (!Array.isArray(requestedFixed)
			|| requestedFixed.some(index => !Number.isInteger(index) || index < 0 || index >= baseTeams.length)
			|| new Set(requestedFixed).size !== requestedFixed.length) {
			throw new Error('固定チームの指定が不正です。');
		}
		const fixedSet = new Set(requestedFixed);
		const fixedIndexes = baseTeams.map((_, index) => index).filter(index => fixedSet.has(index));
		const flexibleIndexes = baseTeams.map((_, index) => index).filter(index => !fixedSet.has(index));
		const outputTeams = Array(baseTeams.length);
		const selectedPlayerIds = [];
		let candidateCount = 0;
		let vcSpreadLimit = 0;

		let remainingStandby = [...standbyPlayers];
		if (fixedIndexes.length > 0) {
			const result = fillFixedVacancies(fixedIndexes.map(index => baseTeams[index]), remainingStandby, rng, restarts);
			fixedIndexes.forEach((index, offset) => { outputTeams[index] = result.teams[offset]; });
			selectedPlayerIds.push(...result.selectedPlayerIds);
			const selected = new Set(result.selectedPlayerIds);
			remainingStandby = remainingStandby.filter(player => !selected.has(player.id));
			candidateCount += result.candidateCount;
			vcSpreadLimit = Math.max(vcSpreadLimit, result.vcSpreadLimit);
		}
		if (flexibleIndexes.length > 0) {
			const result = rebalanceFlexibleTeams(flexibleIndexes.map(index => baseTeams[index]), remainingStandby, rng, restarts);
			flexibleIndexes.forEach((index, offset) => { outputTeams[index] = result.teams[offset]; });
			selectedPlayerIds.push(...result.selectedPlayerIds);
			candidateCount += result.candidateCount;
			vcSpreadLimit = Math.max(vcSpreadLimit, result.vcSpreadLimit);
		}

		return {
			teams: outputTeams,
			selectedPlayerIds,
			score: evaluateTeams(outputTeams),
			vcSpreadLimit,
			candidateCount
		};
	}

	return {
		balanceInitial,
		fillVacancies,
		evaluateTeams,
		createSeededRng
	};
});
