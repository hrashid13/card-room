import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket, connectSocket } from './socket';

const GAMES = [
  { id: 'holdem', name: "Texas Hold'em", icon: '♠', available: true },
  { id: 'blackjack', name: 'Blackjack', icon: '♥', available: false },
  { id: 'spades', name: 'Spades', icon: '♣', available: false }
];

const HomePage = () => {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [botCount, setBotCount] = useState(3);
  const [selectedGame, setSelectedGame] = useState('holdem');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsCreating(true);
    setError('');
    connectSocket();

    socket.emit('createRoom', { playerName: playerName.trim(), botCount });

    socket.once('roomCreated', ({ roomCode, room }) => {
      setIsCreating(false);
      navigate(`/lobby/${roomCode}`, { state: { room, isHost: true } });
    });

    socket.once('error', ({ message }) => {
      setError(message);
      setIsCreating(false);
    });
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!roomCode.trim()) {
      setError('Please enter room code');
      return;
    }

    setIsJoining(true);
    setError('');
    connectSocket();

    socket.emit('joinRoom', { roomCode: roomCode.trim().toUpperCase(), playerName: playerName.trim() });

    socket.once('roomJoined', ({ roomCode, room }) => {
      setIsJoining(false);
      navigate(`/lobby/${roomCode}`, { state: { room, isHost: false } });
    });

    socket.once('error', ({ message }) => {
      setError(message);
      setIsJoining(false);
    });
  };

  return (
    <div className="page page--center">
      <div className="panel panel--narrow">
        <h1 className="brand">The Card Room</h1>
        <p className="brand-sub">Multiplayer casino classics — play with friends or CPUs</p>
        <div className="brand-rule">♠ ♥ ♦ ♣</div>

        {error && <div className="alert-error">{error}</div>}

        <div className="field">
          <label className="field-label">Choose a Game</label>
          <div className="game-grid">
            {GAMES.map((game) => (
              <button
                key={game.id}
                type="button"
                disabled={!game.available}
                onClick={() => setSelectedGame(game.id)}
                className={`game-tile${selectedGame === game.id ? ' game-tile--active' : ''}`}
              >
                <div className="game-tile-icon">{game.icon}</div>
                <div className="game-tile-name">{game.name}</div>
                {!game.available && <span className="game-tile-badge">Coming Soon</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">Your Name</label>
          <input
            type="text"
            className="text-input"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={20}
          />
        </div>

        <div className="field">
          <label className="field-label">CPU Players: {botCount}</label>
          <input
            type="range"
            className="slider"
            min="2"
            max="5"
            value={botCount}
            onChange={(e) => setBotCount(parseInt(e.target.value))}
          />
          <div className="field-hint">
            You + {botCount} CPUs = {botCount + 1} players total
          </div>
        </div>

        <button
          onClick={handleCreateRoom}
          disabled={isCreating}
          className="btn btn--gold"
        >
          {isCreating ? 'Creating Room…' : 'Create Room'}
        </button>

        <div className="divider">OR JOIN A TABLE</div>

        <div className="field">
          <label className="field-label">Room Code</label>
          <input
            type="text"
            className="text-input"
            placeholder="Enter room code (e.g., ABC123)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
        </div>

        <button
          onClick={handleJoinRoom}
          disabled={isJoining}
          className="btn btn--green"
        >
          {isJoining ? 'Joining Room…' : 'Join Room'}
        </button>
      </div>
    </div>
  );
};

export default HomePage;
