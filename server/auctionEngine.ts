import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AnswerResult,
  AuctionHistoryEntry,
  AuctionPhase,
  BidRecord,
  HostAuctionItem,
  ItemDifficulty,
  LastScoringResult,
  LeaderboardEntry,
  LiveRoomState,
  PublicAuctionItem,
  QuestionBankItem,
  RoomConfig,
  RoomSnapshotHost,
  RoomSnapshotPublic,
  RoomStatus,
} from '../src/types/auction.ts';
import { hashPin, signTeamToken, verifyPin } from './auth.ts';
import { DEMO_ROOM_ID } from './demoData.ts';
import { seedDemoData } from './db.ts';

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

function genRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  return out;
}

export class EngineError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type BroadcastCallback = (roomId: string, hostSnapshot: RoomSnapshotHost, publicSnapshot: RoomSnapshotPublic) => void;

export class AuctionEngine {
  private db: DatabaseSync;
  private locks = new Map<string, Promise<unknown>>();
  private onBroadcast?: BroadcastCallback;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;

  constructor(db: DatabaseSync, onBroadcast?: BroadcastCallback) {
    this.db = db;
    this.onBroadcast = onBroadcast;
  }

  setBroadcastCallback(cb: BroadcastCallback) {
    this.onBroadcast = cb;
  }

  startTimerLoop(intervalMs = 250) {
    if (this.timerHandle) return;
    // Run an immediate catch-up tick in case server restarted while a timer was active
    void this.processExpiredTimers();
    this.timerHandle = setInterval(() => {
      void this.processExpiredTimers();
    }, intervalMs);
  }

  stopTimerLoop() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private async withRoomLock<T>(roomId: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.locks.get(roomId) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.locks.set(roomId, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(roomId) === chained) {
        this.locks.delete(roomId);
      }
    }
  }

  private runTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  private emitRoomUpdate(roomId: string) {
    if (!this.onBroadcast) return;
    try {
      const hostSnap = this.getHostRoomSnapshot(roomId);
      const pubSnap = this.getPublicRoomSnapshot(roomId);
      this.onBroadcast(roomId, hostSnap, pubSnap);
    } catch (err) {
      console.error('Broadcast error for room', roomId, err);
    }
  }

  // --- Mapping Helpers ---

  private mapRoomRow(row: Record<string, unknown>): RoomConfig {
    return {
      id: String(row.id),
      hostUid: String(row.host_uid),
      name: String(row.name),
      eventName: String(row.event_name),
      description: String(row.description || ''),
      code: String(row.code),
      hasPin: Boolean(row.pin_hash),
      maxTeams: Number(row.max_teams),
      startingCoins: Number(row.starting_coins),
      minBid: Number(row.min_bid),
      minBidIncrement: Number(row.min_bid_increment),
      deductWinningBid: Boolean(row.deduct_winning_bid),
      allowManualCoinAdjust: Boolean(row.allow_manual_coin_adjust),
      auctionDurationSec: Number(row.auction_duration_sec),
      maxAuctionDurationSec: Number(row.max_auction_duration_sec),
      startingBidDefault: Number(row.starting_bid_default),
      allowMultipleBids: Boolean(row.allow_multiple_bids),
      allowRebidAfterOutbid: Boolean(row.allow_rebid_after_outbid),
      autoCloseOnExpire: Boolean(row.auto_close_on_expire),
      answerDurationSec: Number(row.answer_duration_sec),
      correctPoints: Number(row.correct_points),
      incorrectDeduction: Number(row.incorrect_deduction),
      unansweredCountsIncorrect: Boolean(row.unanswered_counts_incorrect),
      allowHostOverride: Boolean(row.allow_host_override),
      status: String(row.status) as RoomStatus,
      isDemo: Boolean(row.is_demo),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapHostItemRow(row: Record<string, unknown>): HostAuctionItem {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      bankItemId: row.bank_item_id ? String(row.bank_item_id) : null,
      sortOrder: Number(row.sort_order),
      name: String(row.name),
      imageUrl: String(row.image_url || ''),
      emoji: String(row.emoji || '⚡'),
      category: String(row.category),
      description: String(row.description),
      startingBid: Number(row.starting_bid),
      difficulty: String(row.difficulty) as ItemDifficulty,
      question: String(row.question),
      correctAnswer: String(row.correct_answer),
      explanation: String(row.explanation || ''),
      timeLimitOverrideSec: row.time_limit_override_sec !== null && row.time_limit_override_sec !== undefined ? Number(row.time_limit_override_sec) : null,
      hostNotes: String(row.host_notes || ''),
      status: String(row.status),
    };
  }

  private sanitizeItemForPublic(item: HostAuctionItem | null, phase: AuctionPhase, questionRevealed: boolean): PublicAuctionItem | null {
    if (!item) return null;
    const isQuestionVisible =
      questionRevealed &&
      (phase === 'QUESTION_ACTIVE' ||
        phase === 'QUESTION_PAUSED' ||
        phase === 'QUESTION_TIMEOUT' ||
        phase === 'SCORED');
    const isAnswerVisible = phase === 'SCORED';

    return {
      id: item.id,
      roomId: item.roomId,
      bankItemId: item.bankItemId,
      sortOrder: item.sortOrder,
      name: item.name,
      imageUrl: item.imageUrl,
      emoji: item.emoji,
      category: item.category,
      description: item.description,
      startingBid: item.startingBid,
      difficulty: item.difficulty,
      timeLimitOverrideSec: item.timeLimitOverrideSec,
      status: item.status,
      ...(isQuestionVisible ? { question: item.question } : {}),
      ...(isAnswerVisible ? { correctAnswer: item.correctAnswer, explanation: item.explanation } : {}),
    };
  }

  private mapLiveState(row: Record<string, unknown>): LiveRoomState {
    let lastResult: LastScoringResult | null = null;
    if (row.last_result_json) {
      try {
        lastResult = JSON.parse(String(row.last_result_json)) as LastScoringResult;
      } catch {
        lastResult = null;
      }
    }
    return {
      roomId: String(row.room_id),
      currentItemId: row.current_item_id ? String(row.current_item_id) : null,
      phase: String(row.phase) as AuctionPhase,
      currentHighestBid: Number(row.current_highest_bid),
      highestBidderTeamId: row.highest_bidder_team_id ? String(row.highest_bidder_team_id) : null,
      highestBidderTeamName: row.highest_bidder_team_name ? String(row.highest_bidder_team_name) : null,
      auctionStartedAt: row.auction_started_at ? Number(row.auction_started_at) : null,
      auctionDeadlineAt: row.auction_deadline_at ? Number(row.auction_deadline_at) : null,
      auctionRemainingMs: row.auction_remaining_ms !== null && row.auction_remaining_ms !== undefined ? Number(row.auction_remaining_ms) : null,
      answerStartedAt: row.answer_started_at ? Number(row.answer_started_at) : null,
      answerDeadlineAt: row.answer_deadline_at ? Number(row.answer_deadline_at) : null,
      answerRemainingMs: row.answer_remaining_ms !== null && row.answer_remaining_ms !== undefined ? Number(row.answer_remaining_ms) : null,
      questionRevealed: Boolean(row.question_revealed),
      lastResult,
      version: Number(row.version),
      updatedAt: Number(row.updated_at),
    };
  }

  public getLeaderboard(roomId: string): LeaderboardEntry[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM teams
        WHERE room_id = ? AND is_removed = 0
        ORDER BY points DESC, coins DESC, joined_at ASC
      `)
      .all(roomId) as Record<string, unknown>[];

    const entries: LeaderboardEntry[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const points = Number(r.points);
      const coins = Number(r.coins);
      const prev = i > 0 ? entries[i - 1] : null;
      const matchesPrev = prev !== null && prev.points === points && prev.coins === coins;
      const nextRow = i + 1 < rows.length ? rows[i + 1] : null;
      const matchesNext = nextRow !== null && Number(nextRow.points) === points && Number(nextRow.coins) === coins;

      entries.push({
        id: String(r.id),
        roomId: String(r.room_id),
        name: String(r.name),
        coins,
        points,
        itemsWon: Number(r.items_won),
        correctAnswers: Number(r.correct_answers),
        incorrectAnswers: Number(r.incorrect_answers),
        totalBids: Number(r.total_bids),
        joinedAt: Number(r.joined_at),
        isRemoved: false,
        rank: matchesPrev ? prev.rank : i + 1,
        isTied: matchesPrev || matchesNext,
      });
    }
    return entries;
  }

  private getHistory(roomId: string): AuctionHistoryEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM auction_history WHERE room_id = ? ORDER BY host_action_time DESC`)
      .all(roomId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      roomId: String(r.room_id),
      itemId: String(r.item_id),
      itemName: String(r.item_name),
      winningTeamId: r.winning_team_id ? String(r.winning_team_id) : null,
      winningTeamName: r.winning_team_name ? String(r.winning_team_name) : null,
      winningBid: Number(r.winning_bid),
      auctionStartTime: r.auction_start_time ? Number(r.auction_start_time) : null,
      auctionEndTime: r.auction_end_time ? Number(r.auction_end_time) : null,
      question: String(r.question),
      correctAnswer: String(r.correct_answer),
      answerResult: String(r.answer_result) as AnswerResult,
      pointsAwarded: Number(r.points_awarded),
      coinsDeducted: Number(r.coins_deducted),
      hostActionTime: Number(r.host_action_time),
    }));
  }

  private getRecentBids(roomId: string, itemId: string | null): BidRecord[] {
    if (!itemId) return [];
    const rows = this.db
      .prepare(`
        SELECT * FROM bids
        WHERE room_id = ? AND item_id = ?
        ORDER BY amount DESC, created_at DESC
        LIMIT 25
      `)
      .all(roomId, itemId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      roomId: String(r.room_id),
      itemId: String(r.item_id),
      teamId: String(r.team_id),
      teamName: String(r.team_name),
      amount: Number(r.amount),
      createdAt: Number(r.created_at),
    }));
  }

  private assertRoomHostAccess(roomId: string, hostUid: string): RoomConfig {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Record<string, unknown> | undefined;
    if (!row) throw new EngineError('Room not found', 404);
    const room = this.mapRoomRow(row);
    if (!room.isDemo && room.hostUid !== hostUid) {
      throw new EngineError('You do not have permission to manage this room', 403);
    }
    return room;
  }

  public getRoomByCode(code: string): RoomConfig | null {
    const row = this.db.prepare('SELECT * FROM rooms WHERE code = ?').get(code.toUpperCase().trim()) as Record<string, unknown> | undefined;
    return row ? this.mapRoomRow(row) : null;
  }

  public getRoomById(roomId: string): RoomConfig | null {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Record<string, unknown> | undefined;
    return row ? this.mapRoomRow(row) : null;
  }

  public getHostRoomSnapshot(roomId: string): RoomSnapshotHost {
    const roomRow = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Record<string, unknown> | undefined;
    if (!roomRow) throw new EngineError('Room not found', 404);
    const room = this.mapRoomRow(roomRow);

    const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown> | undefined;
    if (!stateRow) throw new EngineError('Room live state missing', 500);
    const liveState = this.mapLiveState(stateRow);

    const itemRows = this.db
      .prepare('SELECT * FROM room_items WHERE room_id = ? ORDER BY sort_order ASC')
      .all(roomId) as Record<string, unknown>[];
    const items = itemRows.map((r) => this.mapHostItemRow(r));
    const itemIndex = liveState.currentItemId ? items.findIndex((it) => it.id === liveState.currentItemId) : -1;
    const currentItem = itemIndex >= 0 ? items[itemIndex] : null;

    return {
      serverNow: Date.now(),
      room,
      liveState,
      currentItem,
      items,
      itemsCount: items.length,
      itemIndex: itemIndex >= 0 ? itemIndex + 1 : 0,
      teams: this.getLeaderboard(roomId),
      recentBids: this.getRecentBids(roomId, liveState.currentItemId),
      history: this.getHistory(roomId),
    };
  }

  public getPublicRoomSnapshot(roomId: string): RoomSnapshotPublic {
    const hostSnap = this.getHostRoomSnapshot(roomId);
    const { items: _omitItems, currentItem, ...rest } = hostSnap;
    return {
      ...rest,
      currentItem: this.sanitizeItemForPublic(currentItem, hostSnap.liveState.phase, hostSnap.liveState.questionRevealed),
    };
  }

  // --- Host Rooms & Creation ---

  public listRoomsForHost(hostUid: string): Array<RoomConfig & { itemsCount: number; teamsCount: number }> {
    const rows = this.db
      .prepare(`
        SELECT r.*,
          (SELECT COUNT(*) FROM room_items ri WHERE ri.room_id = r.id) AS items_count,
          (SELECT COUNT(*) FROM teams t WHERE t.room_id = r.id AND t.is_removed = 0) AS teams_count
        FROM rooms r
        WHERE r.host_uid = ? OR r.is_demo = 1
        ORDER BY r.is_demo ASC, r.updated_at DESC
      `)
      .all(hostUid) as Record<string, unknown>[];

    return rows.map((r) => ({
      ...this.mapRoomRow(r),
      itemsCount: Number(r.items_count || 0),
      teamsCount: Number(r.teams_count || 0),
    }));
  }

  public createRoom(hostUid: string, hostEmail: string, input: any): RoomSnapshotHost {
    const now = Date.now();
    const roomId = genId('room');
    let code = input.code ? String(input.code).toUpperCase().trim() : genRoomCode();

    // Ensure unique room code
    let attempts = 0;
    while (this.db.prepare('SELECT id FROM rooms WHERE code = ?').get(code)) {
      if (input.code) {
        throw new EngineError(`Room code "${code}" is already in use. Please pick another code.`, 409);
      }
      code = genRoomCode();
      if (++attempts > 10) throw new EngineError('Failed to generate unique room code', 500);
    }

    const pinHash = input.pin && String(input.pin).trim().length > 0 ? hashPin(String(input.pin).trim()) : null;

    this.runTransaction(() => {
      this.db
        .prepare(`INSERT OR IGNORE INTO hosts (uid, email, created_at) VALUES (?, ?, ?)`)
        .run(hostUid, hostEmail, now);

      this.db
        .prepare(`
          INSERT INTO rooms (
            id, host_uid, name, event_name, description, code, pin_hash,
            max_teams, starting_coins, min_bid, min_bid_increment, deduct_winning_bid,
            allow_manual_coin_adjust, auction_duration_sec, max_auction_duration_sec,
            starting_bid_default, allow_multiple_bids, allow_rebid_after_outbid,
            auto_close_on_expire, answer_duration_sec, correct_points, incorrect_deduction,
            unanswered_counts_incorrect, allow_host_override, status, is_demo,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `)
        .run(
          roomId,
          hostUid,
          input.name,
          input.eventName,
          input.description || '',
          code,
          pinHash,
          input.maxTeams,
          input.startingCoins,
          input.minBid,
          input.minBidIncrement,
          input.deductWinningBid ? 1 : 0,
          input.allowManualCoinAdjust ? 1 : 0,
          input.auctionDurationSec,
          input.maxAuctionDurationSec || 600,
          input.startingBidDefault,
          input.allowMultipleBids ? 1 : 0,
          input.allowRebidAfterOutbid ? 1 : 0,
          input.autoCloseOnExpire !== false ? 1 : 0,
          input.answerDurationSec,
          input.correctPoints,
          input.incorrectDeduction,
          input.unansweredCountsIncorrect ? 1 : 0,
          input.allowHostOverride ? 1 : 0,
          input.status || 'READY',
          now,
          now
        );

      const items: any[] = Array.isArray(input.items) ? input.items : [];
      const insertItem = this.db.prepare(`
        INSERT INTO room_items (
          id, room_id, bank_item_id, sort_order, name, image_url, emoji,
          category, description, starting_bid, difficulty, question,
          correct_answer, explanation, time_limit_override_sec, host_notes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let firstItemId: string | null = null;
      items.forEach((it, idx) => {
        const itemId = genId('item');
        if (idx === 0) firstItemId = itemId;
        insertItem.run(
          itemId,
          roomId,
          it.bankItemId || null,
          idx + 1,
          it.name,
          it.imageUrl || '',
          it.emoji || '⚡',
          it.category,
          it.description,
          it.startingBid ?? input.startingBidDefault,
          it.difficulty || 'Medium',
          it.question,
          it.correctAnswer,
          it.explanation || '',
          it.timeLimitOverrideSec ?? null,
          it.hostNotes || '',
          idx === 0 ? 'PREVIEW' : 'PENDING'
        );
      });

      this.db
        .prepare(`
          INSERT INTO live_room_state (
            room_id, current_item_id, phase, current_highest_bid,
            question_revealed, version, updated_at
          ) VALUES (?, ?, ?, 0, 0, 1, ?)
        `)
        .run(roomId, firstItemId, firstItemId ? 'ITEM_PREVIEW' : 'LOBBY', now);
    });

    return this.getHostRoomSnapshot(roomId);
  }

  public async updateRoom(roomId: string, hostUid: string, input: any): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      const room = this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      const fields: string[] = [];
      const values: Array<string | number | null> = [];

      const mapBool = (val: boolean | undefined) => (val ? 1 : 0);
      const assign = (col: string, val: string | number | null) => {
        fields.push(`${col} = ?`);
        values.push(val);
      };

      if (input.name !== undefined) assign('name', input.name);
      if (input.eventName !== undefined) assign('event_name', input.eventName);
      if (input.description !== undefined) assign('description', input.description);
      if (input.maxTeams !== undefined) assign('max_teams', input.maxTeams);
      if (input.startingCoins !== undefined) assign('starting_coins', input.startingCoins);
      if (input.minBid !== undefined) assign('min_bid', input.minBid);
      if (input.minBidIncrement !== undefined) assign('min_bid_increment', input.minBidIncrement);
      if (input.deductWinningBid !== undefined) assign('deduct_winning_bid', mapBool(input.deductWinningBid));
      if (input.allowManualCoinAdjust !== undefined) assign('allow_manual_coin_adjust', mapBool(input.allowManualCoinAdjust));
      if (input.auctionDurationSec !== undefined) assign('auction_duration_sec', input.auctionDurationSec);
      if (input.maxAuctionDurationSec !== undefined) assign('max_auction_duration_sec', input.maxAuctionDurationSec);
      if (input.startingBidDefault !== undefined) assign('starting_bid_default', input.startingBidDefault);
      if (input.allowMultipleBids !== undefined) assign('allow_multiple_bids', mapBool(input.allowMultipleBids));
      if (input.allowRebidAfterOutbid !== undefined) assign('allow_rebid_after_outbid', mapBool(input.allowRebidAfterOutbid));
      if (input.autoCloseOnExpire !== undefined) assign('auto_close_on_expire', mapBool(input.autoCloseOnExpire));
      if (input.answerDurationSec !== undefined) assign('answer_duration_sec', input.answerDurationSec);
      if (input.correctPoints !== undefined) assign('correct_points', input.correctPoints);
      if (input.incorrectDeduction !== undefined) assign('incorrect_deduction', input.incorrectDeduction);
      if (input.unansweredCountsIncorrect !== undefined) assign('unanswered_counts_incorrect', mapBool(input.unansweredCountsIncorrect));
      if (input.allowHostOverride !== undefined) assign('allow_host_override', mapBool(input.allowHostOverride));
      if (input.status !== undefined) assign('status', input.status);
      if (input.clearPin) {
        assign('pin_hash', null);
      } else if (input.pin && String(input.pin).trim().length > 0) {
        assign('pin_hash', hashPin(String(input.pin).trim()));
      }

      if (fields.length > 0) {
        assign('updated_at', now);
        values.push(room.id);
        this.db.prepare(`UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }

      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public deleteRoom(roomId: string, hostUid: string) {
    const room = this.assertRoomHostAccess(roomId, hostUid);
    if (room.isDemo) {
      throw new EngineError('The built-in Demo Room cannot be deleted. Use Reset Demo Room instead.', 400);
    }
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    return { deleted: true };
  }

  public async resetDemoRoom(): Promise<RoomSnapshotHost> {
    return this.withRoomLock(DEMO_ROOM_ID, () => {
      seedDemoData(this.db, true);
      this.emitRoomUpdate(DEMO_ROOM_ID);
      return this.getHostRoomSnapshot(DEMO_ROOM_ID);
    });
  }

  // --- Question Bank CRUD ---

  public listQuestionBank(hostUid: string): QuestionBankItem[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM question_bank_items
        WHERE host_uid = ? OR is_demo = 1
        ORDER BY is_demo ASC, updated_at DESC
      `)
      .all(hostUid) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      hostUid: String(r.host_uid),
      name: String(r.name),
      imageUrl: String(r.image_url || ''),
      emoji: String(r.emoji || '⚡'),
      category: String(r.category),
      description: String(r.description),
      startingBid: Number(r.starting_bid),
      difficulty: String(r.difficulty) as ItemDifficulty,
      question: String(r.question),
      correctAnswer: String(r.correct_answer),
      explanation: String(r.explanation || ''),
      timeLimitOverrideSec: r.time_limit_override_sec !== null && r.time_limit_override_sec !== undefined ? Number(r.time_limit_override_sec) : null,
      hostNotes: String(r.host_notes || ''),
      isDemo: Boolean(r.is_demo),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  public createQuestionBankItem(hostUid: string, input: any): QuestionBankItem {
    const now = Date.now();
    const id = genId('qbank');
    this.db
      .prepare(`
        INSERT INTO question_bank_items (
          id, host_uid, name, image_url, emoji, category, description,
          starting_bid, difficulty, question, correct_answer, explanation,
          time_limit_override_sec, host_notes, is_demo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(
        id,
        hostUid,
        input.name,
        input.imageUrl || '',
        input.emoji || '⚡',
        input.category,
        input.description,
        input.startingBid,
        input.difficulty,
        input.question,
        input.correctAnswer,
        input.explanation || '',
        input.timeLimitOverrideSec ?? null,
        input.hostNotes || '',
        now,
        now
      );

    return {
      id,
      hostUid,
      name: input.name,
      imageUrl: input.imageUrl || '',
      emoji: input.emoji || '⚡',
      category: input.category,
      description: input.description,
      startingBid: input.startingBid,
      difficulty: input.difficulty,
      question: input.question,
      correctAnswer: input.correctAnswer,
      explanation: input.explanation || '',
      timeLimitOverrideSec: input.timeLimitOverrideSec ?? null,
      hostNotes: input.hostNotes || '',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  public updateQuestionBankItem(itemId: string, hostUid: string, input: any): QuestionBankItem {
    const existing = this.db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
    if (!existing) throw new EngineError('Question bank item not found', 404);
    if (Boolean(existing.is_demo) || String(existing.host_uid) !== hostUid) {
      throw new EngineError('You can only edit your own custom question bank items (duplicate demo items to customize)', 403);
    }
    const now = Date.now();
    this.db
      .prepare(`
        UPDATE question_bank_items
        SET name = ?, image_url = ?, emoji = ?, category = ?, description = ?,
            starting_bid = ?, difficulty = ?, question = ?, correct_answer = ?,
            explanation = ?, time_limit_override_sec = ?, host_notes = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.name,
        input.imageUrl || '',
        input.emoji || '⚡',
        input.category,
        input.description,
        input.startingBid,
        input.difficulty,
        input.question,
        input.correctAnswer,
        input.explanation || '',
        input.timeLimitOverrideSec ?? null,
        input.hostNotes || '',
        now,
        itemId
      );

    const updated = this.db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(itemId) as Record<string, unknown>;
    return {
      id: String(updated.id),
      hostUid: String(updated.host_uid),
      name: String(updated.name),
      imageUrl: String(updated.image_url || ''),
      emoji: String(updated.emoji || '⚡'),
      category: String(updated.category),
      description: String(updated.description),
      startingBid: Number(updated.starting_bid),
      difficulty: String(updated.difficulty) as ItemDifficulty,
      question: String(updated.question),
      correctAnswer: String(updated.correct_answer),
      explanation: String(updated.explanation || ''),
      timeLimitOverrideSec: updated.time_limit_override_sec !== null && updated.time_limit_override_sec !== undefined ? Number(updated.time_limit_override_sec) : null,
      hostNotes: String(updated.host_notes || ''),
      isDemo: Boolean(updated.is_demo),
      createdAt: Number(updated.created_at),
      updatedAt: Number(updated.updated_at),
    };
  }

  public duplicateQuestionBankItem(itemId: string, hostUid: string): QuestionBankItem {
    const existing = this.db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
    if (!existing) throw new EngineError('Item not found', 404);
    if (!Boolean(existing.is_demo) && String(existing.host_uid) !== hostUid) {
      throw new EngineError('Unauthorized', 403);
    }
    return this.createQuestionBankItem(hostUid, {
      name: `${String(existing.name)} (Copy)`,
      imageUrl: String(existing.image_url || ''),
      emoji: String(existing.emoji || '⚡'),
      category: String(existing.category),
      description: String(existing.description),
      startingBid: Number(existing.starting_bid),
      difficulty: String(existing.difficulty),
      question: String(existing.question),
      correctAnswer: String(existing.correct_answer),
      explanation: String(existing.explanation || ''),
      timeLimitOverrideSec: existing.time_limit_override_sec !== null ? Number(existing.time_limit_override_sec) : null,
      hostNotes: String(existing.host_notes || ''),
    });
  }

  public deleteQuestionBankItem(itemId: string, hostUid: string) {
    const existing = this.db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
    if (!existing) throw new EngineError('Item not found', 404);
    if (Boolean(existing.is_demo) || String(existing.host_uid) !== hostUid) {
      throw new EngineError('Cannot delete sample demo items or another host’s items', 403);
    }
    this.db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(itemId);
    return { deleted: true };
  }

  // --- Room Item Queue Operations ---

  public async addItemToRoom(roomId: string, hostUid: string, input: any): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const maxOrderRow = this.db
          .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM room_items WHERE room_id = ?')
          .get(roomId) as { max_order: number };
        const sortOrder = Number(maxOrderRow.max_order) + 1;
        const itemId = genId('item');

        this.db
          .prepare(`
            INSERT INTO room_items (
              id, room_id, bank_item_id, sort_order, name, image_url, emoji,
              category, description, starting_bid, difficulty, question,
              correct_answer, explanation, time_limit_override_sec, host_notes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
          `)
          .run(
            itemId,
            roomId,
            input.bankItemId || null,
            sortOrder,
            input.name,
            input.imageUrl || '',
            input.emoji || '⚡',
            input.category,
            input.description,
            input.startingBid,
            input.difficulty,
            input.question,
            input.correctAnswer,
            input.explanation || '',
            input.timeLimitOverrideSec ?? null,
            input.hostNotes || ''
          );

        const state = this.db.prepare('SELECT current_item_id, phase FROM live_room_state WHERE room_id = ?').get(roomId) as {
          current_item_id: string | null;
          phase: string;
        };
        if (!state.current_item_id && state.phase === 'LOBBY') {
          this.db
            .prepare(`UPDATE live_room_state SET current_item_id = ?, phase = 'ITEM_PREVIEW', updated_at = ?, version = version + 1 WHERE room_id = ?`)
            .run(itemId, now, roomId);
          this.db.prepare(`UPDATE room_items SET status = 'PREVIEW' WHERE id = ?`).run(itemId);
        }
      });

      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async removeItemFromRoom(roomId: string, hostUid: string, itemId: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const state = this.db.prepare('SELECT current_item_id, phase FROM live_room_state WHERE room_id = ?').get(roomId) as {
        current_item_id: string | null;
        phase: string;
      };
      if (state.current_item_id === itemId && (state.phase === 'BIDDING_OPEN' || state.phase === 'QUESTION_ACTIVE')) {
        throw new EngineError('Cannot remove an item while its auction or question timer is active', 409);
      }
      this.runTransaction(() => {
        this.db.prepare('DELETE FROM room_items WHERE id = ? AND room_id = ?').run(itemId, roomId);
        if (state.current_item_id === itemId) {
          const next = this.db
            .prepare(`SELECT id FROM room_items WHERE room_id = ? AND status != 'SCORED' ORDER BY sort_order ASC LIMIT 1`)
            .get(roomId) as { id: string } | undefined;
          this.db
            .prepare(`UPDATE live_room_state SET current_item_id = ?, phase = ?, current_highest_bid = 0, highest_bidder_team_id = NULL, highest_bidder_team_name = NULL, question_revealed = 0, updated_at = ?, version = version + 1 WHERE room_id = ?`)
            .run(next ? next.id : null, next ? 'ITEM_PREVIEW' : 'LOBBY', Date.now(), roomId);
        }
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async reorderRoomItems(roomId: string, hostUid: string, orderedItemIds: string[]): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      this.runTransaction(() => {
        const stmt = this.db.prepare('UPDATE room_items SET sort_order = ? WHERE id = ? AND room_id = ?');
        orderedItemIds.forEach((id, idx) => {
          stmt.run(idx + 1, id, roomId);
        });
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async randomizeRoomItems(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const state = this.db.prepare('SELECT current_item_id, phase FROM live_room_state WHERE room_id = ?').get(roomId) as {
        current_item_id: string | null;
        phase: string;
      };
      if (state.phase === 'BIDDING_OPEN' || state.phase === 'QUESTION_ACTIVE') {
        throw new EngineError('Pause or close the active round before randomizing items', 409);
      }

      this.runTransaction(() => {
        const pendingRows = this.db
          .prepare(`SELECT id FROM room_items WHERE room_id = ? AND status IN ('PENDING', 'PREVIEW') ORDER BY sort_order ASC`)
          .all(roomId) as { id: string }[];
        const scoredCountRow = this.db
          .prepare(`SELECT COUNT(*) AS cnt FROM room_items WHERE room_id = ? AND status NOT IN ('PENDING', 'PREVIEW')`)
          .get(roomId) as { cnt: number };
        const offset = Number(scoredCountRow.cnt);
        const ids = pendingRows.map((r) => r.id);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = crypto.randomInt(0, i + 1);
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        const stmt = this.db.prepare('UPDATE room_items SET sort_order = ? WHERE id = ? AND room_id = ?');
        ids.forEach((id, idx) => stmt.run(offset + idx + 1, id, roomId));
      });

      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  // --- Team Registration & Management ---

  public async joinTeam(input: { roomCode: string; teamName: string; pin?: string }) {
    const room = this.getRoomByCode(input.roomCode);
    if (!room) {
      throw new EngineError('Invalid room code. Please verify the code with your event host.', 404);
    }

    return this.withRoomLock(room.id, () => {
      const freshRoomRow = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(room.id) as Record<string, unknown>;
      const freshRoom = this.mapRoomRow(freshRoomRow);

      if (freshRoom.status === 'COMPLETED') {
        throw new EngineError('This auction room has already ended.', 403);
      }

      if (freshRoomRow.pin_hash) {
        if (!input.pin || !verifyPin(input.pin, String(freshRoomRow.pin_hash))) {
          throw new EngineError('Incorrect room access PIN.', 401);
        }
      }

      const normalizedName = input.teamName.trim().toLowerCase().replace(/\s+/g, ' ');
      const existing = this.db
        .prepare('SELECT id FROM teams WHERE room_id = ? AND normalized_name = ? AND is_removed = 0')
        .get(freshRoom.id, normalizedName);
      if (existing) {
        throw new EngineError(`Team name "${input.teamName}" is already registered in this room.`, 409);
      }

      const countRow = this.db
        .prepare('SELECT COUNT(*) AS cnt FROM teams WHERE room_id = ? AND is_removed = 0')
        .get(freshRoom.id) as { cnt: number };
      if (Number(countRow.cnt) >= freshRoom.maxTeams) {
        throw new EngineError('This room has reached its maximum team capacity.', 403);
      }

      const teamId = genId('team');
      const now = Date.now();

      this.runTransaction(() => {
        this.db
          .prepare(`
            INSERT INTO teams (
              id, room_id, name, normalized_name, coins, points, items_won,
              correct_answers, incorrect_answers, total_bids, joined_at, is_removed
            ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, 0)
          `)
          .run(teamId, freshRoom.id, input.teamName.trim(), normalizedName, freshRoom.startingCoins, now);
      });

      const token = signTeamToken({
        teamId,
        roomId: freshRoom.id,
        roomCode: freshRoom.code,
        teamName: input.teamName.trim(),
      });

      this.emitRoomUpdate(freshRoom.id);

      const snapshot = this.getPublicRoomSnapshot(freshRoom.id);
      const team = snapshot.teams.find((t) => t.id === teamId)!;
      return { token, team, snapshot };
    });
  }

  public getTeamMe(roomId: string, teamId: string) {
    const row = this.db
      .prepare('SELECT * FROM teams WHERE id = ? AND room_id = ? AND is_removed = 0')
      .get(teamId, roomId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new EngineError('Team not found or has been removed from this room', 404);
    }
    const snapshot = this.getPublicRoomSnapshot(roomId);
    const team = snapshot.teams.find((t) => t.id === teamId);
    return { team, snapshot };
  }

  public async removeTeam(roomId: string, hostUid: string, teamId: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const state = this.db.prepare('SELECT phase FROM live_room_state WHERE room_id = ?').get(roomId) as { phase: string };
      if (state.phase === 'BIDDING_OPEN' || state.phase === 'QUESTION_ACTIVE') {
        throw new EngineError('Cannot remove a team while an auction or question timer is active', 409);
      }
      const bidCount = this.db
        .prepare('SELECT COUNT(*) AS cnt FROM bids WHERE room_id = ? AND team_id = ?')
        .get(roomId, teamId) as { cnt: number };
      const historyCount = this.db
        .prepare('SELECT COUNT(*) AS cnt FROM auction_history WHERE room_id = ? AND winning_team_id = ?')
        .get(roomId, teamId) as { cnt: number };
      if (Number(bidCount.cnt) > 0 || Number(historyCount.cnt) > 0) {
        throw new EngineError('Teams that have already placed bids or won items cannot be removed', 409);
      }

      this.db.prepare('UPDATE teams SET is_removed = 1 WHERE id = ? AND room_id = ?').run(teamId, roomId);
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async adjustTeamCoins(
    roomId: string,
    hostUid: string,
    teamId: string,
    delta: number,
    reason: string
  ): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      const room = this.assertRoomHostAccess(roomId, hostUid);
      if (!room.allowManualCoinAdjust) {
        throw new EngineError('Manual coin adjustment is disabled in this room’s settings', 403);
      }
      this.runTransaction(() => {
        const team = this.db
          .prepare('SELECT coins FROM teams WHERE id = ? AND room_id = ? AND is_removed = 0')
          .get(teamId, roomId) as { coins: number } | undefined;
        if (!team) throw new EngineError('Team not found', 404);
        const nextCoins = Math.max(0, Number(team.coins) + delta);
        this.db.prepare('UPDATE teams SET coins = ? WHERE id = ?').run(nextCoins, teamId);
        this.db
          .prepare('INSERT INTO coin_adjustments (id, room_id, team_id, delta, reason, host_uid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(genId('adj'), roomId, teamId, delta, reason, hostUid, Date.now());
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  // --- Live Auction Controls & Atomic Bid Engine ---

  public async selectItem(roomId: string, hostUid: string, itemId: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const state = this.db.prepare('SELECT phase FROM live_room_state WHERE room_id = ?').get(roomId) as { phase: string };
        if (state.phase === 'BIDDING_OPEN' || state.phase === 'QUESTION_ACTIVE') {
          throw new EngineError('Close or pause the active round before switching items', 409);
        }
        const item = this.db.prepare('SELECT * FROM room_items WHERE id = ? AND room_id = ?').get(itemId, roomId) as Record<string, unknown> | undefined;
        if (!item) throw new EngineError('Item not found in this room', 404);
        if (String(item.status) === 'SCORED') {
          throw new EngineError('This item has already been completed and scored', 409);
        }
        this.db.prepare(`UPDATE room_items SET status = 'PENDING' WHERE room_id = ? AND status = 'PREVIEW'`).run(roomId);
        this.db.prepare(`UPDATE room_items SET status = 'PREVIEW' WHERE id = ?`).run(itemId);
        this.db
          .prepare(`
            UPDATE live_room_state
            SET current_item_id = ?, phase = 'ITEM_PREVIEW',
                current_highest_bid = 0, highest_bidder_team_id = NULL, highest_bidder_team_name = NULL,
                auction_started_at = NULL, auction_deadline_at = NULL, auction_remaining_ms = NULL,
                answer_started_at = NULL, answer_deadline_at = NULL, answer_remaining_ms = NULL,
                question_revealed = 0, version = version + 1, updated_at = ?
            WHERE room_id = ?
          `)
          .run(itemId, now, roomId);
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async startBidding(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      const room = this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const state = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        if (!state.current_item_id) {
          throw new EngineError('Select an auction item before starting bidding', 400);
        }
        if (state.phase === 'BIDDING_OPEN') {
          throw new EngineError('Bidding is already open for this item', 409);
        }
        const currentItemId = String(state.current_item_id);
        const item = this.db.prepare('SELECT * FROM room_items WHERE id = ? AND room_id = ?').get(currentItemId, roomId) as Record<string, unknown> | undefined;
        if (!item) throw new EngineError('Selected item not found', 404);
        if (String(item.status) === 'SCORED') {
          throw new EngineError('This item has already been scored. Select the next item.', 409);
        }

        const configuredSec = Number(room.auctionDurationSec) > 0 ? Number(room.auctionDurationSec) : 30;
        const maxAllowedSec = Number(room.maxAuctionDurationSec) >= 5 ? Number(room.maxAuctionDurationSec) : 600;
        const durationSec = Math.max(5, Math.min(maxAllowedSec, configuredSec));
        const deadlineAt = now + durationSec * 1000;
        const itemId = String(item.id);

        this.db.prepare(`UPDATE rooms SET status = 'LIVE', updated_at = ? WHERE id = ?`).run(now, roomId);
        this.db.prepare(`UPDATE room_items SET status = 'BIDDING' WHERE id = ?`).run(itemId);
        this.db.prepare('DELETE FROM bids WHERE room_id = ? AND item_id = ?').run(roomId, itemId);

        this.db
          .prepare(`
            UPDATE live_room_state
            SET phase = 'BIDDING_OPEN',
                current_highest_bid = 0, highest_bidder_team_id = NULL, highest_bidder_team_name = NULL,
                auction_started_at = ?, auction_deadline_at = ?, auction_remaining_ms = NULL,
                answer_started_at = NULL, answer_deadline_at = NULL, answer_remaining_ms = NULL,
                question_revealed = 0, version = version + 1, updated_at = ?
            WHERE room_id = ?
          `)
          .run(now, deadlineAt, now, roomId);
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async placeBid(
    roomId: string,
    teamId: string,
    input: { itemId: string; amount: number; idempotencyKey: string }
  ): Promise<{ deduplicated: boolean; bid: BidRecord; snapshot: RoomSnapshotPublic }> {
    return this.withRoomLock(roomId, () => {
      const now = Date.now();
      let autoExpired = false;

      const result = this.runTransaction(() => {
        const roomRow = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Record<string, unknown> | undefined;
        if (!roomRow) throw new EngineError('Room not found', 404);
        const room = this.mapRoomRow(roomRow);

        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);

        // Idempotency check FIRST so network retries return gracefully
        const dupRow = this.db
          .prepare('SELECT * FROM bids WHERE room_id = ? AND item_id = ? AND idempotency_key = ?')
          .get(roomId, input.itemId, input.idempotencyKey) as Record<string, unknown> | undefined;
        if (dupRow) {
          return {
            deduplicated: true,
            bid: {
              id: String(dupRow.id),
              roomId: String(dupRow.room_id),
              itemId: String(dupRow.item_id),
              teamId: String(dupRow.team_id),
              teamName: String(dupRow.team_name),
              amount: Number(dupRow.amount),
              createdAt: Number(dupRow.created_at),
            },
          };
        }

        if (state.phase !== 'BIDDING_OPEN') {
          throw new EngineError('Bidding is currently closed', 409);
        }

        if (state.currentItemId !== input.itemId) {
          throw new EngineError('This auction item is no longer active', 409);
        }

        // Server-authoritative deadline enforcement
        if (state.auctionDeadlineAt !== null && now > state.auctionDeadlineAt && room.autoCloseOnExpire) {
          this.closeBiddingInternal(room, state, now);
          autoExpired = true;
          return null;
        }

        const teamRow = this.db
          .prepare('SELECT * FROM teams WHERE id = ? AND room_id = ? AND is_removed = 0')
          .get(teamId, roomId) as Record<string, unknown> | undefined;
        if (!teamRow) {
          throw new EngineError('Team is not registered in this room', 403);
        }

        const teamCoins = Number(teamRow.coins);
        const teamName = String(teamRow.name);

        if (!Number.isInteger(input.amount) || input.amount <= 0) {
          throw new EngineError('Bid must be a positive whole number', 400);
        }

        if (state.highestBidderTeamId === teamId) {
          throw new EngineError('You already hold the highest bid', 409);
        }

        // Check multiple bids / rebid rules
        if (!room.allowMultipleBids || !room.allowRebidAfterOutbid) {
          const prevBid = this.db
            .prepare('SELECT id FROM bids WHERE room_id = ? AND item_id = ? AND team_id = ? LIMIT 1')
            .get(roomId, input.itemId, teamId);
          if (prevBid) {
            throw new EngineError(
              !room.allowMultipleBids
                ? 'Only one bid per team is allowed for this item'
                : 'Rebidding after being outbid is disabled in this room',
              403
            );
          }
        }

        const itemRow = this.db.prepare('SELECT starting_bid FROM room_items WHERE id = ?').get(input.itemId) as { starting_bid: number };
        const minRequired =
          state.highestBidderTeamId === null
            ? Math.max(room.minBid, Number(itemRow.starting_bid))
            : state.currentHighestBid + room.minBidIncrement;

        if (input.amount < minRequired) {
          throw new EngineError(`Bid must be at least ${minRequired} coins`, 400);
        }

        if (input.amount > teamCoins) {
          throw new EngineError(`Insufficient balance. You have ${teamCoins} coins available.`, 400);
        }

        const bidId = genId('bid');
        this.db
          .prepare(`
            INSERT INTO bids (id, room_id, item_id, team_id, team_name, amount, idempotency_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(bidId, roomId, input.itemId, teamId, teamName, input.amount, input.idempotencyKey, now);

        this.db.prepare('UPDATE teams SET total_bids = total_bids + 1 WHERE id = ?').run(teamId);

        this.db
          .prepare(`
            UPDATE live_room_state
            SET current_highest_bid = ?, highest_bidder_team_id = ?, highest_bidder_team_name = ?,
                version = version + 1, updated_at = ?
            WHERE room_id = ?
          `)
          .run(input.amount, teamId, teamName, now, roomId);

        return {
          deduplicated: false,
          bid: {
            id: bidId,
            roomId,
            itemId: input.itemId,
            teamId,
            teamName,
            amount: input.amount,
            createdAt: now,
          },
        };
      });

      if (autoExpired || result === null) {
        this.emitRoomUpdate(roomId);
        throw new EngineError('Auction time expired just before your bid arrived', 409);
      }

      if (!result.deduplicated) {
        this.emitRoomUpdate(roomId);
      }

      return {
        deduplicated: result.deduplicated,
        bid: result.bid,
        snapshot: this.getPublicRoomSnapshot(roomId),
      };
    });
  }

  private closeBiddingInternal(room: RoomConfig, state: LiveRoomState, now: number) {
    if (!state.currentItemId) return;

    // Deduct winning bid only if enabled and not already deducted
    if (room.deductWinningBid && state.highestBidderTeamId && state.currentHighestBid > 0) {
      const winner = this.db
        .prepare('SELECT coins FROM teams WHERE id = ?')
        .get(state.highestBidderTeamId) as { coins: number } | undefined;
      if (winner) {
        const deducted = Math.max(0, Number(winner.coins) - state.currentHighestBid);
        this.db.prepare('UPDATE teams SET coins = ? WHERE id = ?').run(deducted, state.highestBidderTeamId);
      }
    }

    this.db.prepare(`UPDATE room_items SET status = 'CLOSED' WHERE id = ?`).run(state.currentItemId);
    this.db
      .prepare(`
        UPDATE live_room_state
        SET phase = 'BIDDING_CLOSED', auction_deadline_at = ?, auction_remaining_ms = 0,
            version = version + 1, updated_at = ?
        WHERE room_id = ?
      `)
      .run(now, now, room.id);
  }

  public async closeBidding(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      const room = this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);
        if (state.phase !== 'BIDDING_OPEN' && state.phase !== 'BIDDING_PAUSED') {
          throw new EngineError('Auction is not currently open or paused', 409);
        }
        this.closeBiddingInternal(room, state, now);
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async pauseTimer(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);
        if (state.phase === 'BIDDING_OPEN') {
          const rem = Math.max(0, (state.auctionDeadlineAt || now) - now);
          this.db
            .prepare(`UPDATE live_room_state SET phase = 'BIDDING_PAUSED', auction_remaining_ms = ?, version = version + 1, updated_at = ? WHERE room_id = ?`)
            .run(rem, now, roomId);
        } else if (state.phase === 'QUESTION_ACTIVE') {
          const rem = Math.max(0, (state.answerDeadlineAt || now) - now);
          this.db
            .prepare(`UPDATE live_room_state SET phase = 'QUESTION_PAUSED', answer_remaining_ms = ?, version = version + 1, updated_at = ? WHERE room_id = ?`)
            .run(rem, now, roomId);
        } else {
          throw new EngineError('No active timer to pause', 409);
        }
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async resumeTimer(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);
        if (state.phase === 'BIDDING_PAUSED') {
          const rem = Math.max(1000, state.auctionRemainingMs ?? 10000);
          this.db
            .prepare(`UPDATE live_room_state SET phase = 'BIDDING_OPEN', auction_deadline_at = ?, auction_remaining_ms = NULL, version = version + 1, updated_at = ? WHERE room_id = ?`)
            .run(now + rem, now, roomId);
        } else if (state.phase === 'QUESTION_PAUSED') {
          const rem = Math.max(1000, state.answerRemainingMs ?? 10000);
          this.db
            .prepare(`UPDATE live_room_state SET phase = 'QUESTION_ACTIVE', answer_deadline_at = ?, answer_remaining_ms = NULL, version = version + 1, updated_at = ? WHERE room_id = ?`)
            .run(now + rem, now, roomId);
        } else {
          throw new EngineError('No paused timer to resume', 409);
        }
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async revealQuestion(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      const room = this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);
        if (state.phase !== 'BIDDING_CLOSED') {
          throw new EngineError('Close bidding before revealing the question', 409);
        }
        if (!state.highestBidderTeamId) {
          throw new EngineError('No winning bidder for this item. Skip or restart instead.', 409);
        }
        const item = this.db.prepare('SELECT time_limit_override_sec FROM room_items WHERE id = ?').get(state.currentItemId) as {
          time_limit_override_sec: number | null;
        };
        const rawAnswerSec = Number(item?.time_limit_override_sec ?? room.answerDurationSec);
        const answerSec = Number.isFinite(rawAnswerSec) && rawAnswerSec >= 5 ? rawAnswerSec : 30;
        const answerDeadline = now + answerSec * 1000;

        this.db.prepare(`UPDATE room_items SET status = 'QUESTION_REVEALED' WHERE id = ?`).run(state.currentItemId);
        this.db
          .prepare(`
            UPDATE live_room_state
            SET phase = 'QUESTION_ACTIVE', question_revealed = 1,
                answer_started_at = ?, answer_deadline_at = ?, answer_remaining_ms = NULL,
                version = version + 1, updated_at = ?
            WHERE room_id = ?
          `)
          .run(now, answerDeadline, now, roomId);
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async scoreAnswer(
    roomId: string,
    hostUid: string,
    input: { itemId: string; outcome: 'CORRECT' | 'INCORRECT' | 'UNANSWERED' }
  ): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      const room = this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);

        if (state.currentItemId !== input.itemId) {
          throw new EngineError('Item mismatch while scoring', 409);
        }

        // Exact-once scoring guard
        const alreadyScored = this.db
          .prepare('SELECT id FROM auction_history WHERE item_id = ?')
          .get(input.itemId);
        if (alreadyScored) {
          throw new EngineError('This item has already been scored. Duplicate scoring is blocked.', 409);
        }

        const allowedPhases: AuctionPhase[] = ['BIDDING_CLOSED', 'QUESTION_ACTIVE', 'QUESTION_PAUSED', 'QUESTION_TIMEOUT'];
        if (!allowedPhases.includes(state.phase)) {
          throw new EngineError('Item cannot be scored in its current phase', 409);
        }

        const itemRow = this.db.prepare('SELECT * FROM room_items WHERE id = ?').get(input.itemId) as Record<string, unknown>;
        const item = this.mapHostItemRow(itemRow);

        let pointsAwarded = 0;
        let coinsDeducted = 0;
        let finalOutcome: AnswerResult = input.outcome;

        if (!state.highestBidderTeamId) {
          finalOutcome = 'NO_BIDS';
        } else {
          const teamRow = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(state.highestBidderTeamId) as Record<string, unknown>;
          const currentCoins = Number(teamRow.coins);

          if (input.outcome === 'CORRECT') {
            pointsAwarded = room.correctPoints;
            this.db
              .prepare(`UPDATE teams SET points = points + ?, items_won = items_won + 1, correct_answers = correct_answers + 1 WHERE id = ?`)
              .run(pointsAwarded, state.highestBidderTeamId);
          } else if (input.outcome === 'INCORRECT' || (input.outcome === 'UNANSWERED' && room.unansweredCountsIncorrect)) {
            coinsDeducted = Math.min(currentCoins, room.incorrectDeduction);
            this.db
              .prepare(`UPDATE teams SET coins = coins - ?, items_won = items_won + 1, incorrect_answers = incorrect_answers + 1 WHERE id = ?`)
              .run(coinsDeducted, state.highestBidderTeamId);
          } else {
            // Unanswered and room does not penalize unanswered
            this.db
              .prepare(`UPDATE teams SET items_won = items_won + 1 WHERE id = ?`)
              .run(state.highestBidderTeamId);
          }
        }

        this.db
          .prepare(`
            INSERT INTO auction_history (
              id, room_id, item_id, item_name, winning_team_id, winning_team_name,
              winning_bid, auction_start_time, auction_end_time, question, correct_answer,
              answer_result, points_awarded, coins_deducted, host_action_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            genId('hist'),
            roomId,
            item.id,
            item.name,
            state.highestBidderTeamId,
            state.highestBidderTeamName,
            state.currentHighestBid,
            state.auctionStartedAt,
            state.auctionDeadlineAt,
            item.question,
            item.correctAnswer,
            finalOutcome,
            pointsAwarded,
            coinsDeducted,
            now
          );

        const lastResult: LastScoringResult = {
          itemId: item.id,
          itemName: item.name,
          winningTeamId: state.highestBidderTeamId,
          winningTeamName: state.highestBidderTeamName,
          winningBid: state.currentHighestBid,
          answerResult: finalOutcome,
          pointsAwarded,
          coinsDeducted,
          correctAnswer: item.correctAnswer,
          explanation: item.explanation,
          timestamp: now,
        };

        this.db.prepare(`UPDATE room_items SET status = 'SCORED' WHERE id = ?`).run(item.id);
        this.db
          .prepare(`
            UPDATE live_room_state
            SET phase = 'SCORED', question_revealed = 1,
                answer_deadline_at = NULL, answer_remaining_ms = NULL,
                last_result_json = ?, version = version + 1, updated_at = ?
            WHERE room_id = ?
          `)
          .run(JSON.stringify(lastResult), now, roomId);
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async recordNoBidSkip(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
      const state = this.mapLiveState(stateRow);
      if (!state.currentItemId) throw new EngineError('No active item', 400);
      return this.scoreAnswerInternalNoLock(roomId, state.currentItemId);
    });
  }

  private scoreAnswerInternalNoLock(roomId: string, itemId: string): RoomSnapshotHost {
    const now = Date.now();
    this.runTransaction(() => {
      const already = this.db.prepare('SELECT id FROM auction_history WHERE item_id = ?').get(itemId);
      if (!already) {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);
        const itemRow = this.db.prepare('SELECT * FROM room_items WHERE id = ?').get(itemId) as Record<string, unknown>;
        const item = this.mapHostItemRow(itemRow);
        this.db
          .prepare(`
            INSERT INTO auction_history (
              id, room_id, item_id, item_name, winning_team_id, winning_team_name,
              winning_bid, auction_start_time, auction_end_time, question, correct_answer,
              answer_result, points_awarded, coins_deducted, host_action_time
            ) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, 'NO_BIDS', 0, 0, ?)
          `)
          .run(genId('hist'), roomId, item.id, item.name, state.auctionStartedAt, state.auctionDeadlineAt, item.question, item.correctAnswer, now);

        const lastResult: LastScoringResult = {
          itemId: item.id,
          itemName: item.name,
          winningTeamId: null,
          winningTeamName: null,
          winningBid: 0,
          answerResult: 'NO_BIDS',
          pointsAwarded: 0,
          coinsDeducted: 0,
          correctAnswer: item.correctAnswer,
          explanation: item.explanation,
          timestamp: now,
        };
        this.db.prepare(`UPDATE room_items SET status = 'SCORED' WHERE id = ?`).run(item.id);
        this.db
          .prepare(`UPDATE live_room_state SET phase = 'SCORED', question_revealed = 1, last_result_json = ?, version = version + 1, updated_at = ? WHERE room_id = ?`)
          .run(JSON.stringify(lastResult), now, roomId);
      }
    });
    this.emitRoomUpdate(roomId);
    return this.getHostRoomSnapshot(roomId);
  }

  public async restartAuction(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      const room = this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);
        if (!state.currentItemId) throw new EngineError('No item selected to restart', 400);

        const alreadyScored = this.db.prepare('SELECT id FROM auction_history WHERE item_id = ?').get(state.currentItemId);
        if (alreadyScored) {
          throw new EngineError('Already scored items cannot be restarted', 409);
        }

        // Refund winning bid if it was deducted when bidding closed
        if (
          room.deductWinningBid &&
          (state.phase === 'BIDDING_CLOSED' || state.phase === 'QUESTION_ACTIVE' || state.phase === 'QUESTION_PAUSED' || state.phase === 'QUESTION_TIMEOUT') &&
          state.highestBidderTeamId &&
          state.currentHighestBid > 0
        ) {
          this.db.prepare('UPDATE teams SET coins = coins + ? WHERE id = ?').run(state.currentHighestBid, state.highestBidderTeamId);
        }

        this.db.prepare('DELETE FROM bids WHERE room_id = ? AND item_id = ?').run(roomId, state.currentItemId);
        this.db.prepare(`UPDATE room_items SET status = 'PREVIEW' WHERE id = ?`).run(state.currentItemId);
        this.db
          .prepare(`
            UPDATE live_room_state
            SET phase = 'ITEM_PREVIEW',
                current_highest_bid = 0, highest_bidder_team_id = NULL, highest_bidder_team_name = NULL,
                auction_started_at = NULL, auction_deadline_at = NULL, auction_remaining_ms = NULL,
                answer_started_at = NULL, answer_deadline_at = NULL, answer_remaining_ms = NULL,
                question_revealed = 0, version = version + 1, updated_at = ?
            WHERE room_id = ?
          `)
          .run(now, roomId);
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async cancelAuction(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.restartAuction(roomId, hostUid);
  }

  public async nextItem(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(roomId) as Record<string, unknown>;
        const state = this.mapLiveState(stateRow);
        if (state.phase === 'BIDDING_OPEN' || state.phase === 'QUESTION_ACTIVE') {
          throw new EngineError('Finish or cancel the active round before advancing', 409);
        }

        const next = this.db
          .prepare(`
            SELECT id FROM room_items
            WHERE room_id = ? AND status IN ('PENDING', 'PREVIEW') AND id != COALESCE(?, '')
            ORDER BY sort_order ASC
            LIMIT 1
          `)
          .get(roomId, state.currentItemId) as { id: string } | undefined;

        if (!next) {
          this.db.prepare(`UPDATE rooms SET status = 'COMPLETED', updated_at = ? WHERE id = ?`).run(now, roomId);
          this.db
            .prepare(`
              UPDATE live_room_state
              SET current_item_id = NULL, phase = 'EVENT_ENDED',
                  current_highest_bid = 0, highest_bidder_team_id = NULL, highest_bidder_team_name = NULL,
                  auction_started_at = NULL, auction_deadline_at = NULL, auction_remaining_ms = NULL,
                  answer_started_at = NULL, answer_deadline_at = NULL, answer_remaining_ms = NULL,
                  question_revealed = 0, version = version + 1, updated_at = ?
              WHERE room_id = ?
            `)
            .run(now, roomId);
        } else {
          this.db.prepare(`UPDATE room_items SET status = 'PREVIEW' WHERE id = ?`).run(next.id);
          this.db
            .prepare(`
              UPDATE live_room_state
              SET current_item_id = ?, phase = 'ITEM_PREVIEW',
                  current_highest_bid = 0, highest_bidder_team_id = NULL, highest_bidder_team_name = NULL,
                  auction_started_at = NULL, auction_deadline_at = NULL, auction_remaining_ms = NULL,
                  answer_started_at = NULL, answer_deadline_at = NULL, answer_remaining_ms = NULL,
                  question_revealed = 0, version = version + 1, updated_at = ?
              WHERE room_id = ?
            `)
            .run(next.id, now, roomId);
        }
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  public async endEvent(roomId: string, hostUid: string): Promise<RoomSnapshotHost> {
    return this.withRoomLock(roomId, () => {
      this.assertRoomHostAccess(roomId, hostUid);
      const now = Date.now();
      this.runTransaction(() => {
        this.db.prepare(`UPDATE rooms SET status = 'COMPLETED', updated_at = ? WHERE id = ?`).run(now, roomId);
        this.db
          .prepare(`
            UPDATE live_room_state
            SET phase = 'EVENT_ENDED',
                auction_deadline_at = NULL, auction_remaining_ms = NULL,
                answer_deadline_at = NULL, answer_remaining_ms = NULL,
                version = version + 1, updated_at = ?
            WHERE room_id = ?
          `)
          .run(now, roomId);
      });
      this.emitRoomUpdate(roomId);
      return this.getHostRoomSnapshot(roomId);
    });
  }

  // --- Authoritative Timer Expiry Processor ---

  public async processExpiredTimers(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const now = Date.now();
      const expiredBidding = this.db
        .prepare(`
          SELECT l.room_id FROM live_room_state l
          JOIN rooms r ON r.id = l.room_id
          WHERE l.phase = 'BIDDING_OPEN' AND l.auction_deadline_at IS NOT NULL AND l.auction_deadline_at <= ? AND r.auto_close_on_expire = 1
        `)
        .all(now) as { room_id: string }[];

      for (const row of expiredBidding) {
        await this.withRoomLock(row.room_id, () => {
          const checkNow = Date.now();
          let changed = false;
          this.runTransaction(() => {
            const roomRow = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(row.room_id) as Record<string, unknown> | undefined;
            const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(row.room_id) as Record<string, unknown> | undefined;
            if (!roomRow || !stateRow) return;
            const room = this.mapRoomRow(roomRow);
            const state = this.mapLiveState(stateRow);
            if (state.phase === 'BIDDING_OPEN' && state.auctionDeadlineAt !== null && state.auctionDeadlineAt <= checkNow && room.autoCloseOnExpire) {
              this.closeBiddingInternal(room, state, checkNow);
              changed = true;
            }
          });
          if (changed) this.emitRoomUpdate(row.room_id);
        });
      }

      const expiredAnswer = this.db
        .prepare(`
          SELECT room_id FROM live_room_state
          WHERE phase = 'QUESTION_ACTIVE' AND answer_deadline_at IS NOT NULL AND answer_deadline_at <= ?
        `)
        .all(now) as { room_id: string }[];

      for (const row of expiredAnswer) {
        await this.withRoomLock(row.room_id, () => {
          const checkNow = Date.now();
          let changed = false;
          this.runTransaction(() => {
            const stateRow = this.db.prepare('SELECT * FROM live_room_state WHERE room_id = ?').get(row.room_id) as Record<string, unknown> | undefined;
            if (!stateRow) return;
            const state = this.mapLiveState(stateRow);
            if (state.phase === 'QUESTION_ACTIVE' && state.answerDeadlineAt !== null && state.answerDeadlineAt <= checkNow) {
              this.db
                .prepare(`
                  UPDATE live_room_state
                  SET phase = 'QUESTION_TIMEOUT', answer_remaining_ms = 0, version = version + 1, updated_at = ?
                  WHERE room_id = ?
                `)
                .run(checkNow, row.room_id);
              changed = true;
            }
          });
          if (changed) this.emitRoomUpdate(row.room_id);
        });
      }
    } catch (err) {
      console.error('Timer tick error:', err);
    } finally {
      this.isTicking = false;
    }
  }

  public exportRoomResultsCsv(roomId: string, hostUid: string): { filename: string; csv: string } {
    const snap = this.getHostRoomSnapshot(roomId);
    if (!snap.room.isDemo && snap.room.hostUid !== hostUid) {
      throw new EngineError('Unauthorized', 403);
    }
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };

    const lines: string[] = [];
    lines.push(['SECTION', 'TECH AUCTION — FINAL EVENT RESULTS', snap.room.name, snap.room.code].map(esc).join(','));
    lines.push(['Rank', 'Team Name', 'Tie Status', 'Points', 'Remaining Coins', 'Items Won', 'Correct Answers', 'Incorrect Answers', 'Total Bids'].map(esc).join(','));
    for (const t of snap.teams) {
      lines.push(
        [t.rank, t.name, t.isTied ? 'TIE' : '', t.points, t.coins, t.itemsWon, t.correctAnswers, t.incorrectAnswers, t.totalBids]
          .map(esc)
          .join(',')
      );
    }
    lines.push('');
    lines.push(['Item Name', 'Winning Team', 'Winning Bid', 'Answer Result', 'Points Awarded', 'Coins Deducted', 'Question', 'Correct Answer', 'Host Action Time'].map(esc).join(','));
    for (const h of snap.history) {
      lines.push(
        [
          h.itemName,
          h.winningTeamName || 'No Bids',
          h.winningBid,
          h.answerResult,
          h.pointsAwarded,
          h.coinsDeducted,
          h.question,
          h.correctAnswer,
          new Date(h.hostActionTime).toISOString(),
        ]
          .map(esc)
          .join(',')
      );
    }

    return {
      filename: `tech-auction-${snap.room.code.toLowerCase()}-results.csv`,
      csv: lines.join('\n'),
    };
  }
}