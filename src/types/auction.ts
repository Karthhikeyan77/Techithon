export type RoomStatus = 'DRAFT' | 'READY' | 'LIVE' | 'COMPLETED';

export type AuctionPhase =
  | 'LOBBY'
  | 'ITEM_PREVIEW'
  | 'BIDDING_OPEN'
  | 'BIDDING_PAUSED'
  | 'BIDDING_CLOSED'
  | 'QUESTION_ACTIVE'
  | 'QUESTION_PAUSED'
  | 'QUESTION_TIMEOUT'
  | 'SCORED'
  | 'EVENT_ENDED';

export type ItemDifficulty = 'Easy' | 'Medium' | 'Hard';

export type AnswerResult = 'CORRECT' | 'INCORRECT' | 'UNANSWERED' | 'NO_BIDS' | 'CANCELLED';

export interface RoomConfig {
  id: string;
  hostUid: string;
  name: string;
  eventName: string;
  description: string;
  code: string;
  hasPin: boolean;
  maxTeams: number;
  startingCoins: number;
  minBid: number;
  minBidIncrement: number;
  deductWinningBid: boolean;
  allowManualCoinAdjust: boolean;
  auctionDurationSec: number;
  maxAuctionDurationSec: number;
  startingBidDefault: number;
  allowMultipleBids: boolean;
  allowRebidAfterOutbid: boolean;
  autoCloseOnExpire: boolean;
  answerDurationSec: number;
  correctPoints: number;
  incorrectDeduction: number;
  unansweredCountsIncorrect: boolean;
  allowHostOverride: boolean;
  status: RoomStatus;
  isDemo: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PublicAuctionItem {
  id: string;
  roomId: string;
  bankItemId: string | null;
  sortOrder: number;
  name: string;
  imageUrl: string;
  emoji: string;
  category: string;
  description: string;
  startingBid: number;
  difficulty: ItemDifficulty;
  timeLimitOverrideSec: number | null;
  status: string;
  // Question is only populated in public view when phase is QUESTION_ACTIVE / QUESTION_PAUSED / QUESTION_TIMEOUT / SCORED
  question?: string;
  // Answer & explanation are only populated in public view AFTER item is SCORED
  correctAnswer?: string;
  explanation?: string;
}

export interface HostAuctionItem extends PublicAuctionItem {
  question: string;
  correctAnswer: string;
  explanation: string;
  hostNotes: string;
}

export interface QuestionBankItem {
  id: string;
  hostUid: string;
  name: string;
  imageUrl: string;
  emoji: string;
  category: string;
  description: string;
  startingBid: number;
  difficulty: ItemDifficulty;
  question: string;
  correctAnswer: string;
  explanation: string;
  timeLimitOverrideSec: number | null;
  hostNotes: string;
  isDemo: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TeamRecord {
  id: string;
  roomId: string;
  name: string;
  coins: number;
  points: number;
  itemsWon: number;
  correctAnswers: number;
  incorrectAnswers: number;
  totalBids: number;
  joinedAt: number;
  isRemoved: boolean;
}

export interface LeaderboardEntry extends TeamRecord {
  rank: number;
  isTied: boolean;
}

export interface BidRecord {
  id: string;
  roomId: string;
  itemId: string;
  teamId: string;
  teamName: string;
  amount: number;
  createdAt: number;
}

export interface LastScoringResult {
  itemId: string;
  itemName: string;
  winningTeamId: string | null;
  winningTeamName: string | null;
  winningBid: number;
  answerResult: AnswerResult;
  pointsAwarded: number;
  coinsDeducted: number;
  correctAnswer: string;
  explanation: string;
  timestamp: number;
}

export interface LiveRoomState {
  roomId: string;
  currentItemId: string | null;
  phase: AuctionPhase;
  currentHighestBid: number;
  highestBidderTeamId: string | null;
  highestBidderTeamName: string | null;
  auctionStartedAt: number | null;
  auctionDeadlineAt: number | null;
  auctionRemainingMs: number | null;
  answerStartedAt: number | null;
  answerDeadlineAt: number | null;
  answerRemainingMs: number | null;
  questionRevealed: boolean;
  lastResult: LastScoringResult | null;
  version: number;
  updatedAt: number;
}

export interface AuctionHistoryEntry {
  id: string;
  roomId: string;
  itemId: string;
  itemName: string;
  winningTeamId: string | null;
  winningTeamName: string | null;
  winningBid: number;
  auctionStartTime: number | null;
  auctionEndTime: number | null;
  question: string;
  correctAnswer: string;
  answerResult: AnswerResult;
  pointsAwarded: number;
  coinsDeducted: number;
  hostActionTime: number;
}

export interface RoomSnapshotPublic {
  serverNow: number;
  room: RoomConfig;
  liveState: LiveRoomState;
  currentItem: PublicAuctionItem | null;
  itemsCount: number;
  itemIndex: number;
  teams: LeaderboardEntry[];
  recentBids: BidRecord[];
  history: AuctionHistoryEntry[];
}

export interface RoomSnapshotHost extends Omit<RoomSnapshotPublic, 'currentItem'> {
  currentItem: HostAuctionItem | null;
  items: HostAuctionItem[];
}
