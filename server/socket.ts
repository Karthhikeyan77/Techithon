import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import { verifyHostTokenString, verifyTeamToken } from './auth.ts';
import { AuctionEngine, EngineError } from './auctionEngine.ts';
import { placeBidSchema } from './validation.ts';

interface SocketAuthData {
  role: 'host' | 'team' | 'audience';
  roomId: string;
  teamId?: string;
  hostUid?: string;
}

export function attachSocketServer(httpServer: HttpServer, engine: AuctionEngine): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    pingInterval: 15000,
    pingTimeout: 10000,
  });

  engine.setBroadcastCallback((roomId, hostSnap, publicSnap) => {
    io.to(`room:${roomId}:host`).emit('room:state', hostSnap);
    io.to(`room:${roomId}:public`).emit('room:state', publicSnap);
  });

  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const role = auth.role as string;

      if (role === 'host') {
        const token = String(auth.token || '');
        const roomId = String(auth.roomId || '');
        if (!token || !roomId) return next(new Error('Missing host credentials or roomId'));
        const hostUser = await verifyHostTokenString(token);
        const room = engine.getRoomById(roomId);
        if (!room) return next(new Error('Room not found'));
        if (!room.isDemo && room.hostUid !== hostUser.uid) {
          return next(new Error('Unauthorized host for this room'));
        }
        (socket.data as SocketAuthData) = { role: 'host', roomId, hostUid: hostUser.uid };
        return next();
      }

      if (role === 'team') {
        const token = String(auth.token || '');
        const session = verifyTeamToken(token);
        if (!session) return next(new Error('Invalid team session'));
        const room = engine.getRoomById(session.roomId);
        if (!room) return next(new Error('Room not found'));
        (socket.data as SocketAuthData) = { role: 'team', roomId: session.roomId, teamId: session.teamId };
        return next();
      }

      if (role === 'audience') {
        const roomCode = String(auth.roomCode || '');
        const room = engine.getRoomByCode(roomCode);
        if (!room) return next(new Error('Invalid room code'));
        (socket.data as SocketAuthData) = { role: 'audience', roomId: room.id };
        return next();
      }

      return next(new Error('Invalid socket role'));
    } catch (err) {
      return next(new Error(err instanceof Error ? err.message : 'Socket authentication failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const meta = socket.data as SocketAuthData;
    const channel = meta.role === 'host' ? `room:${meta.roomId}:host` : `room:${meta.roomId}:public`;
    void socket.join(channel);

    // Send immediate authoritative snapshot on connect/reconnect
    try {
      if (meta.role === 'host') {
        socket.emit('room:state', engine.getHostRoomSnapshot(meta.roomId));
      } else {
        socket.emit('room:state', engine.getPublicRoomSnapshot(meta.roomId));
      }
    } catch (err) {
      socket.emit('room:error', { error: err instanceof Error ? err.message : 'Failed to load room state' });
    }

    socket.on('room:sync', () => {
      try {
        if (meta.role === 'host') {
          socket.emit('room:state', engine.getHostRoomSnapshot(meta.roomId));
        } else {
          socket.emit('room:state', engine.getPublicRoomSnapshot(meta.roomId));
        }
      } catch (err) {
        socket.emit('room:error', { error: err instanceof Error ? err.message : 'Sync failed' });
      }
    });

    socket.on('bid:place', async (payload: unknown, ack?: (res: { ok: boolean; error?: string; deduplicated?: boolean; bid?: unknown }) => void) => {
      if (meta.role !== 'team' || !meta.teamId) {
        ack?.({ ok: false, error: 'Only registered teams can place bids' });
        return;
      }
      try {
        const parsed = placeBidSchema.parse(payload);
        const result = await engine.placeBid(meta.roomId, meta.teamId, parsed);
        ack?.({ ok: true, deduplicated: result.deduplicated, bid: result.bid });
      } catch (err) {
        const message = err instanceof EngineError ? err.message : err instanceof Error ? err.message : 'Bid rejected';
        ack?.({ ok: false, error: message });
      }
    });
  });

  return io;
}
