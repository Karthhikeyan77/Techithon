import type {
  QuestionBankItem,
  RoomConfig,
  RoomSnapshotHost,
  RoomSnapshotPublic,
  TeamRecord,
} from '../types/auction.ts';

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function apiPublicJoinInfo(code: string) {
  const res = await fetch(`/api/rooms/join-info/${encodeURIComponent(code.trim().toUpperCase())}`);
  return parseJsonOrThrow<{
    id: string;
    name: string;
    eventName: string;
    code: string;
    hasPin: boolean;
    isDemo: boolean;
    status: string;
    maxTeams: number;
  }>(res);
}

export async function apiPublicRoomByCode(code: string) {
  const res = await fetch(`/api/public/rooms/by-code/${encodeURIComponent(code.trim().toUpperCase())}`);
  return parseJsonOrThrow<RoomSnapshotPublic>(res);
}

export async function apiJoinTeam(payload: { roomCode: string; teamName: string; pin?: string }) {
  const res = await fetch('/api/teams/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<{ token: string; team: TeamRecord; snapshot: RoomSnapshotPublic }>(res);
}

export async function apiTeamMe(teamToken: string) {
  const res = await fetch('/api/teams/me', {
    headers: { Authorization: `Bearer ${teamToken}` },
  });
  return parseJsonOrThrow<{ team: TeamRecord; snapshot: RoomSnapshotPublic }>(res);
}

export async function apiPlaceBid(
  teamToken: string,
  roomId: string,
  payload: { itemId: string; amount: number; idempotencyKey: string }
) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/bid`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teamToken}`,
    },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<{ deduplicated: boolean; snapshot: RoomSnapshotPublic }>(res);
}

// --- Host API Calls ---

export async function hostFetch<T>(
  idToken: string,
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(options?.headers || {}),
    },
  });
  return parseJsonOrThrow<T>(res);
}

export async function apiHostListRooms(idToken: string) {
  return hostFetch<{ rooms: Array<RoomConfig & { itemsCount: number; teamsCount: number }> }>(
    idToken,
    '/api/rooms'
  );
}

export async function apiHostGetRoom(idToken: string, roomId: string) {
  return hostFetch<RoomSnapshotHost>(idToken, `/api/rooms/${encodeURIComponent(roomId)}`);
}

export async function apiHostCreateRoom(idToken: string, payload: unknown) {
  return hostFetch<RoomSnapshotHost>(idToken, '/api/rooms', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiHostUpdateRoom(idToken: string, roomId: string, payload: unknown) {
  return hostFetch<RoomSnapshotHost>(idToken, `/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function apiHostDeleteRoom(idToken: string, roomId: string) {
  return hostFetch<{ deleted: boolean }>(idToken, `/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'DELETE',
  });
}

export async function apiHostResetDemo(idToken: string) {
  return hostFetch<RoomSnapshotHost>(idToken, '/api/demo/reset', {
    method: 'POST',
  });
}

export async function apiHostListQuestionBank(idToken: string) {
  return hostFetch<{ items: QuestionBankItem[] }>(idToken, '/api/question-bank');
}

export async function apiHostCreateBankItem(idToken: string, payload: unknown) {
  return hostFetch<{ item: QuestionBankItem }>(idToken, '/api/question-bank', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiHostUpdateBankItem(idToken: string, itemId: string, payload: unknown) {
  return hostFetch<{ item: QuestionBankItem }>(idToken, `/api/question-bank/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function apiHostDuplicateBankItem(idToken: string, itemId: string) {
  return hostFetch<{ item: QuestionBankItem }>(idToken, `/api/question-bank/${encodeURIComponent(itemId)}/duplicate`, {
    method: 'POST',
  });
}

export async function apiHostDeleteBankItem(idToken: string, itemId: string) {
  return hostFetch<{ deleted: boolean }>(idToken, `/api/question-bank/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  });
}

export async function apiHostImportBankCsv(idToken: string, items: unknown[]) {
  return hostFetch<{ importedCount: number; items: QuestionBankItem[] }>(idToken, '/api/question-bank/import', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

// --- Sound Synthesizer (Web Audio API, no external files) ---

let audioCtx: AudioContext | null = null;

export function playAuctionCue(type: 'bid' | 'close' | 'correct' | 'incorrect') {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'bid') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'close') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.setValueAtTime(390, now + 0.12);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'correct') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.09);
      osc.frequency.setValueAtTime(783.99, now + 0.18);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.linearRampToValueAtTime(160, now + 0.25);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch {
    // Ignore audio errors on restricted devices
  }
}

// --- CSV Helpers for Question Bank ---

export function parseCsvToItems(csvText: string): Array<Record<string, unknown>> {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));

  const nameI = idx(['name', 'itemname', 'object', 'title']);
  const catI = idx(['category', 'topic']);
  const descI = idx(['description', 'desc']);
  const bidI = idx(['startingbid', 'minbid', 'bid']);
  const diffI = idx(['difficulty', 'level']);
  const qI = idx(['question', 'q']);
  const aI = idx(['correctanswer', 'answer', 'key']);
  const expI = idx(['explanation', 'details']);
  const emojiI = idx(['emoji', 'icon']);
  const notesI = idx(['hostnotes', 'notes']);

  return rows.slice(1).map((cols) => {
    const rawDiff = diffI >= 0 ? cols[diffI] : 'Medium';
    const difficulty = rawDiff === 'Easy' || rawDiff === 'Hard' ? rawDiff : 'Medium';
    return {
      name: (nameI >= 0 ? cols[nameI] : cols[0]) || 'Untitled Item',
      category: (catI >= 0 ? cols[catI] : 'Technology') || 'Technology',
      description: (descI >= 0 ? cols[descI] : 'Technology auction object') || 'Technology auction object',
      startingBid: Number(bidI >= 0 ? cols[bidI] : 10) || 10,
      difficulty,
      question: (qI >= 0 ? cols[qI] : '') || 'Explain this technology.',
      correctAnswer: (aI >= 0 ? cols[aI] : '') || 'Answer provided by host.',
      explanation: expI >= 0 ? cols[expI] || '' : '',
      emoji: emojiI >= 0 ? cols[emojiI] || '⚡' : '⚡',
      hostNotes: notesI >= 0 ? cols[notesI] || '' : '',
      imageUrl: '',
    };
  });
}

export function exportQuestionBankCsv(items: QuestionBankItem[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Name', 'Category', 'Difficulty', 'StartingBid', 'Emoji', 'Description', 'Question', 'CorrectAnswer', 'Explanation', 'HostNotes']
    .map(esc)
    .join(',');
  const body = items.map((it) =>
    [
      it.name,
      it.category,
      it.difficulty,
      it.startingBid,
      it.emoji,
      it.description,
      it.question,
      it.correctAnswer,
      it.explanation,
      it.hostNotes,
    ]
      .map(esc)
      .join(',')
  );
  return [header, ...body].join('\n');
}
