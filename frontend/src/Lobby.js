import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { socket } from './socket';

const Lobby = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [room, setRoom] = useState(location.state?.room || null);
  const [isHost, setIsHost] = useState(location.state?.isHost || false);
  const [error, setError] = useState('');
  const [myPlayerId, setMyPlayerId] = useState(socket.id);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMyPlayerId(socket.id);

    // Listen for room updates
    socket.on('roomUpdated', (updatedRoom) => {
      setRoom(updatedRoom);
      setIsHost(updatedRoom.host === socket.id);
    });

    // Listen for player leaving
    socket.on('playerLeft', ({ playerId }) => {
      console.log('Player left:', playerId);
    });

    // Listen for game start — route to the screen for this room's game
    socket.on('gameStarted', ({ players, gameType }) => {
      const paths = { blackjack: 'blackjack', spades: 'spades' };
      const path = paths[gameType] || 'game';
      navigate(`/${path}/${roomCode}`, { state: { players, roomCode } });
    });

    // Listen for errors
    socket.on('error', ({ message }) => {
      setError(message);
    });

    return () => {
      socket.off('roomUpdated');
      socket.off('playerLeft');
      socket.off('gameStarted');
      socket.off('error');
    };
  }, [roomCode, navigate]);

  const handleToggleReady = () => {
    socket.emit('toggleReady', { roomCode });
  };

  const handleStartGame = () => {
    socket.emit('startGame', { roomCode });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!room) {
    return (
      <div className="page page--center">
        <div className="panel panel--narrow">
          <p style={{ textAlign: 'center', margin: 0 }}>Loading room…</p>
        </div>
      </div>
    );
  }

  const allPlayers = [...room.players, ...room.bots];
  const humanPlayers = room.players;
  const allHumansReady = humanPlayers.filter(p => p.id !== room.host).every(p => p.ready);
  const canStart = humanPlayers.length === 1 || allHumansReady; // Solo player or all others ready

  const mePlayer = humanPlayers.find(p => p.id === myPlayerId);
  const isReady = mePlayer?.ready || false;

  return (
    <div className="page">
      <div className="panel panel--wide">
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1 className="brand" style={{ fontSize: '28px' }}>Waiting Room</h1>
          <p className="brand-sub" style={{ marginBottom: '14px' }}>
            {{ blackjack: 'Blackjack', spades: 'Spades' }[room.gameType] || "Texas Hold'em"}
          </p>
          <div className="brand-rule">♠ ♥ ♦ ♣</div>
          <span className="room-code-chip">
            {roomCode}
            <button onClick={handleCopyCode} className="btn btn--gold btn--sm">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </span>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <div className="alert-info">
          {isHost ? (
            <p>You are the host. All players must ready up before you can start the game.</p>
          ) : (
            <p>Waiting for the host to start the game. Click "Ready" when you're prepared to play.</p>
          )}
        </div>

        <h3 className="section-title">
          Players ({allPlayers.length}/{room.maxPlayers || 6})
        </h3>

        {room.gameType === 'spades' && (
          <div className="field-hint" style={{ textAlign: 'left', marginBottom: '12px' }}>
            Partnerships: seats 1 &amp; 3 vs seats 2 &amp; 4 (partners sit across from each other).
          </div>
        )}

        <div className="players-grid">
          {allPlayers.map((player, seatIndex) => {
            const isMe = player.id === myPlayerId;
            const ready = player.ready || player.isBot;
            return (
              <div key={player.id} className={`player-card${isMe ? ' player-card--me' : ''}`}>
                <div className="player-card-name">
                  {player.name} {isMe && '(You)'}
                  {player.id === room.host && ' 👑'}
                </div>
                {room.gameType === 'spades' && (
                  <div className="player-card-status player-card-status--waiting">
                    Seat {seatIndex + 1} — Team {(seatIndex % 2) + 1}
                  </div>
                )}
                <div className={`player-card-status ${ready ? 'player-card-status--ready' : 'player-card-status--waiting'}`}>
                  {player.isBot ? '🤖 CPU' : player.ready ? '✅ Ready' : '⏳ Not Ready'}
                </div>
                <div className="player-card-chips">
                  {player.chips} chips
                </div>
              </div>
            );
          })}
        </div>

        <div>
          {!isHost && (
            <button
              onClick={handleToggleReady}
              className={`btn ${isReady ? 'btn--red' : 'btn--green'}`}
            >
              {isReady ? 'Not Ready' : 'Ready'}
            </button>
          )}

          {isHost && (
            <button
              onClick={handleStartGame}
              disabled={!canStart}
              className="btn btn--gold"
            >
              {canStart ? 'Start Game' : `Waiting for players to ready up (${humanPlayers.filter(p => p.ready || p.id === room.host).length}/${humanPlayers.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Lobby;
