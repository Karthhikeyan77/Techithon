import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase.ts';
import type { QuestionBankItem, RoomConfig } from '../types/auction.ts';

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export async function syncRoomToFirestore(room: RoomConfig): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || room.isDemo) return;
  const safeId = sanitizeId(room.id);
  const path = `rooms/${safeId}`;
  try {
    await setDoc(doc(db, 'rooms', safeId), {
      id: safeId,
      hostUid: user.uid,
      name: room.name.slice(0, 120),
      eventName: room.eventName.slice(0, 120),
      description: (room.description || '').slice(0, 600),
      code: room.code.slice(0, 16),
      status: room.status,
      startingCoins: room.startingCoins,
      auctionDurationSec: room.auctionDurationSec,
      answerDurationSec: room.answerDurationSec,
      correctPoints: room.correctPoints,
      incorrectDeduction: room.incorrectDeduction,
      maxTeams: room.maxTeams,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // Non-fatal in case user's token expired; log structured Firestore diagnostic
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Keep auction flow uninterrupted
    }
  }
}

export async function syncQuestionBankItemToFirestore(item: QuestionBankItem): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || item.isDemo) return;
  const safeId = sanitizeId(item.id);
  const path = `questionBankItems/${safeId}`;
  try {
    await setDoc(doc(db, 'questionBankItems', safeId), {
      id: safeId,
      hostUid: user.uid,
      name: item.name.slice(0, 120),
      category: item.category.slice(0, 64),
      difficulty: item.difficulty,
      description: item.description.slice(0, 600),
      question: item.question.slice(0, 1000),
      correctAnswer: item.correctAnswer.slice(0, 1000),
      explanation: (item.explanation || '').slice(0, 1500),
      startingBid: item.startingBid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Keep UI responsive
    }
  }
}

export async function syncArchiveToFirestore(params: {
  room: RoomConfig;
  winnerTeamName?: string;
  winnerPoints?: number;
  totalTeams: number;
  totalItems: number;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || params.room.isDemo) return;
  const safeId = sanitizeId(`arch-${params.room.id}`);
  const path = `auctionArchives/${safeId}`;
  try {
    await setDoc(doc(db, 'auctionArchives', safeId), {
      id: safeId,
      hostUid: user.uid,
      roomId: sanitizeId(params.room.id),
      roomName: params.room.name.slice(0, 120),
      ...(params.winnerTeamName ? { winnerTeamName: params.winnerTeamName.slice(0, 120) } : {}),
      ...(params.winnerPoints !== undefined ? { winnerPoints: params.winnerPoints } : {}),
      totalTeams: params.totalTeams,
      totalItems: params.totalItems,
      completedAt: serverTimestamp(),
    });
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.CREATE, path);
    } catch {
      // Keep UI responsive
    }
  }
}
