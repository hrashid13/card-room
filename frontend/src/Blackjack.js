import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { socket } from './socket';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BET_OPTIONS = [10, 25, 50, 100];

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

// Ace counts as 11 when it doesn't bust the hand (soft), otherwise 1
const handValue = (cards) => {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces++;
      total += 1;
    } else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') {
      total += 10;
    } else {
      total += parseInt(c.rank, 10);
    }
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft };
};

const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;

const upcardValue = (card) => {
  if (!card) return 0;
  if (card.rank === 'A') return 11;
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') return 10;
  return parseInt(card.rank, 10);
};

// Simplified basic strategy for CPU players
const botDecision = (cards, dealerUpcard) => {
  const { total, soft } = handValue(cards);
  const up = upcardValue(dealerUpcard);

  if (soft) {
    if (total <= 17) return 'hit';
    if (total === 18 && up >= 9) return 'hit';
    return 'stand';
  }
  if (total <= 11) return 'hit';
  if (total >= 17) return 'stand';
  if (up >= 7) return 'hit';
  if (total === 12 && (up === 2 || up === 3)) return 'hit';
  return 'stand';
};

const Blackjack = () => {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mySocketId = socket.id;

  const initialPlayers = location.state?.players || [];
  const isHost = useRef(initialPlayers[0]?.id === mySocketId);

  // Render state (all clients)
  const [players, setPlayers] = useState([]);
  const [dealerCards, setDealerCards] = useState([]);
  const [dealerRevealed, setDealerRevealed] = useState(false);
  const [phase, setPhase] = useState('betting'); // betting, playing, dealer, payout
  const [activeIndex, setActiveIndex] = useState(-1);
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

  // Host: push authoritative state to local render state + broadcast to others
  const sync = () => {
    const g = game.current;
    const state = {
      players: g.players.map(p => ({ ...p, cards: [...p.cards] })),
      dealerCards: [...g.dealerCards],
      dealerRevealed: g.dealerRevealed,
      phase: g.phase,
      activeIndex: g.activeIndex,
      message: g.message
    };
    setPlayers(state.players);
    setDealerCards(state.dealerCards);
    setDealerRevealed(state.dealerRevealed);
    setPhase(state.phase);
    setActiveIndex(state.activeIndex);
    setMessage(state.message);
    socket.emit('updateGameState', { roomCode, gameState: state });
  };

  const startRound = () => {
    const g = game.current;
    g.players.forEach(p => {
      if (p.chips <= 0) p.chips = 1000; // broke players re-buy
      p.bet = 0;
      p.cards = [];
      p.status = 'betting'; // betting, waiting, playing, stood, bust, blackjack
      p.result = null;
    });
    g.deck = createDeck();
    g.dealerCards = [];
    g.dealerRevealed = false;
    g.phase = 'betting';
    g.activeIndex = -1;
    g.message = 'Place your bets';
    sync();

    // CPU players bet on staggered timers
    g.players.forEach((p, i) => {
      if (p.isBot) {
        later(() => {
          const gg = game.current;
          const bot = gg.players.find(pl => pl.id === p.id);
          if (gg.phase === 'betting' && bot && bot.status === 'betting') {
            const options = BET_OPTIONS.filter(a => a <= bot.chips);
            const amount = options.length > 0
              ? options[Math.floor(Math.random() * options.length)]
              : Math.min(10, bot.chips);
            applyBet(bot.id, amount);
          }
        }, 800 + i * 500);
      }
    });
  };

  const applyBet = (playerId, amount) => {
    const g = game.current;
    if (g.phase !== 'betting') return;
    const p = g.players.find(pl => pl.id === playerId);
    if (!p || p.status !== 'betting') return;

    const bet = Math.max(1, Math.min(amount, p.chips));
    p.bet = bet;
    p.chips -= bet;
    p.status = 'waiting';

    if (g.players.every(pl => pl.status !== 'betting')) {
      dealInitial();
    } else {
      g.message = `${p.name} bets ${bet}. Waiting for bets…`;
      sync();
    }
  };

  const dealInitial = () => {
    const g = game.current;
    g.players.forEach(p => {
      p.cards = [g.deck.pop(), g.deck.pop()];
      p.status = isNatural(p.cards) ? 'blackjack' : 'playing';
    });
    g.dealerCards = [g.deck.pop(), g.deck.pop()];
    g.phase = 'playing';
    g.activeIndex = -1;
    advanceTurn('Cards dealt.');
  };

  const advanceTurn = (prefix = '') => {
    const g = game.current;
    let next = g.activeIndex + 1;
    while (next < g.players.length && g.players[next].status !== 'playing') {
      next++;
    }
    if (next >= g.players.length) {
      dealerTurn(prefix);
      return;
    }
    g.activeIndex = next;
    g.message = `${prefix} ${g.players[next].name}'s turn`.trim();
    sync();
    if (g.players[next].isBot) scheduleBot();
  };

  const scheduleBot = () => {
    later(() => {
      const g = game.current;
      if (g.phase !== 'playing') return;
      const p = g.players[g.activeIndex];
      if (!p || !p.isBot || p.status !== 'playing') return;
      applyAction(p.id, botDecision(p.cards, g.dealerCards[0]));
    }, 1100);
  };

  const applyAction = (playerId, action) => {
    const g = game.current;
    if (g.phase !== 'playing') return;
    const p = g.players[g.activeIndex];
    if (!p || p.id !== playerId || p.status !== 'playing') return;

    if (action === 'hit') {
      p.cards.push(g.deck.pop());
      const { total } = handValue(p.cards);
      if (total > 21) {
        p.status = 'bust';
        advanceTurn(`${p.name} busts with ${total}!`);
      } else if (total === 21) {
        p.status = 'stood';
        advanceTurn(`${p.name} has 21.`);
      } else {
        g.message = `${p.name} hits (${total})`;
        sync();
        if (p.isBot) scheduleBot();
      }
    } else if (action === 'stand') {
      p.status = 'stood';
      advanceTurn(`${p.name} stands.`);
    }
  };

  const dealerTurn = (prefix = '') => {
    const g = game.current;
    g.phase = 'dealer';
    g.activeIndex = -1;
    g.dealerRevealed = true;
    g.message = `${prefix} Dealer reveals…`.trim();
    sync();

    // Dealer only draws if someone is still in the hand (stands on all 17s)
    const anyStanding = g.players.some(p => p.status === 'stood');
    const step = () => {
      const gg = game.current;
      const { total } = handValue(gg.dealerCards);
      if (anyStanding && total < 17) {
        gg.dealerCards.push(gg.deck.pop());
        gg.message = `Dealer draws (${handValue(gg.dealerCards).total})`;
        sync();
        later(step, 900);
      } else {
        settle();
      }
    };
    later(step, 900);
  };

  const settle = () => {
    const g = game.current;
    const dealerTotal = handValue(g.dealerCards).total;
    const dealerBJ = isNatural(g.dealerCards);
    const dealerBust = dealerTotal > 21;

    g.players.forEach(p => {
      if (p.status === 'bust') {
        p.result = 'lose';
      } else if (p.status === 'blackjack') {
        if (dealerBJ) {
          p.result = 'push';
          p.chips += p.bet;
        } else {
          // Natural pays 3:2
          p.result = 'blackjack';
          p.chips += p.bet + Math.floor(p.bet * 1.5);
        }
      } else {
        const total = handValue(p.cards).total;
        if (dealerBJ) {
          p.result = 'lose';
        } else if (dealerBust || total > dealerTotal) {
          p.result = 'win';
          p.chips += p.bet * 2;
        } else if (total === dealerTotal) {
          p.result = 'push';
          p.chips += p.bet;
        } else {
          p.result = 'lose';
        }
      }
    });

    g.phase = 'payout';
    g.message = dealerBust
      ? `Dealer busts with ${dealerTotal}!`
      : dealerBJ
        ? 'Dealer has Blackjack!'
        : `Dealer stands on ${dealerTotal}`;
    sync();

    later(() => startRound(), 6000);
  };

  // Socket wiring
  useEffect(() => {
    if (!location.state?.players) {
      navigate('/');
      return;
    }

    // Host processes actions relayed from other players
    socket.on('playerAction', ({ playerId, action, amount }) => {
      if (!isHost.current || playerId === mySocketId) return;
      if (action === 'bet') {
        applyBet(playerId, amount);
      } else if (action === 'hit' || action === 'stand') {
        applyAction(playerId, action);
      }
    });

    // Non-hosts render whatever the host broadcasts
    socket.on('gameStateUpdated', (state) => {
      if (state.players) setPlayers(state.players);
      if (state.dealerCards) setDealerCards(state.dealerCards);
      if (state.dealerRevealed !== undefined) setDealerRevealed(state.dealerRevealed);
      if (state.phase) setPhase(state.phase);
      if (state.activeIndex !== undefined) setActiveIndex(state.activeIndex);
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
    if (isHost.current && initialPlayers.length > 0 && !gameInitialized.current) {
      gameInitialized.current = true;
      game.current = {
        players: initialPlayers.map(p => ({
          id: p.id,
          name: p.name,
          isBot: p.isBot,
          chips: p.chips ?? 1000,
          bet: 0,
          cards: [],
          status: 'betting',
          result: null
        })),
        deck: [],
        dealerCards: [],
        dealerRevealed: false,
        phase: 'betting',
        activeIndex: -1,
        message: ''
      };
      later(() => startRound(), 1000);
    }
    // StrictMode dev double-mount clears the pending timer above on unmount,
    // so allow re-initialization when the effect re-runs
    return () => {
      gameInitialized.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Player intents (host applies directly; others relay through the server)
  const placeBet = (amount) => {
    if (isHost.current) {
      applyBet(mySocketId, amount);
    } else {
      socket.emit('gameAction', { roomCode, action: 'bet', amount });
    }
  };

  const doAction = (action) => {
    if (isHost.current) {
      applyAction(mySocketId, action);
    } else {
      socket.emit('gameAction', { roomCode, action });
    }
  };

  const Card = ({ card, faceDown = false }) => {
    if (faceDown) {
      return <div className="playing-card playing-card--down" />;
    }
    if (!card) {
      return <div className="playing-card">?</div>;
    }
    const suitClass = (card.suit === '♥' || card.suit === '♦') ? 'suit-red' : 'suit-black';
    return (
      <div className="playing-card">
        <div className={suitClass}>{card.rank}</div>
        <div className={`card-suit ${suitClass}`}>{card.suit}</div>
      </div>
    );
  };

  const TotalBadge = ({ cards }) => {
    if (!cards || cards.length === 0) return null;
    const { total, soft } = handValue(cards);
    return (
      <span className="hand-total">
        {soft ? `Soft ${total}` : total}
      </span>
    );
  };

  const ResultBadge = ({ result }) => {
    if (!result) return null;
    const labels = { win: 'WIN', lose: 'LOSE', push: 'PUSH', blackjack: 'BLACKJACK 3:2' };
    return <span className={`result-badge result-badge--${result}`}>{labels[result]}</span>;
  };

  const statusLabel = (p) => {
    if (p.status === 'betting') return 'Placing bet…';
    if (p.status === 'waiting') return `Bet: ${p.bet}`;
    if (p.status === 'bust') return `Bet: ${p.bet} — Bust`;
    if (p.status === 'blackjack') return `Bet: ${p.bet} — Blackjack!`;
    return `Bet: ${p.bet}`;
  };

  const myPlayer = players.find(p => p.id === mySocketId);
  const isMyTurn = phase === 'playing' && players[activeIndex]?.id === mySocketId;
  const amBetting = phase === 'betting' && myPlayer?.status === 'betting';

  const dealerValue = dealerCards.length > 0 && dealerRevealed
    ? handValue(dealerCards)
    : null;

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="game-header">
        <h1>Blackjack — Room {roomCode}</h1>
        <p className="game-message">{message}</p>
        <p className="game-stats">
          {phase === 'betting' && 'Betting round'}
          {phase === 'playing' && 'Players act — hit or stand'}
          {phase === 'dealer' && 'Dealer draws to 17'}
          {phase === 'payout' && 'Results — next hand starts shortly'}
        </p>
      </div>

      <div className="table-felt">
        <div className="bj-dealer">
          <div className="community-label">Dealer</div>
          <div className="community-cards">
            {dealerCards.length > 0 ? (
              dealerCards.map((card, idx) => (
                <Card
                  key={idx}
                  card={card}
                  faceDown={idx === 1 && !dealerRevealed}
                />
              ))
            ) : (
              <div className="community-empty">Waiting for bets…</div>
            )}
          </div>
          {dealerValue && (
            <div style={{ textAlign: 'center', marginTop: '8px' }}>
              <span className="hand-total">
                {dealerValue.total > 21 ? `Bust (${dealerValue.total})` : dealerValue.total}
              </span>
            </div>
          )}
        </div>

        <div className="seats-grid">
          {players.filter(p => p.id !== mySocketId).map((player, idx) => {
            const playerIndex = players.indexOf(player);
            const isActive = phase === 'playing' && playerIndex === activeIndex;
            return (
              <div key={player.id} className={`seat${isActive ? ' seat--active' : ''}`}>
                <div className="seat-name">
                  {player.name}
                  {player.isBot && ' (CPU)'}
                  {' '}<ResultBadge result={player.result} />
                </div>
                <div className="seat-cards">
                  {player.cards && player.cards.length > 0 ? (
                    <>
                      {player.cards.map((card, i) => <Card key={i} card={card} />)}
                    </>
                  ) : (
                    <div className="seat-folded">
                      {player.status === 'betting' ? 'Placing bet…' : 'No cards'}
                    </div>
                  )}
                </div>
                <div className="seat-info">
                  {player.cards && player.cards.length > 0 && (
                    <><TotalBadge cards={player.cards} />&nbsp;•&nbsp;</>
                  )}
                  Chips: {player.chips} &nbsp;•&nbsp; {statusLabel(player)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {myPlayer && (
        <div className={`my-bar${(isMyTurn || amBetting) ? ' my-bar--active' : ''}`}>
          <div className="my-bar-name">
            {myPlayer.name} (You) <ResultBadge result={myPlayer.result} />
          </div>
          <div className="my-bar-row">
            <div className="my-bar-cards">
              {myPlayer.cards && myPlayer.cards.map((card, idx) => (
                <Card key={idx} card={card} />
              ))}
            </div>
            <div className="my-bar-info">
              {myPlayer.cards && myPlayer.cards.length > 0 && (
                <><TotalBadge cards={myPlayer.cards} />&nbsp;•&nbsp;</>
              )}
              Chips: {myPlayer.chips} &nbsp;•&nbsp; {statusLabel(myPlayer)}
            </div>
            <div className="my-bar-actions">
              {amBetting ? (
                BET_OPTIONS.map(amount => (
                  <button
                    key={amount}
                    onClick={() => placeBet(amount)}
                    className="btn btn--gold btn--sm"
                    disabled={amount > myPlayer.chips}
                  >
                    Bet {amount}
                  </button>
                ))
              ) : isMyTurn ? (
                <>
                  <button onClick={() => doAction('hit')} className="btn btn--green btn--sm">
                    Hit
                  </button>
                  <button onClick={() => doAction('stand')} className="btn btn--red btn--sm">
                    Stand
                  </button>
                </>
              ) : (
                <div className="waiting-note">
                  {phase === 'payout'
                    ? 'Next hand starting…'
                    : phase === 'dealer'
                      ? 'Dealer is playing…'
                      : phase === 'betting'
                        ? 'Waiting for bets…'
                        : `Waiting for ${players[activeIndex]?.name || 'players'}…`}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Blackjack;
