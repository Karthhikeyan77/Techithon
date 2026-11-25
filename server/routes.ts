import express, { Router } from 'express';
import { z } from 'zod';
import {
  createRateLimiter,
  requireHostAuth,
  requireTeamAuth,
} from './auth.ts';
import type { AuthenticatedHostRequest, AuthenticatedTeamRequest } from './auth.ts';
import { AuctionEngine, EngineError } from './auctionEngine.ts';
import {
  coinAdjustSchema,
  createRoomSchema,
  itemInputSchema,
  joinTeamSchema,
  placeBidSchema,
  scoreActionSchema,
  updateRoomSchema,
} from './validation.ts';

function handleRouteError(res: express.Response, err: unknown) {
  if (err instanceof EngineError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: err.issues[0]?.message || 'Validation failed' });
    return;
  }
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred' });
}

export function createApiRouter(engine: AuctionEngine): Router {
  const router = Router();
  const joinLimiter = createRateLimiter({ windowMs: 15000, maxRequests: 120 });
  const bidLimiter = createRateLimiter({ windowMs: 5000, maxRequests: 150 });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, serverNow: Date.now() });
  });

  // --- Public & Audience Routes (No Answer Keys) ---

  router.get('/rooms/join-info/:code', (req, res) => {
    try {
      const room = engine.getRoomByCode(req.params.code);
      if (!room) {
        res.status(404).json({ error: 'Room not found for this code' });
        return;
      }
      res.json({
        id: room.id,
        name: room.name,
        eventName: room.eventName,
        code: room.code,
        hasPin: room.hasPin,
        isDemo: room.isDemo,
        status: room.status,
        maxTeams: room.maxTeams,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/public/rooms/by-code/:code', (req, res) => {
    try {
      const room = engine.getRoomByCode(req.params.code);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      res.json(engine.getPublicRoomSnapshot(room.id));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // --- Team Routes ---

  router.post('/teams/join', joinLimiter, async (req, res) => {
    try {
      const parsed = joinTeamSchema.parse(req.body);
      const result = await engine.joinTeam(parsed);
      res.status(201).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/teams/me', requireTeamAuth, (req: AuthenticatedTeamRequest, res) => {
    try {
      const session = req.teamSession!;
      const data = engine.getTeamMe(session.roomId, session.teamId);
      res.json(data);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/bid', requireTeamAuth, bidLimiter, async (req: AuthenticatedTeamRequest, res) => {
    try {
      const session = req.teamSession!;
      if (session.roomId !== req.params.roomId) {
        res.status(403).json({ error: 'Team token does not belong to this room' });
        return;
      }
      const parsed = placeBidSchema.parse(req.body);
      const result = await engine.placeBid(req.params.roomId, session.teamId, parsed);
      res.json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // --- Host Protected Routes ---

  router.get('/rooms', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const rooms = engine.listRoomsForHost(req.hostUser!.uid);
      res.json({ rooms });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const parsed = createRoomSchema.parse(req.body);
      const snap = engine.createRoom(req.hostUser!.uid, req.hostUser!.email, parsed);
      res.status(201).json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/rooms/:roomId', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = engine.getHostRoomSnapshot(req.params.roomId);
      if (!snap.room.isDemo && snap.room.hostUid !== req.hostUser!.uid) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/rooms/:roomId', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const parsed = updateRoomSchema.parse(req.body);
      const snap = await engine.updateRoom(req.params.roomId, req.hostUser!.uid, parsed);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.delete('/rooms/:roomId', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const result = engine.deleteRoom(req.params.roomId, req.hostUser!.uid);
      res.json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/demo/reset', requireHostAuth, async (_req, res) => {
    try {
      const snap = await engine.resetDemoRoom();
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // --- Question Bank Routes ---

  router.get('/question-bank', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const items = engine.listQuestionBank(req.hostUser!.uid);
      res.json({ items });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/question-bank', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const parsed = itemInputSchema.parse(req.body);
      const item = engine.createQuestionBankItem(req.hostUser!.uid, parsed);
      res.status(201).json({ item });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/question-bank/import', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const listSchema = z.object({ items: z.array(itemInputSchema).min(1).max(200) });
      const parsed = listSchema.parse(req.body);
      const created = parsed.items.map((it) => engine.createQuestionBankItem(req.hostUser!.uid, it));
      res.status(201).json({ importedCount: created.length, items: created });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/question-bank/:itemId', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const parsed = itemInputSchema.parse(req.body);
      const item = engine.updateQuestionBankItem(req.params.itemId, req.hostUser!.uid, parsed);
      res.json({ item });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/question-bank/:itemId/duplicate', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const item = engine.duplicateQuestionBankItem(req.params.itemId, req.hostUser!.uid);
      res.status(201).json({ item });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.delete('/question-bank/:itemId', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const result = engine.deleteQuestionBankItem(req.params.itemId, req.hostUser!.uid);
      res.json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // --- Room Item Queue Management ---

  router.post('/rooms/:roomId/items', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const parsed = itemInputSchema.parse(req.body);
      const snap = await engine.addItemToRoom(req.params.roomId, req.hostUser!.uid, parsed);
      res.status(201).json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.delete('/rooms/:roomId/items/:itemId', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.removeItemFromRoom(req.params.roomId, req.hostUser!.uid, req.params.itemId);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.put('/rooms/:roomId/items/reorder', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const body = z.object({ orderedItemIds: z.array(z.string().min(1)).min(1) }).parse(req.body);
      const snap = await engine.reorderRoomItems(req.params.roomId, req.hostUser!.uid, body.orderedItemIds);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/items/randomize', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.randomizeRoomItems(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // --- Team Management by Host ---

  router.post('/rooms/:roomId/teams/:teamId/remove', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.removeTeam(req.params.roomId, req.hostUser!.uid, req.params.teamId);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/teams/:teamId/adjust-coins', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const parsed = coinAdjustSchema.parse(req.body);
      const snap = await engine.adjustTeamCoins(req.params.roomId, req.hostUser!.uid, req.params.teamId, parsed.delta, parsed.reason);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // --- Live Auction Controls ---

  router.post('/rooms/:roomId/live/select-item', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const { itemId } = z.object({ itemId: z.string().min(1) }).parse(req.body);
      const snap = await engine.selectItem(req.params.roomId, req.hostUser!.uid, itemId);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/start-bidding', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.startBidding(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/close-bidding', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.closeBidding(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/pause', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.pauseTimer(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/resume', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.resumeTimer(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/reveal-question', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.revealQuestion(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/score', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const parsed = scoreActionSchema.parse(req.body);
      const snap = await engine.scoreAnswer(req.params.roomId, req.hostUser!.uid, parsed);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/skip-no-bids', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.recordNoBidSkip(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/restart', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.restartAuction(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/cancel', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.cancelAuction(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/next-item', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.nextItem(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/rooms/:roomId/live/end-event', requireHostAuth, async (req: AuthenticatedHostRequest, res) => {
    try {
      const snap = await engine.endEvent(req.params.roomId, req.hostUser!.uid);
      res.json(snap);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/rooms/:roomId/export-csv', requireHostAuth, (req: AuthenticatedHostRequest, res) => {
    try {
      const { filename, csv } = engine.exportRoomResultsCsv(req.params.roomId, req.hostUser!.uid);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  return router;
}
