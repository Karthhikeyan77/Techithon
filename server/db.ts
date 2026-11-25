import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_ITEMS, DEMO_ROOM_CODE, DEMO_ROOM_ID } from './demoData.ts';

export function initDatabase(dbFilePath?: string): DatabaseSync {
  const targetPath = dbFilePath || path.resolve(process.cwd(), '.data', 'tech_auction.db');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS hosts (
      uid TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      host_uid TEXT NOT NULL,
      name TEXT NOT NULL,
      event_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL UNIQUE,
      pin_hash TEXT,
      max_teams INTEGER NOT NULL DEFAULT 30,
      starting_coins INTEGER NOT NULL DEFAULT 100,
      min_bid INTEGER NOT NULL DEFAULT 5,
      min_bid_increment INTEGER NOT NULL DEFAULT 5,
      deduct_winning_bid INTEGER NOT NULL DEFAULT 0,
      allow_manual_coin_adjust INTEGER NOT NULL DEFAULT 1,
      auction_duration_sec INTEGER NOT NULL DEFAULT 30,
      max_auction_duration_sec INTEGER NOT NULL DEFAULT 120,
      starting_bid_default INTEGER NOT NULL DEFAULT 10,
      allow_multiple_bids INTEGER NOT NULL DEFAULT 1,
      allow_rebid_after_outbid INTEGER NOT NULL DEFAULT 1,
      auto_close_on_expire INTEGER NOT NULL DEFAULT 1,
      answer_duration_sec INTEGER NOT NULL DEFAULT 20,
      correct_points INTEGER NOT NULL DEFAULT 10,
      incorrect_deduction INTEGER NOT NULL DEFAULT 10,
      unanswered_counts_incorrect INTEGER NOT NULL DEFAULT 1,
      allow_host_override INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'READY',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
    CREATE INDEX IF NOT EXISTS idx_rooms_host_uid ON rooms(host_uid);

    CREATE TABLE IF NOT EXISTS question_bank_items (
      id TEXT PRIMARY KEY,
      host_uid TEXT NOT NULL,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '⚡',
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      starting_bid INTEGER NOT NULL DEFAULT 10,
      difficulty TEXT NOT NULL DEFAULT 'Medium',
      question TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      time_limit_override_sec INTEGER,
      host_notes TEXT NOT NULL DEFAULT '',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_qbank_host ON question_bank_items(host_uid, is_demo);

    CREATE TABLE IF NOT EXISTS room_items (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bank_item_id TEXT,
      sort_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '⚡',
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      starting_bid INTEGER NOT NULL DEFAULT 10,
      difficulty TEXT NOT NULL DEFAULT 'Medium',
      question TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      time_limit_override_sec INTEGER,
      host_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING'
    );

    CREATE INDEX IF NOT EXISTS idx_room_items_order ON room_items(room_id, sort_order);

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      coins INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      items_won INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      incorrect_answers INTEGER NOT NULL DEFAULT 0,
      total_bids INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL,
      is_removed INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_teams_room ON teams(room_id, is_removed);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_unique_active
      ON teams(room_id, normalized_name) WHERE is_removed = 0;

    CREATE TABLE IF NOT EXISTS live_room_state (
      room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
      current_item_id TEXT,
      phase TEXT NOT NULL DEFAULT 'LOBBY',
      current_highest_bid INTEGER NOT NULL DEFAULT 0,
      highest_bidder_team_id TEXT,
      highest_bidder_team_name TEXT,
      auction_started_at INTEGER,
      auction_deadline_at INTEGER,
      auction_remaining_ms INTEGER,
      answer_started_at INTEGER,
      answer_deadline_at INTEGER,
      answer_remaining_ms INTEGER,
      question_revealed INTEGER NOT NULL DEFAULT 0,
      last_result_json TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bids (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(room_id, item_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_bids_room_item ON bids(room_id, item_id, amount DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS auction_history (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      winning_team_id TEXT,
      winning_team_name TEXT,
      winning_bid INTEGER NOT NULL DEFAULT 0,
      auction_start_time INTEGER,
      auction_end_time INTEGER,
      question TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      answer_result TEXT NOT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      coins_deducted INTEGER NOT NULL DEFAULT 0,
      host_action_time INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_room ON auction_history(room_id, host_action_time DESC);

    CREATE TABLE IF NOT EXISTS coin_adjustments (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      host_uid TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  seedDemoData(db, false);
  return db;
}

export function seedDemoData(db: DatabaseSync, forceReset = false) {
  const now = Date.now();
  const existing = db.prepare('SELECT id FROM rooms WHERE id = ?').get(DEMO_ROOM_ID) as { id: string } | undefined;

  if (existing && !forceReset) {
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (forceReset) {
      db.prepare('DELETE FROM bids WHERE room_id = ?').run(DEMO_ROOM_ID);
      db.prepare('DELETE FROM auction_history WHERE room_id = ?').run(DEMO_ROOM_ID);
      db.prepare('DELETE FROM teams WHERE room_id = ?').run(DEMO_ROOM_ID);
      db.prepare('DELETE FROM room_items WHERE room_id = ?').run(DEMO_ROOM_ID);
      db.prepare('DELETE FROM live_room_state WHERE room_id = ?').run(DEMO_ROOM_ID);
      db.prepare('DELETE FROM rooms WHERE id = ?').run(DEMO_ROOM_ID);
      db.prepare('DELETE FROM question_bank_items WHERE is_demo = 1').run();
    }

    db.prepare(`
      INSERT INTO rooms (
        id, host_uid, name, event_name, description, code, pin_hash,
        max_teams, starting_coins, min_bid, min_bid_increment, deduct_winning_bid,
        allow_manual_coin_adjust, auction_duration_sec, max_auction_duration_sec,
        starting_bid_default, allow_multiple_bids, allow_rebid_after_outbid,
        auto_close_on_expire, answer_duration_sec, correct_points, incorrect_deduction,
        unanswered_counts_incorrect, allow_host_override, status, is_demo,
        created_at, updated_at
      ) VALUES (
        ?, 'demo-system', 'TECHITHON Demo Arena (Sample)',
        'TECHITHON – THE ULTIMATE TECH CHALLENGE',
        'Sample demo room pre-loaded with 15 first-year engineering tech objects and questions. Isolated from official event rooms.',
        ?, NULL,
        60, 100, 5, 5, 0,
        1, 30, 120,
        10, 1, 1,
        1, 20, 10, 10,
        1, 1, 'LIVE', 1,
        ?, ?
      )
    `).run(DEMO_ROOM_ID, DEMO_ROOM_CODE, now, now);

    const insertBank = db.prepare(`
      INSERT OR REPLACE INTO question_bank_items (
        id, host_uid, name, image_url, emoji, category, description,
        starting_bid, difficulty, question, correct_answer, explanation,
        time_limit_override_sec, host_notes, is_demo, created_at, updated_at
      ) VALUES (?, 'demo-system', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    const insertRoomItem = db.prepare(`
      INSERT INTO room_items (
        id, room_id, bank_item_id, sort_order, name, image_url, emoji,
        category, description, starting_bid, difficulty, question,
        correct_answer, explanation, time_limit_override_sec, host_notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `);

    DEMO_ITEMS.forEach((item, index) => {
      insertBank.run(
        item.id,
        item.name,
        item.imageUrl,
        item.emoji,
        item.category,
        item.description,
        item.startingBid,
        item.difficulty,
        item.question,
        item.correctAnswer,
        item.explanation,
        item.timeLimitOverrideSec,
        item.hostNotes,
        now,
        now
      );

      insertRoomItem.run(
        `${DEMO_ROOM_ID}-item-${index + 1}`,
        DEMO_ROOM_ID,
        item.id,
        index + 1,
        item.name,
        item.imageUrl,
        item.emoji,
        item.category,
        item.description,
        item.startingBid,
        item.difficulty,
        item.question,
        item.correctAnswer,
        item.explanation,
        item.timeLimitOverrideSec,
        item.hostNotes
      );
    });

    // Seed 3 sample teams in Demo Room so Audience / Leaderboard looks alive immediately
    const insertTeam = db.prepare(`
      INSERT INTO teams (
        id, room_id, name, normalized_name, coins, points, items_won,
        correct_answers, incorrect_answers, total_bids, joined_at, is_removed
      ) VALUES (?, ?, ?, ?, 100, 0, 0, 0, 0, 0, ?, 0)
    `);
    insertTeam.run('demo-team-1', DEMO_ROOM_ID, 'Circuit Breakers', 'circuit breakers', now - 60000);
    insertTeam.run('demo-team-2', DEMO_ROOM_ID, 'Quantum Coders', 'quantum coders', now - 45000);
    insertTeam.run('demo-team-3', DEMO_ROOM_ID, 'Binary Titans', 'binary titans', now - 30000);

    // Initialize live_room_state with first item in preview
    const firstItemId = `${DEMO_ROOM_ID}-item-1`;
    db.prepare(`
      INSERT INTO live_room_state (
        room_id, current_item_id, phase, current_highest_bid,
        highest_bidder_team_id, highest_bidder_team_name,
        question_revealed, version, updated_at
      ) VALUES (?, ?, 'ITEM_PREVIEW', 0, NULL, NULL, 0, 1, ?)
    `).run(DEMO_ROOM_ID, firstItemId, now);

    db.prepare(`UPDATE room_items SET status = 'PREVIEW' WHERE id = ?`).run(firstItemId);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
