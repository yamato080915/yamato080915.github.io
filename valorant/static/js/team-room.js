(function(root, factory) {
	'use strict';
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.TeamRoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
	'use strict';
	// Supabase DashboardのConnect画面に表示される公開情報を設定する。
	const SUPABASE_URL = 'https://ohzhrcymowwfvbfxtkcj.supabase.co';
	const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_v9RCRhsUbAyB_lCvkCq2Zg_ioCD-2qS';
	const API_BASE = `${SUPABASE_URL}/rest/v1/rpc`;
	const PREFIX = 'valorant.teamShuffle.room.v3.';
	const ACTIVE_KEY = PREFIX + 'active';
	const CREATION_KEY = PREFIX + 'creation';
	const TIERS = ['unranked', 'iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal', 'radiant'];
	const RANK_MODES = ['peak', 'current'];
	const RIOT_ID_MAX = 64;
	const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	const isToken = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
	const clone = value => JSON.parse(JSON.stringify(value));
	function randomToken() {
		return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
	}
	function validateRegistration(value) {
		return value && typeof value.name === 'string' && value.name.trim().length > 0 && [...value.name].length <= 80
			&& TIERS.includes(value.tier) && Number.isInteger(value.div) && value.div >= 1 && value.div <= 3
			&& (!['radiant', 'unranked'].includes(value.tier) || value.div === 1) && typeof value.vc === 'boolean';
	}
	function validRiotPart(value) {
		return typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= RIOT_ID_MAX
			&& !/[#\u0000-\u001f\u007f]/.test(value);
	}
	function validateRegistrationInput(value) {
		return value && typeof value.name === 'string' && value.name.trim().length > 0 && [...value.name.trim()].length <= 80
			&& validRiotPart(value.riotName) && validRiotPart(value.riotTag)
			&& typeof value.vc === 'boolean' && value.consent === true;
	}
	function validRiotId(value) {
		return value && validRiotPart(value.gameName) && validRiotPart(value.tagline);
	}
	function normalizePlayerIdentity(p) {
		if (!p || typeof p !== 'object') return;
		if (p.riotId === undefined) p.riotId = null;
		if (p.rankModeVerified === undefined) p.rankModeVerified = null;
		if (p.rankVerifiedAt === undefined) p.rankVerifiedAt = null;
	}
	function validVerifiedIdentity(p) {
		if (p.riotId === null) return p.rankModeVerified === null && p.rankVerifiedAt === null;
		return validRiotId(p.riotId) && RANK_MODES.includes(p.rankModeVerified)
			&& typeof p.rankVerifiedAt === 'string' && Number.isFinite(Date.parse(p.rankVerifiedAt));
	}
	function validPlayer(p) {
		normalizePlayerIdentity(p);
		return validateRegistration(p) && validVerifiedIdentity(p) && isId(p.id)
			&& typeof p.editLocked === 'boolean' && Number.isInteger(p.version) && p.version >= 1;
	}
	function validDirectoryPlayer(p) {
		return validateRegistration(p) && isId(p.id) && (p.riotId === null || validRiotId(p.riotId));
	}
	function validDirectoryTeams(teams, players) {
		if (teams === null) return true;
		if (!Array.isArray(teams) || teams.length < 2 || teams.length > 100) return false;
		const memberIds = [];
		for (const team of teams) {
			if (!team || !Array.isArray(team.members) || !Number.isInteger(team.vacancies) || team.vacancies < 0
				|| team.members.length + team.vacancies < 1 || team.members.length + team.vacancies > 5
				|| !team.members.every(validDirectoryPlayer)) return false;
			for (const member of team.members) {
				if (!players.has(member.id)) return false;
				memberIds.push(member.id);
			}
		}
		return memberIds.length === new Set(memberIds).size;
	}
	function validRoom(room) {
		return room && isId(room.id) && ['open', 'closed', 'expired'].includes(room.status)
			&& Number.isFinite(Date.parse(room.expiresAt)) && Number.isInteger(room.revision) && room.revision >= 0
			&& (room.lastOperationId === null || isId(room.lastOperationId))
			&& RANK_MODES.includes(room.rankMode) && typeof room.rankModeEditable === 'boolean';
	}
	function validateSnapshot(value) {
		if (!value || !validRoom(value.room) || !Array.isArray(value.participants) || !value.participants.every(validPlayer)
			|| new Set(value.participants.map(p => p.id)).size !== value.participants.length) {
			throw new Error('サーバーから受信した参加者情報が不正です。');
		}
		return value;
	}
	function validateRegistrationSnapshot(value, roomId) {
		const directory = Array.isArray(value?.participants) ? value.participants : null;
		const playerIds = new Set(directory?.map(player => player.id));
		if (!value?.room || value.room.id !== roomId || !['open', 'closed', 'expired'].includes(value.room.status)
			|| !Number.isFinite(Date.parse(value.room.expiresAt)) || !RANK_MODES.includes(value.room.rankMode)
			|| typeof value.editable !== 'boolean'
			|| (value.participant !== null && !validPlayer(value.participant))
			|| directory === null || !directory.every(validDirectoryPlayer)
			|| playerIds.size !== directory.length || !validDirectoryTeams(value.teams, playerIds)
			|| (value.participant === null && (directory.length !== 0 || value.teams !== null))
			|| (value.participant !== null && !playerIds.has(value.participant.id))) {
			throw new Error('登録情報の応答が不正です。');
		}
		return value;
	}
	function teamResultPayload(teams) {
		if (teams === null) return null;
		return teams.map(team => ({
			memberIds: team.members.map(member => member.id),
			capacity: team.members.length + team.vacancies
		}));
	}
	function validateRankVerification(value, roomId) {
		const validVerificationId = isId(value?.verificationId) || (value?.saved === true && value.verificationId === null);
		if (!value || !validVerificationId || !validRiotId(value.riotId)
			|| !RANK_MODES.includes(value.rankMode) || !TIERS.includes(value.tier)
			|| !Number.isInteger(value.div) || value.div < 1 || value.div > 3
			|| (['radiant', 'unranked'].includes(value.tier) && value.div !== 1)
			|| typeof value.rankLabel !== 'string' || !value.rankLabel.trim()
			|| !Number.isFinite(Date.parse(value.expiresAt))) {
			throw new Error('ランク取得の応答が不正です。');
		}
		return value;
	}
	function validTeams(teams, playerIds) {
		if (teams === null) return true;
		if (!Array.isArray(teams) || teams.length < 2) return false;
		const members = [];
		for (const team of teams) {
			if (!team || !Array.isArray(team.members) || !Number.isInteger(team.vacancies) || team.vacancies < 0
				|| team.members.length + team.vacancies > 5 || !Number.isFinite(team.totalPoints)
				|| (team.fixed !== undefined && typeof team.fixed !== 'boolean')) return false;
			for (const member of team.members) {
				if (!validPlayer(member) || !Number.isFinite(member.point) || !playerIds.has(member.id)) return false;
				members.push(member.id);
			}
		}
		return members.length === new Set(members).size;
	}
	function validateState(state) {
		if (!state || state.schemaVersion !== 3 || !validRoom(state.room) || !isToken(state.organizerToken)
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
				|| !validTeams(p.teams, new Set(ids))
				|| JSON.stringify(p.request.teams) !== JSON.stringify(teamResultPayload(p.teams))) return false;
		}
		return true;
	}
	function normalizeFixedTeams(teams) {
		if (!Array.isArray(teams)) return;
		for (const team of teams) {
			if (team.fixed === undefined) team.fixed = true;
		}
	}
	function normalizeFixedState(state) {
		normalizeFixedTeams(state.lastTeams);
		normalizeFixedTeams(state.pending?.teams);
	}
	function normalizeRankModeState(state) {
		if (!state?.room) return;
		if (state.room.rankMode === undefined) state.room.rankMode = 'peak';
		// 旧保存データでは一度でも登録があったか判別できないため、取得完了までは安全側で固定する。
		if (state.room.rankModeEditable === undefined) state.room.rankModeEditable = false;
	}
	function normalizePlayerIdentityState(state) {
		if (!state) return;
		const collections = [state.players, state.standbyPlayers];
		if (Array.isArray(state.lastTeams)) collections.push(...state.lastTeams.map(team => team.members));
		if (Array.isArray(state.pending?.teams)) collections.push(...state.pending.teams.map(team => team.members));
		for (const players of collections) if (Array.isArray(players)) players.forEach(normalizePlayerIdentity);
	}
	function normalizePendingResult(state) {
		if (state?.pending?.request && state.pending.request.teams === undefined) {
			state.pending.request.teams = teamResultPayload(state.pending.teams);
		}
	}
	class ApiError extends Error {
		constructor(message, status = 0, code = 'network_error') { super(message); this.status = status; this.code = code; }
	}
	function rpcRequest(path, method, token, body) {
		const verb = method.toUpperCase();
		let match;
		if (path === '/rooms' && verb === 'POST') return {
			name: 'team_shuffle_create_room',
			body: { p_room_id: body?.id ?? null, p_organizer_token: body?.organizerToken ?? null }
		};
		if ((match = path.match(/^\/rooms\/([^/]+)$/)) && verb === 'GET') return {
			name: 'team_shuffle_get_room', body: { p_room_id: match[1] }
		};
		if ((match = path.match(/^\/rooms\/([^/]+)\/participants$/)) && verb === 'GET') return {
			name: 'team_shuffle_get_participants',
			body: { p_room_id: match[1], p_organizer_token: token ?? null }
		};
		if ((match = path.match(/^\/rooms\/([^/]+)\/rank-mode$/)) && verb === 'PUT') return {
			name: 'team_shuffle_set_rank_mode',
			body: {
				p_room_id: match[1], p_organizer_token: token ?? null,
				p_rank_mode: body?.rankMode ?? null
			}
		};
		if ((match = path.match(/^\/rooms\/([^/]+)\/registration$/)) && verb === 'GET') return {
			name: 'team_shuffle_get_registration',
			body: { p_room_id: match[1], p_participant_token: token ?? null }
		};
		if ((match = path.match(/^\/rooms\/([^/]+)\/registration$/)) && verb === 'PUT') return {
			name: 'team_shuffle_put_verified_registration',
			body: {
				p_room_id: match[1], p_participant_token: token ?? null,
				p_verification_id: body?.verificationId ?? null,
				p_name: body?.name ?? null, p_riot_name: body?.riotName ?? null,
				p_riot_tag: body?.riotTag ?? null, p_vc: body?.vc ?? null,
				p_consent: body?.consent ?? null
			}
		};
		if ((match = path.match(/^\/rooms\/([^/]+)\/edit-locks$/)) && verb === 'PUT') return {
			name: 'team_shuffle_commit_result',
			body: {
				p_room_id: match[1], p_organizer_token: token ?? null,
				p_operation_id: body?.operationId ?? null,
				p_expected_revision: body?.expectedRevision ?? null,
				p_participant_ids: body?.participantIds ?? null,
				p_teams: body?.teams ?? null
			}
		};
		if ((match = path.match(/^\/rooms\/([^/]+)\/participants\/([^/]+)$/)) && verb === 'DELETE') return {
			name: 'team_shuffle_remove_participant',
			body: { p_room_id: match[1], p_organizer_token: token ?? null, p_participant_id: match[2] }
		};
		if ((match = path.match(/^\/rooms\/([^/]+)\/close$/)) && verb === 'POST') return {
			name: 'team_shuffle_close_room',
			body: { p_room_id: match[1], p_organizer_token: token ?? null }
		};
		throw new ApiError('API要求が不正です。ページを再読み込みしてください。', 0, 'invalid_request');
	}
	function validSupabaseConfig(url, key) {
		return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)
			&& typeof key === 'string' && key.startsWith('sb_publishable_');
	}
	class Api {
		constructor(fetcher = (...args) => fetch(...args), config = {}) {
			this.fetcher = fetcher;
			this.url = (config.url || SUPABASE_URL).replace(/\/$/, '');
			this.key = config.key || SUPABASE_PUBLISHABLE_KEY;
		}
		async request(path, { method = 'GET', token, body, signal } = {}) {
			if (!validSupabaseConfig(this.url, this.key)) {
				throw new ApiError('Supabaseの接続情報が未設定です。管理者へ連絡してください。', 0, 'configuration_error');
			}
			const rpc = rpcRequest(path, method, token, body);
			const abort = new AbortController();
			const cancel = () => abort.abort();
			if (signal?.aborted) cancel();
			else signal?.addEventListener('abort', cancel, { once: true });
			const timer = setTimeout(() => abort.abort(), 10000);
			try {
				const headers = { Accept: 'application/json', 'Content-Type': 'application/json', apikey: this.key };
				const res = await this.fetcher(`${this.url}/rest/v1/rpc/${rpc.name}`, {
					method: 'POST', headers, body: JSON.stringify(rpc.body),
					signal: abort.signal, cache: 'default', credentials: 'omit'
				});
				let data;
				try { data = await res.json(); } catch (_) { throw new ApiError('APIから正しい応答がありません。時間をおいて再試行してください。', res.status); }
				if (!res.ok) {
					const appCodes = new Set(['invalid_request', 'unauthorized', 'forbidden', 'not_found', 'closed', 'expired', 'locked', 'rank_mode_locked', 'revision_conflict', 'consent_required', 'invalid_riot_id', 'duplicate_riot_id', 'verification_required', 'verification_expired']);
					const code = appCodes.has(data?.details) ? data.details : (data?.code || 'request_failed');
					throw new ApiError(data?.message || '処理を完了できませんでした。', res.status, code);
				}
				return data;
			} catch (error) {
				if (signal?.aborted) throw new ApiError('取得を中断しました。', 0, 'request_cancelled');
				if (error instanceof ApiError) throw error;
				throw new ApiError('サーバーに接続できません。入力内容を保持しています。再試行してください。');
			} finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
		}
		async lookupRank(body, { signal } = {}) {
			if (!validSupabaseConfig(this.url, this.key)) throw new ApiError('Supabaseの接続情報が未設定です。管理者へ連絡してください。', 0, 'configuration_error');
			const abort = new AbortController();
			const cancel = () => abort.abort();
			if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
			const timer = setTimeout(() => abort.abort(), 15000);
			try {
				const res = await this.fetcher(`${this.url}/functions/v1/team-shuffle-rank-lookup`, {
					method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: this.key },
					body: JSON.stringify(body), signal: abort.signal, cache: 'no-store', credentials: 'omit'
				});
				let data;
				try { data = await res.json(); } catch (_) { throw new ApiError('ランク取得APIから正しい応答がありません。', res.status); }
				if (!res.ok) {
					const error = new ApiError(data?.message || 'ランクを取得できませんでした。', res.status, data?.code || 'rank_lookup_unavailable');
					error.retryAfter = Math.max(0, Number(data?.retryAfter ?? res.headers?.get?.('Retry-After')) || 0);
					throw error;
				}
				return data;
			} catch (error) {
				if (signal?.aborted) throw new ApiError('取得を中断しました。', 0, 'request_cancelled');
				if (error instanceof ApiError) throw error;
				throw new ApiError('ランク取得APIに接続できません。入力内容を保持しています。');
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
			normalizeRankModeState(saved);
			normalizePlayerIdentityState(saved);
			normalizePendingResult(saved);
			if (!isId(active) || !validateState(saved) || saved.room.id !== active) throw new Error('募集の保存データが不正です。データを保護するため自動作成を停止しました。');
			normalizeFixedState(saved);
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
			const next = { schemaVersion: 3, room: snapshot.room, organizerToken: draft.organizerToken, players: snapshot.participants, standbyPlayers: [], lastTeams: null, teamCount: 2, pending: null };
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
		setRankMode(rankMode) {
			return this.run(async () => {
				if (!RANK_MODES.includes(rankMode)) throw new Error('ランク入力基準の指定が不正です。');
				await this.settlePending();
				try {
					this.absorb(await this.request('/rank-mode', 'PUT', { rankMode }));
				} catch (error) {
					if (error.code === 'rank_mode_locked') await this.pull();
					throw error;
				}
			});
		}
		setTeamFixed(index, fixed) {
			return this.run(() => {
				if (!this.state.lastTeams || this.state.pending) throw new Error('現在はチームの固定状態を変更できません。');
				if (!Number.isInteger(index) || index < 0 || index >= this.state.lastTeams.length || typeof fixed !== 'boolean') {
					throw new Error('固定チームの指定が不正です。');
				}
				this.state.lastTeams[index].fixed = fixed;
				this.save();
			});
		}
		async commit(teams, activeIds) {
			const participantIds = teams === null ? [] : teams.flatMap(t => t.members.map(p => p.id));
			this.state.pending = { teams: clone(teams), activeIds, request: {
				operationId: this.uuid(), expectedRevision: this.state.room.revision,
				participantIds, teams: teamResultPayload(teams)
			} };
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
							const fixedTeamIndexes = s.lastTeams
								.map((team, index) => team.fixed !== false ? index : -1)
								.filter(index => index !== -1);
							const result = this.balancer.fillVacancies(
								s.lastTeams,
								s.standbyPlayers.map(p => ({ ...p, point: this.point(p) })),
								{ fixedTeamIndexes }
							);
							teams = result.teams.map((team, index) => ({ ...team, fixed: s.lastTeams[index].fixed !== false }));
							activeIds = [...s.players.map(p => p.id), ...result.selectedPlayerIds];
						} else {
							const result = this.balancer.balanceInitial(s.players.map(p => ({ ...p, point: this.point(p) })), s.teamCount);
							teams = result.teams.map(team => ({ ...team, fixed: true })); activeIds = s.players.map(p => p.id);
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
	return { API_BASE, ACTIVE_KEY, CREATION_KEY, PREFIX, TIERS, RANK_MODES, isId, isToken, randomToken, validateRegistration, validateRegistrationInput, validateRankVerification, validateRegistrationSnapshot, validateSnapshot, validateState, teamResultPayload, ApiError, Api, RoomManager };
});
