import { z } from 'zod';

export function sanitizeText(input: string): string {
  return input.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

export const itemInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  bankItemId: z.string().max(128).nullable().optional(),
  name: z.string().min(1, 'Item name is required').max(120).transform(sanitizeText),
  imageUrl: z
    .string()
    .max(500000) // supports uploaded compressed data URI or URL
    .refine(
      (val) => {
        if (!val) return true;
        return (
          val.startsWith('/src/assets/') ||
          val.startsWith('https://') ||
          val.startsWith('http://') ||
          val.startsWith('data:image/png;base64,') ||
          val.startsWith('data:image/jpeg;base64,') ||
          val.startsWith('data:image/webp;base64,')
        );
      },
      { message: 'Invalid image format or URL scheme' }
    )
    .optional()
    .default(''),
  emoji: z.string().max(16).optional().default('⚡'),
  category: z.string().min(1, 'Category is required').max(64).transform(sanitizeText),
  description: z.string().min(1, 'Description is required').max(600).transform(sanitizeText),
  startingBid: z.coerce.number().int().min(0).max(100000).default(10),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).default('Medium'),
  question: z.string().min(1, 'Question is required').max(1000).transform(sanitizeText),
  correctAnswer: z.string().min(1, 'Correct answer is required').max(1000).transform(sanitizeText),
  explanation: z.string().max(1500).transform(sanitizeText).optional().default(''),
  timeLimitOverrideSec: z.coerce.number().int().min(5).max(600).nullable().optional().default(null),
  hostNotes: z.string().max(1000).transform(sanitizeText).optional().default(''),
});

export const createRoomSchema = z.object({
  name: z.string().min(1, 'Room name is required').max(120).transform(sanitizeText),
  eventName: z.string().min(1, 'Event name is required').max(120).transform(sanitizeText).default('TECHITHON – THE ULTIMATE TECH CHALLENGE'),
  description: z.string().max(600).transform(sanitizeText).optional().default(''),
  code: z
    .string()
    .min(4, 'Room code must be 4–16 characters')
    .max(16)
    .regex(/^[A-Za-z0-9-]+$/, 'Room code may only contain letters, numbers, and hyphens')
    .transform((s) => s.toUpperCase().trim())
    .optional(),
  pin: z.string().max(24).optional().default(''),
  maxTeams: z.coerce.number().int().min(2).max(200).default(30),
  startingCoins: z.coerce.number().int().min(10).max(100000).default(100),
  minBid: z.coerce.number().int().min(1).max(100000).default(5),
  minBidIncrement: z.coerce.number().int().min(1).max(10000).default(5),
  deductWinningBid: z.boolean().default(false),
  allowManualCoinAdjust: z.boolean().default(true),
  auctionDurationSec: z.coerce.number().int().min(5).max(600).default(30),
  maxAuctionDurationSec: z.coerce.number().int().min(10).max(900).default(120),
  startingBidDefault: z.coerce.number().int().min(1).max(100000).default(10),
  allowMultipleBids: z.boolean().default(true),
  allowRebidAfterOutbid: z.boolean().default(true),
  autoCloseOnExpire: z.boolean().default(true),
  answerDurationSec: z.coerce.number().int().min(5).max(600).default(20),
  correctPoints: z.coerce.number().int().min(1).max(10000).default(10),
  incorrectDeduction: z.coerce.number().int().min(0).max(10000).default(10),
  unansweredCountsIncorrect: z.boolean().default(true),
  allowHostOverride: z.boolean().default(true),
  status: z.enum(['DRAFT', 'READY']).default('READY'),
  items: z.array(itemInputSchema).max(200).optional().default([]),
});

export const updateRoomSchema = createRoomSchema
  .omit({ code: true, items: true })
  .partial()
  .extend({
    pin: z.string().max(24).optional(),
    clearPin: z.boolean().optional(),
    status: z.enum(['DRAFT', 'READY', 'LIVE', 'COMPLETED']).optional(),
  });

export const joinTeamSchema = z.object({
  roomCode: z
    .string()
    .min(3)
    .max(16)
    .transform((s) => s.toUpperCase().trim()),
  teamName: z.string().min(2, 'Team name must be at least 2 characters').max(40).transform(sanitizeText),
  pin: z.string().max(24).optional().default(''),
});

export const placeBidSchema = z.object({
  itemId: z.string().min(1).max(128),
  amount: z.coerce.number().int().positive('Bid must be a positive whole number'),
  idempotencyKey: z.string().min(4).max(128),
});

export const coinAdjustSchema = z.object({
  delta: z.coerce.number().int().min(-100000).max(100000),
  reason: z.string().max(200).transform(sanitizeText).optional().default('Host adjustment'),
});

export const scoreActionSchema = z.object({
  itemId: z.string().min(1).max(128),
  outcome: z.enum(['CORRECT', 'INCORRECT', 'UNANSWERED']),
});
