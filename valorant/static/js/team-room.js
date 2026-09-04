(function(root, factory) {
	'use strict';
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.TeamRoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
	'use strict';
	const API_BASE = 'https://yamato0915.xsrv.jp/api/valorant/team-shuffle';
	const PREFIX = 'valorant.teamShuffle.room.v2.';
	const ACTIVE_KEY = PREFIX + 'active';
	const CREATION_KEY = PREFIX + 'creation';
	const TIERS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal', 'radiant'];
	const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	const isToken = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
	const clone = value => JSON.parse(JSON.stringify(value));
	function randomToken() {
		return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
	}
	function validateRegistration(value) {
		return value && typeof value.name === 'string' && value.name.trim().length > 0 && [...value.name].length <= 80
			&& TIERS.includes(value.tier) && Number.isInteger(value.div) && value.div >= 1 && value.div <= 3
			&& (value.tier !== 'radiant' || value.div === 1) && typeof value.vc === 'boolean';
	}
	function validPlayer(p) {
		return validateRegistration(p) && isId(p.id) && typeof p.editLocked === 'boolean' && Number.isInteger(p.version) && p.version >= 1;
	}
	function validRoom(room) {
		return room && isId(room.id) && ['open', 'closed', 'expired'].includes(room.status)
			&& Number.isFinite(Date.parse(room.expiresAt)) && Number.isInteger(room.revision) && room.revision >= 0
			&& (room.lastOperationId === null || isId(room.lastOperationId));
	}
	function validateSnapshot(value) {
		if (!value || !validRoom(value.room) || !Array.isArray(value.participants) || !value.participants.every(validPlayer)
			|| new Set(value.participants.map(p => p.id)).size !== value.participants.length) {
			throw new Error('サーバーから受信した参加者情報が不正です。');
		}
		return value;
	}
	function validTeams(teams, playerIds) {
		if (teams === null) return true;
		if (!Array.isArray(teams) || teams.length < 2) return false;
		const members = [];
		for (const team of teams) {
			if (!team || !Array.isArray(team.members) || !Number.isInteger(team.vacancies) || team.vacancies < 0
				|| team.members.length + team.vacancies > 5 || !Number.isFinite(team.totalPoints)) return false;
			for (const member of team.members) {
				if (!validPlayer(member) || !Number.isFinite(member.point) || !playerIds.has(member.id)) return false;
				members.push(member.id);
			}
		}
		return members.length === new Set(members).size;
	}
	function validateState(state) {
		if (!state || state.schemaVersion !== 2 || !validRoom(state.room) || !isToken(state.organizerToken)
			|| !Array.isArray(state.players) || !Array.isArray(state.standbyPlayers)
			|| ![...state.players, ...state.standbyPlayers].every(validPlayer)
			|| !Number.isInteger(state.teamCount) || state.teamCount < 2 || state.teamCount > 100) return false;
		const ids = [...state.players, ...state.standbyPlayers].map(p => p.id);
		if (new Set(ids).size !== ids.length || !validTeams(state.lastTeams, new Set(ids))) return false;
		if (state.pending !== null) {
			const p = state.pending;
			if (!p || !isId(p.request?.operationId) || !Number.isInteger(p.request.expectedRevision)
				|| !Array.isArray(p.activeIds) || !p.activeIds.every(id => ids.includes(id))
				|| !Array.isArray(p.request.participantIds) || !p.request.participantIds.every(id => ids.includes(id))
				|| !validTeams(p.teams, new Set(ids))) return false;
		}
		return true;
	}
	class ApiError extends Error {
		constructor(message, status = 0, code = 'network_error') { super(message); this.status = status; this.code = code; }
	}
	class Api {
		constructor(fetcher = (...args) => fetch(...args)) { this.fetcher = fetcher; }
		async request(path, { method = 'GET', token, body, signal } = {}) {
			const abort = new AbortController();
			const cancel = () => abort.abort();
			if (signal?.aborted) cancel();
			else signal?.addEventListener('abort', cancel, { once: true });
			const timer = setTimeout(() => abort.abort(), 10000);
			try {
				const headers = { Accept: 'application/json' };
				if (token) {
					headers.Authorization = `Bearer ${token}`;
					// CGIでAuthorizationが除去される環境にも同じ認証情報を届ける。
					headers['X-Team-Shuffle-Authorization'] = headers.Authorization;
				}
				if (body !== undefined) headers['Content-Type'] = 'application/json';
				// 応答の保存禁止はAPIのCache-Controlに任せ、CORS事前確認は再利用する。
				const res = await this.fetcher(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal, cache: 'default', credentials: 'omit' });
				let data;
				try { data = await res.json(); } catch (_) { throw new ApiError('APIから正しい応答がありません。時間をおいて再試行してください。', res.status); }
				if (!res.ok) throw new ApiError(data.message || '処理を完了できませんでした。', res.status, data.code);
				return data;
			} catch (error) {
				if (signal?.aborted) throw new ApiError('取得を中断しました。', 0, 'request_cancelled');
				if (error instanceof ApiError) throw error;
				throw new ApiError('サーバーに接続できません。入力内容を保持しています。再試行してください。');
			} finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
		}
	}
	class RoomManager {
		constructor({ api, storage, balancer, points, uuid = () => crypto.randomUUID(), token = randomToken, withLock = task => task() }) {
			Object.assign(this, { api, storage, balancer, points, uuid, token, withLock });
			this.state = null;
			this.queue = Promise.resolve();
			this.syncJob = null;
		}
		read(key) {
			try { const value = this.storage.getItem(key); return value === null ? null : JSON.parse(value); }
			catch (_) { throw new Error('保存データを読み込めません。ブラウザの保存設定を確認してください。'); }
		}
		write(key, value) {
			try {
				const serialized = JSON.stringify(value);
				// 同じ値の書き込みを避け、主催者の複数タブ間でstorageイベントが循環しないようにする。
				if (this.storage.getItem(key) !== serialized) this.storage.setItem(key, serialized);
			}
			catch (_) { throw new Error('ブラウザに保存できないため処理を停止しました。保存設定や空き容量を確認してください。'); }
		}
		restore() {
			const active = this.read(ACTIVE_KEY);
			if (!active) { this.state = null; return; }
			const saved = this.read(PREFIX + active);
			if (!isId(active) || !validateState(saved) || saved.room.id !== active) throw new Error('募集の保存データが不正です。データを保護するため自動作成を停止しました。');
			this.state = saved;
		}
		save() { this.write(PREFIX + this.state.room.id, this.state); }
		cancelSync() { this.syncJob?.controller.abort(); }
		run(task, interruptSync = true) {
			if (interruptSync) this.cancelSync();
			const run = this.queue.catch(() => {}).then(() => this.withLock(async () => { this.restore(); return task(); }));
			this.queue = run;
			return run;
		}
		path(suffix = '') { return `/rooms/${this.state.room.id}${suffix}`; }
		request(suffix, method = 'GET', body, signal) { return this.api.request(this.path(suffix), { method, body, signal, token: this.state.organizerToken }); }
		point(player) {
			const value = this.points?.[player.tier]?.[player.div - 1];
			if (!Number.isFinite(value)) throw new Error('ランクポイントを取得できません。ページを再読み込みしてください。');
			return value;
		}
		absorb(raw) {
			const snapshot = validateSnapshot(raw);
			const state = this.state;
			if (snapshot.room.id !== state.room.id) throw new Error('募集IDが一致しません。');
			if (snapshot.room.revision < state.room.revision) return;
			const incoming = new Map(snapshot.participants.map(p => [p.id, p]));
			if (state.pending) {
				if (snapshot.room.lastOperationId === state.pending.request.operationId) {
					state.lastTeams = state.pending.teams;
					state.players = state.pending.activeIds.map(id => incoming.get(id)).filter(Boolean);
					state.standbyPlayers = state.standbyPlayers.filter(p => !state.pending.activeIds.includes(p.id));
					state.pending = null;
				} else if (snapshot.room.revision !== state.pending.request.expectedRevision) {
					// 版が進んでいれば、この版を前提とした未確定操作は以後適用されない。
					state.pending = null;
				}
			}
			state.room = snapshot.room;
			state.players = state.players.map(p => incoming.get(p.id)).filter(Boolean);
			state.standbyPlayers = state.standbyPlayers.map(p => incoming.get(p.id)).filter(Boolean);
			const known = new Set([...state.players, ...state.standbyPlayers].map(p => p.id));
			for (const p of snapshot.participants) {
				if (!known.has(p.id)) (state.lastTeams === null ? state.players : state.standbyPlayers).push(p);
			}
			if (state.lastTeams) {
				for (const team of state.lastTeams) {
					const previousSize = team.members.length;
					team.members = team.members.filter(p => incoming.has(p.id)).map(p => ({ ...incoming.get(p.id), point: p.point }));
					team.vacancies += previousSize - team.members.length;
					team.totalPoints = team.members.reduce((sum, p) => sum + p.point, 0);
				}
			}
			this.save();
		}
		async pull(signal) {
			const snapshot = await this.request('/participants', 'GET', undefined, signal);
			if (!signal?.aborted) this.absorb(snapshot);
		}
		async settlePending() { if (this.state.pending) await this.settle(); }
		async settle() {
			await this.pull();
			if (this.state.pending) {
				try { this.absorb(await this.request('/edit-locks', 'PUT', this.state.pending.request)); }
				catch (error) {
					if (error.status === 409) { await this.pull(); return; }
					if (error.status >= 400 && error.status < 500) { this.state.pending = null; this.save(); }
					throw error;
				}
			}
		}
		async create() {
			let draft = this.read(CREATION_KEY);
			if (draft?.id === this.state?.room.id) draft = null;
			if (!draft) { draft = { id: this.uuid(), organizerToken: this.token() }; this.write(CREATION_KEY, draft); }
			if (!isId(draft.id) || !isToken(draft.organizerToken)) throw new Error('募集作成の保存データが不正です。');
			const snapshot = validateSnapshot(await this.api.request('/rooms', { method: 'POST', body: draft }));
			if (snapshot.room.id !== draft.id) throw new Error('作成した募集IDが一致しません。');
			const next = { schemaVersion: 2, room: snapshot.room, organizerToken: draft.organizerToken, players: snapshot.participants, standbyPlayers: [], lastTeams: null, teamCount: 2, pending: null };
			this.write(PREFIX + draft.id, next);
			this.write(ACTIVE_KEY, draft.id);
			this.state = next;
			this.write(CREATION_KEY, null);
		}
		start() {
			return this.run(async () => {
				if (!this.state) return this.create();
				const expired = () => this.state.room.status === 'expired'
					|| Date.parse(this.state.room.expiresAt) <= Date.now();
				// 未確定のチーム結果だけは旧募集へ確定してから、新しい募集へ移る。
				if (this.state.pending) await this.settle();
				else if (!expired()) await this.settle();
				if (expired()) await this.create();
			});
		}
		sync() {
			if (this.syncJob) return this.syncJob.promise;
			const job = { controller: new AbortController() };
			this.syncJob = job;
			job.promise = this.run(async () => {
				if (job.controller.signal.aborted) return false;
				if (!this.state) await this.create();
				else if (this.state.pending) await this.settle();
				else await this.pull(job.controller.signal);
				return !job.controller.signal.aborted;
			}, false).catch(error => {
				if (!job.controller.signal.aborted) throw error;
				return false;
			}).finally(() => { if (this.syncJob === job) this.syncJob = null; });
			return job.promise;
		}
		close() { return this.run(async () => { await this.settlePending(); this.absorb(await this.request('/close', 'POST')); }); }
		newRoom() {
			return this.run(async () => {
				if (this.state) {
					await this.settlePending();
					if (this.state.room.status !== 'closed') this.absorb(await this.request('/close', 'POST'));
				}
				await this.create();
			});
		}
		remove(id) {
			return this.run(async () => {
				if (!isId(id)) throw new Error('参加者IDが不正です。');
				await this.settlePending();
				this.absorb(await this.request(`/participants/${id}`, 'DELETE'));
			});
		}
		setTeamCount(count) {
			return this.run(() => {
				if (!Number.isInteger(count) || count < 2 || count > 100) throw new Error('チーム数は2〜100で指定してください。');
				if (this.state.pending || this.state.lastTeams) throw new Error('チーム数を変更するには、先にチーム分けをリセットしてください。');
				this.state.teamCount = count; this.save();
			});
		}
		async commit(teams, activeIds) {
			const participantIds = teams === null ? [] : teams.flatMap(t => t.members.map(p => p.id));
			this.state.pending = { teams: clone(teams), activeIds, request: { operationId: this.uuid(), expectedRevision: this.state.room.revision, participantIds } };
			// サーバーの確定より前に、復旧に必要な候補を永続化する。
			this.save();
			try { this.absorb(await this.request('/edit-locks', 'PUT', this.state.pending.request)); }
			catch (error) {
				if (error.status >= 400 && error.status < 500) { this.state.pending = null; this.save(); }
				throw error;
			}
		}
		changeTeams(reset) {
			return this.run(async () => {
				await this.settlePending();
				for (let attempt = 0; attempt < 3; attempt++) {
					const s = this.state;
					let teams, activeIds;
					try {
						if (reset) {
							teams = null; activeIds = [...s.players, ...s.standbyPlayers].map(p => p.id);
						} else if (s.lastTeams) {
							const result = this.balancer.fillVacancies(s.lastTeams, s.standbyPlayers.map(p => ({ ...p, point: this.point(p) })));
							teams = result.teams; activeIds = [...s.players.map(p => p.id), ...result.selectedPlayerIds];
						} else {
							const result = this.balancer.balanceInitial(s.players.map(p => ({ ...p, point: this.point(p) })), s.teamCount);
							teams = result.teams; activeIds = s.players.map(p => p.id);
						}
					} catch (error) {
						// 人数不足などが古い一覧によるものなら、取得して一度再計算する。
						if (attempt === 0) { await this.pull(); continue; }
						throw error;
					}
					// 保存済みの版で一括確定し、競合時だけ取得・再計算する。
					try { await this.commit(teams, activeIds); return; }
					catch (error) { if (error.status !== 409) throw error; await this.pull(); }
				}
				throw new Error('参加者情報が更新されています。最新の一覧を確認して、もう一度実行してください。');
			});
		}
		shuffle() { return this.changeTeams(false); }
		reset() { return this.changeTeams(true); }
	}
	return { API_BASE, ACTIVE_KEY, CREATION_KEY, PREFIX, TIERS, isId, isToken, randomToken, validateRegistration, validateSnapshot, validateState, ApiError, Api, RoomManager };
});
