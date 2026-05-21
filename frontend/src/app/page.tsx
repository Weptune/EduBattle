"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Crown,
  Flame,
  LogOut,
  Medal,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  Zap,
  Search,
  UserPlus,
  UserMinus,
  Check,
  X,
  MessageSquare,
  Users,
  Send,
  Volume2,
  VolumeX,
  Award,
  Smile
} from "lucide-react";

type GameState = "menu" | "queue" | "versus_intro" | "initial_discard" | "drafting" | "battle" | "results";
type Screen = "auth" | "play" | "profile" | "leaderboard" | "social";

type Account = {
  id: string;
  username: string;
  elo: number;
  avatarUrl: string;
  bannerUrl: string;
  bio: string;
  wins: number;
  losses: number;
  gamesPlayed: number;
  bestElo: number;
  fieldElos?: Record<string, number>;
  fieldStats?: Record<string, { wins: number; losses: number }>;
  createdAt: string;
  level?: number;
  xp?: number;
};

type Friendship = {
  userId: string;
  friendId: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  isOutgoingRequest: boolean;
  isIncomingRequest: boolean;
  friend: {
    id: string;
    username: string;
    avatarUrl: string;
    bannerUrl: string;
    elo: number;
    wins: number;
    losses: number;
    bio: string;
    xp: number;
    level: number;
  };
};

type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string;
  bannerUrl: string;
  elo: number;
  level: number;
  message: string;
  timestamp: string;
};

type DirectMessagePayload = {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  createdAt: string;
  sender?: {
    id: string;
    username: string;
    avatarUrl: string;
  };
};

function dmToChatMessage(msg: DirectMessagePayload, account: Account | null): ChatMessage {
  const isOwn = msg.senderId === account?.id;
  return {
    id: msg.id,
    userId: msg.senderId,
    username: isOwn ? (account?.username || "You") : (msg.sender?.username || "Unknown"),
    avatarUrl: isOwn ? (account?.avatarUrl || "") : (msg.sender?.avatarUrl || ""),
    bannerUrl: isOwn ? (account?.bannerUrl || "") : "",
    elo: isOwn ? (account?.elo || 0) : 0,
    level: isOwn ? (account?.level || 1) : 1,
    message: msg.message,
    timestamp: msg.createdAt || new Date().toISOString(),
  };
}

type IncomingChallenge = {
  challengeId: string;
  challenger: Account;
  domain: string;
};

type MatchData = {
  draftTurn?: string;
  currentRound?: number;
  domain?: string;
};

type RoundData = {
  round: number;
  question: {
    prompt: string;
    options: string[];
    timeLimit: number;
  };
};

type RoundResult = {
  answers: Record<string, { answer: number; timeTaken: number }>;
  correctAnswer: number;
  hpData: Record<string, number>;
  damageDealt: Record<string, number>;
};

type WinnerInfo = {
  winner: string;
  elo: number;
  eloDelta: number;
};

type FighterProfile = {
  id?: string;
  name: string;
  username?: string;
  elo: number;
  hp: number;
  avatarUrl?: string;
  bannerUrl?: string;
  level?: number;
};

type LeaderboardEntry = {
  rank: number;
  user: Account;
};

type MatchRecord = {
  id: string;
  winner_id?: string | null;
  loser_id?: string | null;
  winnerId?: string | null;
  loserId?: string | null;
  player_one_id?: string | null;
  player_two_id?: string | null;
  playerOneId?: string | null;
  playerTwoId?: string | null;
  player_one_name?: string;
  player_two_name?: string;
  playerOneName?: string;
  playerTwoName?: string;
  player_one_delta?: number;
  player_two_delta?: number;
  playerOneDelta?: number;
  playerTwoDelta?: number;
  rounds: number;
  finished_at?: string;
  finishedAt?: string;
  domain?: string;
};

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

const getImageUrl = (url?: string) => {
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) {
    const baseUrl = SOCKET_URL.replace(/\/+$/, "");
    const cleanUrl = "/" + url.replace(/^\/+/, "");
    return `${baseUrl}${cleanUrl}`;
  }
  return url;
};

const AvatarImage = ({
  username,
  avatarUrl,
  className,
  alt = "",
  style = {}
}: {
  username?: string;
  avatarUrl?: string;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
}) => {
  const [src, setSrc] = useState("");

  useEffect(() => {
    setSrc(getImageUrl(avatarUrl));
  }, [avatarUrl]);

  const fallbackUrl = `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(username || "default")}`;

  return (
    <img
      src={src || fallbackUrl}
      alt={alt}
      className={className}
      style={style}
      onError={() => {
        if (src !== fallbackUrl) {
          setSrc(fallbackUrl);
        }
      }}
    />
  );
};

const BannerContainer = ({
  bannerUrl,
  className,
  children,
  style = {}
}: {
  bannerUrl?: string;
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) => {
  const defaultBanner = "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1400&q=80";
  const [src, setSrc] = useState(defaultBanner);

  useEffect(() => {
    const url = getImageUrl(bannerUrl);
    if (!url) {
      setSrc(defaultBanner);
      return;
    }
    const img = new Image();
    img.src = url;
    img.onload = () => setSrc(url);
    img.onerror = () => setSrc(defaultBanner);
  }, [bannerUrl]);

  return (
    <div
      className={className}
      style={{
        ...style,
        backgroundImage: `url(${src})`
      }}
    >
      {children}
    </div>
  );
};

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;

  const baseUrl = SOCKET_URL.replace(/\/+$/, "");
  const cleanPath = "/" + path.replace(/^\/+/, "");

  try {
    response = await fetch(`${baseUrl}${cleanPath}`, options);
  } catch {
    throw new Error(`Cannot reach backend at ${baseUrl}. Make sure the updated backend server is running.`);
  }

  const text = await response.text();
  let data: { error?: string } = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Backend returned a non-JSON response for ${path}. You may be talking to an old server process.`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}.`);
  }

  return data as T;
}

function playSound(type: "select" | "hit" | "damage" | "victory" | "confirm" | "queue" | "intro" | "error") {
  try {
    const AudioCtor: typeof globalThis.AudioContext | undefined =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof globalThis.AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    const settings = {
      select: [800, 1200, 0.1, "sine"],
      hit: [400, 800, 0.15, "square"],
      damage: [150, 40, 0.3, "sawtooth"],
      victory: [440, 659, 1, "triangle"],
      confirm: [520, 980, 0.12, "triangle"],
      queue: [300, 620, 0.18, "sine"],
      intro: [220, 760, 0.35, "triangle"],
      error: [180, 90, 0.22, "sawtooth"],
    } as const;
    const [start, end, duration, wave] = settings[type];

    osc.type = wave;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(type === "damage" || type === "error" ? 0.3 : 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Audio is cosmetic; ignore browser autoplay restrictions.
  }
}

const FIELDS = [
  { id: "all", name: "All Subjects" },
  { id: "Common / First Year", name: "Common / First Year" },
  { id: "Computer Science / AI / IT / Data", name: "Computer Science & AI" },
  { id: "Electronics / Electrical / Embedded", name: "Electrical & Electronics" },
  { id: "Mechanical / Automobile / Aerospace", name: "Mechanical & Aerospace" },
  { id: "Civil / Chemical / Biotech / Biomedical", name: "Civil & Chemical & Biotech" },
];

export default function Home() {
  const socketRef = useRef<Socket | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [socketId, setSocketId] = useState<string | undefined>();
  const [selectedField, setSelectedField] = useState<string>("all");
  const [queueMode, setQueueMode] = useState<"global" | "field">("global");
  const [screen, setScreen] = useState<Screen>("auth");
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("synapse_token");
  });
  const [account, setAccount] = useState<Account | null>(null);
  const accountRef = useRef<Account | null>(null);
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [profileForm, setProfileForm] = useState({ username: "", bio: "", avatarUrl: "", bannerUrl: "" });
  const [status, setStatus] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isProfileBusy, setIsProfileBusy] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<MatchRecord[]>([]);
  const [isMetaLoading, setIsMetaLoading] = useState(false);
  const [leaderboardField, setLeaderboardField] = useState<string>("all");
  const [showFieldElosModal, setShowFieldElosModal] = useState(false);
  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  const [leaderboardSort, setLeaderboardSort] = useState<"elo" | "level" | "wins" | "winRate">("elo");

  // Social & Friends System States
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<Friendship[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<Friendship[]>([]);
  const [onlineFriends, setOnlineFriends] = useState<Set<string>>(new Set());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatMessageInput, setChatMessageInput] = useState("");
  const [incomingChallenge, setIncomingChallenge] = useState<IncomingChallenge | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<string | null>(null);
  const [viewingUser, setViewingUser] = useState<Account | null>(null);
  const [viewingUserMatches, setViewingUserMatches] = useState<MatchRecord[]>([]);
  const [isViewingUserLoading, setIsViewingUserLoading] = useState(false);
  const [challengeChosenField, setChallengeChosenField] = useState<string>("all");
  const [isChallenging, setIsChallenging] = useState(false);
  const [dmFriendId, setDmFriendId] = useState<string | null>(null);
  const [dmMessages, setDmMessages] = useState<Record<string, ChatMessage[]>>({});

  const [gameState, setGameState] = useState<GameState>("menu");
  const [player, setPlayer] = useState<FighterProfile>({ name: "Player", elo: 1200, hp: 100 });
  const [opponent, setOpponent] = useState<FighterProfile>({ id: "", name: "?", username: "", elo: 1200, hp: 100 });
  const [hand, setHand] = useState<string[]>([]);
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [winnerInfo, setWinnerInfo] = useState<WinnerInfo | null>(null);
  const [myAnswer, setMyAnswer] = useState<number | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [lockedSubject, setLockedSubject] = useState<string | null>(null);
  const versusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerLockedRef = useRef(false);
  const refreshPlayerMetaRef = useRef<(token?: string | null) => Promise<void>>(async () => { });
  const refreshFriendsListRef = useRef<(token?: string | null) => Promise<void>>(async () => { });

  const winRate = useMemo(() => {
    if (!account?.gamesPlayed) return 0;
    return Math.round((account.wins / account.gamesPlayed) * 100);
  }, [account]);

  const displayLeaderboard = useMemo(() => {
    let filtered = leaderboardField === "all"
      ? leaderboard.map(entry => ({ ...entry, displayElo: entry.user.elo }))
      : leaderboard.map(entry => {
        const elo = entry.user.fieldElos?.[leaderboardField] ?? 1200;
        return { ...entry, displayElo: elo };
      });

    // Filter by search
    if (leaderboardSearch.trim()) {
      const searchLower = leaderboardSearch.toLowerCase();
      filtered = filtered.filter(entry =>
        entry.user.username.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      switch (leaderboardSort) {
        case "elo":
          return b.displayElo - a.displayElo;
        case "level":
          return (b.user.level || 1) - (a.user.level || 1);
        case "wins":
          return b.user.wins - a.user.wins;
        case "winRate":
          const aWR = a.user.gamesPlayed > 0 ? a.user.wins / a.user.gamesPlayed : 0;
          const bWR = b.user.gamesPlayed > 0 ? b.user.wins / b.user.gamesPlayed : 0;
          return bWR - aWR;
        default:
          return b.displayElo - a.displayElo;
      }
    });

    // Assign ranks
    return filtered.map((entry, idx) => ({
      ...entry,
      rank: idx + 1
    }));
  }, [leaderboard, leaderboardField, leaderboardSearch, leaderboardSort]);

  const refreshFriendsList = useCallback(async (activeToken = token) => {
    if (!activeToken) return;
    try {
      const data = await apiRequest<{
        friends: Friendship[];
        incomingRequests: Friendship[];
        outgoingRequests: Friendship[];
      }>("/friends", { headers: { Authorization: `Bearer ${activeToken}` } });
      setFriends(data.friends);
      setIncomingRequests(data.incomingRequests);
      setOutgoingRequests(data.outgoingRequests);
    } catch (err) {
      console.error("Failed to load friends:", err);
    }
  }, [token]);

  const loadChatHistory = useCallback(async (activeToken = token) => {
    if (!activeToken) return;
    try {
      const data = await apiRequest<{ messages: ChatMessage[] }>("/chat/messages", {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      setChatMessages(data.messages);
    } catch (err) {
      console.error("Failed to load chat history:", err);
    }
  }, [token]);

  const refreshPlayerMeta = useCallback(async (activeToken = token) => {
    if (!activeToken) return;

    setIsMetaLoading(true);
    try {
      const [leaderboardData, matchData, meData] = await Promise.all([
        apiRequest<{ leaderboard: LeaderboardEntry[] }>("/leaderboard"),
        apiRequest<{ matches: MatchRecord[] }>("/me/matches", { headers: { Authorization: `Bearer ${activeToken}` } }),
        apiRequest<{ user: Account }>("/me", { headers: { Authorization: `Bearer ${activeToken}` } }),
      ]);
      setLeaderboard(leaderboardData.leaderboard);
      setRecentMatches(matchData.matches);
      setAccount(meData.user);
      setPlayer({
        name: meData.user.username,
        username: meData.user.username,
        elo: meData.user.elo,
        hp: 100,
        avatarUrl: meData.user.avatarUrl,
        bannerUrl: meData.user.bannerUrl,
        level: meData.user.level || 1
      });

      refreshFriendsList(activeToken);
    } catch {
      // Meta panels are non-critical; auth/profile errors are shown elsewhere.
    } finally {
      setIsMetaLoading(false);
    }
  }, [token, refreshFriendsList]);

  refreshPlayerMetaRef.current = refreshPlayerMeta;
  refreshFriendsListRef.current = refreshFriendsList;

  const openUserProfile = async (userId: string) => {
    if (!token) {
      setStatus("Sign in to view player profiles.");
      setScreen("auth");
      return;
    }
    playSound("select");
    setIsViewingUserLoading(true);
    try {
      const data = await apiRequest<{ user: Account; matches: MatchRecord[] }>(`/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setViewingUser(data.user);
      setViewingUserMatches(data.matches);
    } catch (err) {
      console.error("Failed to load user profile:", err);
      setStatus(err instanceof Error ? err.message : "Failed to load profile.");
      setTimeout(() => setStatus(""), 4000);
    } finally {
      setIsViewingUserLoading(false);
    }
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatMessageInput.trim();
    if (!text || !socketRef.current) return;
    socketRef.current.emit("send_chat_message", { message: text });
    setChatMessageInput("");
  };

  const sendDmMessage = (e: React.FormEvent, friendId: string) => {
    e.preventDefault();
    const text = chatMessageInput.trim();
    if (!text || !socketRef.current || !account) return;

    // Add message to local state immediately for better UX
    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      userId: account.id,
      username: account.username,
      avatarUrl: account.avatarUrl,
      bannerUrl: account.bannerUrl,
      elo: account.elo,
      level: account.level || 1,
      message: text,
      timestamp: new Date().toISOString()
    };

    setDmMessages(prev => ({
      ...prev,
      [friendId]: [...(prev[friendId] || []), tempMessage]
    }));

    socketRef.current.emit("send_direct_message", { recipientId: friendId, message: text });
    setChatMessageInput("");
  };

  const loadDmHistory = async (friendId: string) => {
    if (!token || !account) return;
    try {
      const data = await apiRequest<{ messages: DirectMessagePayload[] }>(`/chat/dms/${friendId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const messages = data.messages.map(msg => dmToChatMessage(msg, account));
      setDmMessages(prev => ({ ...prev, [friendId]: messages }));
    } catch (err) {
      console.error("Failed to load DM history:", err);
    }
  };

  const startDuelWithUser = (userId: string) => {
    openUserProfile(userId);
    setIsChallenging(true);
  };

  const addFriend = async (username: string) => {
    if (!token) return;
    const trimmed = username.trim();
    if (!trimmed) return;
    playSound("confirm");
    try {
      await apiRequest("/friends/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ friendUsername: trimmed })
      });
      refreshFriendsList(token);
      setStatus("Friend request sent!");
      setTimeout(() => setStatus(""), 4000);
    } catch (err: any) {
      setStatus(err.message || "Failed to send friend request.");
      playSound("error");
      setTimeout(() => setStatus(""), 4000);
    }
  };

  const acceptFriend = async (friendId: string) => {
    if (!token) return;
    playSound("confirm");
    try {
      await apiRequest("/friends/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ friendId })
      });
      refreshFriendsList(token);
    } catch (err: any) {
      console.error(err);
    }
  };

  const removeFriend = async (friendId: string) => {
    if (!token) return;
    playSound("select");
    try {
      await apiRequest("/friends/remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ friendId })
      });
      refreshFriendsList(token);
    } catch (err: any) {
      console.error(err);
    }
  };

  const friendshipStatus = useMemo(() => {
    if (!account || !viewingUser || account.id === viewingUser.id) return null;
    const isFriend = friends.some(f => f.friend.id === viewingUser.id);
    if (isFriend) return "friend";
    const isIncoming = incomingRequests.some(f => f.friend.id === viewingUser.id);
    if (isIncoming) return "incoming";
    const isOutgoing = outgoingRequests.some(f => f.friend.id === viewingUser.id);
    if (isOutgoing) return "outgoing";
    return "none";
  }, [account, viewingUser, friends, incomingRequests, outgoingRequests]);

  useEffect(() => {
    if (!token) return;

    apiRequest<{ user: Account }>("/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(data => {
        setAccount(data.user);
        setPlayer({ name: data.user.username, username: data.user.username, elo: data.user.elo, hp: 100, avatarUrl: data.user.avatarUrl, bannerUrl: data.user.bannerUrl });
        setProfileForm({
          username: data.user.username,
          bio: data.user.bio,
          avatarUrl: data.user.avatarUrl,
          bannerUrl: data.user.bannerUrl,
        });
        setScreen("play");
        refreshPlayerMeta(token);
      })
      .catch(() => {
        localStorage.removeItem("synapse_token");
        setToken(null);
        setAccount(null);
        setScreen("auth");
      });
  }, [token, refreshPlayerMeta]);

  useEffect(() => {
    const activeSocket = io(SOCKET_URL, { autoConnect: true, transports: ["websocket", "polling"] });
    socketRef.current = activeSocket;

    activeSocket.on("connect", () => {
      setSocketId(activeSocket.id);
      const activeToken = localStorage.getItem("synapse_token");
      if (activeToken) {
        activeSocket.emit("register_socket", { authToken: activeToken });
      }
    });

    activeSocket.on("disconnect", () => setSocketId(undefined));

    activeSocket.on("auth_required", () => {
      setStatus("Sign in before entering a match.");
      setScreen("auth");
      setGameState("menu");
    });

    activeSocket.on("waiting_in_queue", () => setGameState("queue"));

    activeSocket.on("match_found", data => {
      answerLockedRef.current = false;
      setOpponent({
        ...data.opponent,
        id: data.opponent?.id ?? "",
        hp: data.opponent?.hp ?? 100,
      });
      setMatchData(data.match);
      setHand(data.hand || []);
      setPlayer(p => ({ ...p, hp: 100 }));
      setLockedSubject(null);
      setRoundResult(null);
      setMyAnswer(null);
      setGameState("versus_intro");
      playSound("intro");
      setScreen("play");

      if (versusTimerRef.current) clearTimeout(versusTimerRef.current);
      versusTimerRef.current = setTimeout(() => {
        setGameState("initial_discard");
      }, 2600);
    });

    activeSocket.on("hand_updated", data => setHand(data.hand));

    activeSocket.on("discard_phase_end", data => {
      setMatchData(data.match);
      setLockedSubject(null);
      setGameState("drafting");
    });

    activeSocket.on("draft_complete", data => setSelectedSubject(data.subject));

    activeSocket.on("round_start", data => {
      answerLockedRef.current = false;
      setRoundData(data);
      setRoundResult(null);
      setMyAnswer(null);
      setLockedSubject(null);
      setGameState("battle");
    });

    activeSocket.on("round_result", data => {
      const myId = activeSocket.id;
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
        playSound("damage");
      } else {
        playSound("hit");
      }
    });

    activeSocket.on("match_end", data => {
      setWinnerInfo(data);
      setGameState("results");
      setAccount(current => current ? { ...current, elo: data.elo, bestElo: Math.max(current.bestElo, data.elo) } : current);
      refreshPlayerMetaRef.current();
      if (data.winner === activeSocket.id) playSound("victory");
      else playSound("damage");
    });

    activeSocket.on("back_to_draft", data => {
      setMatchData(prev => ({
        ...prev,
        draftTurn: data.draftTurn,
        currentRound: data.round,
      }));
      setSelectedSubject(null);
      setLockedSubject(null);
      setGameState("drafting");
    });

    activeSocket.on("chat_message", (msg: ChatMessage) => {
      setChatMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev.slice(-99), msg];
      });
    });

    activeSocket.on("direct_message", (msg: DirectMessagePayload) => {
      const currentAccount = accountRef.current;
      const friendId = msg.senderId === currentAccount?.id ? msg.receiverId : msg.senderId;
      const chatMessage = dmToChatMessage(msg, currentAccount);

      setDmMessages(prev => {
        const existing = prev[friendId] || [];
        if (existing.some(m => m.id === chatMessage.id)) return prev;

        const withoutOptimisticDup = existing.filter(
          m => !(m.id.startsWith("temp-") && m.userId === chatMessage.userId && m.message === chatMessage.message)
        );

        return {
          ...prev,
          [friendId]: [...withoutOptimisticDup.slice(-99), chatMessage],
        };
      });
    });

    activeSocket.on("friend_status_change", (data: { friendId: string; isOnline: boolean }) => {
      setOnlineFriends(prev => {
        const next = new Set(prev);
        if (data.isOnline) {
          next.add(data.friendId);
        } else {
          next.delete(data.friendId);
        }
        return next;
      });
    });

    activeSocket.on("friend_challenge", (data: IncomingChallenge) => {
      setIncomingChallenge(data);
      playSound("intro");
    });

    activeSocket.on("challenge_declined", () => {
      setChallengeStatus("Challenge was declined.");
      playSound("error");
      setTimeout(() => setChallengeStatus(null), 4000);
    });

    activeSocket.on("challenge_error", (data: { error: string }) => {
      setChallengeStatus(data.error);
      playSound("error");
      setTimeout(() => setChallengeStatus(null), 4000);
    });

    activeSocket.on("friend_request_received", () => {
      refreshFriendsListRef.current();
    });

    activeSocket.on("friend_request_accepted", () => {
      refreshFriendsListRef.current();
    });

    return () => {
      activeSocket.removeAllListeners();
      activeSocket.disconnect();
      socketRef.current = null;
      if (versusTimerRef.current) clearTimeout(versusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  useEffect(() => {
    if (!token || !socketRef.current?.connected) return;
    socketRef.current.emit("register_socket", { authToken: token });
  }, [token, socketId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (screen === "social" && token) {
      loadChatHistory(token);
    }
  }, [screen, token, loadChatHistory]);

  const authenticate = async () => {
    setStatus("");
    setIsAuthBusy(true);

    try {
      const username = authForm.username.trim();
      if (!username || !authForm.password) {
        setStatus("Enter a username and password.");
        return;
      }

      const endpoint = authMode === "signup" ? "signup" : "login";
      const data = await apiRequest<{ token: string; user: Account }>(`/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: authForm.password }),
      });

      localStorage.setItem("synapse_token", data.token);
      setToken(data.token);
      setAccount(data.user);
      setPlayer({ name: data.user.username, username: data.user.username, elo: data.user.elo, hp: 100, avatarUrl: data.user.avatarUrl, bannerUrl: data.user.bannerUrl });
      setProfileForm({
        username: data.user.username,
        bio: data.user.bio,
        avatarUrl: data.user.avatarUrl,
        bannerUrl: data.user.bannerUrl,
      });
      setScreen("play");
      refreshPlayerMeta(data.token);
      playSound("confirm");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Account request failed.");
      playSound("error");
    } finally {
      setIsAuthBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!token) return;
    setStatus("");
    setIsProfileBusy(true);

    try {
      let avatarUrl = profileForm.avatarUrl;
      let bannerUrl = profileForm.bannerUrl;

      if (avatarUrl && avatarUrl.startsWith("data:image/")) {
        const uploadRes = await apiRequest<{ url: string }>("/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ image: avatarUrl }),
        });
        avatarUrl = uploadRes.url;
      }

      if (bannerUrl && bannerUrl.startsWith("data:image/")) {
        const uploadRes = await apiRequest<{ url: string }>("/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ image: bannerUrl }),
        });
        bannerUrl = uploadRes.url;
      }

      const data = await apiRequest<{ user: Account }>("/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...profileForm,
          username: profileForm.username.trim(),
          avatarUrl,
          bannerUrl
        }),
      });

      setAccount(data.user);
      setPlayer(p => ({ ...p, name: data.user.username, username: data.user.username, elo: data.user.elo, avatarUrl: data.user.avatarUrl, bannerUrl: data.user.bannerUrl }));
      setStatus("Profile saved.");
      playSound("confirm");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile update failed.");
      playSound("error");
    } finally {
      setIsProfileBusy(false);
    }
  };

  const logout = async () => {
    if (token) {
      apiRequest("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    localStorage.removeItem("synapse_token");
    setToken(null);
    setAccount(null);
    setLeaderboard([]);
    setRecentMatches([]);
    setScreen("auth");
    setGameState("menu");
    playSound("select");
  };

  const joinQueue = (bot = false) => {
    if (!socketRef.current || !token || !account) {
      setScreen("auth");
      setStatus("Create an account or sign in before playing.");
      playSound("error");
      return;
    }

    const domain = queueMode === "global" ? "all" : (selectedField === "all" ? "Common / First Year" : selectedField);

    playSound(bot ? "confirm" : "queue");
    socketRef.current.emit(bot ? "join_bot_queue" : "join_queue", { authToken: token, domain });
  };

  const pickSubject = (subject: string) => {
    if (matchData?.draftTurn === socketId && !lockedSubject) {
      playSound("select");
      setLockedSubject(subject);
      socketRef.current?.emit("draft_action", { subject });
    }
  };

  const submitAnswer = (answerIndex: number) => {
    if (roundResult || myAnswer !== null || answerLockedRef.current) return;
    if (!socketRef.current?.connected || gameState !== "battle") return;

    answerLockedRef.current = true;
    playSound("select");
    setMyAnswer(answerIndex);
    socketRef.current.emit("submit_answer", { answerIndex });
  };

  const setProfileImage = (field: "avatarUrl" | "bannerUrl", file?: File) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file.");
      playSound("error");
      return;
    }

    const maxSize = field === "avatarUrl" ? 1_200_000 : 2_500_000;
    if (file.size > maxSize) {
      setStatus(field === "avatarUrl" ? "Avatar must be under 1.2 MB." : "Banner must be under 2.5 MB.");
      playSound("error");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setProfileForm(current => ({ ...current, [field]: reader.result as string }));
      setStatus(field === "avatarUrl" ? "Avatar ready. Save profile to keep it." : "Banner ready. Save profile to keep it.");
      playSound("confirm");
    };
    reader.onerror = () => {
      setStatus("Could not read that image.");
      playSound("error");
    };
    reader.readAsDataURL(file);
  };

  const navTabs: { id: Screen; label: string; onClick: () => void }[] = account
    ? [
      { id: "play", label: "Play", onClick: () => { playSound("select"); setScreen("play"); } },
      { id: "social", label: "Social", onClick: () => { playSound("select"); setScreen("social"); refreshFriendsList(); loadChatHistory(); } },
      { id: "profile", label: "Profile", onClick: () => { playSound("select"); setScreen("profile"); } },
      { id: "leaderboard", label: "Ranks", onClick: () => { playSound("select"); refreshPlayerMeta(); setScreen("leaderboard"); } },
    ]
    : [];

  return (
    <main className="relative min-h-screen overflow-x-hidden text-slate-50">
      <ArenaBackdrop />

      <nav className="relative z-20 mx-auto flex w-full max-w-6xl min-w-0 items-center justify-between gap-2 px-3 py-3 safe-pt sm:px-4 sm:py-5">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setScreen(account ? "play" : "auth")}
          className="flex min-w-0 items-center gap-2 text-left sm:gap-3"
        >
          <motion.div
            animate={{ boxShadow: ["0 0 20px rgba(45,212,191,0.25)", "0 0 32px rgba(45,212,191,0.45)", "0 0 20px rgba(45,212,191,0.25)"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-400 text-slate-950 sm:h-10 sm:w-10"
          >
            <Swords size={20} className="sm:h-[22px] sm:w-[22px]" />
          </motion.div>
          <div className="min-w-0 truncate">
            <p className="font-display text-sm font-black uppercase tracking-wide text-teal-400 text-glow-teal sm:text-lg">
              <span className="sm:hidden">Synapse</span>
              <span className="hidden sm:inline">Synapse.gg</span>
            </p>
            <p className="hidden text-[10px] font-mono text-slate-400 sm:block">Collegiate Trivia Arena</p>
          </div>
        </motion.button>

        {account ? (
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative hidden items-center gap-0.5 rounded-xl border border-white/[0.06] bg-black/40 p-1 backdrop-blur-md md:flex">
              {navTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={tab.onClick}
                  className={`relative z-10 rounded-lg px-3 py-2 text-xs font-bold transition-colors lg:px-4 lg:text-sm ${screen === tab.id ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {screen === tab.id && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-lg nav-tab-glow border border-white/10 bg-gradient-to-b from-white/12 to-white/[0.04]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative">{tab.label}</span>
                </button>
              ))}
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={logout}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-200 sm:h-10 sm:w-10"
              title="Log out"
            >
              <LogOut size={16} className="sm:h-[18px] sm:w-[18px]" />
            </motion.button>
          </div>
        ) : null}
      </nav>

      {account ? (
        <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/95 backdrop-blur-xl md:hidden safe-pb">
          <div className="mx-auto grid max-w-lg grid-cols-4 gap-0.5 px-1 py-1.5">
            {navTabs.map(tab => {
              const active = screen === tab.id;
              const Icon = tab.id === "play" ? Swords : tab.id === "social" ? MessageSquare : tab.id === "profile" ? Users : Trophy;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={tab.onClick}
                  className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 transition ${active ? "bg-teal-400/15 text-teal-300" : "text-slate-500"}`}
                >
                  <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                  <span className="text-[9px] font-black uppercase tracking-wide">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      <div className="relative z-10 mx-auto w-full min-w-0 max-w-6xl px-3 pb-24 md:px-4 md:pb-10">
        <AnimatePresence mode="wait">
          {!account || screen === "auth"
            ? renderAuth()
            : screen === "profile"
              ? renderProfile()
              : screen === "leaderboard"
                ? renderLeaderboard()
                : screen === "social"
                  ? renderSocial()
                  : renderGame()}
        </AnimatePresence>
      </div>

      {/* Disciplines Elo Modal */}
      <AnimatePresence>
        {showFieldElosModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
              onClick={() => setShowFieldElosModal(false)}
            />
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-slate-900/90 p-5 sm:p-6 shadow-2xl backdrop-blur-2xl z-10"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-teal-400">Synapse Arena Ratings</p>
                  <h3 className="text-2xl font-black uppercase text-white">Your Discipline Elos</h3>
                  <p className="text-xs text-slate-400 mt-1">Separate MMR is tracked and updated only when playing real ranked games in the field-wise queue.</p>
                </div>
                <button
                  onClick={() => setShowFieldElosModal(false)}
                  className="rounded-lg bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1 scrollbar-thin flex-1 max-h-[60vh]">
                {FIELDS.filter(f => f.id !== "all").map(field => {
                  const rating = account?.fieldElos?.[field.id] ?? 1200;

                  // Scholar Tiers
                  let tierName = "Bronze Scholar";
                  let tierColor = "text-amber-500 border-amber-500/20 bg-amber-500/10";
                  if (rating >= 1800) {
                    tierName = "Diamond Dean";
                    tierColor = "text-cyan-400 border-cyan-400/20 bg-cyan-400/10 shadow-[0_0_12px_rgba(34,211,238,0.15)]";
                  } else if (rating >= 1500) {
                    tierName = "Gold Guru";
                    tierColor = "text-yellow-400 border-yellow-400/20 bg-yellow-400/10";
                  } else if (rating >= 1300) {
                    tierName = "Silver Specialist";
                    tierColor = "text-slate-300 border-slate-300/20 bg-slate-300/10";
                  }

                  return (
                    <div key={field.id} className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-slate-950/45 p-4 transition-all duration-300 hover:border-teal-500/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black uppercase tracking-wide text-slate-200 group-hover:text-teal-300 transition-colors">{field.name}</p>
                          <span className={`inline-block mt-1.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${tierColor}`}>
                            {tierName}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-2xl font-black text-teal-300">{rating}</p>
                          <p className="text-[9px] uppercase tracking-widest text-slate-500">Rating</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* User Profile Detail Modal */}
      <AnimatePresence>
        {(viewingUser || isViewingUserLoading) && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setViewingUser(null); setIsChallenging(false); setIsViewingUserLoading(false); }}
              className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.98, y: 24, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.98, y: 24, opacity: 0 }}
              className="relative z-50 flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl"
            >
              {isViewingUserLoading && !viewingUser ? (
                <div className="flex h-64 items-center justify-center">
                  <p className="font-mono text-xs font-black uppercase tracking-widest text-teal-300 animate-pulse">Loading profile...</p>
                </div>
              ) : viewingUser ? (
                <>
                  {/* Profile banner */}
                  <BannerContainer
                    bannerUrl={viewingUser.bannerUrl}
                    className="h-36 bg-cover bg-center relative"
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                    <button
                      onClick={() => { setViewingUser(null); setIsChallenging(false); setIsViewingUserLoading(false); }}
                      className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-full bg-black/60 border border-white/10 text-slate-300 hover:text-white hover:bg-black/80 transition z-20"
                    >
                      <X size={16} />
                    </button>
                  </BannerContainer>

                  {/* Profile details */}
                  <div className="relative z-10 -mt-12 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 scrollbar-thin sm:px-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end justify-between mb-6">
                      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                        <AvatarImage
                          username={viewingUser.username}
                          avatarUrl={viewingUser.avatarUrl}
                          className="h-24 w-24 rounded-xl border-4 border-slate-950 bg-slate-800 object-cover shadow-lg"
                        />
                        <div className="pb-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-xl font-black uppercase tracking-tight text-white break-all sm:text-2xl">{viewingUser.username}</h3>
                            <span className="rounded bg-gradient-to-r from-teal-400 to-emerald-400 border border-teal-300 px-1.5 py-0.5 text-[10px] font-mono font-black text-slate-950 shadow-[0_0_10px_rgba(45,212,191,0.2)]">
                              Lvl {viewingUser.level || 1}
                            </span>
                          </div>
                          <p className="font-mono text-[10px] text-teal-400 mt-0.5">@{viewingUser.username}</p>
                          <div className="mt-2 w-full max-w-[200px]">
                            <div className="flex justify-between text-[9px] font-mono font-black text-slate-400 mb-0.5">
                              <span>XP Progress</span>
                              <span>{(viewingUser.xp || 0) % 500} / 500</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden border border-white/5">
                              <div
                                className="h-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-all duration-500"
                                style={{ width: `${(((viewingUser.xp || 0) % 500) / 500) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Friendship & Duel actions */}
                      <div className="flex flex-wrap gap-2">
                        {account && viewingUser.id !== account.id && (
                          <>
                            {friendshipStatus === "none" && (
                              <button
                                onClick={() => addFriend(viewingUser.username)}
                                className="flex items-center gap-1.5 rounded-lg bg-teal-400 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-slate-950 hover:bg-teal-350 transition duration-300"
                              >
                                <UserPlus size={14} />
                                Add Friend
                              </button>
                            )}
                            {friendshipStatus === "incoming" && (
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => acceptFriend(viewingUser.id)}
                                  className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-emerald-400 transition"
                                >
                                  <Check size={14} /> Accept
                                </button>
                                <button
                                  onClick={() => removeFriend(viewingUser.id)}
                                  className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-300 hover:bg-white/10 transition"
                                >
                                  Ignore
                                </button>
                              </div>
                            )}
                            {friendshipStatus === "outgoing" && (
                              <button
                                onClick={() => removeFriend(viewingUser.id)}
                                className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-slate-300 hover:bg-white/10 transition"
                              >
                                <X size={14} />
                                Cancel Request
                              </button>
                            )}
                            {friendshipStatus === "friend" && (
                              <>
                                <button
                                  onClick={() => removeFriend(viewingUser.id)}
                                  className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/30 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-red-400 hover:bg-red-500 hover:text-white transition duration-300"
                                >
                                  <UserMinus size={14} />
                                  Unfriend
                                </button>
                                {onlineFriends.has(viewingUser.id) && !isChallenging && (
                                  <button
                                    onClick={() => { playSound("select"); setIsChallenging(true); }}
                                    className="flex items-center gap-1.5 rounded-lg bg-teal-400/10 border border-teal-400/30 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-teal-300 hover:bg-teal-400 hover:text-slate-950 transition duration-300"
                                  >
                                    <Swords size={14} />
                                    Duel Challenge
                                  </button>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Duel Challenge Selection Menu */}
                    {isChallenging && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        className="mb-6 rounded-xl border border-teal-400/30 bg-teal-400/5 p-4"
                      >
                        <p className="text-[10px] font-black uppercase tracking-widest text-teal-300 mb-3">Select Duel Academic Subject:</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 mb-4">
                          <button
                            onClick={() => { playSound("select"); setChallengeChosenField("all"); }}
                            className={`rounded-lg px-2.5 py-2 text-xs font-black uppercase tracking-wider border transition ${challengeChosenField === "all" ? "bg-teal-400 text-slate-950 border-teal-400" : "bg-black/40 text-slate-300 border-white/10 hover:border-white/20"}`}
                          >
                            All Subjects
                          </button>
                          {FIELDS.map(f => (
                            <button
                              key={f.id}
                              onClick={() => { playSound("select"); setChallengeChosenField(f.id); }}
                              className={`rounded-lg px-2.5 py-2 text-xs font-black uppercase tracking-wider border transition truncate ${challengeChosenField === f.id ? "bg-teal-400 text-slate-950 border-teal-400" : "bg-black/40 text-slate-300 border-white/10 hover:border-white/20"}`}
                            >
                              {f.name}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { playSound("select"); setIsChallenging(false); }}
                            className="rounded-lg border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-300 hover:bg-white/5 transition"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              if (!socketRef.current) return;
                              playSound("confirm");
                              socketRef.current.emit("challenge_friend", { friendId: viewingUser.id, domain: challengeChosenField });
                              setChallengeStatus(`Duel request sent to ${viewingUser.username}!`);
                              setViewingUser(null);
                              setIsChallenging(false);
                              setTimeout(() => setChallengeStatus(null), 4000);
                            }}
                            className="rounded-lg bg-teal-400 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-teal-300 transition"
                          >
                            Send Duel Invitation
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {/* Bio text */}
                    <p className="text-slate-300 text-sm mb-6 leading-relaxed bg-black/20 p-3 rounded-lg border border-white/5">{viewingUser.bio || "hi"}</p>

                    {/* Grid stats */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
                      <div className="rounded-xl border border-white/[0.08] bg-slate-950/45 p-3.5 text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Overall Elo</p>
                        <p className="mt-1 font-mono text-xl font-black text-teal-300">{viewingUser.elo}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.08] bg-slate-950/45 p-3.5 text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Wins</p>
                        <p className="mt-1 font-mono text-xl font-black text-white">{viewingUser.wins}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.08] bg-slate-950/45 p-3.5 text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Losses</p>
                        <p className="mt-1 font-mono text-xl font-black text-white">{viewingUser.losses}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.08] bg-slate-950/45 p-3.5 text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Win Rate</p>
                        <p className="mt-1 font-mono text-xl font-black text-teal-300">
                          {viewingUser.wins + viewingUser.losses > 0
                            ? `${Math.round((viewingUser.wins / (viewingUser.wins + viewingUser.losses)) * 100)}%`
                            : "0%"}
                        </p>
                      </div>
                    </div>

                    {/* Discipline Ratings & Matches */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-300 mb-3">Field Ratings</h4>
                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                          {FIELDS.map(f => {
                            const elo = viewingUser.fieldElos?.[f.id] || 1200;
                            const stats = viewingUser.fieldStats?.[f.id];
                            const w = stats?.wins || 0;
                            const l = stats?.losses || 0;
                            const wr = w + l > 0 ? Math.round((w / (w + l)) * 100) : 0;
                            return (
                              <div key={f.id} className="flex flex-col gap-1 border-b border-white/5 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3 text-xs">
                                <span className="font-bold text-slate-400 break-words leading-snug">{f.name}</span>
                                <div className="shrink-0 text-left sm:text-right">
                                  <span className="font-mono font-bold text-teal-300">{elo} Elo</span>
                                  <span className="block text-[8px] font-mono text-slate-500">{w}W-{l}L ({wr}% WR)</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-300 mb-3">Match History</h4>
                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                          {viewingUserMatches.length ? (
                            viewingUserMatches.map(m => {
                              const isWin = m.winnerId === viewingUser.id || m.winner_id === viewingUser.id;
                              const oppName = (m.playerOneName || m.player_one_name) === viewingUser.username
                                ? (m.playerTwoName || m.player_two_name)
                                : (m.playerOneName || m.player_one_name);
                              const delta = (m.playerOneName || m.player_one_name) === viewingUser.username
                                ? (m.playerOneDelta ?? m.player_one_delta)
                                : (m.playerTwoDelta ?? m.player_two_delta);
                              const formattedDelta = delta && delta >= 0 ? `+${delta}` : delta;
                              return (
                                <div key={m.id} className="flex items-center justify-between text-[10px] border-b border-white/5 pb-1.5 last:border-b-0 last:pb-0">
                                  <div className="min-w-0">
                                    <span className={`font-black uppercase ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                                      {isWin ? "Victory" : "Defeat"}
                                    </span>
                                    <span className="text-slate-500 font-bold block truncate">vs {oppName || "AI Bot"}</span>
                                  </div>
                                  <span className={`font-mono font-bold ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                                    {formattedDelta || ""} Elo
                                  </span>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[10px] text-slate-500 text-center py-4">No recent matches played.</p>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </>
              ) : null}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Incoming Challenge Notification */}
      <AnimatePresence>
        {incomingChallenge && (
          <div className="fixed left-4 right-4 top-4 z-50 flex justify-center sm:left-auto sm:right-6 sm:top-6 sm:w-96 pointer-events-none">
            <motion.div
              initial={{ y: -50, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0, scale: 0.95 }}
              className="pointer-events-auto w-full overflow-hidden rounded-2xl border border-teal-500/40 bg-slate-950/95 p-4 shadow-[0_0_30px_rgba(45,212,191,0.25)] backdrop-blur-xl"
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <AvatarImage
                    username={incomingChallenge.challenger.username}
                    avatarUrl={incomingChallenge.challenger.avatarUrl}
                    className="h-12 w-12 rounded-xl border border-white/10 bg-slate-800 object-cover"
                  />
                  <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 border border-teal-500/30 text-teal-400">
                    <Swords size={10} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-mono text-xs font-black uppercase tracking-wider text-teal-300">⚔️ Duel Challenge!</p>
                  </div>
                  <p className="mt-0.5 text-sm font-black text-white truncate">
                    @{incomingChallenge.challenger.username}
                  </p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-slate-800 border border-white/[0.06] px-1.5 py-0.5 text-[9px] font-mono font-black text-amber-300">
                      Lvl {incomingChallenge.challenger.level || 1}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {incomingChallenge.challenger.elo} Elo
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-300 bg-white/[0.03] border border-white/[0.06] px-2 py-1 rounded inline-block">
                    Arena: {incomingChallenge.domain === 'all' || incomingChallenge.domain === 'Common / First Year' ? 'All Subjects' : incomingChallenge.domain}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    if (!socketRef.current) return;
                    playSound("select");
                    socketRef.current.emit("decline_challenge", { challengeId: incomingChallenge.challengeId });
                    setIncomingChallenge(null);
                  }}
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-black uppercase tracking-wider text-slate-300 hover:bg-white/10 transition"
                >
                  Decline
                </button>
                <button
                  onClick={() => {
                    if (!socketRef.current) return;
                    playSound("confirm");
                    socketRef.current.emit("accept_challenge", { challengeId: incomingChallenge.challengeId });
                    setIncomingChallenge(null);
                  }}
                  className="flex-1 rounded-lg bg-gradient-to-r from-teal-400 to-emerald-400 py-2 text-xs font-black uppercase tracking-wider text-slate-950 shadow-[0_0_12px_rgba(45,212,191,0.2)] hover:from-teal-350 hover:to-emerald-350 transition duration-300"
                >
                  Accept
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast notifications */}
      <AnimatePresence>
        {challengeStatus && (
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -24, scale: 0.9 }}
            className="fixed left-3 right-3 top-4 z-50 rounded-xl border border-teal-400/40 bg-slate-900/90 px-4 py-3 shadow-2xl backdrop-blur-md sm:left-auto sm:right-6 sm:top-6 sm:px-5 sm:py-4"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-teal-500/10 p-1.5 text-teal-400">
                <Sparkles size={16} />
              </div>
              <p className="font-mono text-xs font-black uppercase tracking-wide text-teal-200">{challengeStatus}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );

  function renderSocial() {
    if (!account) return null;

    return (
      <motion.section
        key="social"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        className="flex min-w-0 flex-col gap-4 lg:grid lg:grid-cols-[1.2fr_0.8fr] lg:gap-6"
      >
        {/* Global Arena Chat */}
        <div className="glass-panel relative flex min-h-[min(42vh,360px)] max-h-[min(52vh,440px)] flex-col overflow-hidden scanline-overlay lg:min-h-[min(68vh,560px)] lg:max-h-[calc(100vh-11rem)]">
          {/* Chat Header */}
          <div className="flex flex-col gap-2 border-b border-white/[0.08] bg-slate-950/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="shrink-0 rounded-lg bg-teal-500/10 p-2 text-teal-400">
                <MessageSquare size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-100 sm:text-lg">Global Arena Chat</h2>
                <p className="text-[10px] font-mono text-slate-400">Interact with online challengers</p>
              </div>
            </div>
            {socketId ? (
              <span className="flex w-fit items-center gap-1.5 rounded-full bg-teal-500/10 px-2.5 py-1 text-[10px] font-mono font-black text-teal-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
                Live Connection
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-[10px] font-mono font-black text-red-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Connecting...
              </span>
            )}
          </div>

          {/* Chat Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 scrollbar-thin sm:space-y-4 sm:p-4">
            {chatMessages.length ? (
              chatMessages.map(msg => {
                const isSelf = account?.id === msg.userId;
                const isFriend = friends.some(f => f.friend.id === msg.userId);
                const isOnline = onlineFriends.has(msg.userId);
                const canInvite = !isSelf && isFriend && isOnline;

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, x: isSelf ? 8 : -8 }}
                    animate={{ opacity: 1, y: 0, x: 0 }}
                    transition={{ duration: 0.3 }}
                    className={`flex items-start gap-3 group chat-msg-in ${isSelf ? "flex-row-reverse" : ""}`}
                  >
                    <div
                      onClick={() => openUserProfile(msg.userId)}
                      className="cursor-pointer"
                    >
                      <AvatarImage
                        username={msg.username}
                        avatarUrl={msg.avatarUrl}
                        className="h-9 w-9 rounded-lg object-cover border border-white/10 hover:border-teal-400 transition-colors shadow bg-slate-800"
                      />
                    </div>
                    <div className={`min-w-0 flex-1 rounded-xl border px-4 py-3 transition-all ${isSelf ? "border-teal-400/15 bg-teal-400/[0.06] group-hover:border-teal-400/25" : "border-white/[0.04] bg-white/[0.02] group-hover:border-white/[0.08]"}`}>
                      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            onClick={() => openUserProfile(msg.userId)}
                            className="cursor-pointer font-black text-xs uppercase text-teal-200 hover:text-teal-350 transition-colors"
                          >
                            {msg.username}
                          </span>
                          <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[8px] font-mono font-black text-amber-300">
                            Lvl {msg.level || 1}
                          </span>
                          <span className="font-mono text-[9px] text-slate-400">
                            ({msg.elo} Elo)
                          </span>
                        </div>
                        <span className="font-mono text-[9px] text-slate-500">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-slate-200 text-sm break-words selection:bg-teal-400/20">{msg.message}</p>
                      {canInvite && (
                        <button
                          type="button"
                          onClick={() => startDuelWithUser(msg.userId)}
                          className="mt-2 flex items-center gap-1 rounded-lg border border-teal-400/30 bg-teal-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-teal-300 hover:bg-teal-400 hover:text-slate-950 transition"
                        >
                          <Swords size={10} />
                          Invite to Duel
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center opacity-40">
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity }}>
                  <MessageSquare size={48} className="text-slate-400 mb-3" />
                </motion.div>
                <p className="font-black uppercase tracking-wider text-sm">No messages yet</p>
                <p className="text-xs text-slate-400 max-w-xs mt-1">Be the first to start a conversation in the global lounge!</p>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input Form */}
          <form onSubmit={sendChatMessage} className="flex shrink-0 gap-2 border-t border-white/[0.08] bg-slate-950/25 p-3 sm:p-4">
            <input
              value={chatMessageInput}
              onChange={e => setChatMessageInput(e.target.value)}
              placeholder="Message the arena..."
              maxLength={300}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-teal-400/80 sm:px-4 sm:py-3"
            />
            <button
              type="submit"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 transition duration-300 hover:from-teal-350 hover:to-emerald-350 sm:h-11 sm:w-11"
            >
              <Send size={18} />
            </button>
          </form>
        </div>

        {/* Friends & actions */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* Add Friend Card */}
          <div className="glass-panel rounded-2xl p-3 sm:p-4">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-200 sm:mb-3 sm:text-sm">
              <UserPlus size={16} className="text-teal-300" /> Add Challenger
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <input
                  id="friend-username-input"
                  placeholder="Enter username..."
                  className="w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-3 py-2.5 text-xs text-white outline-none focus:border-teal-400/80 transition"
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const input = document.getElementById("friend-username-input") as HTMLInputElement;
                      if (input?.value.trim()) {
                        addFriend(input.value.trim());
                        input.value = "";
                      }
                    }
                  }}
                />
                <Search size={14} className="absolute left-3 top-3.5 text-slate-400" />
              </div>
              <button
                onClick={() => {
                  const input = document.getElementById("friend-username-input") as HTMLInputElement;
                  if (input?.value.trim()) {
                    addFriend(input.value.trim());
                    input.value = "";
                  }
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/10 sm:py-0"
              >
                Send
              </button>
            </div>
            {status && (
              <p className="mt-2 text-[10px] font-bold text-teal-300 animate-pulse">{status}</p>
            )}
          </div>

          {/* Incoming Friend Requests */}
          {incomingRequests.length > 0 && (
            <div className="rounded-2xl border border-white/[0.08] bg-slate-900/40 p-5 backdrop-blur-md">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-amber-200">
                <Users size={16} className="text-amber-300" /> Pending Invites ({incomingRequests.length})
              </h3>
              <div className="space-y-2">
                {incomingRequests.map(req => (
                  <div key={req.friend.id} className="flex items-center justify-between rounded-xl bg-black/20 p-3 border border-white/[0.04]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        onClick={() => openUserProfile(req.friend.id)}
                        className="cursor-pointer"
                      >
                        <AvatarImage
                          username={req.friend.username}
                          avatarUrl={req.friend.avatarUrl}
                          className="h-8 w-8 rounded object-cover border border-white/10 bg-slate-800"
                        />
                      </div>
                      <div className="min-w-0">
                        <p
                          onClick={() => openUserProfile(req.friend.id)}
                          className="cursor-pointer font-black text-xs uppercase text-white truncate hover:text-teal-200"
                        >
                          {req.friend.username}
                        </p>
                        <p className="font-mono text-[9px] text-slate-400">{req.friend.elo} Elo</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => acceptFriend(req.friend.id)}
                        className="grid h-7 w-7 place-items-center rounded bg-teal-400 text-slate-950 hover:bg-teal-300 transition"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => removeFriend(req.friend.id)}
                        className="grid h-7 w-7 place-items-center rounded bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white transition"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Friends List */}
          <div className="glass-panel flex min-h-0 flex-1 flex-col rounded-2xl p-3 sm:p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-200">
              <Users size={16} className="text-teal-300" /> Friends List
            </h3>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {friends.length ? (
                // Sort friends so online ones are at the top
                [...friends].sort((a, b) => {
                  const aOnline = onlineFriends.has(a.friend.id) ? 1 : 0;
                  const bOnline = onlineFriends.has(b.friend.id) ? 1 : 0;
                  return bOnline - aOnline;
                }).map(f => {
                  const isOnline = onlineFriends.has(f.friend.id);
                  return (
                    <div
                      key={f.friend.id}
                      className="group/friend flex items-center justify-between rounded-xl bg-black/20 p-3.5 border border-white/[0.04] hover:border-teal-500/10 hover:bg-white/[0.01] transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative">
                          <div
                            onClick={() => openUserProfile(f.friend.id)}
                            className="cursor-pointer"
                          >
                            <AvatarImage
                              username={f.friend.username}
                              avatarUrl={f.friend.avatarUrl}
                              className="h-10 w-10 rounded-lg object-cover border border-white/10 bg-slate-800"
                            />
                          </div>
                          <span className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-slate-900 ${isOnline ? "bg-emerald-400" : "bg-slate-500"}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              onClick={() => openUserProfile(f.friend.id)}
                              className="cursor-pointer font-black text-xs uppercase text-slate-100 hover:text-teal-300 truncate"
                            >
                              {f.friend.username}
                            </span>
                            <span className="rounded bg-slate-800/80 border border-slate-700 px-1 py-0.5 text-[8px] font-mono font-black text-amber-300">
                              Lvl {f.friend.level || 1}
                            </span>
                          </div>
                          <p className="font-mono text-[9px] text-slate-400 mt-0.5">
                            {f.friend.elo} Elo • {isOnline ? "Online" : "Offline"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            playSound("select");
                            setDmFriendId(f.friend.id);
                            loadDmHistory(f.friend.id);
                          }}
                          className="rounded border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
                          title="Send Message"
                        >
                          <MessageSquare size={12} />
                        </button>
                        {isOnline && (
                          <button
                            onClick={() => {
                              playSound("select");
                              startDuelWithUser(f.friend.id);
                            }}
                            className="flex items-center gap-1 rounded bg-teal-400/10 border border-teal-400/30 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-teal-300 hover:bg-teal-400 hover:text-slate-950 transition duration-300"
                            title="Challenge to Duel"
                          >
                            <Swords size={12} />
                            Duel
                          </button>
                        )}
                        <button
                          onClick={() => openUserProfile(f.friend.id)}
                          className="rounded border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
                          title="View Profile"
                        >
                          <Users size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center opacity-30 py-8">
                  <Users size={36} className="text-slate-400 mb-2" />
                  <p className="font-black uppercase tracking-wider text-xs">No Friends Yet</p>
                  <p className="text-[10px] text-slate-400 max-w-xs mt-1">Search for rival campus students above and recruit them!</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* DM Conversation Modal */}
        <AnimatePresence>
          {dmFriendId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => setDmFriendId(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-panel-strong w-full max-w-lg rounded-2xl p-4 sm:p-6 max-h-[80vh] flex flex-col"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black uppercase tracking-widest text-teal-300">Direct Message</h3>
                  <button
                    onClick={() => setDmFriendId(null)}
                    className="rounded border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-[200px] max-h-[400px]">
                  {dmMessages[dmFriendId]?.length ? (
                    dmMessages[dmFriendId].map((msg) => {
                      const isOwn = msg.userId === account?.id;
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-xl px-3 py-2 ${isOwn
                              ? "bg-teal-400/20 border border-teal-400/30 text-white"
                              : "bg-white/5 border border-white/10 text-slate-200"
                              }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <AvatarImage
                                username={msg.username}
                                avatarUrl={msg.avatarUrl}
                                className="h-5 w-5 rounded-full object-cover"
                              />
                              <span className="text-[10px] font-bold uppercase text-slate-400">{msg.username}</span>
                            </div>
                            <p className="text-xs break-words">{msg.message}</p>
                            <p className="text-[9px] text-slate-500 mt-1">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-center opacity-40 py-8">
                      <MessageSquare size={36} className="text-slate-400 mb-2" />
                      <p className="font-black uppercase tracking-wider text-xs">No messages yet</p>
                      <p className="text-[10px] text-slate-400 max-w-xs mt-1">Start a conversation!</p>
                    </div>
                  )}
                </div>

                <form onSubmit={(e) => sendDmMessage(e, dmFriendId)} className="flex shrink-0 gap-2">
                  <input
                    value={chatMessageInput}
                    onChange={e => setChatMessageInput(e.target.value)}
                    placeholder="Type a message..."
                    maxLength={300}
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-teal-400/80"
                  />
                  <button
                    type="submit"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 transition duration-300 hover:from-teal-350 hover:to-emerald-350"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    );
  }

  function renderAuth() {
    return (
      <motion.section
        key="auth"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        className="grid min-w-0 items-center gap-6 py-4 sm:gap-8 lg:min-h-[calc(100vh-96px)] lg:grid-cols-[1.1fr_0.9fr]"
      >
        <div className="max-w-2xl">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm font-bold text-teal-200"
          >
            <Shield size={16} /> Account required
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="font-display text-3xl font-black uppercase leading-none tracking-normal text-glow-teal sm:text-5xl md:text-7xl"
          >
            Build your ranked identity.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 }}
            className="mt-6 max-w-xl text-lg leading-8 text-slate-300"
          >
            Your Elo, wins, losses, profile banner, and battle record now live on your account. No account, no queue.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28 }}
            className="mt-8 grid gap-4 sm:grid-cols-3"
          >
            <Stat icon={<Medal size={20} />} label="Starting Elo" value="1200" delay={0} />
            <Stat icon={<Flame size={20} />} label="Tracked" value="W/L" delay={0.06} />
            <Stat icon={<Crown size={20} />} label="Profile" value="Live" delay={0.12} />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.15 }}
          className="glass-panel-strong scanline-overlay relative rounded-2xl p-6"
        >
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-black/40 p-1 border border-white/5">
            {(["signup", "login"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => {
                  setAuthMode(mode);
                  setStatus("");
                  playSound("select");
                }}
                className={`rounded-lg py-3 text-sm font-black uppercase tracking-wider transition-all duration-300 ${authMode === mode ? "bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(45,212,191,0.2)]" : "text-slate-400 hover:text-white"}`}
              >
                {mode === "signup" ? "Create" : "Login"}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Username</span>
              <input value={authForm.username} onChange={event => setAuthForm({ ...authForm, username: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 outline-none transition focus:border-teal-400/80 focus:ring-1 focus:ring-teal-400/30" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Password</span>
              <input type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 outline-none transition focus:border-teal-400/80 focus:ring-1 focus:ring-teal-400/30" />
            </label>
            {status ? <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3.5 text-sm text-amber-100">{status}</p> : null}
            <motion.button
              whileHover={{ scale: isAuthBusy ? 1 : 1.02 }}
              whileTap={{ scale: isAuthBusy ? 1 : 0.98 }}
              onClick={authenticate}
              disabled={isAuthBusy}
              className="btn-arena-primary relative z-10 w-full py-4 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-10">{isAuthBusy ? "Working..." : authMode === "signup" ? "Create Account" : "Enter Arena"}</span>
            </motion.button>
          </div>
        </motion.div>
      </motion.section>
    );
  }

  function renderProfile() {
    if (!account) return null;

    return (
      <motion.section key="profile" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="min-w-0 space-y-4 sm:space-y-6">
        <div className="glass-panel overflow-hidden rounded-2xl scanline-overlay relative">
          <BannerContainer bannerUrl={account.bannerUrl} className="h-56 bg-cover bg-center relative">
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 to-transparent" />
          </BannerContainer>
          <div className="relative z-10 -mt-10 flex flex-col gap-4 px-4 pb-6 sm:gap-6 sm:px-6 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
              <AvatarImage username={account.username} avatarUrl={account.avatarUrl} alt={`${account.username} avatar`} className="h-24 w-24 rounded-2xl border-4 border-slate-900/80 bg-slate-800 object-cover shadow-2xl sm:h-32 sm:w-32" />
              <div className="min-w-0 pb-1">
                <p className="font-mono text-sm text-teal-300">@{account.username}</p>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <h1 className="text-2xl font-black uppercase tracking-normal text-white break-all sm:text-4xl">{account.username}</h1>
                  <span className="rounded bg-gradient-to-r from-teal-400 to-emerald-400 border border-teal-300 px-2 py-0.5 text-xs font-mono font-black text-slate-950 shadow-[0_0_12px_rgba(45,212,191,0.25)]">Lvl {account.level || 1}</span>
                </div>

                {/* XP Progress Bar */}
                <div className="mt-3 max-w-sm">
                  <div className="flex justify-between text-[9px] font-mono font-black uppercase text-slate-400 mb-1">
                    <span>Progression XP</span>
                    <span>{(account.xp || 0) % 500} / 500 XP</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-950/60 border border-white/5">
                    <div className="h-full bg-gradient-to-r from-teal-400 to-emerald-400 shadow-[0_0_8px_rgba(45,212,191,0.3)] transition-all duration-500" style={{ width: `${(((account.xp || 0) % 500) / 500) * 100}%` }} />
                  </div>
                </div>

                <p className="mt-4 max-w-xl text-slate-300">{account.bio}</p>
                <button
                  onClick={() => { playSound("select"); setShowFieldElosModal(true); }}
                  className="mt-4 flex items-center gap-2 rounded-lg border border-teal-400/30 bg-teal-400/5 px-3.5 py-2 text-xs font-black uppercase tracking-widest text-teal-300 hover:bg-teal-400/10 hover:text-white transition duration-300 shadow-[0_0_12px_rgba(45,212,191,0.05)]"
                >
                  View Discipline Elos
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <Stat icon={<Zap size={18} />} label="Elo" value={String(account.elo)} />
              <Stat icon={<Trophy size={18} />} label="Best" value={String(account.bestElo)} />
              <Stat icon={<Swords size={18} />} label="Games" value={String(account.gamesPlayed)} />
              <Stat icon={<Flame size={18} />} label="Win Rate" value={`${winRate}%`} />
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
          <div className="glass-panel rounded-2xl p-3 sm:p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-black uppercase"><Medal className="text-amber-300" /> Battle Record</h2>
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={<Trophy size={18} />} label="Wins" value={String(account.wins)} />
              <Stat icon={<Skull size={18} />} label="Losses" value={String(account.losses)} />
            </div>
            <div className="mt-5 rounded-lg bg-black/30 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Joined</p>
              <p className="mt-1 font-mono text-sm text-slate-200">{new Date(account.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-3 sm:p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black uppercase sm:text-xl"><Camera className="text-teal-300" /> Edit Profile</h2>
            <div className="grid gap-4">
              <input value={profileForm.username} onChange={event => setProfileForm({ ...profileForm, username: event.target.value })} placeholder="Username" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-teal-300" />
              <input value={profileForm.bio} onChange={event => setProfileForm({ ...profileForm, bio: event.target.value })} placeholder="Bio" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-teal-300" />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="cursor-pointer rounded-lg border border-white/10 bg-black/30 p-4 transition hover:border-teal-300/60 hover:bg-teal-300/10">
                  <span className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-teal-200"><Camera size={16} /> Avatar File</span>
                  <div className="flex items-center gap-4">
                    <AvatarImage username={profileForm.username || account?.username} avatarUrl={profileForm.avatarUrl} className="h-16 w-16 rounded-lg bg-slate-800 object-cover" />
                    <span className="text-sm text-slate-300">Choose from your PC</span>
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={event => setProfileImage("avatarUrl", event.target.files?.[0])} />
                </label>
                <label className="cursor-pointer rounded-lg border border-white/10 bg-black/30 p-4 transition hover:border-teal-300/60 hover:bg-teal-300/10">
                  <span className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-teal-200"><Camera size={16} /> Banner File</span>
                  <BannerContainer bannerUrl={profileForm.bannerUrl} className="h-16 rounded-lg bg-cover bg-center" />
                  <input type="file" accept="image/*" className="hidden" onChange={event => setProfileImage("bannerUrl", event.target.files?.[0])} />
                </label>
              </div>
              {status ? <p className="text-sm text-teal-200">{status}</p> : null}
              <button onClick={saveProfile} disabled={isProfileBusy} className="rounded-lg bg-teal-300 px-5 py-3 font-black uppercase tracking-widest text-slate-950 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60">{isProfileBusy ? "Saving..." : "Save Profile"}</button>
            </div>
          </div>
        </div>
      </motion.section>
    );
  }

  function renderLeaderboard() {
    return (
      <motion.section key="leaderboard" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="grid min-w-0 gap-4 lg:grid-cols-[1fr_0.85fr] lg:gap-6">
        <div className="glass-panel min-w-0 rounded-2xl p-3 sm:p-5">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-teal-300">Global Ladder</p>
              <h1 className="font-display text-2xl font-black uppercase tracking-normal text-glow-teal sm:text-3xl">Leaderboard</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { playSound("select"); setShowFieldElosModal(true); }}
                className="rounded-lg border border-amber-300/30 px-3.5 py-2 text-xs font-black uppercase tracking-widest text-amber-200 hover:bg-amber-300/10 transition duration-300"
              >
                Your Field Elos
              </button>
              <button onClick={() => refreshPlayerMeta()} className="rounded-lg border border-teal-300/30 px-3.5 py-2 text-xs font-black uppercase tracking-widest text-teal-200 hover:bg-teal-300/10 transition duration-300">
                {isMetaLoading ? "Syncing" : "Refresh"}
              </button>
            </div>
          </div>

          {/* New Field-wise Leaderboard Selector */}
          <div className="mb-5 space-y-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search players..."
                value={leaderboardSearch}
                onChange={(e) => setLeaderboardSearch(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-slate-950/45 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 backdrop-blur-md focus:border-teal-400/50 focus:outline-none focus:ring-1 focus:ring-teal-400/50 transition-all"
              />
            </div>

            {/* Sort Buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { playSound("select"); setLeaderboardSort("elo"); }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all ${leaderboardSort === "elo"
                  ? "bg-teal-400 text-slate-950 border-teal-400 font-black shadow-[0_0_12px_rgba(45,212,191,0.15)]"
                  : "bg-slate-950/45 text-slate-400 border-white/[0.08] hover:text-white hover:border-teal-500/20"
                  }`}
              >
                Elo
              </button>
              <button
                onClick={() => { playSound("select"); setLeaderboardSort("level"); }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all ${leaderboardSort === "level"
                  ? "bg-teal-400 text-slate-950 border-teal-400 font-black shadow-[0_0_12px_rgba(45,212,191,0.15)]"
                  : "bg-slate-950/45 text-slate-400 border-white/[0.08] hover:text-white hover:border-teal-500/20"
                  }`}
              >
                Level
              </button>
              <button
                onClick={() => { playSound("select"); setLeaderboardSort("wins"); }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all ${leaderboardSort === "wins"
                  ? "bg-teal-400 text-slate-950 border-teal-400 font-black shadow-[0_0_12px_rgba(45,212,191,0.15)]"
                  : "bg-slate-950/45 text-slate-400 border-white/[0.08] hover:text-white hover:border-teal-500/20"
                  }`}
              >
                Wins
              </button>
              <button
                onClick={() => { playSound("select"); setLeaderboardSort("winRate"); }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all ${leaderboardSort === "winRate"
                  ? "bg-teal-400 text-slate-950 border-teal-400 font-black shadow-[0_0_12px_rgba(45,212,191,0.15)]"
                  : "bg-slate-950/45 text-slate-400 border-white/[0.08] hover:text-white hover:border-teal-500/20"
                  }`}
              >
                Win Rate
              </button>
            </div>

            {/* Field-wise Leaderboard Selector */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Rank by Academic Field:</p>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin sm:flex-wrap sm:overflow-visible">
                {FIELDS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { playSound("select"); setLeaderboardField(f.id); }}
                    className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition duration-300 border sm:px-3 sm:text-xs ${leaderboardField === f.id
                      ? "bg-teal-400 text-slate-950 border-teal-400 font-black shadow-[0_0_12px_rgba(45,212,191,0.15)]"
                      : "bg-slate-950/45 text-slate-400 border-white/[0.08] hover:text-white hover:border-teal-500/20"
                      }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {isMetaLoading ? (
              // Glassmorphic loading skeletons
              Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="rounded-xl border border-white/[0.06] bg-slate-950/20 p-3 sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-3 sm:p-3.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-white/5 animate-pulse sm:w-10 sm:h-10" />
                    <div className="h-10 w-10 shrink-0 rounded-lg bg-white/5 animate-pulse sm:h-11 sm:w-11" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-24 rounded bg-white/5 animate-pulse" />
                      <div className="h-3 w-16 rounded bg-white/5 animate-pulse" />
                    </div>
                  </div>
                  <div className="mt-2 sm:mt-0 sm:text-right">
                    <div className="h-5 w-16 rounded bg-white/5 animate-pulse" />
                  </div>
                </div>
              ))
            ) : displayLeaderboard.length ? displayLeaderboard.map(entry => {
              const isSelf = entry.user.id === account?.id;
              const rank = entry.rank;
              const rankIcon = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
              const rankColor = rank === 1 ? "text-amber-400" : rank === 2 ? "text-slate-300" : rank === 3 ? "text-amber-600" : "text-slate-400";
              const wins = leaderboardField === "all" ? entry.user.wins : (entry.user.fieldStats?.[leaderboardField]?.wins || 0);
              const losses = leaderboardField === "all" ? entry.user.losses : (entry.user.fieldStats?.[leaderboardField]?.losses || 0);
              const totalGames = wins + losses;
              const wrPercent = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
              return (
                <motion.div
                  key={entry.user.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(rank * 0.03, 0.25) }}
                  onClick={() => openUserProfile(entry.user.id)}
                  className={`cursor-pointer rounded-xl border p-3 card-hover-lift min-w-0 sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-3 sm:p-3.5 ${isSelf ? "border-teal-400/40 bg-teal-400/[0.06] shadow-[0_0_15px_rgba(45,212,191,0.08)]" : "border-white/[0.06] bg-slate-950/20"} ${rank <= 3 ? "ring-1 ring-amber-400/10" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                    <div className={`w-8 shrink-0 text-center font-mono text-base font-black sm:w-10 sm:text-lg ${rankColor}`}>{rankIcon}</div>
                    <AvatarImage username={entry.user.username} avatarUrl={entry.user.avatarUrl} className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover sm:h-11 sm:w-11" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="truncate font-black text-sm uppercase tracking-wide text-slate-100">{entry.user.username}</p>
                        <span className="shrink-0 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] font-mono font-black text-amber-300">Lvl {entry.user.level || 1}</span>
                      </div>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-slate-400 sm:text-[10px]">{wins}W / {losses}L · {wrPercent}% WR</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 sm:mt-0 sm:block sm:border-0 sm:pt-0 sm:text-right">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500 sm:hidden">{leaderboardField === "all" ? "Global Elo" : "Field Elo"}</p>
                    <p className="font-mono text-lg font-black text-teal-300">{entry.displayElo}</p>
                    <p className="hidden text-[9px] uppercase tracking-widest text-slate-500 sm:block">{leaderboardField === "all" ? "Global Elo" : "Field Elo"}</p>
                  </div>
                </motion.div>
              );
            }) : (
              <div className="rounded-xl border border-white/[0.06] bg-slate-950/20 p-8 text-center text-slate-400">No ranked players yet.</div>
            )}
          </div>
        </div>

        <div className="glass-panel min-w-0 rounded-2xl p-3 sm:p-5">
          <p className="text-xs font-black uppercase tracking-widest text-amber-300">Your Timeline</p>
          <h2 className="font-display mb-4 text-xl font-black uppercase tracking-normal sm:mb-5 sm:text-2xl">Recent Matches</h2>
          <div className="space-y-3">
            {recentMatches.length ? recentMatches.map(match => {
              const p1Name = match.player_one_name || match.playerOneName || "Player 1";
              const p2Name = match.player_two_name || match.playerTwoName || "Player 2";
              const p1Id = match.player_one_id ?? match.playerOneId;
              const p2Id = match.player_two_id ?? match.playerTwoId;
              const winnerId = match.winner_id ?? match.winnerId;
              const loserId = match.loser_id ?? match.loserId;
              const myId = account?.id;
              const iAmP1 = myId && p1Id === myId;
              const myDelta = iAmP1
                ? (match.player_one_delta ?? match.playerOneDelta ?? 0)
                : (match.player_two_delta ?? match.playerTwoDelta ?? 0);
              const isWin = Boolean(myId && winnerId === myId);
              const isLoss = Boolean(myId && loserId === myId);
              const oppName = iAmP1 ? p2Name : p1Name;
              const finished = match.finished_at || match.finishedAt;
              const isBotMatch = !winnerId || !loserId || p1Name.toLowerCase().includes("bot") || p2Name.toLowerCase().includes("bot");

              return (
                <div
                  key={match.id}
                  className={`rounded-lg border p-4 ${isWin ? "border-emerald-500/30 bg-emerald-500/[0.06]" : isLoss ? "border-red-500/25 bg-red-500/[0.05]" : "border-white/10 bg-black/25"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${isWin ? "bg-emerald-500/20 text-emerald-300" : isLoss ? "bg-red-500/20 text-red-300" : "bg-slate-700 text-slate-300"}`}>
                          {isWin ? "Victory" : isLoss ? "Defeat" : "Match"}
                        </span>
                        {isBotMatch && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[9px] font-mono text-slate-400">Practice</span>
                        )}
                      </div>
                      <p className="truncate font-black text-slate-100">
                        vs <span className="text-teal-200">{oppName}</span>
                      </p>
                      <p className="text-[10px] font-bold text-teal-300/80 mt-1 uppercase tracking-widest">
                        🏟️ {match.domain && match.domain !== "all" ? match.domain : "All Subjects"}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-xs text-slate-500">{finished ? new Date(finished).toLocaleDateString() : ""}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <p className="rounded bg-white/5 p-2 text-center font-mono text-slate-300">{match.rounds} rounds</p>
                    <p className={`rounded p-2 text-center font-mono font-bold ${myDelta >= 0 ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
                      {isBotMatch ? "No Elo change" : `${myDelta >= 0 ? "+" : ""}${myDelta} Elo`}
                    </p>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-lg border border-white/10 bg-black/25 p-8 text-center text-slate-400">Your matches will appear here after ranked games.</div>
            )}
          </div>
        </div>
      </motion.section>
    );
  }

  function renderGame() {
    return (
      <motion.section key="game" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="min-h-[calc(100vh-96px)]">
        <AnimatePresence mode="wait">
          {gameState === "menu" && (
            <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid min-w-0 items-center gap-4 py-2 sm:gap-6 lg:min-h-[calc(100vh-120px)] lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5">
                <div className="glass-panel overflow-hidden rounded-2xl scanline-overlay relative">
                  <BannerContainer bannerUrl={account?.bannerUrl} className="h-32 bg-cover bg-center relative opacity-80">
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 to-transparent" />
                  </BannerContainer>
                  <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-end relative z-10 -mt-10">
                    <div className="flex min-w-0 items-end gap-4">
                      <AvatarImage username={account?.username} avatarUrl={account?.avatarUrl} className="h-24 w-24 rounded-2xl border-4 border-slate-900/80 bg-white/10 object-cover shadow-2xl" />
                      <div className="min-w-0 pb-1">
                        <p className="font-mono text-sm text-teal-300">@{account?.username}</p>
                        <h1 className="text-2xl font-black uppercase tracking-normal text-white break-all sm:text-4xl md:text-5xl">{account?.username}</h1>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat icon={<Zap size={20} />} label="Elo" value={String(account?.elo || player.elo)} delay={0} />
                  <Stat icon={<Trophy size={20} />} label="Best" value={String(account?.bestElo || player.elo)} delay={0.05} />
                  <Stat icon={<Swords size={20} />} label="Games" value={String(account?.gamesPlayed || 0)} delay={0.1} />
                  <Stat icon={<Flame size={20} />} label="Win Rate" value={`${winRate}%`} delay={0.15} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="glass-panel rounded-2xl border-teal-500/20 bg-teal-950/25 p-5 shadow-[0_0_40px_rgba(45,212,191,0.06)]">
                  <h2 className="font-display text-3xl font-black uppercase tracking-normal text-teal-100">Choose your queue</h2>
                  <p className="mt-2 text-sm text-slate-300 leading-relaxed">Ranked uses your account Elo. Bot matches are safe practice, they do not affect your elo.</p>

                  <div className="mt-5 border-t border-white/[0.08] pt-4">
                    <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Select Queue Type</p>
                    <div className="grid gap-2 grid-cols-2 mb-4 bg-black/40 p-1.5 rounded-xl border border-white/5">
                      <button
                        onClick={() => { playSound("select"); setQueueMode("global"); setSelectedField("all"); }}
                        className={`py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all duration-300 ${queueMode === "global"
                          ? "bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(45,212,191,0.2)]"
                          : "text-slate-400 hover:text-white"
                          }`}
                      >
                        Main Queue
                      </button>
                      <button
                        onClick={() => { playSound("select"); setQueueMode("field"); if (selectedField === "all" || !selectedField) setSelectedField("Common / First Year"); }}
                        className={`py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all duration-300 ${queueMode === "field"
                          ? "bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(45,212,191,0.2)]"
                          : "text-slate-400 hover:text-white"
                          }`}
                      >
                        Field-wise Queue
                      </button>
                    </div>

                    {queueMode === "global" ? (
                      <p className="text-xs text-slate-400 mb-4 leading-relaxed">Global Queue will search for active opponents across all subjects. All disciplines are included in this mode.</p>
                    ) : (
                      <div className="mb-4">
                        <p className="text-xs text-slate-400 mb-3 leading-relaxed">Choose which academic discipline to compete in:</p>
                        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                          {FIELDS.filter(f => f.id !== "all").map(field => {
                            const isSelected = selectedField === field.id;
                            return (
                              <button
                                key={field.id}
                                onClick={() => { playSound("select"); setSelectedField(field.id); }}
                                className={`p-3 rounded-lg border text-left font-bold text-xs uppercase tracking-wider transition-all truncate ${isSelected
                                  ? "border-teal-300 bg-teal-300/10 text-teal-200 shadow-[0_0_15px_rgba(45,212,191,0.15)]"
                                  : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:bg-black/30"
                                  }`}
                              >
                                {field.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => joinQueue(false)} className="btn-arena-primary px-6 py-5">
                      <span className="relative z-10">Find Ranked Match</span>
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => joinQueue(true)} className="btn-arena-ghost px-6 py-5">
                      Play vs AI Bot
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === "queue" && (
            <motion.div key="queue" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="grid min-h-[calc(100vh-120px)] place-items-center text-center">
              <div>
                <div className="relative mx-auto mb-8 h-32 w-32">
                  <span className="queue-ring" />
                  <span className="queue-ring queue-ring-delay" />
                  <div className="absolute inset-2 animate-spin rounded-full border-4 border-teal-300/15 border-t-teal-300 border-r-emerald-400/60" />
                  <div className="absolute inset-0 grid place-items-center">
                    <Swords size={36} className="text-teal-300" />
                  </div>
                </div>
                <motion.h2
                  animate={{ opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="font-display text-4xl font-black uppercase tracking-widest text-teal-200 text-glow-teal"
                >
                  Searching
                </motion.h2>
                <p className="mt-2 font-mono text-slate-400">Scanning the global arena for opponents...</p>
              </div>
            </motion.div>
          )}

          {gameState === "versus_intro" && (
            <motion.div key="versus" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative -mx-4 grid min-h-[calc(100vh-96px)] place-items-center overflow-hidden rounded-lg border border-white/10 bg-black">
              <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 80, damping: 18 }} className="absolute left-0 top-0 h-1/2 w-full overflow-hidden md:h-full md:w-[52%]">
                <BannerContainer bannerUrl={player.bannerUrl || account?.bannerUrl} className="absolute inset-0 bg-cover bg-center opacity-60" />
                <div className="absolute inset-0 bg-gradient-to-r from-teal-500/55 via-slate-950/70 to-slate-950/90" />
                <VersusPlayer profile={{ ...player, avatarUrl: getImageUrl(player.avatarUrl || account?.avatarUrl), bannerUrl: getImageUrl(player.bannerUrl || account?.bannerUrl) }} side="left" />
              </motion.div>

              <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 80, damping: 18, delay: 0.1 }} className="absolute bottom-0 right-0 h-1/2 w-full overflow-hidden md:h-full md:w-[52%]">
                <BannerContainer bannerUrl={opponent.bannerUrl} className="absolute inset-0 bg-cover bg-center opacity-60" />
                <div className="absolute inset-0 bg-gradient-to-l from-red-500/55 via-slate-950/70 to-slate-950/90" />
                <VersusPlayer profile={{ ...opponent, avatarUrl: getImageUrl(opponent.avatarUrl), bannerUrl: getImageUrl(opponent.bannerUrl) }} side="right" />
              </motion.div>

              <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 rounded-full border border-teal-300/20 bg-teal-950/85 px-4 py-2 text-xs font-black uppercase tracking-widest text-teal-200 backdrop-blur shadow-[0_0_30px_rgba(45,212,191,0.2)]">
                🏟️ {matchData?.domain && matchData.domain !== 'all' ? `${matchData.domain} Arena` : 'All Subjects Arena'}
              </div>

              <motion.div
                initial={{ scale: 0.5, opacity: 0, rotate: -8 }}
                animate={{ scale: [1, 1.06, 1], opacity: 1, rotate: 0 }}
                transition={{ delay: 0.45, scale: { duration: 1.8, repeat: Infinity, ease: "easeInOut" }, type: "spring", stiffness: 180, damping: 12 }}
                className="vs-badge-glow relative z-20 flex h-24 w-24 items-center justify-center rounded-full border-4 border-slate-950 bg-gradient-to-br from-amber-400 to-orange-500 font-display text-4xl font-black italic text-slate-950 md:h-28 md:w-28 md:text-5xl"
              >
                VS
              </motion.div>
            </motion.div>
          )}

          {gameState === "initial_discard" && (
            <motion.div key="discard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mx-auto flex min-h-[calc(100vh-120px)] max-w-5xl flex-col items-center justify-center gap-8">
              <h2 className="text-center text-4xl font-black uppercase md:text-5xl">Initial Discard Phase</h2>
              <p className="text-center text-slate-300">{lockedSubject === "WAITING" ? "Waiting for opponent to decide..." : "Select up to 1 card to discard from your hand"}</p>
              <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-5">
                {hand.map((sub, i) => (
                  <motion.button
                    key={sub}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    whileHover={lockedSubject !== "WAITING" ? { scale: 1.03, y: -2 } : undefined}
                    onClick={() => { if (lockedSubject !== "WAITING") { playSound("select"); setLockedSubject(lockedSubject === sub ? null : sub); } }}
                    disabled={lockedSubject === "WAITING"}
                    className={`flex min-h-36 items-center justify-center rounded-lg border p-4 text-center font-bold transition ${lockedSubject === sub ? "border-red-300 bg-red-500/30 text-white shadow-[0_0_20px_rgba(239,68,68,0.2)]" : "border-white/15 bg-white/[0.06] hover:bg-white/10 hover:border-red-300/40"}`}
                  >
                    {sub}
                  </motion.button>
                ))}
              </div>
              {lockedSubject !== "WAITING" ? (
                <div className="flex gap-3">
                  <button onClick={() => { playSound("confirm"); socketRef.current?.emit("discard_action", { subject: lockedSubject }); setLockedSubject("WAITING"); }} disabled={!lockedSubject || !hand.includes(lockedSubject)} className="rounded-lg bg-red-500 px-6 py-3 font-black uppercase tracking-widest disabled:opacity-40">Discard</button>
                  <button onClick={() => { playSound("confirm"); socketRef.current?.emit("skip_discard"); setLockedSubject("WAITING"); }} className="rounded-lg border border-white/15 bg-white/10 px-6 py-3 font-black uppercase tracking-widest">Keep All</button>
                </div>
              ) : null}
            </motion.div>
          )}

          {gameState === "drafting" && (
            <motion.div key="drafting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mx-auto flex min-h-[calc(100vh-120px)] max-w-5xl flex-col justify-center gap-7">
              <DuelHeader player={player} opponent={opponent} matchData={matchData} />
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-4xl font-black uppercase">Play a Card</h2>
                  <p className="mt-2 font-mono text-teal-200">{matchData?.draftTurn === socketId ? "YOUR TURN" : "OPPONENT IS PLAYING"}</p>
                </div>
              </div>
              <div className="grid max-h-[54vh] grid-cols-2 gap-4 overflow-y-auto p-1 md:grid-cols-5">
                {matchData?.draftTurn === socketId ? hand.map((sub, index) => (
                  <motion.button
                    key={index + sub}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    whileHover={lockedSubject === null ? { scale: 1.04, y: -3 } : undefined}
                    onClick={() => pickSubject(sub)}
                    disabled={lockedSubject !== null}
                    className={`flex min-h-36 flex-col justify-center rounded-lg border p-4 text-center font-bold transition ${lockedSubject === sub ? "border-teal-200 bg-teal-300 text-slate-950 shadow-[0_0_24px_rgba(45,212,191,0.25)]" : "border-white/15 bg-white/[0.06] hover:border-teal-300/60 hover:bg-teal-300/10"}`}
                  >
                    {sub}
                  </motion.button>
                )) : [1, 2, 3, 4, 5].map(i => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.3, 0.7, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.15 }}
                    className="grid min-h-36 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-4xl font-black text-slate-600"
                  >
                    ?
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {gameState === "battle" && (
            <motion.div
              key={`battle-${roundData?.round ?? 0}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`mx-auto flex w-full min-w-0 max-w-5xl flex-col justify-center gap-5 px-0 sm:gap-8 sm:px-2 ${isShaking ? "animate-[shake_0.4s_ease-in-out]" : ""}`}
            >
              <DuelHeader player={player} opponent={opponent} matchData={matchData} />
              <BattleTimerBar
                roundKey={`${matchData?.currentRound ?? 0}-${roundData?.round ?? 0}`}
                timeLimit={roundData?.question?.timeLimit || 15}
                paused={!!roundResult}
              />
              <div className="text-center">
                <p className="mb-5 inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-100">{selectedSubject}</p>
                <h2 className="mx-auto max-w-3xl px-1 font-sans text-lg font-semibold normal-case leading-snug tracking-normal text-slate-100 sm:text-2xl md:text-4xl">
                  {roundData?.question.prompt}
                </h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {roundData?.question.options.map((opt: string, i: number) => {
                  const myAns = socketId && roundResult ? roundResult.answers[socketId]?.answer : null;
                  const oppId = roundResult ? opponent?.id || Object.keys(roundResult.answers).find(id => id !== socketId) : null;
                  const oppAns = oppId && roundResult ? roundResult.answers[oppId]?.answer : null;
                  let buttonClass = "border-white/[0.08] bg-slate-900/40 hover:border-teal-500/30 hover:bg-slate-900/60";
                  if (roundResult?.correctAnswer === i) buttonClass = "border-emerald-500/50 bg-emerald-500/10 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.1)]";
                  else if (myAns === i) buttonClass = "border-rose-500/50 bg-rose-500/10 text-rose-200";
                  else if (oppAns === i) buttonClass = "border-amber-500/50 bg-amber-500/10 text-amber-200";
                  else if (myAnswer === i) buttonClass = "border-teal-400 bg-teal-400/15 text-teal-200 shadow-[0_0_20px_rgba(45,212,191,0.08)]";

                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => submitAnswer(i)}
                      disabled={!!roundResult || myAnswer !== null}
                      className={`group relative overflow-hidden rounded-2xl border-2 p-6 text-left text-lg font-bold transition-colors duration-200 ${buttonClass}`}
                    >
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest opacity-50 group-hover:opacity-85 transition-opacity">Option {i + 1}</span>
                      {opt}
                    </button>
                  );
                })}
              </div>

              <AnimatePresence>
                {roundResult && socketId ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.82, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/20 backdrop-blur-[2px]"
                  >
                    <div className="max-w-xl rounded-lg border border-white/15 bg-slate-950/95 p-8 text-center shadow-[0_0_70px_rgba(0,0,0,0.8)]">
                      {roundResult.damageDealt[socketId] > 0 ? (
                        <div className="text-red-300">
                          <Skull size={64} className="mx-auto mb-4" />
                          <p className="text-5xl font-black uppercase">-{roundResult.damageDealt[socketId]} HP</p>
                          <p className="mt-3 text-sm font-black uppercase tracking-widest text-red-200/80">
                            {roundResult.answers[socketId] ? "Wrong or slower answer" : "Time out"}
                          </p>
                        </div>
                      ) : opponent.id && roundResult.damageDealt[opponent.id] > 0 ? (
                        <div className="text-teal-200">
                          <Zap size={64} className="mx-auto mb-4" />
                          <p className="text-5xl font-black uppercase">Hit +{roundResult.damageDealt[opponent.id]}</p>
                          <p className="mt-3 text-sm font-black uppercase tracking-widest text-teal-100/80">You dealt damage</p>
                        </div>
                      ) : (
                        <div className="text-amber-200">
                          <Shield size={64} className="mx-auto mb-4" />
                          <p className="text-5xl font-black uppercase">Trade</p>
                          <p className="mt-3 text-sm font-black uppercase tracking-widest text-amber-100/80">Both players took damage</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          )}

          {gameState === "results" && (
            <motion.div key="results" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="grid min-h-[calc(100vh-120px)] place-items-center text-center">
              <div>
                <motion.div
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 200, damping: 14 }}
                >
                  {winnerInfo?.winner === socketId ? (
                    <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
                      <Trophy size={96} className="mx-auto mb-6 text-amber-300 drop-shadow-[0_0_24px_rgba(251,191,36,0.4)]" />
                    </motion.div>
                  ) : (
                    <Skull size={96} className="mx-auto mb-6 text-red-400 drop-shadow-[0_0_24px_rgba(248,113,113,0.35)]" />
                  )}
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className={`font-display text-6xl font-black uppercase ${winnerInfo?.winner === socketId ? "text-glow-teal text-teal-200" : "text-red-300"}`}
                >
                  {winnerInfo?.winner === socketId ? "Victory" : "Defeat"}
                </motion.h2>
                <div className="mx-auto my-8 w-80 rounded-2xl border border-white/[0.08] bg-slate-900/40 p-6 shadow-xl backdrop-blur-md">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">New Rating</p>
                  <p className="mt-2 font-mono text-5xl font-black text-teal-300">{winnerInfo?.elo}</p>
                  <p className={`mt-2 font-bold ${(winnerInfo?.eloDelta ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{(winnerInfo?.eloDelta ?? 0) >= 0 ? "+" : ""}{winnerInfo?.eloDelta ?? 0} Elo</p>
                </div>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => { playSound("select"); setGameState("menu"); }} className="btn-arena-primary mt-2 px-8 py-4">
                  <span className="relative z-10">Return to Menu</span>
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    );
  }

  function DuelHeader({
    player: playerProfile,
    opponent: opponentProfile,
    matchData: matchInfo,
  }: {
    player: FighterProfile;
    opponent: FighterProfile;
    matchData: MatchData | null;
  }) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-teal-200 bg-teal-950/80 px-3 py-1 rounded-full border border-teal-500/20 shadow-[0_0_15px_rgba(45,212,191,0.1)]">
            🏟️ {matchInfo?.domain && matchInfo.domain !== "all" ? `${matchInfo.domain} Arena` : "All Subjects Arena"}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <Fighter profile={playerProfile} tone="teal" />
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-900 text-xs font-black italic text-slate-400 mx-auto shadow-md">
            VS
          </div>
          <Fighter profile={opponentProfile} tone="red" alignRight />
        </div>
      </div>
    );
  }
}

function ArenaBackdrop() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[#070912]" />
      <div className="arena-orb arena-orb-1" />
      <div className="arena-orb arena-orb-2" />
      <div className="arena-orb arena-orb-3" />
      <div className="arena-grid" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,rgba(7,9,18,0.4)_50%,rgba(7,9,18,0.85)_100%)]" />
    </div>
  );
}

const BattleTimerBar = memo(function BattleTimerBar({
  timeLimit,
  roundKey,
  paused,
}: {
  timeLimit: number;
  roundKey: string;
  paused: boolean;
}) {
  const [timeLeft, setTimeLeft] = useState(timeLimit);

  useEffect(() => {
    setTimeLeft(timeLimit);
    if (paused) return;

    const tickMs = 250;
    const timer = setInterval(() => {
      setTimeLeft(t => Math.max(0, t - tickMs / 1000));
    }, tickMs);

    return () => clearInterval(timer);
  }, [timeLimit, roundKey, paused]);

  const pct = Math.max(0, Math.min(100, (timeLeft / timeLimit) * 100));
  const urgent = timeLeft < 5 && !paused;

  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-black/50 border border-white/5 shadow-inner">
      <div
        className={`h-full rounded-full transition-[width] duration-200 ease-linear ${urgent ? "bg-gradient-to-r from-red-500 to-orange-400 hp-bar-low" : "bg-gradient-to-r from-teal-400 to-emerald-400"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});

const Fighter = memo(function Fighter({ profile, tone, alignRight = false }: { profile: FighterProfile; tone: "teal" | "red"; alignRight?: boolean }) {
  const color = tone === "teal" ? "from-teal-300 to-blue-400" : "from-red-400 to-amber-300";
  const avatar = profile.avatarUrl ? getImageUrl(profile.avatarUrl) : "";
  const banner = profile.bannerUrl ? getImageUrl(profile.bannerUrl) : "";
  const hp = Math.max(0, Math.min(100, profile.hp));

  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/[0.08] bg-slate-950/45 p-3 shadow-lg backdrop-blur-md sm:p-4">
      {banner && (
        <BannerContainer
          bannerUrl={profile.bannerUrl}
          className="absolute inset-0 bg-cover bg-center opacity-30"
        />
      )}
      <div className={`absolute inset-0 bg-gradient-to-t ${tone === "teal" ? "from-slate-950 via-slate-950/80" : "from-slate-950 via-slate-950/80"} to-slate-950/30`} />

      <div className={`relative z-10 flex ${alignRight ? "flex-row-reverse text-right" : "flex-row"} items-center gap-3`}>
        {avatar && (
          <AvatarImage
            username={profile.username || profile.name}
            avatarUrl={profile.avatarUrl}
            className="h-12 w-12 rounded-lg object-cover border border-white/10 shadow-md shrink-0 bg-slate-800"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className={`flex ${alignRight ? "flex-row-reverse" : "flex-row"} items-center justify-between gap-2`}>
            <div className={`flex ${alignRight ? "flex-row-reverse" : "flex-row"} items-center gap-1.5 min-w-0`}>
              <span className="truncate font-black text-xs uppercase tracking-wide text-slate-100 sm:text-sm">{profile.name}</span>
              <span className="shrink-0 rounded bg-slate-800 border border-slate-700 px-1 py-0.5 text-[8px] font-mono font-black text-amber-300">Lvl {profile.level || 1}</span>
            </div>
            <span className="font-mono text-[10px] font-black text-teal-300 shrink-0">{profile.elo} Elo</span>
          </div>
          <div className="mt-2.5">
            <div className="h-2.5 overflow-hidden rounded-full bg-black/60 border border-white/5">
              <div
                className={`h-full bg-gradient-to-r ${color} transition-[width] duration-300 ease-out ${hp < 30 ? "hp-bar-low" : ""}`}
                style={{ width: `${hp}%` }}
              />
            </div>
            <div className={`mt-1 flex ${alignRight ? "flex-row-reverse" : "flex-row"} items-center justify-between text-[9px] font-mono text-slate-400`}>
              <span>{hp} HP</span>
              <span>{hp} / 100</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function VersusPlayer({ profile, side }: { profile: FighterProfile; side: "left" | "right" }) {
  const align = side === "left" ? "items-start text-left md:pl-16 md:pr-28" : "items-end text-right md:pl-28 md:pr-16";

  return (
    <div className={`absolute z-10 flex h-full w-full flex-col justify-center gap-4 p-8 ${align}`}>
      <motion.div
        initial={{ scale: 0.75, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.35 }}
      >
        <AvatarImage
          username={profile.username || profile.name}
          avatarUrl={profile.avatarUrl}
          className="h-20 w-20 rounded-full border-4 border-white/80 bg-slate-900 object-cover shadow-2xl md:h-24 md:w-24"
        />
      </motion.div>
      <motion.div initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }} className="max-w-[min(28rem,78vw)] md:max-w-[22rem]">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="break-words text-3xl font-black uppercase leading-none tracking-normal text-white drop-shadow-lg md:text-4xl">{profile.name}</p>
          <span className="rounded bg-gradient-to-r from-teal-400 to-emerald-400 border border-teal-300 px-2 py-0.5 text-xs font-mono font-black text-slate-950 shadow-[0_0_12px_rgba(45,212,191,0.25)]">Lvl {profile.level || 1}</span>
        </div>
        <p className="mt-2 font-mono text-lg text-white/80">Rating: {profile.elo.toLocaleString()}</p>
      </motion.div>
    </div>
  );
}

function Stat({ icon, label, value, delay = 0 }: { icon: React.ReactNode; label: string; value: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-slate-950/45 p-4 card-hover-lift"
    >
      <div className="absolute -right-2 -bottom-2 opacity-[0.07] text-teal-400 group-hover:scale-125 transition-transform duration-500">
        {icon}
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-teal-400/0 via-teal-400/0 to-teal-400/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="relative mb-3 flex items-center justify-between">
        <span className="text-teal-400/90 group-hover:text-teal-300 transition-colors">{icon}</span>
      </div>
      <p className="relative text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="relative mt-1.5 font-mono text-2xl font-black text-white group-hover:text-teal-200 transition-colors">{value}</p>
    </motion.div>
  );
}
