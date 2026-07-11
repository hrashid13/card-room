import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { socket } from './socket';

const Game = () => {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mySocketId = socket.id;

  // Initialize from lobby
  const initialPlayers = location.state?.players || [];
  
  const [gameState, setGameState] = useState('playing');
  const [players, setPlayers] = useState(initialPlayers.map((p, idx) => ({
    ...p,
    bet: 0,
    folded: false,
    cards: []
  })));
  const [deck, setDeck] = useState([]);
  const [communityCards, setCommunityCards] = useState([]);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(0);
  const [activePlayerIndex, setActivePlayerIndex] = useState(0);
  const [dealerIndex, setDealerIndex] = useState(0);
  const [round, setRound] = useState('preflop');
  const [message, setMessage] = useState('Game starting...');
  const [firstBettor, setFirstBettor] = useState(null);
  
  const SMALL_BLIND = 10;
  const BIG_BLIND = 20;
  const processingAction = useRef(false);
  const isHost = useRef(initialPlayers[0]?.id === mySocketId);
  const gameInitialized = useRef(false);

  // Card utilities
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  const createDeck = () => {
    const newDeck = [];
    for (let suit of suits) {
      for (let rank of ranks) {
        newDeck.push({ suit, rank });
      }
    }
    return shuffleDeck(newDeck);
  };

  const shuffleDeck = (deck) => {
    const newDeck = [...deck];
    for (let i = newDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }
    return newDeck;
  };

  // Hand evaluation
  const evaluateHand = (cards) => {
    if (cards.length < 5) return { rank: 0, name: 'High Card', value: 0 };
    
    const rankValues = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const cardValues = cards.map(c => rankValues[c.rank]).sort((a, b) => b - a);
    const rankCounts = {};
    const suitCounts = {};
    
    cards.forEach(card => {
      rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
      suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    });

    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const isFlush = Object.values(suitCounts).some(count => count >= 5);
    const isStraight = checkStraight(cardValues);
    
    if (isFlush && isStraight && cardValues[0] === 14) return { rank: 10, name: 'Royal Flush', value: 10000 };
    if (isFlush && isStraight) return { rank: 9, name: 'Straight Flush', value: 9000 + cardValues[0] };
    if (counts[0] === 4) return { rank: 8, name: 'Four of a Kind', value: 8000 + cardValues[0] };
    if (counts[0] === 3 && counts[1] >= 2) return { rank: 7, name: 'Full House', value: 7000 + cardValues[0] };
    if (isFlush) return { rank: 6, name: 'Flush', value: 6000 + cardValues[0] };
    if (isStraight) return { rank: 5, name: 'Straight', value: 5000 + cardValues[0] };
    if (counts[0] === 3) return { rank: 4, name: 'Three of a Kind', value: 4000 + cardValues[0] };
    if (counts[0] === 2 && counts[1] === 2) return { rank: 3, name: 'Two Pair', value: 3000 + cardValues[0] };
    if (counts[0] === 2) return { rank: 2, name: 'One Pair', value: 2000 + cardValues[0] };
    return { rank: 1, name: 'High Card', value: 1000 + cardValues[0] };
  };

  const checkStraight = (values) => {
    const unique = [...new Set(values)].sort((a, b) => b - a);
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) return true;
    }
    if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
      return true;
    }
    return false;
  };

  const evaluatePreFlopHand = (cards) => {
    if (cards.length !== 2) return 0;
    
    const rankValues = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const card1 = rankValues[cards[0].rank];
    const card2 = rankValues[cards[1].rank];
    const suited = cards[0].suit === cards[1].suit;
    
    if (card1 === card2) {
      if (card1 >= 10) return 0.95;
      if (card1 >= 7) return 0.80;
      return 0.65;
    }
    
    const highCard = Math.max(card1, card2);
    const lowCard = Math.min(card1, card2);
    
    if (highCard === 14) {
      if (lowCard >= 10) return suited ? 0.90 : 0.85;
      if (lowCard >= 7) return suited ? 0.70 : 0.60;
      return suited ? 0.55 : 0.40;
    }
    
    if (highCard === 13) {
      if (lowCard >= 10) return suited ? 0.80 : 0.75;
      if (lowCard >= 8) return suited ? 0.65 : 0.50;
      return suited ? 0.45 : 0.30;
    }
    
    if (highCard === 12) {
      if (lowCard >= 10) return suited ? 0.75 : 0.70;
      if (lowCard >= 8) return suited ? 0.60 : 0.45;
      return suited ? 0.40 : 0.25;
    }
    
    if (highCard >= 10) {
      if (lowCard >= 9) return suited ? 0.70 : 0.60;
      if (lowCard >= 7) return suited ? 0.55 : 0.40;
      return suited ? 0.35 : 0.20;
    }
    
    const gap = Math.abs(card1 - card2);
    if (gap <= 1 && suited && lowCard >= 6) return 0.55;
    if (gap <= 1 && lowCard >= 7) return 0.45;
    
    if (suited && highCard >= 8) return 0.35;
    return 0.15;
  };

  const evaluatePostFlopHand = (playerCards, community) => {
    const allCards = [...playerCards, ...community];
    const hand = evaluateHand(allCards);
    const rankScore = hand.rank / 10;
    
    const hasFlushDraw = checkFlushDraw(allCards);
    const hasStraightDraw = checkStraightDraw(allCards);
    
    let drawBonus = 0;
    if (hasFlushDraw) drawBonus += 0.15;
    if (hasStraightDraw) drawBonus += 0.10;
    
    return Math.min(rankScore + drawBonus, 1.0);
  };

  const checkFlushDraw = (cards) => {
    const suitCounts = {};
    cards.forEach(card => {
      suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    });
    return Object.values(suitCounts).some(count => count === 4);
  };

  const checkStraightDraw = (cards) => {
    const rankValues = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const values = [...new Set(cards.map(c => rankValues[c.rank]))].sort((a, b) => a - b);
    
    for (let i = 0; i <= values.length - 4; i++) {
      if (values[i + 3] - values[i] === 3) return true;
    }
    return false;
  };

  // MULTIPLAYER: Start new hand (only host does this)
  const startNewHand = (currentPlayers = null) => {
    if (!isHost.current) return;

    // Use passed players or current state
    const playersToUse = currentPlayers || players;

    const newDeck = createDeck();
    const newPlayers = playersToUse.map(p => ({ 
      ...p, 
      cards: [], 
      bet: 0, 
      folded: false
    }));

    // Deal cards
    newPlayers.forEach(player => {
      player.cards = [newDeck.pop(), newDeck.pop()];
    });

    const smallBlindIndex = (dealerIndex + 1) % playersToUse.length;
    const bigBlindIndex = (dealerIndex + 2) % playersToUse.length;
    
    const smallBlindAmount = Math.min(SMALL_BLIND, newPlayers[smallBlindIndex].chips);
    newPlayers[smallBlindIndex].chips -= smallBlindAmount;
    newPlayers[smallBlindIndex].bet = smallBlindAmount;
    
    const bigBlindAmount = Math.min(BIG_BLIND, newPlayers[bigBlindIndex].chips);
    newPlayers[bigBlindIndex].chips -= bigBlindAmount;
    newPlayers[bigBlindIndex].bet = bigBlindAmount;
    
    const initialPot = smallBlindAmount + bigBlindAmount;
    const firstPlayer = (dealerIndex + 3) % playersToUse.length;

    const gameStateData = {
      deck: newDeck,
      players: newPlayers,
      communityCards: [],
      pot: initialPot,
      currentBet: BIG_BLIND,
      activePlayerIndex: firstPlayer,
      dealerIndex,
      round: 'preflop',
      firstBettor: bigBlindIndex,
      gameState: 'playing' // Add gameState
    };

    // Update local state
    setDeck(newDeck);
    setPlayers(newPlayers);
    setCommunityCards([]);
    setPot(initialPot);
    setCurrentBet(BIG_BLIND);
    setActivePlayerIndex(firstPlayer);
    setFirstBettor(bigBlindIndex);
    setRound('preflop');
    setGameState('playing'); // Set gameState
    setMessage(`Blinds posted. ${newPlayers[firstPlayer].name}'s turn`);
    processingAction.current = false;

    // Broadcast to all players
    socket.emit('updateGameState', { roomCode, gameState: gameStateData });
  };

  // MULTIPLAYER: Handle player action
  const handlePlayerAction = (action, raiseAmount = 0) => {
    const currentPlayer = players[activePlayerIndex];
    
    // Check if it's this player's turn
    // Allow if: it's my turn OR I'm the host and current player is a bot
    const canAct = currentPlayer.id === mySocketId || (isHost.current && currentPlayer.isBot);
    
    if (!canAct) {
      console.log('Not your turn!');
      return;
    }

    if (processingAction.current || gameState !== 'playing') return;
    processingAction.current = true;

    // For non-host human players, emit to host and update local UI
    if (!isHost.current && currentPlayer.id === mySocketId) {
      console.log(`Non-host emitting action: ${action} with amount ${raiseAmount}`);
      socket.emit('gameAction', { roomCode, action, amount: raiseAmount });
      
      // Update local UI immediately for responsiveness
      const player = players[activePlayerIndex];
      const newPlayers = [...players];
      let newPot = pot;
      let newCurrentBet = currentBet;

      if (action === 'fold') {
        newPlayers[activePlayerIndex].folded = true;
      } else if (action === 'call') {
        const callAmount = Math.min(currentBet - player.bet, player.chips);
        newPlayers[activePlayerIndex].chips -= callAmount;
        newPlayers[activePlayerIndex].bet += callAmount;
        newPot += callAmount;
      } else if (action === 'raise') {
        const totalNeeded = (currentBet - player.bet) + raiseAmount;
        const actualBet = Math.min(totalNeeded, player.chips);
        newPlayers[activePlayerIndex].chips -= actualBet;
        newPlayers[activePlayerIndex].bet += actualBet;
        newCurrentBet = newPlayers[activePlayerIndex].bet;
        newPot += actualBet;
      }

      setPlayers(newPlayers);
      setPot(newPot);
      setCurrentBet(newCurrentBet);
      setMessage('Waiting for other players...');
      
      processingAction.current = false;
      return;
    }

    // Host processes immediately (for bots and own actions)
    const player = players[activePlayerIndex];
    const newPlayers = [...players];
    let newPot = pot;
    let newCurrentBet = currentBet;

    if (action === 'fold') {
      newPlayers[activePlayerIndex].folded = true;
    } else if (action === 'call') {
      const callAmount = Math.min(currentBet - player.bet, player.chips);
      newPlayers[activePlayerIndex].chips -= callAmount;
      newPlayers[activePlayerIndex].bet += callAmount;
      newPot += callAmount;
    } else if (action === 'raise') {
      const totalNeeded = (currentBet - player.bet) + raiseAmount;
      const actualBet = Math.min(totalNeeded, player.chips);
      newPlayers[activePlayerIndex].chips -= actualBet;
      newPlayers[activePlayerIndex].bet += actualBet;
      newCurrentBet = newPlayers[activePlayerIndex].bet;
      newPot += actualBet;
      setFirstBettor(activePlayerIndex);
      firstBettorRef.current = activePlayerIndex; // Update ref immediately
    }

    setPlayers(newPlayers);
    setPot(newPot);
    setCurrentBet(newCurrentBet);

    setTimeout(() => {
      processingAction.current = false;
      
      // Only host advances the game
      if (isHost.current) {
        moveToNextPlayer(newPlayers, newCurrentBet);
      }
    }, 300);
  };

  // Create refs for current state
  const playersRef = useRef(players);
  const activePlayerIndexRef = useRef(activePlayerIndex);
  const potRef = useRef(pot);
  const currentBetRef = useRef(currentBet);
  const firstBettorRef = useRef(firstBettor);
  const roundRef = useRef(round);
  const deckRef = useRef(deck);
  const communityCardsRef = useRef(communityCards);
  const dealerIndexRef = useRef(dealerIndex);
  
  // Update refs when state changes
  useEffect(() => {
    playersRef.current = players;
    activePlayerIndexRef.current = activePlayerIndex;
    potRef.current = pot;
    currentBetRef.current = currentBet;
    firstBettorRef.current = firstBettor;
    roundRef.current = round;
    deckRef.current = deck;
    communityCardsRef.current = communityCards;
    dealerIndexRef.current = dealerIndex;
  }, [players, activePlayerIndex, pot, currentBet, firstBettor, round, deck, communityCards, dealerIndex]);

  const moveToNextPlayer = (currentPlayers, currentBetValue, currentActiveIndex = null, currentFirstBettor = null) => {
    if (!isHost.current) return;

    // Use passed index or fall back to state
    const indexToUse = currentActiveIndex !== null ? currentActiveIndex : activePlayerIndex;
    const firstBettorToUse = currentFirstBettor !== null ? currentFirstBettor : firstBettor;

    const activePlayers = currentPlayers.filter(p => !p.folded);

    if (activePlayers.length === 1) {
      endHand(currentPlayers, activePlayers[0]);
      return;
    }

    let nextIndex = (indexToUse + 1) % currentPlayers.length;
    while (currentPlayers[nextIndex].folded) {
      nextIndex = (nextIndex + 1) % currentPlayers.length;
    }

    const allBetsEqual = activePlayers.every(p => p.bet === currentBetValue || p.chips === 0);
    const backToFirstBettor = nextIndex === firstBettorToUse;

    console.log(`moveToNextPlayer: nextIndex=${nextIndex}, firstBettor=${firstBettorToUse}, allBetsEqual=${allBetsEqual}, backToFirstBettor=${backToFirstBettor}`);
    console.log(`Player bets:`, activePlayers.map(p => `${p.name}: ${p.bet}`).join(', '));

    if (allBetsEqual && backToFirstBettor) {
      console.log('Advancing to next round!');
      advanceToNextRound(currentPlayers);
    } else {
      setActivePlayerIndex(nextIndex);
      setMessage(`${currentPlayers[nextIndex].name}'s turn`);
      
      // Broadcast update - include firstBettor and actual pot value
      socket.emit('updateGameState', {
        roomCode,
        gameState: {
          activePlayerIndex: nextIndex,
          players: currentPlayers,
          pot: potRef.current, // Use actual pot, not currentBet
          currentBet: currentBetValue,
          firstBettor: firstBettorToUse
        }
      });
    }
  };

  const advanceToNextRound = (currentPlayers) => {
    if (!isHost.current) return;

    const newPlayers = currentPlayers.map(p => ({ ...p, bet: 0 }));
    setPlayers(newPlayers);
    setCurrentBet(0);
    setGameState('playing'); // Explicitly set to playing

    const currentRound = roundRef.current;
    const currentDeck = [...deckRef.current];
    const currentCommunityCards = communityCardsRef.current;
    const currentDealerIndex = dealerIndexRef.current;

    console.log(`advanceToNextRound: currentRound=${currentRound}, deckLength=${currentDeck.length}`);

    const firstPlayer = (currentDealerIndex + 1) % newPlayers.length;
    let nextActive = firstPlayer;
    while (newPlayers[nextActive].folded) {
      nextActive = (nextActive + 1) % newPlayers.length;
    }

    setActivePlayerIndex(nextActive);
    setFirstBettor(nextActive);
    
    // Update refs immediately so socket listeners see the new values
    activePlayerIndexRef.current = nextActive;
    firstBettorRef.current = nextActive;

    if (currentRound === 'preflop') {
      const flop = [currentDeck.pop(), currentDeck.pop(), currentDeck.pop()];
      setCommunityCards(flop);
      setDeck(currentDeck);
      setRound('flop');
      setMessage('Flop dealt');
      
      console.log('Dealing flop:', flop);
      
      socket.emit('updateGameState', {
        roomCode,
        gameState: {
          communityCards: flop,
          round: 'flop',
          players: newPlayers,
          currentBet: 0,
          deck: currentDeck,
          activePlayerIndex: nextActive,
          firstBettor: nextActive,
          gameState: 'playing'
        }
      });
    } else if (currentRound === 'flop') {
      const newCommunity = [...currentCommunityCards, currentDeck.pop()];
      setCommunityCards(newCommunity);
      setDeck(currentDeck);
      setRound('turn');
      setMessage('Turn dealt');
      
      socket.emit('updateGameState', {
        roomCode,
        gameState: {
          communityCards: newCommunity,
          round: 'turn',
          players: newPlayers,
          currentBet: 0,
          deck: currentDeck,
          activePlayerIndex: nextActive,
          firstBettor: nextActive,
          gameState: 'playing'
        }
      });
    } else if (currentRound === 'turn') {
      const newCommunity = [...currentCommunityCards, currentDeck.pop()];
      setCommunityCards(newCommunity);
      setDeck(currentDeck);
      setRound('river');
      setMessage('River dealt');
      
      socket.emit('updateGameState', {
        roomCode,
        gameState: {
          communityCards: newCommunity,
          round: 'river',
          players: newPlayers,
          currentBet: 0,
          deck: currentDeck,
          activePlayerIndex: nextActive,
          firstBettor: nextActive,
          gameState: 'playing'
        }
      });
    } else {
      determineWinner(newPlayers);
      return;
    }

    setMessage(`${newPlayers[nextActive].name}'s turn`);
  };

  const determineWinner = (currentPlayers) => {
    if (!isHost.current) return;

    const activePlayers = currentPlayers.filter(p => !p.folded);
    
    const results = activePlayers.map(player => {
      const allCards = [...player.cards, ...communityCards];
      const hand = evaluateHand(allCards);
      return { player, hand };
    });

    results.sort((a, b) => b.hand.value - a.hand.value);
    const winner = results[0];

    const newPlayers = [...currentPlayers];
    const winnerIndex = newPlayers.findIndex(p => p.id === winner.player.id);
    newPlayers[winnerIndex].chips += pot;
    setPlayers(newPlayers);

    setMessage(`${winner.player.name} wins with ${winner.hand.name}! (${pot} chips)`);
    setGameState('showdown');

    socket.emit('updateGameState', {
      roomCode,
      gameState: {
        gameState: 'showdown',
        winner: winner.player.id,
        winningHand: winner.hand.name,
        players: newPlayers
      }
    });

    setTimeout(() => {
      setGameState('playing');
      const nextDealerIndex = (dealerIndex + 1) % newPlayers.length;
      setDealerIndex(nextDealerIndex);
      
      // Pass the updated players directly to startNewHand
      setTimeout(() => startNewHand(newPlayers), 100);
    }, 5000);
  };

  const endHand = (currentPlayers, winner) => {
    if (!isHost.current) return;

    const newPlayers = [...currentPlayers];
    const winnerIndex = newPlayers.findIndex(p => p.id === winner.id);
    newPlayers[winnerIndex].chips += pot;
    setPlayers(newPlayers);

    setMessage(`${winner.name} wins! (${pot} chips)`);
    setGameState('showdown');

    socket.emit('updateGameState', {
      roomCode,
      gameState: {
        gameState: 'showdown',
        winner: winner.id,
        players: newPlayers
      }
    });

    setTimeout(() => {
      setGameState('playing');
      const nextDealerIndex = (dealerIndex + 1) % newPlayers.length;
      setDealerIndex(nextDealerIndex);
      
      // Pass the updated players directly to startNewHand
      setTimeout(() => startNewHand(newPlayers), 100);
    }, 3000);
  };

  // Bot AI (only host runs this)
  useEffect(() => {
    if (!isHost.current) return;
    if (gameState !== 'playing' || processingAction.current) return;

    const currentPlayer = players[activePlayerIndex];
    
    if (currentPlayer && currentPlayer.isBot && !currentPlayer.folded) {
      const timeout = setTimeout(() => {
        // Double-check it's still a bot's turn
        if (players[activePlayerIndex]?.isBot && !processingAction.current) {
          const callAmount = currentBet - currentPlayer.bet;
          
          let handStrength;
          if (communityCards.length === 0) {
            handStrength = evaluatePreFlopHand(currentPlayer.cards);
          } else {
            handStrength = evaluatePostFlopHand(currentPlayer.cards, communityCards);
          }

          const playersRemaining = players.filter(p => !p.folded).length;
          const playersAfter = players.slice(activePlayerIndex + 1).filter(p => !p.folded).length;
          const positionFactor = 1 + (playersRemaining - playersAfter) * 0.05;
          
          const adjustedStrength = Math.min(handStrength * positionFactor, 1.0);
          const stackRatio = currentPlayer.chips / Math.max(pot, 20);
          const shortStackPenalty = stackRatio < 5 ? 0.9 : 1.0;
          const finalStrength = adjustedStrength * shortStackPenalty;
          
          const randomFactor = 0.9 + Math.random() * 0.2;
          const effectiveStrength = finalStrength * randomFactor;
          
          const foldThreshold = 0.15; // Lowered from 0.25 - less folding
          const raiseThreshold = 0.65;
          
          console.log(`Bot ${currentPlayer.name} acting - strength: ${effectiveStrength.toFixed(2)}, call: ${callAmount}, chips: ${currentPlayer.chips}`);
          
          if (effectiveStrength < foldThreshold && callAmount > currentPlayer.chips * 0.2) {
            // Only fold with very weak hands and expensive calls
            handlePlayerAction('fold');
          } else if (callAmount > currentPlayer.chips * 0.8) {
            // All-in decision
            if (effectiveStrength > 0.4) { // Lowered from 0.5
              handlePlayerAction('call');
            } else {
              handlePlayerAction('fold');
            }
          } else if (effectiveStrength > raiseThreshold && callAmount < currentPlayer.chips * 0.4) {
            const raiseAmount = Math.floor(pot * (0.5 + Math.random() * 0.5));
            const actualRaise = Math.min(raiseAmount, currentPlayer.chips - callAmount);
            handlePlayerAction('raise', Math.max(actualRaise, 20));
          } else if (effectiveStrength > 0.25 || callAmount === 0) { // Lowered from 0.35
            handlePlayerAction('call');
          } else {
            // Default to call if cheap, fold if expensive
            if (callAmount < pot * 0.3) {
              handlePlayerAction('call');
            } else {
              handlePlayerAction('fold');
            }
          }
        }
      }, 1200);

      return () => clearTimeout(timeout);
    }
  }, [activePlayerIndex, gameState, players, currentBet, communityCards, pot]);

  // Listen for game state updates from server
  useEffect(() => {
    if (!location.state?.players) {
      navigate('/');
      return;
    }

    socket.on('playerAction', ({ playerId, action, amount }) => {
      console.log(`Host received playerAction: ${playerId} performed ${action} with amount ${amount}`);
      
      // If I'm the host and another player acted, I need to process it and advance the game
      if (isHost.current && playerId !== mySocketId) {
        // Use refs to get current state
        const currentPlayers = playersRef.current;
        const currentActiveIndex = activePlayerIndexRef.current;
        const currentPot = potRef.current;
        const currentCurrentBet = currentBetRef.current;
        
        const playerIndex = currentPlayers.findIndex(p => p.id === playerId);
        
        console.log(`Found player at index ${playerIndex}, activeIndex is ${currentActiveIndex}, processing: ${processingAction.current}`);
        
        // Check if it's actually this player's turn and we're not already processing
        if (playerIndex !== -1 && playerIndex === currentActiveIndex && !processingAction.current) {
          processingAction.current = true;
          
          const player = currentPlayers[playerIndex];
          const newPlayers = [...currentPlayers];
          let newPot = currentPot;
          let newCurrentBet = currentCurrentBet;

          if (action === 'fold') {
            newPlayers[playerIndex].folded = true;
          } else if (action === 'call') {
            const callAmount = Math.min(currentCurrentBet - player.bet, player.chips);
            newPlayers[playerIndex].chips -= callAmount;
            newPlayers[playerIndex].bet += callAmount;
            newPot += callAmount;
          } else if (action === 'raise') {
            const totalNeeded = (currentCurrentBet - player.bet) + amount;
            const actualBet = Math.min(totalNeeded, player.chips);
            newPlayers[playerIndex].chips -= actualBet;
            newPlayers[playerIndex].bet += actualBet;
            newCurrentBet = newPlayers[playerIndex].bet;
            newPot += actualBet;
            setFirstBettor(playerIndex);
            firstBettorRef.current = playerIndex; // Update ref immediately
          }

          console.log(`Host processing: Updated chips from ${player.chips} to ${newPlayers[playerIndex].chips}`);

          setPlayers(newPlayers);
          setPot(newPot);
          setCurrentBet(newCurrentBet);

          setTimeout(() => {
            processingAction.current = false;
            moveToNextPlayer(newPlayers, newCurrentBet, playerIndex, firstBettorRef.current);
          }, 300);
        } else if (playerIndex !== currentActiveIndex) {
          console.log(`Ignoring action from ${playerId} - not their turn (expected index ${currentActiveIndex})`);
        }
      }
    });

    socket.on('gameStateUpdated', (newGameState) => {
      console.log('Game state updated:', newGameState);
      
      // Update all relevant state from server
      if (newGameState.players) setPlayers(newGameState.players);
      if (newGameState.communityCards !== undefined) setCommunityCards(newGameState.communityCards);
      if (newGameState.pot !== undefined) setPot(newGameState.pot);
      if (newGameState.currentBet !== undefined) setCurrentBet(newGameState.currentBet);
      if (newGameState.activePlayerIndex !== undefined) setActivePlayerIndex(newGameState.activePlayerIndex);
      if (newGameState.round) setRound(newGameState.round);
      if (newGameState.gameState) setGameState(newGameState.gameState);
      if (newGameState.deck) setDeck(newGameState.deck);
      if (newGameState.firstBettor !== undefined) setFirstBettor(newGameState.firstBettor);
    });

    return () => {
      socket.off('playerAction');
      socket.off('gameStateUpdated');
    };
  }, [location.state, navigate]);

  // Start first hand (only once, only if host)
  useEffect(() => {
    if (isHost.current && players.length > 0 && !gameInitialized.current) {
      gameInitialized.current = true;
      setTimeout(() => startNewHand(), 1000);
    }
  }, [players.length]);

  const Card = ({ card, faceDown = false }) => {
    if (!card) {
      return <div className="playing-card">?</div>;
    }

    if (faceDown) {
      return <div className="playing-card playing-card--down" />;
    }

    const suitClass = (card.suit === '♥' || card.suit === '♦') ? 'suit-red' : 'suit-black';

    return (
      <div className="playing-card">
        <div className={suitClass}>{card.rank}</div>
        <div className={`card-suit ${suitClass}`}>{card.suit}</div>
      </div>
    );
  };

  const myPlayer = players.find(p => p.id === mySocketId);
  const currentPlayer = players[activePlayerIndex];
  const isMyTurn = currentPlayer?.id === mySocketId;
  const callAmount = myPlayer ? currentBet - myPlayer.bet : 0;

  // Debug logging
  console.log(`[${myPlayer?.name}] activePlayerIndex=${activePlayerIndex}, currentPlayer=${currentPlayer?.name}, isMyTurn=${isMyTurn}, gameState=${gameState}`);

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="game-header">
        <h1>Texas Hold'em — Room {roomCode}</h1>
        <p className="game-message">{message}</p>
        <p className="game-stats">
          Round: {round} &nbsp;•&nbsp; Pot: {pot} &nbsp;•&nbsp; Current Bet: {currentBet}
        </p>
      </div>

      <div className="table-felt">
        <div>
          <div className="community-label">Community Cards</div>
          <div className="community-cards">
            {communityCards.length > 0 ? (
              communityCards.map((card, idx) => <Card key={idx} card={card} />)
            ) : (
              <div className="community-empty">No community cards yet</div>
            )}
          </div>
        </div>

        <div className="seats-grid">
          {players.filter(p => p.id !== mySocketId).map((player) => {
            const playerIndex = players.indexOf(player);
            const isDealer = playerIndex === dealerIndex;
            const isActive = player === currentPlayer;

            return (
              <div
                key={player.id}
                className={`seat${isActive ? ' seat--active' : ''}${isDealer ? ' seat--dealer' : ''}`}
              >
                <div className="seat-name">
                  {player.name} {isDealer && '(D)'}
                  {player.isBot && ' (CPU)'}
                </div>
                <div className="seat-cards">
                  {player.folded ? (
                    <div className="seat-folded">Folded</div>
                  ) : player.cards && player.cards.length > 0 ? (
                    gameState === 'showdown' ? (
                      player.cards.map((card, i) => <Card key={i} card={card} />)
                    ) : (
                      [0, 1].map(i => <Card key={i} card={{ rank: '?', suit: '♠' }} faceDown={true} />)
                    )
                  ) : (
                    <div className="seat-folded">No cards</div>
                  )}
                </div>
                <div className="seat-info">
                  Chips: {player.chips} &nbsp;•&nbsp; Bet: {player.bet}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {myPlayer && (
        <div className={`my-bar${isMyTurn ? ' my-bar--active' : ''}`}>
          <div className="my-bar-name">
            {myPlayer.name} (You) {players.indexOf(myPlayer) === dealerIndex && '(D)'}
          </div>
          <div className="my-bar-row">
            <div className="my-bar-cards">
              {myPlayer.cards && myPlayer.cards.map((card, idx) => (
                <Card key={idx} card={card} />
              ))}
            </div>
            <div className="my-bar-info">
              Chips: {myPlayer.chips} &nbsp;•&nbsp; Current Bet: {myPlayer.bet}
            </div>
            <div className="my-bar-actions">
              {isMyTurn ? (
                <>
                  <button
                    onClick={() => handlePlayerAction('fold')}
                    className="btn btn--red btn--sm"
                  >
                    Fold
                  </button>
                  <button
                    onClick={() => handlePlayerAction('call')}
                    className="btn btn--blue btn--sm"
                    disabled={myPlayer.chips === 0}
                  >
                    {callAmount === 0 ? 'Check' : `Call ${callAmount}`}
                  </button>
                  <button
                    onClick={() => handlePlayerAction('raise', 20)}
                    className="btn btn--gold btn--sm"
                    disabled={myPlayer.chips <= callAmount}
                  >
                    Raise 20
                  </button>
                  <button
                    onClick={() => handlePlayerAction('raise', 50)}
                    className="btn btn--gold btn--sm"
                    disabled={myPlayer.chips <= callAmount + 20}
                  >
                    Raise 50
                  </button>
                </>
              ) : (
                <div className="waiting-note">
                  {currentPlayer ? `Waiting for ${currentPlayer.name}…` : 'Waiting…'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Game;