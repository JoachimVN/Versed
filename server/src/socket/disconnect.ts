import { Socket } from 'socket.io';
import * as gm from '../gameManager';
import { io, HOST_GRACE_MS, PLAYER_GRACE_MS, hostDisconnectTimers, playerDisconnectTimers } from './context';

export function registerDisconnectHandler(socket: Socket) {
  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;

    if (game.hostSocketId === socket.id) {
      // Give the host a grace window to reconnect before destroying the game.
      io.to(game.pin).emit('host_reconnecting');
      const timer = setTimeout(() => {
        hostDisconnectTimers.delete(game.pin);
        gm.removeSocket(socket.id);
        io.to(game.pin).emit('host_disconnected');
        gm.cleanupGame(game.pin);
      }, HOST_GRACE_MS);
      hostDisconnectTimers.set(game.pin, timer);
    } else {
      // Give the player a grace window to reconnect before removing them.
      const player = game.players.get(socket.id);
      if (!player) return;
      const sid = socket.id;
      io.to(`host:${game.pin}`).emit('player_reconnecting', { name: player.name });
      const timer = setTimeout(() => {
        playerDisconnectTimers.delete(sid);
        const removed = gm.removeSocket(sid);
        if (!removed) return; // already handled by rejoin
        io.to(`host:${removed.game.pin}`).emit('player_left', {
          players: Array.from(removed.game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak })),
        });
      }, PLAYER_GRACE_MS);
      playerDisconnectTimers.set(sid, timer);
    }
  });
}
