import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`
const socket = io(SERVER_URL)

// ── Shared constants (outside App so they're stable references) ────────────────
const LEVELS = [
  { level: 1, title: 'Newcomer', minXP: 0 },
  { level: 2, title: 'Music Fan', minXP: 100 },
  { level: 3, title: 'DJ in Training', minXP: 250 },
  { level: 4, title: 'Crowd Pleaser', minXP: 500 },
  { level: 5, title: 'Vibe Master', minXP: 1000 },
  { level: 6, title: 'Legend', minXP: 2000 },
]

const COLORS = ['#e94560','#f97316','#eab308','#22c55e','#06b6d4','#6366f1','#a855f7','#ec4899','#ffffff']

// Colors unlocked at each level — visible in chat and the users panel
const LEVEL_COLORS = { 1: '#888', 2: '#6366f1', 3: '#06b6d4', 4: '#22c55e', 5: '#f97316', 6: '#eab308' }
const REACTION_EMOJIS = ['🔥', '❤️', '😂', '👏', '🎵', '💯']

const getLevel = (xp) => {
  let current = LEVELS[0]
  for (const l of LEVELS) { if (xp >= l.minXP) current = l }
  return current
}

const getNextLevel = (xp) => LEVELS.find(l => l.minXP > xp) || null

const formatTime = (secs) => {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60), sc = Math.floor(secs % 60)
  return `${m}:${sc.toString().padStart(2, '0')}`
}

// Shared styles object — defined once outside App so it's never recreated
const s = {
  input: { width: '100%', padding: '14px 18px', borderRadius: 10, border: '1px solid var(--col-border)', background: 'var(--col-bg)', color: 'var(--col-text)', fontSize: 15, boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s' },
  btn: { padding: '12px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 15, transition: 'opacity 0.15s, transform 0.1s, filter 0.15s, background 0.15s' },
  btnPrimary: { background: '#e94560', color: '#fff' },
  btnSecondary: { background: 'var(--col-btn-sec)', color: 'var(--col-text)' },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: 'var(--col-dim)', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' },
}

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar = ({ name, color, size = 36, imageUrl }) => (
  imageUrl
    ? <img src={imageUrl} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block' }} />
    : <div style={{
        width: size, height: size, borderRadius: '50%',
        background: color || '#e94560',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 'bold', fontSize: size * 0.4, color: '#000', flexShrink: 0
      }}>
        {name?.[0]?.toUpperCase() || '?'}
      </div>
)

// ── Toast Container — stable component (outside App) so React never remounts it ─
function ToastContainer({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'success' ? '#0f2a1a' : t.type === 'error' ? '#2a0f0f' : 'var(--col-highlight)',
          border: `1px solid ${t.type === 'success' ? '#22c55e' : t.type === 'error' ? '#e94560' : '#444'}`,
          color: t.type === 'success' ? '#22c55e' : t.type === 'error' ? '#e94560' : 'var(--col-text)',
          borderRadius: 10, padding: '12px 18px', fontSize: 14, fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', minWidth: 220, maxWidth: 340
        }}>{t.message}</div>
      ))}
    </div>
  )
}

// ── Search Panel — uncontrolled input so React never touches the value ────────
function SearchPanel({ roomId, username, addToast }) {
  const inputRef = useRef(null)
  const [searchResults, setSearchResults] = useState([])

  const searchSongs = async () => {
    const query = inputRef.current?.value || ''
    if (!query.trim()) return
    try {
      const res = await fetch(`${SERVER_URL}/search?q=${encodeURIComponent(query)}`)
      setSearchResults(await res.json())
    } catch (e) {}
  }

  const addToQueue = (song) => {
    socket.emit('add-to-queue', { roomId, song, addedBy: username })
    addToast(`Added "${song.title}" to the queue`, 'success')
    setSearchResults([])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{ background: 'var(--col-card)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-card)' }}>
      <div style={s.sectionLabel}>Add a Song</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          ref={inputRef}
          type="text"
          style={{ ...s.input, flex: 1 }}
          placeholder="Search YouTube..."
          onKeyDown={e => e.key === 'Enter' && searchSongs()}
        />
        <button className="btn-accent" style={{ ...s.btn, ...s.btnPrimary, padding: '12px 20px' }} onClick={searchSongs}>Search</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {searchResults.map(r => (
          <div key={r.videoId} onClick={() => addToQueue(r)} className="row-hover" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: 'var(--col-bg)' }}>
            <img src={r.thumbnail} alt="" style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{r.artist}</div>
            </div>
            <button className="btn-accent" style={{ ...s.btn, ...s.btnPrimary, padding: '4px 12px', fontSize: 12, flexShrink: 0 }}>+</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Chat Panel — uncontrolled input so React never touches the value ──────────
function ChatPanel({ messages, chatEndRef, roomId, username, userLevels, isMobile }) {
  const inputRef = useRef(null)

  const send = () => {
    if (!inputRef.current) return
    const val = inputRef.current.value.trim()
    if (!val) return
    socket.emit('send-message', { roomId, username, message: val })
    socket.emit('stop-typing', { roomId, username })
    clearTimeout(typingTimeoutRef.current)
    inputRef.current.value = ''
  }

  return (
    <div style={{ background: 'var(--col-card)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', height: isMobile ? '70vh' : '100%' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--col-dim)', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>Chat</div>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--col-dim)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No messages yet</div>
            <div style={{ fontSize: 12 }}>Say hi to the room!</div>
          </div>
        )}
        {messages.map((msg, i) => {
          const lvl = userLevels[msg.username] || 1
          const nameColor = LEVEL_COLORS[lvl] || '#888'
          return (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: nameColor }}>
                  {lvl === 6 ? '👑 ' : ''}{msg.username}
                </span>
                <span style={{ fontSize: 10, color: '#444' }}>{msg.time}</span>
              </div>
              <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.4 }}>{msg.message}</div>
            </div>
          )
        })}
        <div ref={chatEndRef} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--col-btn-sec)', background: 'var(--col-bg)', color: 'var(--col-text)', fontSize: 13, boxSizing: 'border-box', outline: 'none', flex: 1 }}
          placeholder="Say something..."
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button style={{ padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, background: '#e94560', color: '#fff' }} onClick={send}>→</button>
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState(() => localStorage.getItem('jam-token') ? 'loading' : 'auth')
  const [authMode, setAuthMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [authError, setAuthError] = useState('')

  const [roomName, setRoomName] = useState('')
  const [joinRoomId, setJoinRoomId] = useState('')
  const [currentRoom, setCurrentRoom] = useState(null)
  const [roomId, setRoomId] = useState('')
  const [users, setUsers] = useState([])
  const [userColors, setUserColors] = useState({})
  const [queue, setQueue] = useState([])
  const [messages, setMessages] = useState([])
  const [currentSong, setCurrentSong] = useState(null)
  const [thumbsUp, setThumbsUp] = useState(0)
  const [hasThumbedUp, setHasThumbedUp] = useState(false)
  const [hasVotedSkip, setHasVotedSkip] = useState(false)
  const [skipVotes, setSkipVotes] = useState({ votes: 0, totalUsers: 1 })
  const [publicRooms, setPublicRooms] = useState([])
  const [xp, setXp] = useState(0)
  const [level, setLevel] = useState(LEVELS[0])
  const [avatarColor, setAvatarColor] = useState('#e94560')
  const [profileView, setProfileView] = useState(null)
  const [toasts, setToasts] = useState([])
  const [volume, setVolume] = useState(80)
  const [songHistory, setSongHistory] = useState([])
  const [reactions, setReactions] = useState([])
  const [roomTab, setRoomTab] = useState('playing')
  const [sideTab, setSideTab] = useState('chat')
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [userLevels, setUserLevels] = useState({})
  const [leaderboard, setLeaderboard] = useState([])
  const [homeTab, setHomeTab] = useState('rooms')
  const [reactionCooldown, setReactionCooldown] = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('jam-dark-mode')
    return saved === null ? true : saved === 'true'
  })
  const [favorites, setFavorites] = useState([])
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [sentRequests, setSentRequests] = useState([])
  const [friendSearch, setFriendSearch] = useState('')
  const [friendSearchResults, setFriendSearchResults] = useState([])
  const [friendNotifCount, setFriendNotifCount] = useState(0)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [userAvatarUrls, setUserAvatarUrls] = useState({})
  const [isConnected, setIsConnected] = useState(true)
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [streak, setStreak] = useState(0)
  const [sessionXpEarned, setSessionXpEarned] = useState(0)
  const [isPartyMode, setIsPartyMode] = useState(false)
  const [guestNudgeDismissed, setGuestNudgeDismissed] = useState(false)

  const playerRef = useRef(null)
  const isSyncSource = useRef(false)
  const currentRoomIdRef = useRef('')
  const currentSongRef = useRef(null)
  const lastHeartbeatRef = useRef(null)
  const prevUsersRef = useRef([])
  const chatEndRef = useRef(null)
  const lastReactionTimeRef = useRef(0)
  const pendingAudioWarmup = useRef(false)
  // DOM refs for progress bar — avoids setState every 500ms (which caused focus loss)
  const progressBarRef = useRef(null)
  const progressCurrentRef = useRef(null)
  const progressTotalRef = useRef(null)
  const swipeTouchStartX = useRef(null)
  const thumbsCountRef = useRef(0)
  const thumbsTimestampsRef = useRef([])

  useEffect(() => { currentSongRef.current = currentSong }, [currentSong])

  // Mobile detection
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Toast helper
  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  const handleVolumeChange = (val) => {
    setVolume(val)
    if (playerRef.current?.setVolume) playerRef.current.setVolume(val)
  }

  // YouTube player — div appended to body so it always exists
  useEffect(() => {
    const playerDiv = document.createElement('div')
    playerDiv.id = 'yt-player'
    // 1×1 in the bottom-left corner, invisible — just big enough for iOS to allow playback
    playerDiv.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;z-index:-1'
    document.body.appendChild(playerDiv)

    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.body.appendChild(tag)

    const initPlayer = () => {
      playerRef.current = new window.YT.Player('yt-player', {
        height: '1', width: '1',
        playerVars: { autoplay: 1, controls: 0, playsinline: 1 },
        events: {
          onReady: () => {
            playerRef.current.setVolume(80)
            console.log('YT ready')
            // If user tapped Create/Join before player finished loading, run the warmup now.
            // iOS allows this because it fires within the user activation window (~1-2s after gesture).
            if (pendingAudioWarmup.current) {
              pendingAudioWarmup.current = false
              playerRef.current.loadVideoById('M7lc1UVf-VE')
              setTimeout(() => playerRef.current?.stopVideo(), 200)
            }
          },
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.ENDED && isSyncSource.current) {
              socket.emit('song-ended', { roomId: currentRoomIdRef.current })
            }
          }
        }
      })
    }

    if (window.YT && window.YT.Player) initPlayer()
    else window.onYouTubeIframeAPIReady = initPlayer

    return () => { document.body.removeChild(playerDiv) }
  }, [])

  // Inject reaction float animation once
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'reaction-anim'
    style.textContent = `
      @keyframes floatReaction {
        0%   { transform: translateY(0px)    scale(0.2) rotate(-8deg); opacity: 0; }
        12%  { transform: translateY(-35px)  scale(1.5) rotate(6deg);  opacity: 1; }
        25%  { transform: translateY(-70px)  scale(1.2) rotate(-3deg); opacity: 1; }
        80%  { opacity: 0.85; }
        100% { transform: translateY(-240px) scale(0.9) rotate(2deg);  opacity: 0; }
      }
      @keyframes shimmer {
        0%   { background-position: -400px 0; }
        100% { background-position:  400px 0; }
      }
      .skeleton {
        border-radius: 8px;
        background: linear-gradient(90deg, var(--col-card) 25%, var(--col-highlight) 50%, var(--col-card) 75%);
        background-size: 800px 100%;
        animation: shimmer 1.4s infinite linear;
      }
      @keyframes confettiFall {
        0%   { transform: translateY(-20px) rotate(0deg) scale(1); opacity: 1; }
        80%  { opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg) scale(0.6); opacity: 0; }
      }
      @keyframes confettiWobble {
        0%   { margin-left: 0px; }
        25%  { margin-left: 18px; }
        75%  { margin-left: -14px; }
        100% { margin-left: 0px; }
      }

      /* ── Global interaction polish ── */

      /* Smooth transitions on all buttons */
      button {
        transition: opacity 0.15s ease, transform 0.1s ease, filter 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      }
      button:hover:not(:disabled) { opacity: 0.82; }
      button:active:not(:disabled) { transform: scale(0.95); opacity: 1; }

      /* Accent (red) buttons — brighten instead of dim */
      .btn-accent:hover { opacity: 1 !important; filter: brightness(1.1) saturate(1.05); }
      .btn-accent:active { transform: scale(0.95); filter: none; }

      /* Secondary/ghost buttons */
      .btn-sec:hover { background: var(--col-highlight) !important; opacity: 1 !important; }
      .btn-sec:active { transform: scale(0.96); }

      /* Tab bar buttons */
      .tab-btn { transition: background 0.15s ease !important; }
      .tab-btn:hover { background: var(--col-highlight) !important; opacity: 1 !important; }

      /* Input focus ring */
      input:focus {
        border-color: #e94560 !important;
        box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.13) !important;
      }

      /* Clickable card lift */
      .card-lift {
        transition: transform 0.18s ease, box-shadow 0.18s ease;
        cursor: pointer;
      }
      .card-lift:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-hover) !important;
      }
      .card-lift:active { transform: translateY(0); }

      /* Clickable list rows */
      .row-hover { transition: background 0.12s ease; }
      .row-hover:hover { background: var(--col-highlight) !important; }
    `
    if (!document.getElementById('reaction-anim')) document.head.appendChild(style)
    return () => document.getElementById('reaction-anim')?.remove()
  }, [])

  // Song progress — updates DOM directly via refs, NO setState → no re-renders
  useEffect(() => {
    const interval = setInterval(() => {
      if (playerRef.current?.getCurrentTime && playerRef.current?.getDuration) {
        try {
          const curr = playerRef.current.getCurrentTime()
          const dur = playerRef.current.getDuration()
          if (progressBarRef.current) {
            progressBarRef.current.style.width = `${dur ? (curr / dur) * 100 : 0}%`
          }
          if (progressCurrentRef.current) {
            progressCurrentRef.current.textContent = formatTime(curr)
          }
          if (progressTotalRef.current) {
            progressTotalRef.current.textContent = formatTime(dur)
          }
        } catch (e) {}
      }
    }, 500)
    return () => clearInterval(interval)
  }, [])

  // Sync heartbeat sender (sync source only)
  useEffect(() => {
    if (!currentSong || !isSyncSource.current) return
    const interval = setInterval(() => {
      if (playerRef.current?.getCurrentTime && currentSongRef.current?.videoId === currentSong.videoId) {
        const currentTime = playerRef.current.getCurrentTime()
        lastHeartbeatRef.current = { videoId: currentSong.videoId, time: currentTime, receivedAt: Date.now() }
        socket.emit('sync-heartbeat', { roomId: currentRoomIdRef.current, videoId: currentSong.videoId, currentTime })
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [currentSong])

  // Sync heartbeat receiver
  useEffect(() => {
    socket.on('sync-heartbeat', ({ videoId, currentTime }) => {
      lastHeartbeatRef.current = { videoId, time: currentTime, receivedAt: Date.now() }
    })
    return () => socket.off('sync-heartbeat')
  }, [])

  // Main socket event handlers
  useEffect(() => {
    socket.on('room-created', ({ roomId, room, userColors, userLevels, userAvatarUrls }) => {
      setCurrentRoom(room)
      setRoomId(roomId)
      currentRoomIdRef.current = roomId
      setUsers(room.users)
      prevUsersRef.current = room.users
      setUserColors(userColors || {})
      setUserLevels(userLevels || {})
      setUserAvatarUrls(userAvatarUrls || {})
      setQueue(room.queue)
      isSyncSource.current = true
      setRoomTab('playing')
      setScreen('room')
    })

    socket.on('room-joined', ({ roomId, room, userColors, userLevels, userAvatarUrls, history }) => {
      setCurrentRoom(room)
      setRoomId(roomId)
      currentRoomIdRef.current = roomId
      setUsers(room.users)
      prevUsersRef.current = room.users
      setUserColors(userColors || {})
      setUserLevels(userLevels || {})
      setUserAvatarUrls(userAvatarUrls || {})
      setQueue(room.queue)
      setSongHistory(history || [])
      isSyncSource.current = false
      if (room.queue[0]) {
        setCurrentSong(room.queue[0])
        setThumbsUp(room.queue[0].thumbsUp || 0)
      }
      setRoomTab('playing')
      setScreen('room')
      if (room.queue[0]) {
        setTimeout(() => {
          socket.emit('get-sync', { roomId }, (data) => {
            if (!data?.song || !playerRef.current) return
            playerRef.current.loadVideoById(data.song.videoId, Math.floor(data.elapsed))
          })
        }, 1500)
      }
    })

    socket.on('play-song', ({ song }) => {
      setCurrentSong(song)
      setThumbsUp(song?.thumbsUp || 0)
      setHasVotedSkip(false)
      setHasThumbedUp(false)
      setSkipVotes({ votes: 0, totalUsers: users.length })
      setReactions([])
      if (song) {
        addToast(`♪ Now playing: ${song.title}`)
        if (playerRef.current?.loadVideoById) playerRef.current.loadVideoById(song.videoId, 0)
      } else {
        if (playerRef.current?.stopVideo) playerRef.current.stopVideo()
      }
    })

    socket.on('queue-updated', ({ queue }) => {
      setQueue(queue)
      if (queue.length === 0) {
        setCurrentSong(null)
        if (playerRef.current?.stopVideo) playerRef.current.stopVideo()
      }
    })

    socket.on('user-joined', ({ users, userColors, userLevels, userAvatarUrls }) => {
      const newUser = users.find(u => !prevUsersRef.current.includes(u))
      if (newUser && prevUsersRef.current.length > 0) addToast(`${newUser} joined the jam`)
      prevUsersRef.current = users
      setUsers(users)
      if (userColors) setUserColors(userColors)
      if (userLevels) setUserLevels(userLevels)
      if (userAvatarUrls) setUserAvatarUrls(userAvatarUrls)
    })

    socket.on('user-left', ({ users, userColors, userLevels, userAvatarUrls }) => {
      const leftUser = prevUsersRef.current.find(u => !users.includes(u))
      if (leftUser) addToast(`${leftUser} left the jam`)
      prevUsersRef.current = users
      setUsers(users)
      if (userColors) setUserColors(userColors)
      if (userLevels) setUserLevels(userLevels)
      if (userAvatarUrls) setUserAvatarUrls(userAvatarUrls)
    })

    socket.on('host-changed', ({ newHost, users, userColors, userLevels, userAvatarUrls }) => {
      prevUsersRef.current = users
      setUsers(users)
      if (userColors) setUserColors(userColors)
      if (userLevels) setUserLevels(userLevels)
      if (userAvatarUrls) setUserAvatarUrls(userAvatarUrls)
      setCurrentRoom(prev => prev ? { ...prev, host: newHost } : prev)
      if (newHost === currentUser?.username) {
        isSyncSource.current = true
        addToast('You are now the host! 🎤', 'success')
      } else {
        addToast(`${newHost} is now the host`)
      }
    })

    socket.on('new-message', (msg) => {
      setMessages(prev => [...prev, msg])
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    })

    socket.on('thumbs-updated', ({ thumbsUp }) => {
      if (thumbsUp > thumbsCountRef.current) {
        const now = Date.now()
        thumbsTimestampsRef.current = [...thumbsTimestampsRef.current.filter(t => now - t < 10000), now]
        if (thumbsTimestampsRef.current.length >= 3) {
          setIsPartyMode(true)
          thumbsTimestampsRef.current = []
          setTimeout(() => setIsPartyMode(false), 4500)
        }
      }
      thumbsCountRef.current = thumbsUp
      setThumbsUp(thumbsUp)
    })
    socket.on('skip-votes-updated', ({ votes, totalUsers }) => setSkipVotes({ votes, totalUsers }))

    socket.on('xp-gained', ({ amount, source, thumbsReceived: newThumbsReceived, xp: newXp, leveledUp, newLevel }) => {
      setXp(newXp)
      setLevel(getLevel(newXp))
      setSessionXpEarned(prev => prev + amount)
      if (source === 'thumbsUp' && newThumbsReceived != null) {
        setCurrentUser(prev => ({ ...prev, thumbsReceived: newThumbsReceived }))
      }
      addToast(`+${amount} XP${leveledUp ? ` · Level Up! ${newLevel.title} 🎉` : ''}`, 'success')
    })

    socket.on('song-reaction', ({ username, emoji }) => {
      const id = Date.now() + Math.random()
      const rightOffset = 16 + Math.random() * 200   // px from right edge
      const fontSize   = 48 + Math.random() * 24     // 48–72px
      setReactions(prev => [...prev.slice(-12), { id, username, emoji, rightOffset, fontSize }])
      setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3800)
    })

    socket.on('history-updated', ({ history }) => setSongHistory(history))
    socket.on('error', ({ message }) => addToast(message, 'error'))

    return () => {
      socket.off('room-created'); socket.off('room-joined'); socket.off('play-song')
      socket.off('queue-updated'); socket.off('user-joined'); socket.off('user-left')
      socket.off('host-changed'); socket.off('new-message'); socket.off('thumbs-updated')
      socket.off('skip-votes-updated'); socket.off('xp-gained')
      socket.off('song-reaction'); socket.off('history-updated')
      socket.off('error')
    }
  }, [users.length, currentUser])

  // ── Auth ───────────────────────────────────────────────────────────────────
  const restoreSession = (user) => {
    setCurrentUser(user); setXp(user.xp); setLevel(getLevel(user.xp))
    setAvatarColor(user.avatarColor); setAvatarUrl(user.avatarUrl || null)
    setStreak(user.streak || 0)
    setScreen('home')
    loadFriends(user.username); loadFavorites(user.username)
    if (user.isNewDay && user.streak > 0) {
      setTimeout(() => addToast(`🔥 Day ${user.streak} streak! +${user.streakBonus} XP bonus`, 'success'), 800)
    }
  }

  // Auto-restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('jam-token')
    if (!token) return
    fetch(`${SERVER_URL}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (r.status === 401) {
          // Token is genuinely invalid — clear it and show login
          localStorage.removeItem('jam-token')
          setScreen('auth')
          return
        }
        if (r.ok) {
          const data = await r.json()
          restoreSession(data.user)
        } else {
          // Server error or endpoint not found — keep token, fall back to auth
          setScreen('auth')
        }
      })
      .catch(() => setScreen('auth')) // Network error — keep token, show auth
  }, [])

  const handleRegister = async () => {
    setAuthError('')
    try {
      const res = await fetch(`${SERVER_URL}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) return setAuthError(data.error)
      localStorage.setItem('jam-token', data.token)
      restoreSession(data.user)
    } catch (e) { setAuthError('Server error') }
  }

  const handleLogin = async () => {
    setAuthError('')
    try {
      const res = await fetch(`${SERVER_URL}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) return setAuthError(data.error)
      localStorage.setItem('jam-token', data.token)
      restoreSession(data.user)
    } catch (e) { setAuthError('Server error') }
  }

  const handleGuest = () => {
    const guestUsername = `Guest${Math.floor(1000 + Math.random() * 9000)}`
    const user = { username: guestUsername, xp: 0, avatarColor: '#e94560', isGuest: true }
    setCurrentUser(user); setXp(0); setLevel(LEVELS[0]); setAvatarColor('#e94560'); setScreen('home')
  }

  const logout = () => {
    localStorage.removeItem('jam-token')
    setCurrentUser(null); setScreen('auth'); setUsername(''); setPassword(''); setAuthError('')
    setStreak(0); setSessionXpEarned(0); setGuestNudgeDismissed(false)
  }

  const updateColor = async (color) => {
    setAvatarColor(color)
    if (currentUser && !currentUser.isGuest) {
      await fetch(`${SERVER_URL}/update-color`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, color })
      })
      setCurrentUser(prev => ({ ...prev, avatarColor: color }))
    }
  }

  // Warms up the iOS audio session from within a user gesture (tap on Create/Join).
  // If the YT player is already ready, fires immediately; otherwise sets a flag so
  // onReady can fire it — iOS grants ~1-2s of "user activation" after a gesture.
  const warmupAudio = () => {
    setAudioUnlocked(true)
    if (playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById('M7lc1UVf-VE')
      setTimeout(() => playerRef.current?.stopVideo(), 200)
    } else {
      pendingAudioWarmup.current = true
    }
  }

  const createRoom = () => {
    if (!roomName.trim()) return
    warmupAudio()
    socket.emit('create-room', { roomName: roomName.trim(), username: currentUser.username, avatarColor })
  }

  const joinRoom = () => {
    if (!joinRoomId.trim()) return
    warmupAudio()
    socket.emit('join-room', { roomId: joinRoomId.trim().toUpperCase(), username: currentUser.username, avatarColor })
  }

  const leaveRoom = () => {
    socket.emit('leave-room', { roomId: currentRoomIdRef.current, username: currentUser.username })
    if (playerRef.current?.stopVideo) playerRef.current.stopVideo()
    setCurrentSong(null); setQueue([]); setMessages([]); setUsers([])
    setCurrentRoom(null); setRoomId(''); currentRoomIdRef.current = ''
    isSyncSource.current = false; lastHeartbeatRef.current = null
    setAudioUnlocked(false)
    prevUsersRef.current = []; setSongHistory([]); setUserLevels({}); setAudioUnlocked(false)
    setReactions([]); setUserColors({}); setScreen('home')
  }

  const loadPublicRooms = async () => {
    setRoomsLoading(true)
    try {
      const res = await fetch(`${SERVER_URL}/rooms`)
      setPublicRooms(await res.json())
    } catch (e) {} finally {
      setRoomsLoading(false)
    }
  }

  const loadLeaderboard = async () => {
    setLeaderboardLoading(true)
    try {
      const res = await fetch(`${SERVER_URL}/leaderboard`)
      setLeaderboard(await res.json())
    } catch (e) {} finally {
      setLeaderboardLoading(false)
    }
  }

  const loadFavorites = async (username) => {
    if (!username) return
    try {
      const res = await fetch(`${SERVER_URL}/favorites/${username}`)
      if (res.ok) setFavorites(await res.json())
    } catch (e) {}
  }

  const uploadAvatar = (file) => {
    if (!file || !currentUser) return
    const canvas = document.createElement('canvas')
    canvas.width = 200; canvas.height = 200
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = async () => {
      // Crop to square from centre
      const size = Math.min(img.width, img.height)
      const sx = (img.width - size) / 2
      const sy = (img.height - size) / 2
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200)
      const imageData = canvas.toDataURL('image/jpeg', 0.8)
      try {
        const res = await fetch(`${SERVER_URL}/upload-avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username, imageData })
        })
        if (res.ok) {
          const { avatarUrl: url } = await res.json()
          setAvatarUrl(`${SERVER_URL}${url}?t=${Date.now()}`)
        }
      } catch (e) {}
    }
    img.src = URL.createObjectURL(file)
  }

  const toggleFavorite = async (song) => {
    if (!currentUser || currentUser.isGuest) return
    const isFav = favorites.some(f => f.videoId === song.videoId)
    if (isFav) {
      setFavorites(prev => prev.filter(f => f.videoId !== song.videoId))
      fetch(`${SERVER_URL}/favorites/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser.username, videoId: song.videoId }) })
    } else {
      const newFav = { videoId: song.videoId, title: song.title, artist: song.artist, thumbnail: song.thumbnail, favoritedAt: Date.now() }
      setFavorites(prev => [newFav, ...prev])
      fetch(`${SERVER_URL}/favorites/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser.username, song }) })
    }
  }

  const loadFriends = async (username) => {
    setFriendsLoading(true)
    try {
      const res = await fetch(`${SERVER_URL}/friends/${username}`)
      if (!res.ok) return
      const data = await res.json()
      setFriends(data.friends || [])
      setFriendRequests(data.requests || [])
      setSentRequests(data.sentRequests || [])
      setFriendNotifCount((data.requests || []).length)
    } catch (e) {} finally {
      setFriendsLoading(false)
    }
  }

  const searchUsers = async (q) => {
    setFriendSearch(q)
    if (q.length < 2) { setFriendSearchResults([]); return }
    try {
      const res = await fetch(`${SERVER_URL}/search-users?q=${encodeURIComponent(q)}`)
      setFriendSearchResults(await res.json())
    } catch (e) {}
  }

  const sendFriendRequest = (to) => {
    socket.emit('send-friend-request', { from: currentUser.username, to })
    setSentRequests(prev => [...prev, to])
  }

  const acceptFriendRequest = (from) => {
    socket.emit('accept-friend-request', { from, acceptedBy: currentUser.username })
    setFriendRequests(prev => prev.filter(r => r.username !== from))
    setFriendNotifCount(prev => Math.max(0, prev - 1))
  }

  const declineFriendRequest = (from) => {
    socket.emit('decline-friend-request', { from, declinedBy: currentUser.username })
    setFriendRequests(prev => prev.filter(r => r.username !== from))
    setFriendNotifCount(prev => Math.max(0, prev - 1))
  }

  const removeFriend = (friend) => {
    socket.emit('remove-friend', { username: currentUser.username, friend })
    setFriends(prev => prev.filter(f => f.username !== friend))
  }

  // Inject CSS custom properties whenever darkMode changes
  useEffect(() => {
    const r = document.documentElement.style
    if (darkMode) {
      r.setProperty('--col-bg',        '#0f0f1a')
      r.setProperty('--col-card',      '#1a1a2e')
      r.setProperty('--col-nav',       '#13132a')
      r.setProperty('--col-btn-sec',   '#2a2a4a')
      r.setProperty('--col-text',      '#f0f0f0')
      r.setProperty('--col-dim',       '#888')
      r.setProperty('--col-border',    '#2a2a4a')
      r.setProperty('--col-highlight', '#1e1e3a')
      r.setProperty('--col-border2',   '#3a3a6a')
      r.setProperty('--shadow-card',   '0 2px 8px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03)')
      r.setProperty('--shadow-nav',    '0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.4)')
      r.setProperty('--shadow-hover',  '0 8px 28px rgba(0,0,0,0.55)')
    } else {
      r.setProperty('--col-bg',        '#f0f0f5')
      r.setProperty('--col-card',      '#ffffff')
      r.setProperty('--col-nav',       '#ffffff')
      r.setProperty('--col-btn-sec',   '#ffffff')
      r.setProperty('--col-text',      '#1a1a2e')
      r.setProperty('--col-dim',       '#666')
      r.setProperty('--col-border',    '#c8c8d8')
      r.setProperty('--col-highlight', '#f0f0ff')
      r.setProperty('--col-border2',   '#a0a0b8')
      r.setProperty('--shadow-card',   '0 1px 3px rgba(0,0,0,0.06), 0 2px 14px rgba(0,0,0,0.05)')
      r.setProperty('--shadow-nav',    '0 1px 0 rgba(0,0,0,0.06), 0 2px 12px rgba(0,0,0,0.05)')
      r.setProperty('--shadow-hover',  '0 8px 28px rgba(0,0,0,0.14)')
    }
  }, [darkMode])

  const toggleDarkMode = () => setDarkMode(prev => {
    const next = !prev
    localStorage.setItem('jam-dark-mode', next)
    return next
  })

  // Reconnection handling
  useEffect(() => {
    const onDisconnect = () => setIsConnected(false)
    const onConnect = () => {
      setIsConnected(true)
      // Rejoin room after reconnect
      if (currentRoomIdRef.current && currentUser) {
        socket.emit('join-room', { roomId: currentRoomIdRef.current, username: currentUser.username, avatarColor })
      }
    }
    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)
    return () => {
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
    }
  }, [currentUser, avatarColor])

  // Socket listeners for friend events — set up once on mount
  useEffect(() => {
    socket.on('friend-request-received', ({ from, avatarColor: ac }) => {
      setFriendRequests(prev => [...prev, { username: from, avatarColor: ac }])
      setFriendNotifCount(prev => prev + 1)
      addToast(`👋 ${from} sent you a friend request`)
    })
    socket.on('friend-request-sent', ({ to }) => addToast(`Friend request sent to ${to}`))
    socket.on('friend-accepted', (friendData) => {
      setFriends(prev => [...prev.filter(f => f.username !== friendData.username), friendData])
      addToast(`🎉 ${friendData.username} accepted your friend request!`, 'success')
    })
    socket.on('friend-removed', ({ friend }) => {
      setFriends(prev => prev.filter(f => f.username !== friend))
    })
    return () => {
      socket.off('friend-request-received')
      socket.off('friend-request-sent')
      socket.off('friend-accepted')
      socket.off('friend-removed')
    }
  }, [])

  const voteSkip = () => {
    if (hasVotedSkip) return
    socket.emit('vote-skip', { roomId, username: currentUser.username })
    setHasVotedSkip(true)
  }

  const thumbsUpSong = () => {
    if (!currentSong || hasThumbedUp || currentSong.addedBy === currentUser.username) return
    setHasThumbedUp(true)
    socket.emit('thumbs-up', { roomId, username: currentUser.username, songVideoId: currentSong.videoId })
  }

  const REACTION_COOLDOWN_MS = 6000
  const sendReaction = (emoji) => {
    if (Date.now() - lastReactionTimeRef.current < REACTION_COOLDOWN_MS) return
    if (currentSong?.addedBy === currentUser.username) return
    lastReactionTimeRef.current = Date.now()
    setReactionCooldown(true)
    setTimeout(() => setReactionCooldown(false), REACTION_COOLDOWN_MS)
    socket.emit('song-reaction', { roomId, username: currentUser.username, emoji })
  }

  const syncAudio = () => {
    const requestedAt = Date.now()
    socket.emit('get-sync', { roomId: currentRoomIdRef.current }, (data) => {
      if (!data?.song || !playerRef.current) return
      const rtt = (Date.now() - requestedAt) / 1000
      const elapsed = data.elapsed + rtt / 2
      const currentVideoId = playerRef.current.getVideoData?.()?.video_id
      if (currentVideoId === data.song.videoId) {
        playerRef.current.seekTo(elapsed, true)
        playerRef.current.playVideo()
      } else {
        playerRef.current.loadVideoById(data.song.videoId, elapsed)
      }
    })
  }

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId)
    addToast('Room code copied!', 'success')
  }

  const viewProfile = async (uname) => {
    try {
      const res = await fetch(`${SERVER_URL}/profile/${uname}`)
      setProfileView(res.ok ? await res.json() : { username: uname, xp: 0, level: LEVELS[0], avatarColor: '#e94560', isGuest: true })
    } catch (e) {
      setProfileView({ username: uname, xp: 0, level: LEVELS[0], avatarColor: '#e94560', isGuest: true })
    }
    setScreen('profile')
  }

  // ── LOADING SCREEN (token check in progress) ────────────────────────────────
  if (screen === 'loading') return (
    <div style={{ minHeight: '100vh', background: 'var(--col-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', color: 'var(--col-dim)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎵</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Loading…</div>
      </div>
    </div>
  )

  // ── AUTH SCREEN ─────────────────────────────────────────────────────────────
  if (screen === 'auth') {
    // Inline form JSX — do NOT extract to a sub-component defined here,
    // as that causes React to remount on every render and drop input focus.
    const authFormJsx = (
      <>
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--col-bg)', borderRadius: 12, padding: 4 }}>
          {['login', 'register', 'guest'].map(m => (
            <button key={m} onClick={() => { setAuthMode(m); setAuthError('') }}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: authMode === m ? '#e94560' : 'transparent', color: authMode === m ? '#fff' : 'var(--col-dim)' }}>
              {m === 'login' ? 'Sign In' : m === 'register' ? 'Register' : 'Guest'}
            </button>
          ))}
        </div>
        {authError && <div style={{ color: '#e94560', fontSize: 13, marginBottom: 16, padding: '10px 14px', background: '#e9456022', borderRadius: 8 }}>{authError}</div>}
        {(authMode === 'login' || authMode === 'register') && (
          <>
            <input style={{ ...s.input, marginBottom: 12 }} placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleRegister())} />
            <input style={{ ...s.input, marginBottom: 20 }} placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleRegister())} />
            <button style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 16, background: '#e94560', color: '#fff' }} onClick={authMode === 'login' ? handleLogin : handleRegister}>
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </>
        )}
        {authMode === 'guest' && (
          <>
            <div style={{ background: 'var(--col-bg)', borderRadius: 12, padding: '16px', marginBottom: 20, color: 'var(--col-dim)', fontSize: 14, border: '1px solid var(--col-border)' }}>Guests can't save XP or stats.</div>
            <button style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 16, background: '#e94560', color: '#fff' }} onClick={handleGuest}>Enter as Guest</button>
          </>
        )}
      </>
    )

    if (isMobile) return (
      <div style={{ minHeight: '100vh', background: 'var(--col-bg)', color: 'var(--col-text)', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <ToastContainer toasts={toasts} />
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 52 }}>🎵</div>
          <div style={{ fontSize: 40, fontWeight: 900, color: '#e94560', lineHeight: 1.1 }}>Jam</div>
          <div style={{ fontSize: 14, color: 'var(--col-dim)', marginTop: 6 }}>Listen together, in perfect sync</div>
        </div>
        <div style={{ width: '100%', maxWidth: 360, background: 'var(--col-card)', borderRadius: 20, padding: 24, border: '1px solid var(--col-border)' }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Welcome back</div>
          <div style={{ color: 'var(--col-dim)', fontSize: 13, marginBottom: 20 }}>Sign in or join as a guest</div>
          {authFormJsx}
        </div>
      </div>
    )

    return (
      <div style={{ minHeight: '100vh', background: 'var(--col-bg)', display: 'flex', fontFamily: 'system-ui, sans-serif' }}>
        <ToastContainer toasts={toasts} />
        <div style={{ flex: 1, background: 'linear-gradient(135deg, var(--col-card) 0%, #16213e 50%, #0f3460 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 60 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎵</div>
          <div style={{ fontSize: 52, fontWeight: 900, color: '#e94560', marginBottom: 16 }}>Jam</div>
          <div style={{ fontSize: 20, color: '#aaa', textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>Listen together, in perfect sync</div>
          <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {['🎶 Queue songs from YouTube', '👥 Jam with friends in real time', '⟳ Stay perfectly in sync', '🏆 Earn XP as you vibe'].map(f => (
              <div key={f} style={{ color: '#888', fontSize: 15 }}>{f}</div>
            ))}
          </div>
        </div>
        <div style={{ width: 480, background: 'var(--col-card)', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 60, boxShadow: 'var(--shadow-card)' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--col-text)', marginBottom: 8 }}>Welcome back</div>
          <div style={{ color: '#666', marginBottom: 32, fontSize: 14 }}>Sign in to your account or join as a guest</div>
          {authFormJsx}
        </div>
      </div>
    )
  }

  // ── HOME SCREEN ─────────────────────────────────────────────────────────────
  if (screen === 'home') {

  // ── MOBILE HOME ──
  if (isMobile) return (
    <div style={{ height: '100vh', background: 'var(--col-bg)', color: 'var(--col-text)', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ToastContainer toasts={toasts} />
      {!isConnected && (
        <div style={{ background: '#e94560', color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: 700, padding: '6px 16px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.8, animation: 'shimmer 1s infinite' }} />
          Reconnecting…
        </div>
      )}
      {/* Header */}
      <div style={{ background: 'var(--col-nav)', borderBottom: '1px solid var(--col-border)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, boxShadow: 'var(--shadow-nav)' }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#e94560' }}>🎵 Jam</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggleDarkMode} style={{ background: 'var(--col-btn-sec)', border: '1px solid var(--col-border)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          {!currentUser?.isGuest && <button onClick={logout} style={{ background: 'var(--col-btn-sec)', border: '1px solid var(--col-border)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--col-dim)' }}>Out</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => viewProfile(currentUser.username)}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{currentUser.username}</div>
              <div style={{ fontSize: 10, color: 'var(--col-dim)', lineHeight: 1.2 }}>{level.title}</div>
            </div>
            <Avatar name={currentUser.username} color={avatarColor} imageUrl={avatarUrl} size={30} />
          </div>
          {streak >= 2 && (
            <div style={{ background: 'linear-gradient(135deg, #ff6b35, #e94560)', borderRadius: 8, padding: '3px 7px', fontSize: 11, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 3 }}>
              🔥 {streak}
            </div>
          )}
        </div>
      </div>

      {!isConnected && (
        <div style={{ background: '#e94560', color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: 700, padding: '6px 16px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.8 }} />
          Reconnecting…
        </div>
      )}

      {/* Tab bar */}
      <div style={{ background: 'var(--col-nav)', borderBottom: '1px solid var(--col-border)', display: 'flex', flexShrink: 0 }}>
        {[{ id: 'rooms', emoji: '🎵', title: 'Jams' }, { id: 'friends', emoji: '👥', title: 'Friends' }, { id: 'leaderboard', emoji: '🏆', title: 'Top' }].map(tab => (
          <button key={tab.id} onClick={() => {
            setHomeTab(tab.id)
            if (tab.id === 'leaderboard') loadLeaderboard()
            if (tab.id === 'friends' && currentUser && !currentUser.isGuest) loadFriends(currentUser.username)
          }} className="tab-btn" style={{ position: 'relative', flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', color: homeTab === tab.id ? '#e94560' : 'var(--col-dim)', borderBottom: homeTab === tab.id ? '2px solid #e94560' : '2px solid transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 18 }}>{tab.emoji}</span>
            <span style={{ fontSize: 10, fontWeight: 700 }}>{tab.title}</span>
            {tab.id === 'friends' && friendNotifCount > 0 && (
              <span style={{ position: 'absolute', top: 6, right: '25%', background: '#e94560', color: '#fff', borderRadius: '50%', width: 14, height: 14, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{friendNotifCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {homeTab === 'rooms' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Public Jams</div>
              <button style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, background: 'var(--col-card)', color: 'var(--col-text)', border: '1px solid var(--col-border)' }} onClick={loadPublicRooms}>Refresh</button>
            </div>
            {roomsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ background: 'var(--col-card)', borderRadius: 14, padding: 16, border: '1px solid var(--col-border)' }}>
                    <div className="skeleton" style={{ height: 18, width: '55%', marginBottom: 8 }} />
                    <div className="skeleton" style={{ height: 12, width: '35%', marginBottom: 12 }} />
                    <div className="skeleton" style={{ height: 36, width: '100%' }} />
                  </div>
                ))}
              </div>
            ) : publicRooms.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎶</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: 'var(--col-dim)' }}>No active jams</div>
                <div style={{ fontSize: 13, color: 'var(--col-dim)' }}>Create one and invite your friends!</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {publicRooms.map(r => (
                  <div key={r.id} className="card-lift" style={{ background: 'var(--col-card)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--col-border)', boxShadow: 'var(--shadow-card)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{r.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--col-dim)' }}>Hosted by {r.host}</div>
                      </div>
                      <div style={{ background: 'var(--col-bg)', borderRadius: 20, padding: '4px 10px', fontSize: 12, color: 'var(--col-dim)', border: '1px solid var(--col-border)' }}>👥 {r.userCount}</div>
                    </div>
                    {r.currentSong && (
                      <div style={{ background: 'var(--col-bg)', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--col-border)' }}>
                        <img src={r.currentSong.thumbnail} alt="" style={{ width: 36, height: 27, borderRadius: 4, objectFit: 'cover' }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: '#e94560', marginBottom: 1 }}>♪ Now Playing</div>
                          <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.currentSong.title}</div>
                        </div>
                      </div>
                    )}
                    <button style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: '#e94560', color: '#fff' }}
                      className="btn-accent" onClick={() => { warmupAudio(); socket.emit('join-room', { roomId: r.id, username: currentUser.username, avatarColor }) }}>Join Jam</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {homeTab === 'friends' && (
          <>
            {currentUser?.isGuest ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: 'var(--col-dim)' }}>Friends require an account</div>
                <div style={{ fontSize: 13, color: 'var(--col-dim)' }}>Sign up to add and track friends</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Find Friends</div>
                <input style={{ ...s.input, marginBottom: 12 }} placeholder="Search by username…" value={friendSearch} onChange={e => searchUsers(e.target.value)} />
                {friendSearchResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {friendSearchResults.filter(u => u.username !== currentUser.username).map(u => {
                      const isFriend = friends.some(f => f.username === u.username)
                      const requested = sentRequests.includes(u.username)
                      return (
                        <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                          <Avatar name={u.username} color={u.avatarColor} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: LEVEL_COLORS[u.level.level] || '#888' }}>{u.username}</div>
                            <div style={{ fontSize: 11, color: 'var(--col-dim)' }}>{u.level.title}</div>
                          </div>
                          {isFriend ? <span style={{ fontSize: 12, color: '#22c55e' }}>✓</span>
                            : requested ? <span style={{ fontSize: 11, color: 'var(--col-dim)' }}>Sent</span>
                            : <button style={{ ...s.btn, background: '#e94560', color: '#fff', padding: '5px 12px', fontSize: 12 }} onClick={() => sendFriendRequest(u.username)}>Add</button>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {friendRequests.length > 0 && (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#e94560' }}>Requests ({friendRequests.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                      {friendRequests.map(req => (
                        <div key={req.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                          <Avatar name={req.username} color={req.avatarColor} size={32} />
                          <div style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{req.username}</div>
                          <button style={{ ...s.btn, background: '#22c55e', color: '#fff', padding: '5px 10px', fontSize: 12 }} onClick={() => acceptFriendRequest(req.username)}>✓</button>
                          <button style={{ ...s.btn, ...s.btnSecondary, padding: '5px 10px', fontSize: 12 }} onClick={() => declineFriendRequest(req.username)}>✕</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Friends {friendsLoading ? '' : `(${friends.length})`}</div>
                {friendsLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[1,2,3].map(i => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                        <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div className="skeleton" style={{ height: 13, width: '50%', marginBottom: 6 }} />
                          <div className="skeleton" style={{ height: 11, width: '35%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : friends.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--col-dim)', padding: '16px 0' }}>No friends yet — search above!</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {friends.map(f => (
                      <div key={f.username} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                        <div style={{ position: 'relative' }}>
                          <Avatar name={f.username} color={f.avatarColor} imageUrl={f.avatarUrl} size={36} />
                          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 9, height: 9, borderRadius: '50%', background: f.online ? '#22c55e' : '#666', border: '2px solid var(--col-card)' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: LEVEL_COLORS[f.level?.level] || '#888' }}>{f.username}</div>
                          <div style={{ fontSize: 11, color: 'var(--col-dim)' }}>{f.online ? (f.roomName ? `🎵 ${f.roomName}` : 'Online') : 'Offline'}</div>
                        </div>
                        {f.online && f.roomId && (
                          <button style={{ ...s.btn, background: '#e94560', color: '#fff', padding: '5px 10px', fontSize: 12 }}
                            onClick={() => { warmupAudio(); socket.emit('join-room', { roomId: f.roomId, username: currentUser.username, avatarColor }) }}>Join</button>
                        )}
                        <button style={{ ...s.btn, ...s.btnSecondary, padding: '5px 10px', fontSize: 11 }} onClick={() => removeFriend(f.username)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {homeTab === 'leaderboard' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Top Jammers</div>
              <button style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--col-border)', cursor: 'pointer', fontWeight: 600, fontSize: 12, background: 'var(--col-card)', color: 'var(--col-text)' }} onClick={() => loadLeaderboard()}>Refresh</button>
            </div>
            {leaderboardLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3,4,5].map(i => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                    <div className="skeleton" style={{ width: 24, height: 18, borderRadius: 4, flexShrink: 0 }} />
                    <div className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ height: 13, width: '45%', marginBottom: 6 }} />
                      <div className="skeleton" style={{ height: 11, width: '30%' }} />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="skeleton" style={{ height: 13, width: 60, marginBottom: 4, marginLeft: 'auto' }} />
                      <div className="skeleton" style={{ height: 10, width: 30, marginLeft: 'auto' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : leaderboard.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏆</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--col-dim)' }}>No rankings yet</div>
                <div style={{ fontSize: 13, color: 'var(--col-dim)', marginTop: 4 }}>Start jamming to earn XP!</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {leaderboard.map((entry, i) => {
                  const lvlColor = LEVEL_COLORS[entry.level.level] || '#888'
                  const isMe = entry.username === currentUser.username
                  const medals = ['🥇', '🥈', '🥉']
                  return (
                    <div key={entry.username} onClick={() => viewProfile(entry.username)} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: isMe ? 'var(--col-highlight)' : 'var(--col-card)', border: isMe ? '1px solid #6366f1' : '1px solid var(--col-border)', cursor: 'pointer' }}>
                      <div style={{ width: 24, textAlign: 'center', fontSize: i < 3 ? 18 : 13, fontWeight: 700, color: 'var(--col-dim)' }}>{i < 3 ? medals[i] : `#${i + 1}`}</div>
                      <Avatar name={entry.username} color={entry.avatarColor} imageUrl={entry.avatarUrl} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: lvlColor }}>{entry.level.level === 6 ? '👑 ' : ''}{entry.username}{isMe && <span style={{ fontSize: 10, color: '#6366f1', marginLeft: 6 }}>you</span>}</div>
                        <div style={{ fontSize: 11, color: 'var(--col-dim)' }}>{entry.level.title}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: lvlColor, fontSize: 13 }}>{entry.xp.toLocaleString()} XP</div>
                        <div style={{ fontSize: 10, color: 'var(--col-dim)' }}>Lv {entry.level.level}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create / Join panel — pinned to bottom for easy thumb reach */}
      <div style={{ background: 'var(--col-card)', borderTop: '1px solid var(--col-border)', padding: '12px 14px', flexShrink: 0 }}>
        {/* Avatar color picker */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {COLORS.map(c => (
            <div key={c} onClick={() => updateColor(c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: avatarColor === c ? '2px solid var(--col-text)' : '2px solid transparent', boxSizing: 'border-box' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input style={{ ...s.input, fontSize: 13, padding: '8px 10px' }} placeholder="Room name" value={roomName} onChange={e => setRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createRoom()} />
            <button style={{ padding: '11px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: '#e94560', color: '#fff' }} onClick={createRoom}>🎸 Create Jam</button>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input style={{ ...s.input, fontSize: 13, padding: '8px 10px' }} placeholder="Room code" value={joinRoomId} onChange={e => setJoinRoomId(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && joinRoom()} />
            <button style={{ padding: '11px', borderRadius: 10, border: '1px solid var(--col-border)', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: 'var(--col-btn-sec)', color: 'var(--col-text)' }} onClick={joinRoom}>🚪 Join Jam</button>
          </div>
        </div>
      </div>
    </div>
  )

  // ── DESKTOP HOME ──
  return (
    <div style={{ minHeight: '100vh', background: 'var(--col-bg)', color: 'var(--col-text)', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <ToastContainer toasts={toasts} />
      {!isConnected && (
        <div style={{ background: '#e94560', color: '#fff', textAlign: 'center', fontSize: 13, fontWeight: 700, padding: '7px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.8 }} />
          Connection lost — reconnecting…
        </div>
      )}
      <div style={{ background: 'var(--col-nav)', borderBottom: '1px solid var(--col-border)', padding: '0 40px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, boxShadow: 'var(--shadow-nav)' }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: '#e94560' }}>🎵 Jam</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={toggleDarkMode} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} style={{ background: 'var(--col-btn-sec)', border: '1px solid var(--col-border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          {!currentUser?.isGuest && <button onClick={logout} title="Log out" style={{ background: 'var(--col-btn-sec)', border: '1px solid var(--col-border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--col-dim)' }}>Log out</button>}
          {streak >= 2 && (
            <div style={{ background: 'linear-gradient(135deg, #ff6b35, #e94560)', borderRadius: 10, padding: '5px 10px', fontSize: 13, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
              🔥 {streak} day streak
            </div>
          )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }} onClick={() => viewProfile(currentUser.username)}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{currentUser.username}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{level.title} · {xp} XP</div>
          </div>
          <Avatar name={currentUser.username} color={avatarColor} imageUrl={avatarUrl} size={40} />
        </div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 320, background: 'var(--col-nav)', borderRight: '1px solid var(--col-border)', padding: 32, display: 'flex', flexDirection: 'column', gap: 32, overflowY: 'auto' }}>
          <div>
            <div style={s.sectionLabel}>Avatar Color</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {COLORS.map(c => (
                <div key={c} onClick={() => updateColor(c)} style={{ width: 32, height: 32, borderRadius: '50%', background: c, cursor: 'pointer', border: avatarColor === c ? '3px solid #fff' : '3px solid transparent', boxSizing: 'border-box' }} />
              ))}
            </div>
          </div>
          <div>
            <div style={s.sectionLabel}>Create a Jam</div>
            <input style={{ ...s.input, marginBottom: 10 }} placeholder="Room name" value={roomName} onChange={e => setRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createRoom()} />
            <button style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: '#e94560', color: '#fff' }} onClick={createRoom}>Create Jam</button>
          </div>
          <div>
            <div style={s.sectionLabel}>Join a Jam</div>
            <input style={{ ...s.input, marginBottom: 10 }} placeholder="Enter room code" value={joinRoomId} onChange={e => setJoinRoomId(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && joinRoom()} />
            <button style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: 'var(--col-btn-sec)', color: 'var(--col-text)' }} onClick={joinRoom}>Join Jam</button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--col-border)', background: 'var(--col-nav)', flexShrink: 0 }}>
            {[{ id: 'rooms', label: '🎵 Public Jams' }, { id: 'friends', label: '👥 Friends' }, { id: 'leaderboard', label: '🏆 Leaderboard' }].map(tab => (
              <button key={tab.id} onClick={() => {
                setHomeTab(tab.id)
                if (tab.id === 'leaderboard') loadLeaderboard()
                if (tab.id === 'friends' && currentUser && !currentUser.isGuest) loadFriends(currentUser.username)
              }} className="tab-btn" style={{ position: 'relative', padding: '16px 28px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, color: homeTab === tab.id ? 'var(--col-text)' : 'var(--col-dim)', borderBottom: homeTab === tab.id ? '2px solid #e94560' : '2px solid transparent' }}>
                {tab.label}
                {tab.id === 'friends' && friendNotifCount > 0 && (
                  <span style={{ position: 'absolute', top: 10, right: 10, background: '#e94560', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{friendNotifCount}</span>
                )}
              </button>
            ))}
          </div>

          {homeTab === 'rooms' && (
            <div style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Public Jams</div>
                  <div style={{ color: 'var(--col-dim)', fontSize: 14 }}>Join an active room and start listening</div>
                </div>
                <button style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: 'var(--col-card)', color: 'var(--col-text)' }} onClick={loadPublicRooms}>Refresh</button>
              </div>
              {roomsLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {[1,2,3].map(i => (
                    <div key={i} style={{ background: 'var(--col-card)', borderRadius: 16, padding: 24, border: '1px solid var(--col-border)' }}>
                      <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 10 }} />
                      <div className="skeleton" style={{ height: 14, width: '40%', marginBottom: 18 }} />
                      <div className="skeleton" style={{ height: 40, width: '100%' }} />
                    </div>
                  ))}
                </div>
              ) : publicRooms.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🎶</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--col-dim)' }}>No active jams</div>
                  <div style={{ fontSize: 14, color: '#333' }}>Create one and invite your friends!</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {publicRooms.map(r => (
                    <div key={r.id} className="card-lift" style={{ background: 'var(--col-card)', borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--col-border)', boxShadow: 'var(--shadow-card)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{r.name}</div>
                          <div style={{ fontSize: 13, color: '#666' }}>Hosted by {r.host}</div>
                        </div>
                        <div style={{ background: 'var(--col-bg)', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#888' }}>👥 {r.userCount}</div>
                      </div>
                      {r.currentSong && (
                        <div style={{ background: 'var(--col-bg)', borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                          <img src={r.currentSong.thumbnail} alt="" style={{ width: 40, height: 30, borderRadius: 4, objectFit: 'cover' }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: '#e94560', marginBottom: 2 }}>♪ Now Playing</div>
                            <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.currentSong.title}</div>
                          </div>
                        </div>
                      )}
                      <button style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: '#e94560', color: '#fff' }}
                        onClick={() => socket.emit('join-room', { roomId: r.id, username: currentUser.username, avatarColor })}>Join Jam</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {homeTab === 'friends' && (
            <div style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
              {currentUser?.isGuest ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--col-dim)' }}>Friends require an account</div>
                  <div style={{ fontSize: 14, color: '#333' }}>Sign up to add friends and see when they're jamming</div>
                </div>
              ) : (
                <div style={{ maxWidth: 560 }}>
                  {/* Search */}
                  <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>Find Friends</div>
                  <input
                    style={{ ...s.input, marginBottom: 16 }}
                    placeholder="Search by username…"
                    value={friendSearch}
                    onChange={e => searchUsers(e.target.value)}
                  />
                  {friendSearchResults.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                      {friendSearchResults.filter(u => u.username !== currentUser.username).map(u => {
                        const isFriend = friends.some(f => f.username === u.username)
                        const requested = sentRequests.includes(u.username)
                        return (
                          <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                            <Avatar name={u.username} color={u.avatarColor} size={36} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, color: LEVEL_COLORS[u.level.level] || '#888' }}>{u.username}</div>
                              <div style={{ fontSize: 12, color: 'var(--col-dim)' }}>{u.level.title}</div>
                            </div>
                            {isFriend ? (
                              <span style={{ fontSize: 12, color: '#22c55e' }}>✓ Friends</span>
                            ) : requested ? (
                              <span style={{ fontSize: 12, color: 'var(--col-dim)' }}>Requested</span>
                            ) : (
                              <button style={{ ...s.btn, background: '#e94560', color: '#fff', padding: '6px 14px', fontSize: 12 }} onClick={() => sendFriendRequest(u.username)}>Add Friend</button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Incoming requests */}
                  {friendRequests.length > 0 && (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#e94560' }}>Friend Requests ({friendRequests.length})</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                        {friendRequests.map(req => (
                          <div key={req.username} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-btn-sec)' }}>
                            <Avatar name={req.username} color={req.avatarColor} size={36} />
                            <div style={{ flex: 1, fontWeight: 700 }}>{req.username}</div>
                            <button style={{ ...s.btn, background: '#22c55e', color: '#fff', padding: '6px 14px', fontSize: 12 }} onClick={() => acceptFriendRequest(req.username)}>Accept</button>
                            <button style={{ ...s.btn, ...s.btnSecondary, padding: '6px 14px', fontSize: 12 }} onClick={() => declineFriendRequest(req.username)}>Decline</button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Friends list */}
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Your Friends {friendsLoading ? '' : `(${friends.length})`}</div>
                  {friendsLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[1,2,3].map(i => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div className="skeleton" style={{ height: 14, width: '45%', marginBottom: 8 }} />
                            <div className="skeleton" style={{ height: 12, width: '30%' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : friends.length === 0 ? (
                    <div style={{ fontSize: 14, color: '#333', padding: '24px 0' }}>No friends yet — search above to add some!</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {friends.map(f => (
                        <div key={f.username} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                          <div style={{ position: 'relative' }}>
                            <Avatar name={f.username} color={f.avatarColor} imageUrl={f.avatarUrl} size={40} />
                            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: f.online ? '#22c55e' : '#444', border: '2px solid var(--col-card)' }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: LEVEL_COLORS[f.level?.level] || '#888' }}>{f.username}</div>
                            <div style={{ fontSize: 12, color: 'var(--col-dim)' }}>
                              {f.online ? (f.roomName ? `🎵 In "${f.roomName}"` : 'Online') : 'Offline'}
                            </div>
                          </div>
                          {f.online && f.roomId && (
                            <button style={{ ...s.btn, background: '#e94560', color: '#fff', padding: '6px 14px', fontSize: 12 }}
                              onClick={() => { warmupAudio(); socket.emit('join-room', { roomId: f.roomId, username: currentUser.username, avatarColor }) }}>
                              Join Jam
                            </button>
                          )}
                          <button style={{ ...s.btn, ...s.btnSecondary, padding: '6px 12px', fontSize: 11 }} onClick={() => removeFriend(f.username)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {homeTab === 'leaderboard' && (
            <div style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Top Jammers</div>
                  <div style={{ color: 'var(--col-dim)', fontSize: 14 }}>The most dedicated listeners on the platform</div>
                </div>
                <button style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: 'var(--col-card)', color: 'var(--col-text)' }} onClick={() => loadLeaderboard()}>Refresh</button>
              </div>
              {leaderboardLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 600 }}>
                  {[1,2,3,4,5].map(i => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 14, background: 'var(--col-card)', border: '1px solid var(--col-border)' }}>
                      <div className="skeleton" style={{ width: 28, height: 20, borderRadius: 4, flexShrink: 0 }} />
                      <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div className="skeleton" style={{ height: 15, width: '40%', marginBottom: 8 }} />
                        <div className="skeleton" style={{ height: 12, width: '28%' }} />
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="skeleton" style={{ height: 15, width: 70, marginBottom: 6, marginLeft: 'auto' }} />
                        <div className="skeleton" style={{ height: 11, width: 45, marginLeft: 'auto' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : leaderboard.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🏆</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--col-dim)' }}>No rankings yet</div>
                  <div style={{ fontSize: 14, color: '#333' }}>Start jamming to earn XP!</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 600 }}>
                  {leaderboard.map((entry, i) => {
                    const lvlColor = LEVEL_COLORS[entry.level.level] || '#888'
                    const isMe = entry.username === currentUser.username
                    const medals = ['🥇', '🥈', '🥉']
                    return (
                      <div key={entry.username} onClick={() => viewProfile(entry.username)} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 14, background: isMe ? 'var(--col-highlight)' : 'var(--col-card)', border: isMe ? '1px solid #6366f1' : '1px solid var(--col-border)', cursor: 'pointer', boxShadow: 'var(--shadow-card)' }}>
                        <div style={{ width: 28, textAlign: 'center', fontSize: i < 3 ? 20 : 14, fontWeight: 700, color: 'var(--col-dim)' }}>
                          {i < 3 ? medals[i] : `#${i + 1}`}
                        </div>
                        <Avatar name={entry.username} color={entry.avatarColor} imageUrl={entry.avatarUrl} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: lvlColor }}>
                            {entry.level.level === 6 ? '👑 ' : ''}{entry.username}
                            {isMe && <span style={{ fontSize: 11, color: '#6366f1', marginLeft: 8, fontWeight: 400 }}>you</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--col-dim)', marginTop: 1 }}>{entry.level.title}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: lvlColor, fontSize: 15 }}>{entry.xp.toLocaleString()} XP</div>
                          <div style={{ fontSize: 11, color: 'var(--col-dim)' }}>Level {entry.level.level}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
  } // end if (screen === 'home')

  // ── PROFILE SCREEN ──────────────────────────────────────────────────────────
  if (screen === 'profile') {
    const pLevel = profileView ? getLevel(profileView.xp) : LEVELS[0]
    const pNextLevel = profileView ? getNextLevel(profileView.xp) : LEVELS[1]
    const pProgress = pNextLevel ? ((profileView.xp - pLevel.minXP) / (pNextLevel.minXP - pLevel.minXP)) * 100 : 100
    return (
      <div style={{ minHeight: '100vh', background: 'var(--col-bg)', color: 'var(--col-text)', fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <ToastContainer toasts={toasts} />
        <div style={{ background: 'var(--col-card)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 480, boxShadow: 'var(--shadow-card)' }}>
          <button style={{ ...s.btn, ...s.btnSecondary, marginBottom: 20, padding: '8px 16px', fontSize: 13 }} onClick={() => setScreen(currentRoom ? 'room' : 'home')}>← Back</button>
          {profileView && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <Avatar name={profileView.username} color={profileView.avatarColor || '#e94560'} imageUrl={profileView.username === currentUser?.username ? avatarUrl : profileView.avatarUrl} size={64} />
                  {profileView.username === currentUser?.username && !currentUser.isGuest && (
                    <label style={{ position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: '50%', background: '#e94560', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12, border: '2px solid var(--col-card)' }} title="Change photo">
                      📷
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files[0] && uploadAvatar(e.target.files[0])} />
                    </label>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{profileView.username}</div>
                  <div style={{ color: '#e94560', fontWeight: 600 }}>{pLevel.title}</div>
                  {profileView.isGuest && <div style={{ fontSize: 12, color: 'var(--col-dim)', marginTop: 2 }}>Guest</div>}
                </div>
              </div>
              <div style={{ background: 'var(--col-bg)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: '#888', fontSize: 13 }}>Level {pLevel.level}</span>
                  <span style={{ fontWeight: 700 }}>{profileView.xp} XP</span>
                </div>
                <div style={{ background: 'var(--col-card)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#e94560', height: '100%', width: `${pProgress}%`, transition: 'width 0.5s' }} />
                </div>
                {pNextLevel && <div style={{ fontSize: 12, color: 'var(--col-dim)', marginTop: 6 }}>{pNextLevel.minXP - profileView.xp} XP to {pNextLevel.title}</div>}
              </div>
              {!profileView.isGuest && (() => {
                const totalMins = Math.floor(profileView.minutesListened || 0)
                const hrs = Math.floor(totalMins / 60)
                const mins = totalMins % 60
                const timeLabel = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                    <div style={{ background: 'var(--col-bg)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#e94560' }}>{profileView.songsAdded || 0}</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Songs Added</div>
                    </div>
                    <div style={{ background: 'var(--col-bg)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#e94560' }}>{profileView.thumbsReceived || 0}</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>👍 Received</div>
                    </div>
                    <div style={{ background: 'var(--col-bg)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#e94560' }}>{timeLabel}</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>🎧 Listened</div>
                    </div>
                  </div>
                )
              })()}
              {profileView.username !== currentUser?.username && !currentUser?.isGuest && !profileView.isGuest && (() => {
                const isFriend = friends.some(f => f.username === profileView.username)
                const requested = sentRequests.includes(profileView.username)
                const hasRequest = friendRequests.some(r => r.username === profileView.username)
                if (isFriend) return (
                  <button style={{ ...s.btn, ...s.btnSecondary, width: '100%', padding: '10px', fontSize: 13 }} onClick={() => removeFriend(profileView.username)}>Remove Friend</button>
                )
                if (hasRequest) return (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...s.btn, flex: 1, background: '#22c55e', color: '#fff', padding: '10px', fontSize: 13 }} onClick={() => acceptFriendRequest(profileView.username)}>Accept Request</button>
                    <button style={{ ...s.btn, ...s.btnSecondary, flex: 1, padding: '10px', fontSize: 13 }} onClick={() => declineFriendRequest(profileView.username)}>Decline</button>
                  </div>
                )
                if (requested) return (
                  <button style={{ ...s.btn, ...s.btnSecondary, width: '100%', padding: '10px', fontSize: 13 }} disabled>Request Sent</button>
                )
                return (
                  <button style={{ ...s.btn, background: '#e94560', color: '#fff', width: '100%', padding: '10px', fontSize: 13 }} onClick={() => sendFriendRequest(profileView.username)}>Add Friend</button>
                )
              })()}
              {/* Favorites — only shown on your own profile */}
              {profileView.username === currentUser?.username && !profileView.isGuest && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>❤️ Favourites ({favorites.length})</div>
                  {favorites.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--col-dim)' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🤍</div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No favourites yet</div>
                      <div style={{ fontSize: 12 }}>Tap Save on any song while it's playing</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                      {favorites.map(song => (
                        <div key={song.videoId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'var(--col-bg)' }}>
                          <img src={song.thumbnail} alt="" style={{ width: 48, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--col-dim)' }}>{song.artist}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {currentRoom && (
                              <button style={{ ...s.btn, background: '#e94560', color: '#fff', padding: '5px 10px', fontSize: 11 }}
                                onClick={() => { socket.emit('add-to-queue', { roomId, song, addedBy: currentUser.username }); addToast(`Added ${song.title} to queue`) }}>
                                + Queue
                              </button>
                            )}
                            <button onClick={() => toggleFavorite(song)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '2px 4px' }}>❤️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── ROOM SCREEN ─────────────────────────────────────────────────────────────
  if (screen === 'room') {

    const CONFETTI_COLORS = ['#e94560','#6366f1','#f59e0b','#22c55e','#ec4899','#06b6d4','#ff6b35','#a855f7']
    const confettiPieces = isPartyMode ? Array.from({ length: 32 }, (_, i) => ({
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      left: `${(i * 3.2 + Math.sin(i) * 8 + 100) % 100}%`,
      size: 8 + (i % 5) * 2,
      duration: 2.2 + (i % 5) * 0.4,
      delay: (i % 8) * 0.15,
      shape: i % 3 === 0 ? '50%' : i % 3 === 1 ? '2px' : '0',
    })) : []

    const confettiOverlay = isPartyMode ? (
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998, overflow: 'hidden' }}>
        {confettiPieces.map(p => (
          <div key={p.id} style={{
            position: 'absolute', top: 0, left: p.left,
            width: p.size, height: p.size,
            borderRadius: p.shape,
            background: p.color,
            animation: `confettiFall ${p.duration}s ${p.delay}s ease-in forwards, confettiWobble ${p.duration * 0.7}s ${p.delay}s ease-in-out infinite`,
          }} />
        ))}
        <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: isMobile ? 52 : 72, animation: 'floatReaction 2s ease-out forwards', pointerEvents: 'none' }}>
          🎉
        </div>
      </div>
    ) : null

    // NowPlayingPanel: inline function (no separate component needed since it
    // contains <SearchPanel> which IS a stable component with its own state)
    const NowPlayingPanel = () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: 'var(--col-card)', borderRadius: 14, padding: 24, boxShadow: 'var(--shadow-card)' }}>
          <div style={s.sectionLabel}>Now Playing</div>
          {currentSong ? (
            <>
              {/* Large album art */}
              <div style={{ position: 'relative', marginBottom: 16, borderRadius: 12, overflow: 'hidden', lineHeight: 0 }}>
                <img
                  src={`https://i.ytimg.com/vi/${currentSong.videoId}/hqdefault.jpg`}
                  alt=""
                  style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
                  onError={e => { e.target.src = currentSong.thumbnail }}
                />
                {/* Gradient overlay for text legibility */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '32px 16px 14px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentSong.title}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>{currentSong.artist} · Added by {currentSong.addedBy}</div>
                </div>
              </div>
              {/* Progress bar — updated via DOM refs, no React state */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ background: 'var(--col-bg)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
                  <div ref={progressBarRef} style={{ background: '#e94560', height: '100%', width: '0%', transition: 'width 0.5s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--col-dim)', marginTop: 4 }}>
                  <span ref={progressCurrentRef}>0:00</span>
                  <span ref={progressTotalRef}>0:00</span>
                </div>
              </div>
              {/* Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button onClick={thumbsUpSong} disabled={hasThumbedUp || currentSong?.addedBy === currentUser.username} style={{ ...s.btn, ...s.btnSecondary, padding: '8px 14px', fontSize: 13, opacity: (hasThumbedUp || currentSong?.addedBy === currentUser.username) ? 0.5 : 1 }}>👍 {thumbsUp}</button>
                {!currentUser.isGuest && (() => {
                  const isFav = favorites.some(f => f.videoId === currentSong.videoId)
                  return (
                    <button onClick={() => toggleFavorite(currentSong)} style={{ ...s.btn, padding: '8px 14px', fontSize: 13, background: isFav ? '#e94560' : 'var(--col-btn-sec)', color: '#fff', border: isFav ? '1px solid #e94560' : '1px solid var(--col-border2)', transition: 'background 0.15s' }}>
                      {isFav ? '❤️ Saved' : '🤍 Save'}
                    </button>
                  )
                })()}
                <button onClick={voteSkip} disabled={hasVotedSkip} style={{ ...s.btn, ...s.btnSecondary, padding: '8px 14px', fontSize: 13, opacity: hasVotedSkip ? 0.5 : 1 }}>
                  Skip {skipVotes.votes > 0 ? `(${skipVotes.votes}/${skipVotes.totalUsers})` : ''}
                </button>
                {!isSyncSource.current && (
                  <button onClick={syncAudio} style={{ ...s.btn, ...s.btnSecondary, padding: '8px 14px', fontSize: 13 }}>⟳ Sync</button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                  <span style={{ fontSize: 16 }}>{volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}</span>
                  <input type="range" min="0" max="100" value={volume} onChange={e => handleVolumeChange(Number(e.target.value))} style={{ width: 80, accentColor: '#e94560', cursor: 'pointer' }} />
                </div>
              </div>
              {/* Emoji reactions */}
              {currentSong?.addedBy === currentUser.username ? (
                <div style={{ fontSize: 12, color: '#444', padding: '6px 0' }}>You can't react to your own song</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {REACTION_EMOJIS.map(emoji => (
                    <button key={emoji} onClick={() => sendReaction(emoji)} disabled={reactionCooldown}
                      style={{ background: 'var(--col-bg)', border: `1px solid ${reactionCooldown ? 'var(--col-card)' : 'var(--col-btn-sec)'}`, borderRadius: 8, padding: '5px 10px', cursor: reactionCooldown ? 'not-allowed' : 'pointer', fontSize: 16, transition: 'transform 0.1s, opacity 0.2s', opacity: reactionCooldown ? 0.35 : 1 }}
                      onMouseDown={e => { if (!reactionCooldown) e.currentTarget.style.transform = 'scale(1.3)' }}
                      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}>
                      {emoji}
                    </button>
                  ))}
                  {reactionCooldown && <span style={{ fontSize: 11, color: '#444', marginLeft: 4 }}>cooldown…</span>}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--col-dim)', fontSize: 14 }}>No song playing. Add one below!</div>
          )}
        </div>
        {/* SearchPanel is a stable component (defined outside App) — typing only re-renders SearchPanel */}
        <SearchPanel roomId={roomId} username={currentUser.username} addToast={addToast} />
      </div>
    )

    const QueuePanel = () => (
      <div style={{ background: 'var(--col-card)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-card)' }}>
        <div style={s.sectionLabel}>Up Next ({queue.length > 1 ? queue.length - 1 : 0})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: isMobile ? '60vh' : 400, overflowY: 'auto' }}>
          {queue.slice(1).length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--col-dim)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Queue is empty</div>
              <div style={{ fontSize: 12 }}>Add a song to get the party started</div>
            </div>
          )}
          {queue.slice(1).map((song, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: 'var(--col-bg)' }}>
              <div style={{ fontSize: 13, color: 'var(--col-dim)', width: 20, textAlign: 'center' }}>{i + 1}</div>
              <img src={song.thumbnail} alt="" style={{ width: 40, height: 30, borderRadius: 4, objectFit: 'cover' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                <div style={{ fontSize: 11, color: 'var(--col-dim)' }}>by {song.addedBy}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )

    const HistoryPanel = () => (
      <div style={{ background: 'var(--col-card)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-card)' }}>
        <div style={s.sectionLabel}>Previously Played</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: isMobile ? '60vh' : 400, overflowY: 'auto' }}>
          {songHistory.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--col-dim)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📜</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No history yet</div>
              <div style={{ fontSize: 12 }}>Songs played in this session will appear here</div>
            </div>
          )}
          {songHistory.map((song, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: 'var(--col-bg)', opacity: 0.8 }}>
              <img src={song.thumbnail} alt="" style={{ width: 40, height: 30, borderRadius: 4, objectFit: 'cover' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                <div style={{ fontSize: 11, color: 'var(--col-dim)' }}>{song.skipped ? '⏭ Skipped' : '✓ Played'} · by {song.addedBy}</div>
              </div>
              {!currentUser.isGuest && (
                <button onClick={() => toggleFavorite(song)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '2px 4px', flexShrink: 0 }}>
                  {favorites.some(f => f.videoId === song.videoId) ? '❤️' : '🤍'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )

    const UsersPanel = () => (
      <div style={{ background: 'var(--col-card)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-card)' }}>
        <div style={s.sectionLabel}>Listeners ({users.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map(u => {
            const lvl = userLevels[u] || 1
            const lvlColor = LEVEL_COLORS[lvl] || '#888'
            return (
              <div key={u} onClick={() => viewProfile(u)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 10px', borderRadius: 8, background: 'var(--col-bg)' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <Avatar name={u} color={userColors[u] || '#6366f1'} imageUrl={userAvatarUrls[u]} size={28} />
                  {lvl === 6 && <span style={{ position: 'absolute', top: -6, right: -6, fontSize: 10 }}>👑</span>}
                </div>
                <span style={{ fontSize: 13, flex: 1, color: lvlColor, fontWeight: 500 }}>
                  <span style={{ opacity: 0.7, fontWeight: 400 }}>{LEVELS[lvl - 1]?.title || 'Newcomer'}</span>
                  <span style={{ color: 'var(--col-dim)', margin: '0 5px' }}>|</span>
                  {u}
                </span>
                {u === currentRoom?.host && <span style={{ fontSize: 10, color: '#e94560', fontWeight: 700 }}>HOST</span>}
              </div>
            )
          })}
        </div>
      </div>
    )

    // ── MOBILE LAYOUT ──
    if (isMobile) {
      const TAB_ITEMS = [
        { id: 'playing', label: '🎵', title: 'Playing' },
        { id: 'queue', label: '📋', title: 'Queue' },
        { id: 'chat', label: '💬', title: 'Chat' },
        { id: 'history', label: '📜', title: 'History' },
      ]
      const TAB_IDS = TAB_ITEMS.map(t => t.id)
      const handleSwipeStart = (e) => { swipeTouchStartX.current = e.touches[0].clientX }
      const handleSwipeEnd = (e) => {
        if (swipeTouchStartX.current === null) return
        const dx = e.changedTouches[0].clientX - swipeTouchStartX.current
        swipeTouchStartX.current = null
        if (Math.abs(dx) < 50) return
        const idx = TAB_IDS.indexOf(roomTab)
        if (dx < 0 && idx < TAB_IDS.length - 1) setRoomTab(TAB_IDS[idx + 1])
        if (dx > 0 && idx > 0) setRoomTab(TAB_IDS[idx - 1])
      }
      return (
        <div style={{ height: '100vh', background: 'var(--col-bg)', color: 'var(--col-text)', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
          <ToastContainer toasts={toasts} />
          {!isConnected && (
            <div style={{ background: '#e94560', color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: 700, padding: '6px 16px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.8 }} />
              Reconnecting…
            </div>
          )}
          {currentUser?.isGuest && sessionXpEarned > 0 && !guestNudgeDismissed && (
            <div style={{ background: 'linear-gradient(135deg, #6366f1, #e94560)', color: '#fff', padding: '8px 14px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>⭐</span>
              <div style={{ flex: 1, fontSize: 12 }}>
                <span style={{ fontWeight: 700 }}>You've earned {sessionXpEarned} XP</span> this session — sign up to keep it!
              </div>
              <button onClick={() => { setGuestNudgeDismissed(false); setScreen('auth'); }} style={{ background: '#fff', color: '#6366f1', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>Sign Up</button>
              <button onClick={() => setGuestNudgeDismissed(true)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}>✕</button>
            </div>
          )}
          {confettiOverlay}
          {/* Floating reaction overlay */}
          <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9997 }}>
            {reactions.map(r => (
              <span key={r.id} title={r.username} style={{ position: 'absolute', bottom: 100, right: r.rightOffset, fontSize: r.fontSize, animation: 'floatReaction 3.8s ease-out forwards', userSelect: 'none', lineHeight: 1 }}>
                {r.emoji}
              </span>
            ))}
          </div>
          <div style={{ background: 'var(--col-nav)', borderBottom: '1px solid var(--col-border)', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, boxShadow: 'var(--shadow-nav)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn-sec" style={{ ...s.btn, ...s.btnSecondary, padding: '6px 12px', fontSize: 12 }} onClick={leaveRoom}>← Leave</button>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{currentRoom?.name}</div>
                <div style={{ fontSize: 11, color: '#888' }}>
                  <span style={{ color: '#e94560', fontFamily: 'monospace' }}>{roomId}</span>
                  <button onClick={copyRoomCode} style={{ marginLeft: 6, background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11 }}>Copy</button>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={toggleDarkMode} title={darkMode ? 'Light mode' : 'Dark mode'} style={{ background: 'var(--col-btn-sec)', border: '1px solid var(--col-border)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>
                {darkMode ? '☀️' : '🌙'}
              </button>
              <Avatar name={currentUser.username} color={avatarColor} imageUrl={avatarUrl} size={32} />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}
            onTouchStart={handleSwipeStart}
            onTouchEnd={handleSwipeEnd}
          >
            {roomTab === 'playing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {NowPlayingPanel()}
                {UsersPanel()}
              </div>
            )}
            {roomTab === 'queue' && QueuePanel()}
            {roomTab === 'chat' && <ChatPanel messages={messages} chatEndRef={chatEndRef} roomId={roomId} username={currentUser.username} userLevels={userLevels} isMobile={true} />}
            {roomTab === 'history' && HistoryPanel()}
          </div>
          <div style={{ background: 'var(--col-card)', borderTop: '1px solid var(--col-border)', display: 'flex', flexShrink: 0 }}>
            {TAB_ITEMS.map(tab => (
              <button key={tab.id} onClick={() => setRoomTab(tab.id)} style={{ flex: 1, padding: '12px 0', background: 'none', border: 'none', cursor: 'pointer', color: roomTab === tab.id ? '#e94560' : 'var(--col-dim)', fontSize: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                {tab.label}
                <span style={{ fontSize: 10 }}>{tab.title}</span>
              </button>
            ))}
          </div>
        </div>
      )
    }

    // ── DESKTOP LAYOUT ──
    return (
      <div style={{ minHeight: '100vh', background: 'var(--col-bg)', color: 'var(--col-text)', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
        <ToastContainer toasts={toasts} />
        {!isConnected && (
          <div style={{ background: '#e94560', color: '#fff', textAlign: 'center', fontSize: 13, fontWeight: 700, padding: '7px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.8 }} />
            Connection lost — reconnecting…
          </div>
        )}
        {currentUser?.isGuest && sessionXpEarned > 0 && !guestNudgeDismissed && (
          <div style={{ background: 'linear-gradient(135deg, #6366f1, #e94560)', color: '#fff', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18 }}>⭐</span>
            <div style={{ flex: 1, fontSize: 14 }}>
              <span style={{ fontWeight: 700 }}>You've earned {sessionXpEarned} XP</span> this session — create an account to keep it!
            </div>
            <button onClick={() => { setGuestNudgeDismissed(false); setScreen('auth'); }} style={{ background: '#fff', color: '#6366f1', border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>Sign Up Free</button>
            <button onClick={() => setGuestNudgeDismissed(true)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>✕</button>
          </div>
        )}
        {confettiOverlay}
        {/* Floating reaction overlay */}
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9997 }}>
          {reactions.map(r => (
            <span key={r.id} title={r.username} style={{ position: 'absolute', bottom: 100, right: r.rightOffset, fontSize: r.fontSize, animation: 'floatReaction 3.8s ease-out forwards', userSelect: 'none', lineHeight: 1 }}>
              {r.emoji}
            </span>
          ))}
        </div>
        <div style={{ background: 'var(--col-nav)', borderBottom: '1px solid var(--col-border)', padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, boxShadow: 'var(--shadow-nav)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="btn-sec" style={{ ...s.btn, ...s.btnSecondary, padding: '8px 16px', fontSize: 13 }} onClick={leaveRoom}>← Leave</button>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{currentRoom?.name || 'Room'}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                Code: <span style={{ color: '#e94560', fontFamily: 'monospace', fontWeight: 700 }}>{roomId}</span>
                <button onClick={copyRoomCode} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 4 }}>Copy</button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={toggleDarkMode} title={darkMode ? 'Light mode' : 'Dark mode'} style={{ background: 'var(--col-btn-sec)', border: '1px solid var(--col-border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
              {darkMode ? '☀️' : '🌙'}
            </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }} onClick={() => viewProfile(currentUser.username)}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{currentUser.username}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{level.title} · {xp} XP</div>
            </div>
            <Avatar name={currentUser.username} color={avatarColor} imageUrl={avatarUrl} size={36} />
          </div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: Now Playing + Queue */}
          <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {NowPlayingPanel()}
            {QueuePanel()}
          </div>

          {/* Right sidebar */}
          <div style={{ width: 320, background: 'var(--col-nav)', borderLeft: '1px solid var(--col-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {UsersPanel()}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--col-border)', borderTop: '1px solid var(--col-border)', flexShrink: 0 }}>
              {[{ id: 'chat', label: '💬 Chat' }, { id: 'history', label: '📜 History' }].map(tab => (
                <button key={tab.id} onClick={() => setSideTab(tab.id)} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: sideTab === tab.id ? '#e94560' : '#666', borderBottom: sideTab === tab.id ? '2px solid #e94560' : '2px solid transparent' }}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'hidden', padding: 16 }}>
              {sideTab === 'chat'
                ? <ChatPanel messages={messages} chatEndRef={chatEndRef} roomId={roomId} username={currentUser.username} userLevels={userLevels} isMobile={false} />
                : HistoryPanel()}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}