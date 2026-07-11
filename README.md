# Card Room

A real-time multiplayer card game hub built with React, Node.js, and Socket.io. Create a room, share a code, and play with friends online, no accounts required.

[![Live Demo](https://img.shields.io/badge/Demo-Play_Now-green)](https://pokertexasholdem.up.railway.app/)

## Games

- **Texas Hold'em**: Full poker gameplay with preflop, flop, turn, and river betting rounds, smart CPU bots to fill empty seats, and pot-based hand evaluation
- **Blackjack**: Classic dealer-vs-players blackjack
- **Spades**: Trick-taking partnership card game

## Features

- **Real-time Multiplayer**: Play with friends online via Socket.io
- **Room-based Gameplay**: Create or join rooms with 6-digit codes
- **AI Opponents**: CPU bots available to fill empty seats (Texas Hold'em)
- **No Account Required**: Jump right in and play
- **Responsive Design**: Works on desktop and mobile

## Tech Stack

**Frontend:**
- React 18
- React Router DOM
- Socket.io Client
- CSS

**Backend:**
- Node.js
- Express.js
- Socket.io
- CORS

## Getting Started

### Prerequisites

- Node.js 14+ installed
- npm or yarn

### Installation

1. **Clone the repository**
   ```
   git clone https://github.com/hrashid13/card-room.git
   cd card-room
   ```

2. **Install Backend Dependencies**
   ```
   cd backend
   npm install
   ```

3. **Install Frontend Dependencies**
   ```
   cd ../frontend
   npm install
   ```

### Running Locally

1. **Start the Backend Server**
   ```
   cd backend
   npm run dev
   ```
   The backend will run on `http://localhost:3001`

2. **Start the Frontend** (in a new terminal)
   ```
   cd frontend
   npm start
   ```
   The frontend will run on `http://localhost:3000`

3. **Open your browser** and navigate to `http://localhost:3000`

## How to Play

### Creating a Room

1. Enter your name
2. Pick a game (Texas Hold'em, Blackjack, or Spades)
3. Click "Create Room"
4. Share the 6-digit room code with friends

### Joining a Room

1. Enter your name
2. Enter the room code
3. Click "Join Room"

### In the Lobby

- Wait for all players to join
- Players mark themselves as "Ready"
- Host starts the game when ready

## Project Structure

```
card-room/
├── backend/
│   ├── server.js         # Express + Socket.io server, game room management
│   ├── package.json
│   └── .env
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── App.js        # Main app with routing
│   │   ├── HomePage.js   # Create/join room, game selection
│   │   ├── Lobby.js      # Waiting room
│   │   ├── socket.js     # Socket.io client
│   │   └── index.js
│   ├── package.json
│   ├── .env
│   └── .env.production
├── .gitignore
└── README.md
```

## Deployment

### Deploy to Railway

#### Backend Deployment

```
cd backend
railway login
railway init
railway up
railway domain
```

Set environment variable in Railway dashboard:
- `FRONTEND_URL` = Your frontend Railway URL (without trailing slash)

#### Frontend Deployment

```
cd frontend
railway init
railway up
railway domain
```

Set environment variables in Railway dashboard:
- `REACT_APP_SOCKET_URL` = Your backend Railway URL (without trailing slash)
- `CI` = `false`
- `DISABLE_ESLINT_PLUGIN` = `true`

### Alternative: Deploy Frontend to Netlify

```
cd frontend
npm run build
# Upload the 'build' folder to Netlify
```

Set environment variable in Netlify:
- `REACT_APP_SOCKET_URL` = Your backend URL

## Environment Variables

### Backend (.env)
```
PORT=3001
FRONTEND_URL=http://localhost:3000
```

### Frontend (.env)
```
REACT_APP_SOCKET_URL=http://localhost:3001
```

### Frontend (.env.production)
```
DISABLE_ESLINT_PLUGIN=true
REACT_APP_SOCKET_URL=https://your-backend-url.up.railway.app
```

## Troubleshooting

**Connection Issues:**
- Ensure backend and frontend URLs are correctly set in `.env` files
- Remove trailing slashes from URLs
- Check CORS settings in `server.js`
- Verify firewall/network settings

**Game Stuck:**
- Refresh the page
- Check browser console for errors
- Ensure all environment variables are set

**Deployment Issues:**
- Railway: Set `CI=false` to disable strict linting
- Ensure both services are deployed and running
- Check Railway logs for errors
- Verify CORS allows your frontend URL

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Author

Hesham Rashid

- Portfolio: https://www.heshamrashid.org/
- LinkedIn: https://www.linkedin.com/in/hesham-rashid/
- Email: h.f.rashid@gmail.com

Master's in AI and Business Analytics — University of South Florida

## License

This project is licensed under the MIT License.

## Acknowledgments

- Built with React and Socket.io
- Poker hand evaluation algorithm
- Inspired by classic card games: Texas Hold'em, Blackjack, and Spades

---

**Enjoy the game!**
