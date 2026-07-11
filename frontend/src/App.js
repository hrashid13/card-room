import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './HomePage';
import Lobby from './Lobby';
import Game from './Game';
import Blackjack from './Blackjack';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/lobby/:roomCode" element={<Lobby />} />
        <Route path="/game/:roomCode" element={<Game />} />
        <Route path="/blackjack/:roomCode" element={<Blackjack />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
