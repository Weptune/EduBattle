"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import { Swords, Shield, Zap, Skull, Trophy } from "lucide-react";

let socket: Socket;
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export default function Home() {
  const [gameState, setGameState] = useState<'menu' | 'queue' | 'initial_discard' | 'drafting' | 'battle' | 'results'>('menu');
  const [player, setPlayer] = useState({ name: 'Player', elo: 1200, hp: 100 });
  const [opponent, setOpponent] = useState({ id: '', name: '?', elo: 1200, hp: 100 });
  const [hand, setHand] = useState<string[]>([]);
  const [matchData, setMatchData] = useState<any>(null);
  const [roundData, setRoundData] = useState<any>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<any>(null);
  const [winnerInfo, setWinnerInfo] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number>(15);
  const [myAnswer, setMyAnswer] = useState<number | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [lockedSubject, setLockedSubject] = useState<string | null>(null);

  useEffect(() => {
    const savedElo = localStorage.getItem('edubattle_elo');
    if (savedElo) {
      setPlayer(p => ({ ...p, elo: parseInt(savedElo, 10) }));
    }
  }, []);

  const playSound = (type: 'select' | 'hit' | 'damage' | 'victory') => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      const now = ctx.currentTime;
      if (type === 'select') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
      } else if (type === 'damage') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
      } else if (type === 'hit') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
      } else if (type === 'victory') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(554, now + 0.2);
        osc.frequency.setValueAtTime(659, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 1);
        osc.start(now); osc.stop(now + 1);
      }
    } catch (e) {
      console.log('Audio issue', e);
    }
  };

  useEffect(() => {
    socket = io(SOCKET_URL);

    socket.on('waiting_in_queue', () => setGameState('queue'));
    
    socket.on('match_found', (data) => {
      setOpponent(data.opponent);
      setMatchData(data.match);
      setHand(data.hand || []);
      setPlayer(p => ({ ...p, hp: 100 }));
      setSelectedCategory(null);
      setLockedSubject(null);
      setGameState('initial_discard');
    });

    socket.on('hand_updated', (data) => {
      setHand(data.hand);
    });

    socket.on('discard_phase_end', (data) => {
      setMatchData(data.match);
      setLockedSubject(null);
      setGameState('drafting');
    });

    socket.on('draft_complete', (data) => {
      setSelectedSubject(data.subject);
    });

    socket.on('round_start', (data) => {
      setRoundData(data);
      setRoundResult(null);
      setMyAnswer(null);
      setLockedSubject(null);
      setGameState('battle');
    });

    socket.on('round_result', (data) => {
      const myId = socket.id;
      if (!myId) return;

      setRoundResult(data);
      setPlayer(p => ({ ...p, hp: data.hpData[myId] }));
      setOpponent(o => {
        const oppId = Object.keys(data.hpData).find(id => id !== myId);
        return { ...o, hp: oppId ? data.hpData[oppId] : o.hp };
      });
      
      if (data.damageDealt[myId] > 0) {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        playSound('damage');
      } else {
        playSound('hit');
      }
    });

    socket.on('match_end', (data) => {
      setWinnerInfo(data);
      setGameState('results');
      if (data.winner === socket.id) playSound('victory');
      else playSound('damage');
    });

    socket.on('back_to_draft', (data) => {
      setMatchData((prev: any) => ({
        ...prev,
        draftTurn: data.draftTurn,
        currentRound: data.round
      }));
      setSelectedSubject(null);
      setSelectedCategory(null);
      setLockedSubject(null);
      setGameState('drafting');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (gameState === 'battle' && !roundResult) {
      setTimeLeft(roundData?.question?.timeLimit || 15);
      const timer = setInterval(() => {
        setTimeLeft(t => Math.max(0, t - 0.1));
      }, 100);
      return () => clearInterval(timer);
    }
  }, [gameState, roundResult, roundData]);

  const joinQueue = () => {
    if (socket) {
      socket.emit('join_queue', player);
    }
  };

  const pickSubject = (subject: string) => {
    if (matchData?.draftTurn === socket.id && !lockedSubject) {
      playSound('select');
      setLockedSubject(subject);
      socket.emit('draft_action', { subject });
    }
  };

  const submitAnswer = (answerIndex: number) => {
    if (!roundResult && myAnswer === null) {
      playSound('select');
      setMyAnswer(answerIndex);
      socket.emit('submit_answer', { answerIndex });
    }
  };

  const socketId = socket?.id;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-8 relative overflow-x-hidden">
      {/* Background visual effects */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-fuchsia-600/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <AnimatePresence mode="wait">
        {gameState === 'menu' && (
          <motion.div 
            key="menu"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="z-10 flex flex-col items-center"
          >
            <h1 className="text-6xl font-black mb-2 tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 to-blue-500 glitch-text uppercase">
              Ranked Battler
            </h1>
            <p className="text-slate-400 mb-12 text-xl font-light uppercase tracking-widest">MIT Academic Combat</p>

            <div className="bg-white/5 p-8 rounded-3xl border border-white/10 backdrop-blur-md flex flex-col items-center gap-6 w-96 neon-border">
              <div className="w-full">
                <label className="text-xs text-fuchsia-400 uppercase tracking-wider font-bold mb-2 block">Fighter ID</label>
                <input 
                  type="text" 
                  value={player.name}
                  onChange={(e) => setPlayer({ ...player, name: e.target.value })}
                  className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-white font-medium focus:outline-none focus:border-fuchsia-500 transition-colors"
                />
              </div>
              <div className="w-full flex justify-between text-sm text-slate-400 font-mono">
                <span>Current ELO</span>
                <span className="text-blue-400 font-bold">{player.elo}</span>
              </div>
              <button 
                onClick={joinQueue}
                className="w-full bg-gradient-to-r from-fuchsia-600 to-blue-600 text-white font-bold py-4 rounded-xl hover:opacity-90 active:scale-95 transition-all uppercase tracking-widest shadow-[0_0_20px_rgba(192,38,211,0.5)]"
              >
                Find Ranked Match
              </button>
              <button 
                onClick={() => {
                  if (socket) socket.emit('join_bot_queue', player);
                }}
                className="w-full bg-white/5 border border-white/20 text-white font-bold py-4 rounded-xl hover:bg-white/10 active:scale-95 transition-all uppercase tracking-widest"
              >
                Play vs AI Bot
              </button>
            </div>
          </motion.div>
        )}

        {gameState === 'queue' && (
          <motion.div
            key="queue"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="z-10 flex flex-col items-center"
          >
            <div className="w-32 h-32 border-4 border-fuchsia-500/30 border-t-fuchsia-500 rounded-full animate-spin mb-8" />
            <h2 className="text-3xl font-bold uppercase tracking-widest text-fuchsia-400">Searching...</h2>
            <p className="text-slate-400 mt-2 font-mono">Estimated wait: 0:03</p>
          </motion.div>
        )}

        {gameState === 'initial_discard' && (
          <motion.div
            key="initial_discard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="z-10 w-full max-w-5xl flex flex-col items-center gap-8"
          >
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tight glitch-text text-center">Initial Discard Phase</h2>
            {lockedSubject === 'WAITING' ? (
              <p className="text-xl text-fuchsia-400 animate-pulse">Waiting for opponent to decide...</p>
            ) : (
              <p className="text-xl text-slate-400 text-center">Select up to 1 card to discard from your hand</p>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 w-full mt-4">
              {hand.map((sub: string) => (
                <motion.button
                  key={sub}
                  whileHover={lockedSubject !== 'WAITING' ? { scale: 1.05 } : {}}
                  whileTap={lockedSubject !== 'WAITING' ? { scale: 0.95 } : {}}
                  onClick={() => {
                    if (lockedSubject !== 'WAITING') {
                      setLockedSubject(lockedSubject === sub ? null : sub);
                    }
                  }}
                  disabled={lockedSubject === 'WAITING'}
                  className={`p-4 rounded-xl border border-white/20 font-bold text-sm md:text-base transition-colors min-h-[140px] flex items-center justify-center text-center ${
                    lockedSubject === sub
                      ? 'bg-red-600/50 border-red-400 text-white shadow-[0_0_20px_rgba(220,38,38,0.6)]'
                      : lockedSubject === 'WAITING'
                        ? 'bg-white/5 opacity-50 cursor-not-allowed text-slate-300'
                        : 'bg-white/5 hover:bg-white/10 cursor-pointer shadow-[0_0_15px_rgba(255,255,255,0.05)]'
                  }`}
                >
                  {sub}
                </motion.button>
              ))}
            </div>

            {lockedSubject !== 'WAITING' && (
              <div className="flex gap-4 mt-8">
                <button 
                  onClick={() => {
                    socket.emit('discard_action', { subject: lockedSubject });
                    setLockedSubject('WAITING');
                  }}
                  disabled={!lockedSubject || !hand.includes(lockedSubject)}
                  className="px-8 py-3 bg-red-600/80 hover:bg-red-500 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest shadow-[0_0_15px_rgba(220,38,38,0.4)]"
                >
                  Discard Selected
                </button>
                <button 
                  onClick={() => {
                    socket.emit('skip_discard');
                    setLockedSubject('WAITING');
                  }}
                  className="px-8 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-bold uppercase tracking-widest border border-white/20"
                >
                  Keep All
                </button>
              </div>
            )}
          </motion.div>
        )}

        {gameState === 'drafting' && (
          <motion.div
            key="drafting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="z-10 w-full max-w-4xl flex flex-col items-center gap-8"
          >
            <div className="flex w-full justify-between items-center bg-black/40 p-4 rounded-2xl border border-white/10">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center border border-blue-500">
                  <Shield className="text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-xl">{player.name}</h3>
                  <p className="text-blue-400 font-mono">{player.elo} ELO</p>
                </div>
              </div>
              <h2 className="text-4xl font-black text-slate-700 italic">VS</h2>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <h3 className="font-bold text-xl">{opponent.name}</h3>
                  <p className="text-red-400 font-mono">{opponent.elo} ELO</p>
                </div>
                <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center border border-red-500">
                  <Swords className="text-red-400" />
                </div>
              </div>
            </div>

            <div className="w-full flex justify-between items-center mt-8 mb-4">
              <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tight glitch-text">Play a Card</h2>
            </div>
            
            <p className="text-xl text-fuchsia-400 mb-4 w-full text-center md:text-left font-mono">
              {matchData?.draftTurn === socketId ? "YOUR TURN TO PLAY A CARD (15s)" : "OPPONENT IS PLAYING..."}
            </p>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 w-full mt-4 max-h-[50vh] overflow-y-auto custom-scrollbar p-2">
              {matchData?.draftTurn === socketId ? (
                hand.map((sub: string, index: number) => (
                  <motion.button
                    key={index + sub}
                    whileHover={{ scale: 1.05, y: -5 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => pickSubject(sub)}
                    disabled={lockedSubject !== null}
                    className={`p-4 rounded-xl border border-white/20 font-bold text-sm md:text-base transition-all min-h-[140px] flex flex-col justify-center text-center ${
                      lockedSubject === sub
                        ? 'bg-fuchsia-600 border-fuchsia-400 text-white shadow-[0_0_20px_rgba(192,38,211,0.6)]'
                        : lockedSubject !== null
                          ? 'bg-white/5 opacity-50 cursor-not-allowed'
                          : 'bg-fuchsia-500/10 hover:bg-fuchsia-500/20 hover:border-fuchsia-400 cursor-pointer shadow-[0_0_15px_rgba(192,38,211,0.1)]'
                    }`}
                  >
                    {sub}
                  </motion.button>
                ))
              ) : (
                [1,2,3,4,5].map((i) => (
                  <div key={i} className="p-4 rounded-xl border border-white/10 bg-white/5 text-slate-600 min-h-[140px] flex items-center justify-center font-bold text-4xl shadow-inner">
                    ?
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {gameState === 'battle' && (
          <motion.div
            key="battle"
            initial={{ opacity: 0, scale: 1.1 }}
            animate={isShaking ? { x: [-10, 10, -10, 10, -5, 5, 0], transition: { duration: 0.4 } } : { opacity: 1, scale: 1 }}
            className="z-10 w-full max-w-5xl flex flex-col flex-1 py-4 md:py-12 justify-center"
          >
            {/* Header / HP Bars */}
            <div className="flex justify-between items-center mb-8 gap-8">
              <div className="flex-1">
                <div className="flex justify-between mb-2">
                  <span className="font-bold">{player.name}</span>
                  <span className="font-mono text-fuchsia-400">{player.hp} HP</span>
                </div>
                <div className="h-4 bg-black rounded-full overflow-hidden border border-white/20">
                  <motion.div 
                    initial={{ width: '100%' }}
                    animate={{ width: `${Math.max(0, player.hp)}%` }}
                    className="h-full bg-gradient-to-r from-blue-600 to-fuchsia-500"
                  />
                </div>
              </div>

              <div className="text-3xl font-black uppercase text-slate-500">
                R{roundData?.round}
              </div>

              <div className="flex-1 text-right">
                <div className="flex justify-between mb-2">
                  <span className="font-mono text-red-400">{opponent.hp} HP</span>
                  <span className="font-bold">{opponent.name}</span>
                </div>
                <div className="h-4 bg-black rounded-full overflow-hidden border border-white/20 flex justify-end">
                  <motion.div 
                    initial={{ width: '100%' }}
                    animate={{ width: `${Math.max(0, opponent.hp)}%` }}
                    className="h-full bg-gradient-to-l from-red-600 to-orange-500 origin-right"
                  />
                </div>
              </div>
            </div>

            {/* Combat Area */}
            <div className="flex-1 flex flex-col items-center justify-center relative">
              
              {/* Timer Bar */}
              <div className="w-full max-w-3xl h-2 bg-black rounded-full overflow-hidden mb-8 border border-white/20">
                <motion.div 
                  initial={{ width: '100%' }}
                  animate={{ width: `${(timeLeft / (roundData?.question?.timeLimit || 15)) * 100}%` }}
                  transition={{ duration: 0.1, ease: 'linear' }}
                  className={`h-full ${timeLeft < 5 ? 'bg-red-500 shadow-[0_0_10px_red]' : 'bg-fuchsia-500'}`}
                />
              </div>

              <h2 className="text-sm font-bold text-fuchsia-500 uppercase tracking-[0.3em] mb-8 bg-fuchsia-500/10 py-2 px-6 rounded-full border border-fuchsia-500/30">
                {selectedSubject}
              </h2>

              <div className="text-3xl md:text-5xl font-bold text-center leading-tight mb-12 max-w-3xl">
                {roundData?.question.prompt}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
                {roundData?.question.options.map((opt: string, i: number) => {
                  
                  let btnColor = 'bg-white/5 border-white/10 hover:border-white/30';
                  let indicators: string[] = [];
                  
                  if (roundResult) {
                    const myAns = socketId ? roundResult.answers[socketId]?.answer : null;
                    
                    const oppId = opponent?.id || Object.keys(roundResult.answers).find(id => id !== socketId);
                    const oppAns = oppId ? roundResult.answers[oppId]?.answer : null;
                    
                    if (myAns === i) indicators.push('YOU');
                    if (oppAns === i) indicators.push('OPP');

                    if (roundResult.correctAnswer === i) {
                      btnColor = 'bg-green-500/20 border-green-500 text-green-400';
                    } else if (myAns === i) {
                      btnColor = 'bg-red-500/20 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]'; 
                    } else if (oppAns === i) {
                      btnColor = 'bg-orange-500/10 border-orange-500/50 text-orange-400';
                    }
                  } else if (myAnswer === i) {
                    btnColor = 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]';
                  }

                  return (
                    <motion.button
                      key={i}
                      whileHover={!roundResult && myAnswer === null ? { scale: 1.02 } : {}}
                      whileTap={!roundResult && myAnswer === null ? { scale: 0.98 } : {}}
                      onClick={() => submitAnswer(i)}
                      disabled={!!roundResult || myAnswer !== null}
                      className={`p-6 rounded-2xl border-2 text-xl font-medium text-left transition-all relative overflow-hidden ${btnColor}`}
                    >
                      <div className="flex justify-between items-center mb-3 border-b border-white/5 pb-2">
                        <span className="text-sm font-bold opacity-50 uppercase tracking-widest">Option {i + 1}</span>
                        <div className="flex gap-2">
                          {indicators.includes('OPP') && (
                            <span className="bg-red-600/80 text-white text-xs font-black px-2 py-1 rounded shadow-lg animate-pulse">OPP</span>
                          )}
                          {(indicators.includes('YOU') || (myAnswer === i && !roundResult)) && (
                            <span className="bg-blue-600/80 text-white text-xs font-black px-2 py-1 rounded shadow-lg">YOU</span>
                          )}
                        </div>
                      </div>
                      <span className="drop-shadow-md">{opt}</span>
                    </motion.button>
                  );
                })}
              </div>

              {/* Round Result Overlay */}
              <AnimatePresence>
                {roundResult && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-50"
                  >
                    <div className="text-6xl font-black uppercase italic glitch-text flex flex-col items-center gap-4 bg-black/90 p-12 rounded-3xl backdrop-blur-xl border border-white/20 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                      {socketId && roundResult.damageDealt[socketId] > 0 ? (
                        <div className="flex flex-col items-center gap-2 text-red-500">
                          <div className="flex items-center gap-4"><Skull size={64} /> YOU TOOK {roundResult.damageDealt[socketId]} DMG!</div>
                          <span className="text-xl font-medium tracking-widest text-red-400/80 mt-2">
                            {socketId && roundResult.answers[socketId] ? "TOO SLOW OR INCORRECT" : "TIME OUT"}
                          </span>
                        </div>
                      ) : (opponent?.id && roundResult.damageDealt[opponent.id] > 0) ? (
                        <div className="flex flex-col items-center gap-2 text-green-400">
                          <div className="flex items-center gap-4"><Zap size={64} /> YOU DEALT {roundResult.damageDealt[opponent.id]} DMG!</div>
                          <span className="text-xl font-medium tracking-widest text-green-500/80 mt-2">CRITICAL HIT</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-yellow-500">
                          <div className="flex items-center gap-4"><Shield size={64} /> TIE! BOTH DAMAGED</div>
                          <span className="text-xl font-medium tracking-widest text-yellow-500/80 mt-2">15 DMG EACH</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {gameState === 'results' && (
          <motion.div
            key="results"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="z-10 flex flex-col items-center text-center"
          >
            {winnerInfo?.winner === socketId ? (
              <div className="mb-8">
                <Trophy size={100} className="text-yellow-400 mx-auto mb-6" />
                <h2 className="text-7xl font-black uppercase text-yellow-400 glitch-text">VICTORY</h2>
              </div>
            ) : (
              <div className="mb-8">
                <Skull size={100} className="text-red-600 mx-auto mb-6" />
                <h2 className="text-7xl font-black uppercase text-red-600 glitch-text">DEFEAT</h2>
              </div>
            )}
            
            <div className="bg-white/5 p-8 rounded-3xl border border-white/10 w-96 mb-8">
              <p className="text-slate-400 mb-2 uppercase tracking-widest text-sm">New Rating</p>
              <div className="text-5xl font-bold font-mono text-fuchsia-400">
                {winnerInfo?.elo}
              </div>
              <p className={`mt-2 text-sm font-bold ${winnerInfo?.eloDelta >= 0 ? 'text-green-400' : 'text-red-500'}`}>
                {winnerInfo?.eloDelta >= 0 ? '+' : ''}{winnerInfo?.eloDelta} ELO
              </p>
            </div>

            <button 
              onClick={() => {
                setGameState('menu');
                const newElo = winnerInfo?.elo || player.elo;
                setPlayer(p => ({ ...p, hp: 100, elo: newElo }));
                localStorage.setItem('edubattle_elo', newElo.toString());
              }}
              className="px-12 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full font-bold uppercase tracking-widest transition-colors"
            >
              Return to Menu
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
