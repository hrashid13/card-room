const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors());

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Store active rooms
const rooms = new Map();

// Generate random room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create initial bot players
const BOT_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta', 'Bot Epsilon'];

function createBot(index) {
  return {
    id: `bot-${index}`,
    name: BOT_NAMES[index] || `Bot ${index + 1}`,
    isBot: true,
    chips: 1000,
    bet: 0,
    folded: false,
    cards: [],
    ready: true
  };
}

function createBots(count) {
  const bots = [];
  for (let i = 0; i < count; i++) {
    bots.push(createBot(i));
  }
  return bots;
}

// Add a bot with an id that doesn't collide with the room's current bots
function addBotToRoom(room) {
  const existingIds = new Set(room.bots.map(b => b.id));
  let i = 0;
  while (existingIds.has(`bot-${i}`)) i++;
  room.bots.push(createBot(i));
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Create a new room
  socket.on('createRoom', ({ playerName, botCount, gameType }) => {
    const roomCode = generateRoomCode();

    const validGameType = ['holdem', 'blackjack', 'spades'].includes(gameType) ? gameType : 'holdem';

    // Spades is always exactly 4 players — empty seats are CPUs
    const validBotCount = validGameType === 'spades'
      ? 3
      : Math.max(2, Math.min(5, botCount || 3));
    const maxPlayers = validGameType === 'spades' ? 4 : 6;

    const room = {
      code: roomCode,
      host: socket.id,
      gameType: validGameType,
      players: [
        {
          id: socket.id,
          name: playerName,
          isBot: false,
          chips: 1000,
          bet: 0,
          folded: false,
          cards: [],
          ready: false
        }
      ],
      bots: createBots(validBotCount),
      maxPlayers,
      gameState: 'lobby', // lobby, playing, finished
      gameData: null
    };
    
    rooms.set(roomCode, room);
    socket.join(roomCode);
    
    console.log(`Room ${roomCode} created by ${playerName}`);
    
    socket.emit('roomCreated', {
      roomCode,
      room: getRoomData(room)
    });
  });

  // Join existing room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    if (room.gameState !== 'lobby') {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }
    
    // Check if room is full (excluding bots)
    const humanPlayers = room.players.length;
    if (humanPlayers >= room.maxPlayers) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }
    
    // Add player to room
    const newPlayer = {
      id: socket.id,
      name: playerName,
      isBot: false,
      chips: 1000,
      bet: 0,
      folded: false,
      cards: [],
      ready: false
    };
    
    room.players.push(newPlayer);
    
    // Remove one bot to make room
    if (room.bots.length > 0) {
      room.bots.pop();
    }
    
    socket.join(roomCode);
    
    console.log(`${playerName} joined room ${roomCode}`);
    
    // Notify player they joined
    socket.emit('roomJoined', {
      roomCode,
      room: getRoomData(room)
    });
    
    // Notify all players in room about new player
    io.to(roomCode).emit('roomUpdated', getRoomData(room));
  });

  // Player ready toggle
  socket.on('toggleReady', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = !player.ready;
      io.to(roomCode).emit('roomUpdated', getRoomData(room));
    }
  });

  // Start game
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    if (room.host !== socket.id) {
      socket.emit('error', { message: 'Only host can start game' });
      return;
    }
    
    // Check if all non-host human players are ready
    const nonHostPlayers = room.players.filter(p => p.id !== room.host);
    const allReady = nonHostPlayers.every(p => p.ready);
    if (!allReady && nonHostPlayers.length > 0) {
      socket.emit('error', { message: 'All players must be ready' });
      return;
    }
    
    // Spades needs exactly 4 seats — trim or pad bots to fit
    if (room.gameType === 'spades') {
      while (room.players.length + room.bots.length > 4 && room.bots.length > 0) {
        room.bots.pop();
      }
      while (room.players.length + room.bots.length < 4) {
        addBotToRoom(room);
      }
    }

    // Combine players and bots
    const allPlayers = [...room.players, ...room.bots];
    
    room.gameState = 'playing';
    room.gameData = {
      players: allPlayers,
      dealerIndex: 0,
      // Game will initialize this data
    };
    
    console.log(`Game started in room ${roomCode}`);
    
    io.to(roomCode).emit('gameStarted', {
      players: allPlayers,
      gameType: room.gameType
    });
  });

  // Game action (fold/call/raise, hit/stand, bid/play, …)
  socket.on('gameAction', ({ roomCode, action, amount, payload }) => {
    const room = rooms.get(roomCode);
    if (!room || room.gameState !== 'playing') return;

    // Broadcast action to all players in room
    io.to(roomCode).emit('playerAction', {
      playerId: socket.id,
      action,
      amount,
      payload
    });
  });

  // Update game state (sent by game host)
  socket.on('updateGameState', ({ roomCode, gameState }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.gameData = gameState;
    
    // Broadcast to all players except sender
    socket.to(roomCode).emit('gameStateUpdated', gameState);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Find and remove player from any room
    for (const [roomCode, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        console.log(`${player.name} left room ${roomCode}`);
        
        room.players.splice(playerIndex, 1);
        
        // Add a bot back if in lobby (spades always keeps 4 seats filled)
        const seatCap = room.gameType === 'spades' ? 4 : 6;
        if (room.gameState === 'lobby' && room.players.length + room.bots.length < seatCap && room.bots.length < 5) {
          addBotToRoom(room);
        }
        
        // If room is empty, delete it
        if (room.players.length === 0) {
          console.log(`Room ${roomCode} deleted (empty)`);
          rooms.delete(roomCode);
        } else {
          // If host left, assign new host
          if (room.host === socket.id) {
            room.host = room.players[0].id;
          }
          
          io.to(roomCode).emit('roomUpdated', getRoomData(room));
          io.to(roomCode).emit('playerLeft', { playerId: socket.id });
        }
        
        break;
      }
    }
  });
});

// Helper to get sanitized room data (don't send cards to everyone)
function getRoomData(room) {
  return {
    code: room.code,
    host: room.host,
    gameType: room.gameType || 'holdem',
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      ready: p.ready,
      chips: p.chips
    })),
    bots: room.bots.map(b => ({
      id: b.id,
      name: b.name,
      isBot: b.isBot,
      chips: b.chips
    })),
    maxPlayers: room.maxPlayers,
    gameState: room.gameState
  };
}

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});