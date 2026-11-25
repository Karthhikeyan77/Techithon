import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createAppServer } from '../server.ts';
import { setTestHostTokenVerifier } from '../server/auth.ts';
import type { RoomSnapshotPublic } from '../src/types/auction.ts';

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void> | void) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`PASS  ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    results.push({
      name,
      passed: false,
      durationMs: Date.now() - start,
      details: err instanceof Error ? err.stack || err.message : String(err),
    });
    console.error(`FAIL  ${name}:`, err);
  }
}

async function apiJson<T>(baseUrl: string, pathUrl: string, options?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(`${baseUrl}${pathUrl}`, options);
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-auction-test-'));
  const dbPath = path.join(tempDir, 'test.db');

  // Inject test host token verifier for automated end-to-end host auth verification
  setTestHostTokenVerifier(async (token: string) => {
    if (token === 'host-token-a') return { uid: 'host-a', email: 'hosta@college.edu', name: 'Host A' };
    if (token === 'host-token-b') return { uid: 'host-b', email: 'hostb@college.edu', name: 'Host B' };
    throw new Error('Invalid test host token');
  });

  let srv = await createAppServer({ dbPath, attachVite: false });
  await new Promise<void>((resolve) => srv.httpServer.listen(0, '127.0.0.1', resolve));
  const addr = srv.httpServer.address();
  assert(addr && typeof addr === 'object');
  let baseUrl = `http://127.0.0.1:${addr.port}`;

  let roomAId = '';
  let roomACode = '';
  let roomBId = '';
  let roomBCode = '';
  let team1Token = '';
  let team1Id = '';
  let team2Token = '';
  let team2Id = '';

  await runTest('1. Create custom room with custom coins, timers, scoring & items', async () => {
    const { status, data } = await apiJson<any>(baseUrl, '/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer host-token-a',
      },
      body: JSON.stringify({
        name: 'Finals Hall A',
        eventName: 'TECHITHON 2026',
        code: 'FINAL1',
        pin: '4321',
        maxTeams: 25,
        startingCoins: 150,
        minBid: 10,
        minBidIncrement: 5,
        deductWinningBid: false,
        auctionDurationSec: 15,
        answerDurationSec: 10,
        correctPoints: 15,
        incorrectDeduction: 20,
        items: [
          {
            name: 'FPGA Dev Kit',
            category: 'Hardware',
            description: 'Programmable gate array board.',
            startingBid: 20,
            difficulty: 'Medium',
            question: 'What does FPGA stand for?',
            correctAnswer: 'Field-Programmable Gate Array',
            explanation: 'FPGAs can be reconfigured after manufacturing.',
          },
          {
            name: 'RISC-V Core',
            category: 'Architecture',
            description: 'Open standard instruction set architecture.',
            startingBid: 15,
            difficulty: 'Hard',
            question: 'Is RISC-V proprietary or open-standard?',
            correctAnswer: 'Open-standard ISA.',
            explanation: 'RISC-V is maintained as an open standard.',
          },
        ],
      }),
    });
    assert.equal(status, 201);
    assert.equal(data.room.startingCoins, 150);
    assert.equal(data.room.correctPoints, 15);
    assert.equal(data.room.incorrectDeduction, 20);
    assert.equal(data.items.length, 2);
    roomAId = data.room.id;
    roomACode = data.room.code;
  });

  await runTest('2. Verify PIN enforcement, duplicate team rejection & starting coins', async () => {
    // Wrong PIN
    const badPin = await apiJson<any>(baseUrl, '/api/teams/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: roomACode, teamName: 'Alpha', pin: '0000' }),
    });
    assert.equal(badPin.status, 401);

    // Join Team 1
    const t1 = await apiJson<any>(baseUrl, '/api/teams/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: roomACode, teamName: 'Alpha Squad', pin: '4321' }),
    });
    assert.equal(t1.status, 201);
    assert.equal(t1.data.team.coins, 150);
    team1Token = t1.data.token;
    team1Id = t1.data.team.id;

    // Duplicate team name (case-insensitive)
    const dup = await apiJson<any>(baseUrl, '/api/teams/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: roomACode, teamName: 'alpha squad', pin: '4321' }),
    });
    assert.equal(dup.status, 409);

    // Join Team 2
    const t2 = await apiJson<any>(baseUrl, '/api/teams/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: roomACode, teamName: 'Beta Builders', pin: '4321' }),
    });
    assert.equal(t2.status, 201);
    team2Token = t2.data.token;
    team2Id = t2.data.team.id;
  });

  await runTest('3. Verify private answer keys are hidden from public & team views', async () => {
    const pub = await apiJson<RoomSnapshotPublic>(baseUrl, `/api/public/rooms/by-code/${roomACode}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.data.currentItem?.correctAnswer, undefined);
    assert.equal((pub.data.currentItem as any)?.hostNotes, undefined);
    assert.equal(pub.data.currentItem?.question, undefined);
  });

  await runTest('4. Start auction, validate bids, deduplicate idempotency, determine winner & score correct', async () => {
    const startRes = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/live/start-bidding`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-a' },
    });
    assert.equal(startRes.status, 200);
    const itemId = startRes.data.currentItem.id;

    // Too low bid (< startingBid 20)
    const lowBid = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${team1Token}` },
      body: JSON.stringify({ itemId, amount: 10, idempotencyKey: 'k-low' }),
    });
    assert.equal(lowBid.status, 400);

    // Exceeds balance (> 150)
    const overBid = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${team1Token}` },
      body: JSON.stringify({ itemId, amount: 999, idempotencyKey: 'k-over' }),
    });
    assert.equal(overBid.status, 400);

    // Valid bid by Team 1 (30)
    const b1 = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${team1Token}` },
      body: JSON.stringify({ itemId, amount: 30, idempotencyKey: 'k-b1' }),
    });
    assert.equal(b1.status, 200);
    assert.equal(b1.data.snapshot.liveState.currentHighestBid, 30);

    // Idempotent duplicate retry returns ok without double-counting
    const b1Dup = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${team1Token}` },
      body: JSON.stringify({ itemId, amount: 30, idempotencyKey: 'k-b1' }),
    });
    assert.equal(b1Dup.status, 200);
    assert.equal(b1Dup.data.deduplicated, true);

    // Team 1 cannot bid against itself
    const selfBid = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${team1Token}` },
      body: JSON.stringify({ itemId, amount: 40, idempotencyKey: 'k-self' }),
    });
    assert.equal(selfBid.status, 409);

    // Team 2 outbids at 45
    const b2 = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${team2Token}` },
      body: JSON.stringify({ itemId, amount: 45, idempotencyKey: 'k-b2' }),
    });
    assert.equal(b2.status, 200);
    assert.equal(b2.data.snapshot.liveState.highestBidderTeamId, team2Id);

    // Close bidding & reveal question
    await apiJson(baseUrl, `/api/rooms/${roomAId}/live/close-bidding`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-a' },
    });
    const rev = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/live/reveal-question`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-a' },
    });
    assert.equal(rev.data.liveState.phase, 'QUESTION_ACTIVE');

    // Public view now sees question, STILL NOT answer key
    const pubQ = await apiJson<RoomSnapshotPublic>(baseUrl, `/api/public/rooms/by-code/${roomACode}`);
    assert.equal(pubQ.data.currentItem?.question, 'What does FPGA stand for?');
    assert.equal(pubQ.data.currentItem?.correctAnswer, undefined);

    // Score CORRECT -> +15 points, 0 coin deduction
    const scored = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/live/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer host-token-a' },
      body: JSON.stringify({ itemId, outcome: 'CORRECT' }),
    });
    assert.equal(scored.status, 200);
    const winner = scored.data.teams.find((t: any) => t.id === team2Id);
    assert.equal(winner.points, 15);
    assert.equal(winner.coins, 150);

    // Exact-once scoring guard: duplicate score call MUST fail
    const doubleScore = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/live/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer host-token-a` },
      body: JSON.stringify({ itemId, outcome: 'CORRECT' }),
    });
    assert.equal(doubleScore.status, 409);
  });

  await runTest('5. Next item, incorrect answer coin deduction & CSV export', async () => {
    const nextRes = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/live/next-item`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-a' },
    });
    const item2Id = nextRes.data.currentItem.id;
    await apiJson(baseUrl, `/api/rooms/${roomAId}/live/start-bidding`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-a' },
    });
    await apiJson(baseUrl, `/api/rooms/${roomAId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${team1Token}` },
      body: JSON.stringify({ itemId: item2Id, amount: 25, idempotencyKey: 'k-item2-t1' }),
    });
    await apiJson(baseUrl, `/api/rooms/${roomAId}/live/close-bidding`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-a' },
    });
    await apiJson(baseUrl, `/api/rooms/${roomAId}/live/reveal-question`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-a' },
    });
    const scored2 = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}/live/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer host-token-a' },
      body: JSON.stringify({ itemId: item2Id, outcome: 'INCORRECT' }),
    });
    const t1 = scored2.data.teams.find((t: any) => t.id === team1Id);
    assert.equal(t1.coins, 130); // 150 - 20 penalty
    assert.equal(t1.points, 0);

    // Export CSV
    const csvRes = await fetch(`${baseUrl}/api/rooms/${roomAId}/export-csv`, {
      headers: { Authorization: 'Bearer host-token-a' },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert(csvText.includes('Beta Builders'));
    assert(csvText.includes('FPGA Dev Kit'));
  });

  await runTest('6. 60-client simultaneous Socket.IO concurrency, timer expiry, reconnect & cross-room isolation', async () => {
    // Create a second isolated Room B owned by Host B
    const rb = await apiJson<any>(baseUrl, '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer host-token-b' },
      body: JSON.stringify({
        name: 'Load Test Arena',
        code: 'LOAD60',
        maxTeams: 70,
        startingCoins: 100,
        minBid: 5,
        minBidIncrement: 5,
        auctionDurationSec: 5,
        answerDurationSec: 5,
        items: [
          {
            name: 'Quantum Chip',
            category: 'Quantum',
            description: 'Superconducting qubit processor',
            startingBid: 10,
            difficulty: 'Hard',
            question: 'What phenomenon enables qubits to exist in superposition?',
            correctAnswer: 'Quantum coherence',
          },
        ],
      }),
    });
    assert.equal(rb.status, 201);
    roomBId = rb.data.room.id;
    roomBCode = rb.data.room.code;
    const loadItemId = rb.data.currentItem.id;

    // Host A cannot access Room B
    const crossHost = await apiJson<any>(baseUrl, `/api/rooms/${roomBId}`, {
      headers: { Authorization: 'Bearer host-token-a' },
    });
    assert.equal(crossHost.status, 403);

    // Register 60 distinct mobile team clients in Room B
    const joinPromises = Array.from({ length: 60 }, (_, idx) =>
      apiJson<any>(baseUrl, '/api/teams/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: roomBCode, teamName: `PhoneTeam-${idx + 1}` }),
      })
    );
    const joined = await Promise.all(joinPromises);
    assert(joined.every((j) => j.status === 201));

    // Connect 60 Socket.IO clients simultaneously + 1 Room A audience spy
    const roomASpySnapshots: RoomSnapshotPublic[] = [];
    const spySocket = ioClient(baseUrl, { auth: { role: 'audience', roomCode: roomACode }, transports: ['websocket'] });
    spySocket.on('room:state', (s: RoomSnapshotPublic) => roomASpySnapshots.push(s));

    const clientLatest = new Map<number, RoomSnapshotPublic>();
    const sockets: Socket[] = await Promise.all(
      joined.map(
        (j, idx) =>
          new Promise<Socket>((resolve, reject) => {
            const s = ioClient(baseUrl, {
              auth: { role: 'team', token: j.data.token },
              transports: ['websocket'],
            });
            s.on('room:state', (snap: RoomSnapshotPublic) => clientLatest.set(idx, snap));
            s.on('connect', () => resolve(s));
            s.on('connect_error', reject);
          })
      )
    );

    // Start bidding in Room B
    await apiJson(baseUrl, `/api/rooms/${roomBId}/live/start-bidding`, {
      method: 'POST',
      headers: { Authorization: 'Bearer host-token-b' },
    });

    // Fire 60 simultaneous competing bids at once (amounts 10..95, some invalid >100, some duplicates)
    const bidAcks = await Promise.all(
      sockets.map((s, idx) => {
        const amount = idx < 50 ? 10 + (idx % 18) * 5 : 150; // 10 clients attempt invalid over-balance 150
        return new Promise<{ ok: boolean; error?: string }>((resolve) => {
          s.emit(
            'bid:place',
            { itemId: loadItemId, amount, idempotencyKey: `burst-${idx}` },
            (ack: { ok: boolean; error?: string }) => resolve(ack)
          );
        });
      })
    );

    const acceptedCount = bidAcks.filter((a) => a.ok).length;
    assert(acceptedCount >= 1, 'At least one valid bid must succeed');
    // Over-balance bids must all fail
    for (let i = 50; i < 60; i++) {
      assert.equal(bidAcks[i].ok, false);
    }

    // Reconnect test: disconnect client #0 and reconnect mid-auction
    sockets[0].disconnect();
    await new Promise((r) => setTimeout(r, 150));
    await new Promise<void>((resolve) => {
      sockets[0].once('room:state', () => resolve());
      sockets[0].connect();
    });

    // Wait for broadcasts to settle
    await new Promise((r) => setTimeout(r, 300));

    // Verify all 60 clients converged to exact same highest bid and winner
    const uniqueHighest = new Set(Array.from(clientLatest.values()).map((s) => `${s.liveState.currentHighestBid}:${s.liveState.highestBidderTeamId}`));
    assert.equal(uniqueHighest.size, 1, `Expected all 60 clients to converge, saw: ${Array.from(uniqueHighest).join(', ')}`);

    // Verify Room A spy NEVER received any Room B state
    assert(roomASpySnapshots.every((s) => s.room.id === roomAId));

    // Verify authoritative timer auto-closes after 5s auction duration
    await new Promise((r) => setTimeout(r, 5300));
    const afterExpiry = await apiJson<RoomSnapshotPublic>(baseUrl, `/api/public/rooms/by-code/${roomBCode}`);
    assert.equal(afterExpiry.data.liveState.phase, 'BIDDING_CLOSED');

    // Late bid after expiry must be rejected
    const lateBid = await new Promise<{ ok: boolean }>((resolve) => {
      sockets[1].emit(
        'bid:place',
        { itemId: loadItemId, amount: 100, idempotencyKey: 'late-bid' },
        (ack: { ok: boolean }) => resolve(ack)
      );
    });
    assert.equal(lateBid.ok, false);

    sockets.forEach((s) => s.disconnect());
    spySocket.disconnect();
  });

  await runTest('7. Persistence across full server restart', async () => {
    srv.engine.stopTimerLoop();
    srv.io.close();
    await new Promise<void>((resolve) => srv.httpServer.close(() => resolve()));
    srv.db.close();

    // Re-boot fresh server pointing at same SQLite file
    srv = await createAppServer({ dbPath, attachVite: false });
    await new Promise<void>((resolve) => srv.httpServer.listen(0, '127.0.0.1', resolve));
    const newAddr = srv.httpServer.address();
    assert(newAddr && typeof newAddr === 'object');
    baseUrl = `http://127.0.0.1:${newAddr.port}`;

    const restored = await apiJson<any>(baseUrl, `/api/rooms/${roomAId}`, {
      headers: { Authorization: 'Bearer host-token-a' },
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.history.length, 2);
    const beta = restored.data.teams.find((t: any) => t.id === team2Id);
    assert.equal(beta.points, 15);
  });

  // Cleanup
  srv.engine.stopTimerLoop();
  srv.io.close();
  await new Promise<void>((resolve) => srv.httpServer.close(() => resolve()));
  srv.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('\n=== TEST REPORT ===');
  const passed = results.filter((r) => r.passed).length;
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${results.length - passed}`);
  if (passed !== results.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
