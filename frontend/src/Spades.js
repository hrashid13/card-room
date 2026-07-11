import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { socket } from './socket';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const SUIT_ORDER = { '♠': 0, '♥': 1, '♣': 2, '♦': 3 };

const WINNING_SCORE = 500;
const BOT_DELAY = 1000;
const TRICK_PAUSE = 1500;
const SCORE_PAUSE = 9000;

const rankValue = (card) => RANK_VALUES[card.rank];

const createDeck = () => {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const sortHand = (cards) =>
  [...cards].sort((a, b) =>
    SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || rankValue(b) - rankValue(a)
  );

const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;

// Cards a player may legally play given the trick so far
const legalPlays = (hand, trick, spadesBroken) => {
  if (trick.length === 0) {
    // Leading: spades can't be led until broken (unless hand is all spades)
    const nonSpades = hand.filter(c => c.suit !== '♠');
    if (!spadesBroken && nonSpades.length > 0) return nonSpades;
    return hand;
  }
  const ledSuit = trick[0].card.suit;
  const followers = hand.filter(c => c.suit === ledSuit);
  return followers.length > 0 ? followers : hand;
};

// Does `card` beat the current best card of the trick?
const beats = (card, best) => {
  if (card.suit === best.suit) return rankValue(card) > rankValue(best);
  return card.suit === '♠';
};

const trickWinnerEntry = (trick) => {
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, best.card)) best = trick[i];
  }
  return best;
};

// --- CPU heuristics ---

const botBid = (hand) => {
  let est = 0;
  const spades = hand.filter(c => c.suit === '♠');
  for (const c of hand) {
    const v = rankValue(c);
    if (c.suit === '♠') {
      if (v === 14) est += 1;
      else if (v === 13) est += 0.8;
      else if (v === 12) est += 0.6;
    } else {
      if (v === 14) est += 1;
      else if (v === 13) est += 0.7;
    }
  }
  if (spades.length > 3) est += (spades.length - 3) * 0.7;

  // Hopeless hand: go Nil
  if (est < 0.8 && spades.every(c => rankValue(c) <= 9)) return 0;
  return Math.max(1, Math.min(13, Math.round(est)));
};

const lowestOf = (cards) => cards.reduce((m, c) => (rankValue(c) < rankValue(m) ? c : m), cards[0]);
const highestOf = (cards) => cards.reduce((m, c) => (rankValue(c) > rankValue(m) ? c : m), cards[0]);

// Prefer throwing away low non-spades before low spades
const discardOf = (cards) => {
  const nonSpades = cards.filter(c => c.suit !== '♠');
  return lowestOf(nonSpades.length > 0 ? nonSpades : cards);
};

const botPlay = (player, trick, spadesBroken, playerIndex) => {
  const legal = legalPlays(player.cards, trick, spadesBroken);
  const isNil = player.bid === 0;

  if (trick.length === 0) {
    if (isNil) return lowestOf(legal);
    // Cash side-suit aces, otherwise lead low
    const aces = legal.filter(c => rankValue(c) === 14 && c.suit !== '♠');
    if (aces.length > 0) return aces[0];
    return discardOf(legal);
  }

  const bestEntry = trickWinnerEntry(trick);
  const partnerWinning = bestEntry.playerIndex % 2 === playerIndex % 2;
  const winners = legal.filter(c => beats(c, bestEntry.card));
  const losers = legal.filter(c => !beats(c, bestEntry.card));

  if (isNil) {
    // Duck: play the highest card that still loses
    if (losers.length > 0) return highestOf(losers);
    return lowestOf(legal);
  }
  if (partnerWinning && trick.length >= 2) return discardOf(legal);
  if (winners.length > 0) return lowestOf(winners);
  return discardOf(legal);
};

const Spades = () => {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mySocketId = socket.id;

  const initialPlayers = location.state?.players || [];
  const isHost = useRef(initialPlayers[0]?.id === mySocketId);

  // Render state (all clients)
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState('bidding'); // bidding, playing, scoring, gameover
  const [activeIndex, setActiveIndex] = useState(-1);
  const [currentTrick, setCurrentTrick] = useState([]);
  const [spadesBroken, setSpadesBroken] = useState(false);
  const [teamScores, setTeamScores] = useState([0, 0]);
  const [teamBags, setTeamBags] = useState([0, 0]);
  const [handNumber, setHandNumber] = useState(1);
  const [summary, setSummary] = useState(null);
  const [winnerTeam, setWinnerTeam] = useState(null);
  const [message, setMessage] = useState('Game starting…');

  // Authoritative state (host only)
  const game = useRef(null);
  const timers = useRef([]);
  const gameInitialized = useRef(false);

  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  };

  const sync = () => {
    const g = game.current;
    const state = {
      players: g.players.map(p => ({ ...p, cards: [...p.cards] })),
      phase: g.phase,
      activeIndex: g.activeIndex,
      currentTrick: g.currentTrick.map(t => ({ ...t })),
      spadesBroken: g.spadesBroken,
      teamScores: [...g.teamScores],
      teamBags: [...g.teamBags],
      handNumber: g.handNumber,
      summary: g.summary,
      winnerTeam: g.winnerTeam,
      message: g.message
    };
    setPlayers(state.players);
    setPhase(state.phase);
    setActiveIndex(state.activeIndex);
    setCurrentTrick(state.currentTrick);
    setSpadesBroken(state.spadesBroken);
    setTeamScores(state.teamScores);
    setTeamBags(state.teamBags);
    setHandNumber(state.handNumber);
    setSummary(state.summary);
    setWinnerTeam(state.winnerTeam);
    setMessage(state.message);
    socket.emit('updateGameState', { roomCode, gameState: state });
  };

  const startHand = () => {
    const g = game.current;
    const deck = createDeck();
    g.players.forEach((p, i) => {
      p.cards = sortHand(deck.slice(i * 13, i * 13 + 13));
      p.bid = null;
      p.tricks = 0;
    });
    g.currentTrick = [];
    g.spadesBroken = false;
    g.summary = null;
    g.phase = 'bidding';
    g.activeIndex = (g.dealerIndex + 1) % 4;
    g.message = `Hand ${g.handNumber} — ${g.players[g.activeIndex].name} bids first`;
    sync();
    maybeScheduleBot();
  };

  const maybeScheduleBot = () => {
    const g = game.current;
    if (g.activeIndex < 0) return;
    const p = g.players[g.activeIndex];
    if (!p || !p.isBot) return;

    if (g.phase === 'bidding') {
      later(() => {
        const gg = game.current;
        if (gg.phase !== 'bidding') return;
        const bot = gg.players[gg.activeIndex];
        if (!bot || !bot.isBot || bot.bid !== null) return;
        applyBid(bot.id, botBid(bot.cards));
      }, BOT_DELAY);
    } else if (g.phase === 'playing') {
      later(() => {
        const gg = game.current;
        if (gg.phase !== 'playing' || gg.currentTrick.length >= 4) return;
        const bot = gg.players[gg.activeIndex];
        if (!bot || !bot.isBot) return;
        applyPlay(bot.id, botPlay(bot, gg.currentTrick, gg.spadesBroken, gg.activeIndex));
      }, BOT_DELAY);
    }
  };

  const applyBid = (playerId, bid) => {
    const g = game.current;
    if (g.phase !== 'bidding') return;
    const p = g.players[g.activeIndex];
    if (!p || p.id !== playerId || p.bid !== null) return;

    p.bid = Math.max(0, Math.min(13, Math.floor(bid)));

    if (g.players.every(pl => pl.bid !== null)) {
      const t1 = g.players[0].bid + g.players[2].bid;
      const t2 = g.players[1].bid + g.players[3].bid;
      g.phase = 'playing';
      g.activeIndex = (g.dealerIndex + 1) % 4;
      g.leadIndex = g.activeIndex;
      g.message = `Bids in (${t1} vs ${t2}). ${g.players[g.activeIndex].name} leads`;
    } else {
      g.activeIndex = (g.activeIndex + 1) % 4;
      g.message = `${p.name} bids ${p.bid === 0 ? 'Nil' : p.bid}. ${g.players[g.activeIndex].name} to bid`;
    }
    sync();
    maybeScheduleBot();
  };

  const applyPlay = (playerId, card) => {
    const g = game.current;
    if (g.phase !== 'playing' || g.currentTrick.length >= 4) return;
    const idx = g.activeIndex;
    const p = g.players[idx];
    if (!p || p.id !== playerId || !card) return;

    const cardIdx = p.cards.findIndex(c => sameCard(c, card));
    if (cardIdx === -1) return;
    const played = p.cards[cardIdx];
    if (!legalPlays(p.cards, g.currentTrick, g.spadesBroken).some(c => sameCard(c, played))) return;

    p.cards.splice(cardIdx, 1);
    g.currentTrick.push({ playerIndex: idx, card: played });
    if (played.suit === '♠') g.spadesBroken = true;

    if (g.currentTrick.length === 4) {
      g.activeIndex = -1;
      g.message = 'Trick complete…';
      sync();
      later(resolveTrick, TRICK_PAUSE);
    } else {
      g.activeIndex = (idx + 1) % 4;
      g.message = `${g.players[g.activeIndex].name}'s turn`;
      sync();
      maybeScheduleBot();
    }
  };

  const resolveTrick = () => {
    const g = game.current;
    const winner = trickWinnerEntry(g.currentTrick).playerIndex;
    g.players[winner].tricks++;
    g.currentTrick = [];

    if (g.players.every(pl => pl.cards.length === 0)) {
      scoreHand(winner);
      return;
    }
    g.activeIndex = winner;
    g.leadIndex = winner;
    g.message = `${g.players[winner].name} wins the trick and leads`;
    sync();
    maybeScheduleBot();
  };

  const scoreHand = (lastWinner) => {
    const g = game.current;
    const teams = [0, 1].map(team => {
      const members = g.players.filter((_, i) => i % 2 === team);
      const bidSum = members.filter(p => p.bid > 0).reduce((s, p) => s + p.bid, 0);
      const tricks = members.reduce((s, p) => s + p.tricks, 0);
      let delta = 0;
      const notes = [];

      if (bidSum > 0) {
        if (tricks >= bidSum) {
          delta += bidSum * 10;
          const bags = tricks - bidSum;
          g.teamBags[team] += bags;
          notes.push(`Made bid of ${bidSum} (+${bidSum * 10})${bags > 0 ? `, ${bags} bag${bags > 1 ? 's' : ''}` : ''}`);
        } else {
          delta -= bidSum * 10;
          notes.push(`Missed bid of ${bidSum} (−${bidSum * 10})`);
        }
      }

      members.forEach(p => {
        if (p.bid === 0) {
          if (p.tricks === 0) {
            delta += 100;
            notes.push(`${p.name} made Nil (+100)`);
          } else {
            delta -= 100;
            notes.push(`${p.name} failed Nil (−100)`);
          }
        }
      });

      if (g.teamBags[team] >= 10) {
        delta -= 100;
        g.teamBags[team] -= 10;
        notes.push('10 bags — penalty (−100)');
      }

      g.teamScores[team] += delta;
      return { delta, notes, bidSum, tricks };
    });

    g.summary = { teams };
    g.phase = 'scoring';
    g.activeIndex = -1;
    g.message = `${g.players[lastWinner].name} takes the last trick — hand over`;
    sync();

    later(() => {
      const gg = game.current;
      const [s1, s2] = gg.teamScores;
      if ((s1 >= WINNING_SCORE || s2 >= WINNING_SCORE) && s1 !== s2) {
        gg.winnerTeam = s1 > s2 ? 0 : 1;
        gg.phase = 'gameover';
        gg.message = 'Game over!';
        sync();
      } else {
        gg.dealerIndex = (gg.dealerIndex + 1) % 4;
        gg.handNumber++;
        startHand();
      }
    }, SCORE_PAUSE);
  };

  // Socket wiring
  useEffect(() => {
    if (!location.state?.players) {
      navigate('/');
      return;
    }

    socket.on('playerAction', ({ playerId, action, amount, payload }) => {
      if (!isHost.current || playerId === mySocketId) return;
      if (action === 'bid') {
        applyBid(playerId, amount);
      } else if (action === 'play') {
        applyPlay(playerId, payload);
      }
    });

    socket.on('gameStateUpdated', (state) => {
      if (state.players) setPlayers(state.players);
      if (state.phase) setPhase(state.phase);
      if (state.activeIndex !== undefined) setActiveIndex(state.activeIndex);
      if (state.currentTrick) setCurrentTrick(state.currentTrick);
      if (state.spadesBroken !== undefined) setSpadesBroken(state.spadesBroken);
      if (state.teamScores) setTeamScores(state.teamScores);
      if (state.teamBags) setTeamBags(state.teamBags);
      if (state.handNumber) setHandNumber(state.handNumber);
      if (state.summary !== undefined) setSummary(state.summary);
      if (state.winnerTeam !== undefined) setWinnerTeam(state.winnerTeam);
      if (state.message) setMessage(state.message);
    });

    return () => {
      socket.off('playerAction');
      socket.off('gameStateUpdated');
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Host initializes the game
  useEffect(() => {
    if (isHost.current && initialPlayers.length === 4 && !gameInitialized.current) {
      gameInitialized.current = true;
      game.current = {
        players: initialPlayers.map(p => ({
          id: p.id,
          name: p.name,
          isBot: p.isBot,
          bid: null,
          tricks: 0,
          cards: []
        })),
        phase: 'bidding',
        activeIndex: -1,
        leadIndex: 0,
        dealerIndex: 0,
        currentTrick: [],
        spadesBroken: false,
        teamScores: [0, 0],
        teamBags: [0, 0],
        handNumber: 1,
        summary: null,
        winnerTeam: null,
        message: ''
      };
      later(() => startHand(), 1000);
    }
    // StrictMode dev double-mount clears the pending timer above on unmount,
    // so allow re-initialization when the effect re-runs
    return () => {
      gameInitialized.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Player intents
  const placeBid = (bid) => {
    if (isHost.current) {
      applyBid(mySocketId, bid);
    } else {
      socket.emit('gameAction', { roomCode, action: 'bid', amount: bid });
    }
  };

  const playCard = (card) => {
    if (isHost.current) {
      applyPlay(mySocketId, card);
    } else {
      socket.emit('gameAction', { roomCode, action: 'play', payload: { suit: card.suit, rank: card.rank } });
    }
  };

  const Card = ({ card, small = false }) => {
    if (!card) return null;
    const suitClass = (card.suit === '♥' || card.suit === '♦') ? 'suit-red' : 'suit-black';
    return (
      <div className={`playing-card${small ? ' playing-card--sm' : ''}`}>
        <div className={suitClass}>{card.rank}</div>
        <div className={`card-suit ${suitClass}`}>{card.suit}</div>
      </div>
    );
  };

  const bidLabel = (bid) => (bid === null ? '—' : bid === 0 ? 'Nil' : bid);

  const myIndex = players.findIndex(p => p.id === mySocketId);
  const myPlayer = myIndex >= 0 ? players[myIndex] : null;
  const isMyTurn = myIndex >= 0 && activeIndex === myIndex;
  const myLegal = myPlayer && phase === 'playing' && isMyTurn
    ? legalPlays(myPlayer.cards, currentTrick, spadesBroken)
    : [];

  // Relative seating: 0 = me (bottom), 1 = left, 2 = partner (top), 3 = right
  const seatAt = (rel) => (myIndex < 0 ? null : players[(myIndex + rel) % 4]);
  const seatIndexAt = (rel) => (myIndex < 0 ? -1 : (myIndex + rel) % 4);
  const trickCardFor = (rel) => {
    const idx = seatIndexAt(rel);
    return currentTrick.find(t => t.playerIndex === idx) || null;
  };

  const myTeam = myIndex >= 0 ? myIndex % 2 : 0;

  const teamInfo = (team) => {
    const members = players.filter((_, i) => i % 2 === team);
    return {
      names: members.map(p => p.name).join(' & '),
      bid: members.reduce((s, p) => s + (p.bid > 0 ? p.bid : 0), 0),
      hasNil: members.some(p => p.bid === 0),
      tricks: members.reduce((s, p) => s + p.tricks, 0)
    };
  };

  const OpponentSeat = ({ rel }) => {
    const p = seatAt(rel);
    if (!p) return <div />;
    const idx = seatIndexAt(rel);
    const isActive = activeIndex === idx;
    return (
      <div className={`seat seat--compact${isActive ? ' seat--active' : ''}`}>
        <div className="seat-name">
          {p.name} {p.isBot && '🤖'} {rel === 2 && '(Partner)'}
        </div>
        <div className="seat-info">
          Bid: {bidLabel(p.bid)} &nbsp;•&nbsp; Tricks: {p.tricks}
        </div>
        <div className="seat-info" style={{ marginTop: '4px' }}>
          🂠 {p.cards.length} cards
        </div>
      </div>
    );
  };

  const TrickSlot = ({ rel }) => {
    const entry = trickCardFor(rel);
    const p = seatAt(rel);
    return (
      <div className="trick-slot">
        {entry ? <Card card={entry.card} small /> : <div className="trick-slot-empty" />}
        <div className="trick-slot-label">{rel === 0 ? 'You' : p?.name}</div>
      </div>
    );
  };

  if (!myPlayer && players.length > 0) {
    // Shouldn't happen (all humans are seated), but don't render a broken table
    return (
      <div className="page page--center">
        <div className="panel panel--narrow">
          <p style={{ textAlign: 'center', margin: 0 }}>Connecting to table…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="game-header">
        <h1>Spades — Room {roomCode}</h1>
        <p className="game-message">{message}</p>
        <p className="game-stats">
          Hand {handNumber} &nbsp;•&nbsp; First to {WINNING_SCORE} wins
          {phase === 'playing' && !spadesBroken && ' • Spades not yet broken'}
        </p>
      </div>

      {players.length === 4 && (
        <div className="spades-scores">
          {[0, 1].map(team => {
            const info = teamInfo(team);
            return (
              <div key={team} className={`team-panel${myTeam === team ? ' team-panel--mine' : ''}`}>
                <div className="team-panel-title">
                  {myTeam === team ? 'Your Team' : 'Opponents'} — {info.names}
                </div>
                <div className="team-panel-score">{teamScores[team]}</div>
                <div className="seat-info">
                  Bid: {info.bid}{info.hasNil ? ' + Nil' : ''} &nbsp;•&nbsp; Tricks: {info.tricks} &nbsp;•&nbsp; Bags: {teamBags[team]}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="table-felt">
        {(phase === 'scoring' || phase === 'gameover') && summary ? (
          <div className="score-summary">
            <div className="community-label">
              {phase === 'gameover' ? 'Final Score' : `Hand ${handNumber} Results`}
            </div>
            {[0, 1].map(team => {
              const info = teamInfo(team);
              return (
                <div key={team} className="score-summary-team">
                  <div className="score-summary-head">
                    {myTeam === team ? 'Your Team' : 'Opponents'} ({info.names}):
                    {' '}{summary.teams[team].delta >= 0 ? '+' : ''}{summary.teams[team].delta} → {teamScores[team]}
                  </div>
                  {summary.teams[team].notes.map((note, i) => (
                    <div key={i} className="score-summary-note">{note}</div>
                  ))}
                </div>
              );
            })}
            {phase === 'gameover' ? (
              <>
                <div className="score-summary-winner">
                  🏆 {winnerTeam === myTeam ? 'Your team wins!' : 'Opponents win!'}
                </div>
                <button className="btn btn--gold" style={{ marginTop: '14px' }} onClick={() => navigate('/')}>
                  Back to Home
                </button>
              </>
            ) : (
              <div className="score-summary-note" style={{ marginTop: '10px', textAlign: 'center' }}>
                Next hand starting shortly…
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="spades-table">
              <div className="spades-table-top">
                <OpponentSeat rel={2} />
              </div>
              <div className="spades-table-mid">
                <OpponentSeat rel={1} />
                <div className="trick-grid">
                  <div className="trick-area-top"><TrickSlot rel={2} /></div>
                  <div className="trick-area-left"><TrickSlot rel={1} /></div>
                  <div className="trick-area-right"><TrickSlot rel={3} /></div>
                  <div className="trick-area-bottom"><TrickSlot rel={0} /></div>
                </div>
                <OpponentSeat rel={3} />
              </div>
            </div>
          </>
        )}
      </div>

      {myPlayer && phase !== 'gameover' && (
        <div className={`my-bar${isMyTurn ? ' my-bar--active' : ''}`}>
          <div className="my-bar-name">
            {myPlayer.name} (You) &nbsp;•&nbsp; Bid: {bidLabel(myPlayer.bid)} &nbsp;•&nbsp; Tricks: {myPlayer.tricks}
          </div>

          {phase === 'bidding' && isMyTurn && (
            <div className="bid-grid">
              <button className="btn btn--red btn--sm" onClick={() => placeBid(0)}>Nil</button>
              {Array.from({ length: 13 }, (_, i) => i + 1).map(n => (
                <button key={n} className="btn btn--gold btn--sm" onClick={() => placeBid(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}

          {phase === 'bidding' && !isMyTurn && (
            <div className="waiting-note" style={{ marginBottom: '10px' }}>
              Waiting for {players[activeIndex]?.name || 'players'} to bid…
            </div>
          )}

          {phase === 'playing' && (
            <div className="waiting-note" style={{ marginBottom: '10px' }}>
              {isMyTurn
                ? 'Your turn — choose a card'
                : activeIndex >= 0
                  ? `Waiting for ${players[activeIndex]?.name}…`
                  : 'Resolving trick…'}
            </div>
          )}

          <div className="hand-cards">
            {myPlayer.cards.map((card, i) => {
              const playable = isMyTurn && phase === 'playing' && myLegal.some(c => sameCard(c, card));
              return (
                <button
                  key={`${card.suit}${card.rank}`}
                  className="hand-card"
                  disabled={!playable}
                  onClick={() => playCard(card)}
                  style={{ zIndex: i }}
                >
                  <Card card={card} small />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default Spades;
