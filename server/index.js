require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const axios = require('axios')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// Serve uploaded avatar images
const AVATARS_DIR = path.join(__dirname, 'uploads', 'avatars')
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true })
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

// ── Database setup ────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'jam.db'))
db.pragma('journal_mode = WAL')   // better concurrent read performance
db.pragma('synchronous = NORMAL') // safe + faster than FULL

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username        TEXT PRIMARY KEY,
    password        TEXT NOT NULL,
    xp              INTEGER DEFAULT 0,
    avatarColor     TEXT DEFAULT '#e94560',
    avatarUrl       TEXT,
    songsAdded      INTEGER DEFAULT 0,
    thumbsReceived  INTEGER DEFAULT 0,
    minutesListened REAL DEFAULT 0,
    streak          INTEGER DEFAULT 1,
    lastLoginDate   TEXT
  );
  CREATE TABLE IF NOT EXISTS favorites (
    username    TEXT NOT NULL,
    videoId     TEXT NOT NULL,
    title       TEXT,
    artist      TEXT,
    thumbnail   TEXT,
    favoritedAt INTEGER,
    PRIMARY KEY (username, videoId)
  );
  CREATE TABLE IF NOT EXISTS friendships (
    username TEXT NOT NULL,
    friend   TEXT NOT NULL,
    PRIMARY KEY (username, friend)
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    fromUser TEXT NOT NULL,
    toUser   TEXT NOT NULL,
    PRIMARY KEY (fromUser, toUser)
  );
`)

// ── One-time migration: users.json → SQLite ───────────────────────────────────
const USERS_FILE = path.join(__dirname, 'users.json')
if (fs.existsSync(USERS_FILE)) {
  try {
    const old = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
    const insUser = db.prepare(`INSERT OR IGNORE INTO users
      (username,password,xp,avatarColor,avatarUrl,songsAdded,thumbsReceived,minutesListened,streak,lastLoginDate)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    const insFav  = db.prepare(`INSERT OR IGNORE INTO favorites (username,videoId,title,artist,thumbnail,favoritedAt) VALUES (?,?,?,?,?,?)`)
    const insFriend = db.prepare(`INSERT OR IGNORE INTO friendships (username,friend) VALUES (?,?)`)
    const insReq  = db.prepare(`INSERT OR IGNORE INTO friend_requests (fromUser,toUser) VALUES (?,?)`)
    db.transaction(() => {
      for (const [uname, u] of Object.entries(old)) {
        insUser.run(uname, u.password, u.xp||0, u.avatarColor||'#e94560', u.avatarUrl||null,
                    u.songsAdded||0, u.thumbsReceived||0, u.minutesListened||0, u.streak||1, u.lastLoginDate||null)
        for (const fav of (u.favorites||[]))
          insFav.run(uname, fav.videoId, fav.title, fav.artist, fav.thumbnail, fav.favoritedAt||Date.now())
        for (const friend of (u.friends||[]))
          insFriend.run(uname, friend)
        for (const req of (u.friendRequests||[]))
          insReq.run(req, uname)
      }
    })()
    fs.renameSync(USERS_FILE, USERS_FILE + '.migrated')
    console.log('✅ Migrated users.json → SQLite')
  } catch (e) { console.error('Migration error:', e) }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
const getUser = (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username)

const rooms = {}
const JWT_SECRET = process.env.JWT_SECRET || 'jam-app-secret-key'
const XP_REWARDS = { addSong: 10, thumbsUp: 25 }

const LEVELS = [
  { level: 1, title: 'Newcomer',       minXP: 0    },
  { level: 2, title: 'Music Fan',      minXP: 100  },
  { level: 3, title: 'DJ in Training', minXP: 250  },
  { level: 4, title: 'Crowd Pleaser',  minXP: 500  },
  { level: 5, title: 'Vibe Master',    minXP: 1000 },
  { level: 6, title: 'Legend',         minXP: 2000 },
]

const getLevel = (xp) => {
  let current = LEVELS[0]
  for (const l of LEVELS) { if (xp >= l.minXP) current = l }
  return current
}

const addXP = (username, amount) => {
  const u = getUser(username)
  if (!u) return null
  const prevLevel = getLevel(u.xp || 0)
  const newXP = (u.xp || 0) + amount
  db.prepare('UPDATE users SET xp = ? WHERE username = ?').run(newXP, username)
  const newLevel = getLevel(newXP)
  return { xp: newXP, leveledUp: newLevel.level > prevLevel.level, newLevel }
}

const todayStr = () => new Date().toISOString().slice(0, 10)

const updateStreak = (username) => {
  const u = getUser(username)
  if (!u) return { streak: 0, streakBonus: 0, isNewDay: false }
  const today = todayStr()
  if (u.lastLoginDate === today) return { streak: u.streak || 1, streakBonus: 0, isNewDay: false }
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)
  const newStreak = u.lastLoginDate === yesterdayStr ? (u.streak || 1) + 1 : 1
  db.prepare('UPDATE users SET streak = ?, lastLoginDate = ? WHERE username = ?').run(newStreak, today, username)
  const streakBonus = Math.min(newStreak * 10, 100)
  const xpResult = addXP(username, streakBonus)
  return { streak: newStreak, streakBonus, isNewDay: true, xp: xpResult?.xp, leveledUp: xpResult?.leveledUp, newLevel: xpResult?.newLevel }
}

const getRoomColors = (roomId) => {
  const colors = {}
  io.sockets.sockets.forEach(s => { if (s.data.roomId === roomId && s.data.username) colors[s.data.username] = s.data.avatarColor || '#6366f1' })
  return colors
}

const getRoomLevels = (roomId) => {
  const levels = {}
  io.sockets.sockets.forEach(s => {
    if (s.data.roomId === roomId && s.data.username) {
      const u = getUser(s.data.username)
      levels[s.data.username] = getLevel(u?.xp || 0).level
    }
  })
  return levels
}

const getRoomAvatarUrls = (roomId) => {
  const urls = {}
  io.sockets.sockets.forEach(s => {
    if (s.data.roomId === roomId && s.data.username) {
      const u = getUser(s.data.username)
      if (u?.avatarUrl) urls[s.data.username] = u.avatarUrl
    }
  })
  return urls
}

const playSong = (roomId, song) => {
  rooms[roomId].currentSongStartTime = song ? Date.now() : null
  rooms[roomId].currentPosition = null
  io.to(roomId).emit('play-song', { song })
}

const creditListeningTime = (roomId) => {
  if (!rooms[roomId]?.currentSongStartTime) return
  const seconds = Math.floor((Date.now() - rooms[roomId].currentSongStartTime) / 1000)
  if (seconds < 5) return
  const stmt = db.prepare('UPDATE users SET minutesListened = minutesListened + ? WHERE username = ?')
  io.sockets.sockets.forEach(s => {
    if (s.data.roomId === roomId && s.data.username && getUser(s.data.username))
      stmt.run(seconds / 60, s.data.username)
  })
}

// ── REST endpoints ────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })
  if (getUser(username)) return res.status(400).json({ error: 'Username already taken' })
  const hashed = await bcrypt.hash(password, 10)
  db.prepare(`INSERT INTO users (username,password,xp,avatarColor,songsAdded,thumbsReceived,streak,lastLoginDate)
              VALUES (?,?,0,'#e94560',0,0,1,?)`).run(username, hashed, todayStr())
  const token = jwt.sign({ username }, JWT_SECRET)
  res.json({ token, user: { username, xp: 0, level: getLevel(0), avatarColor: '#e94560', songsAdded: 0, thumbsReceived: 0, streak: 1, streakBonus: 0, isNewDay: false } })
})

app.post('/login', async (req, res) => {
  const u = getUser(req.body.username)
  if (!u) return res.status(400).json({ error: 'User not found' })
  const valid = await bcrypt.compare(req.body.password, u.password)
  if (!valid) return res.status(400).json({ error: 'Wrong password' })
  const streakInfo = updateStreak(u.username)
  const fresh = getUser(u.username)
  const token = jwt.sign({ username: u.username }, JWT_SECRET)
  res.json({ token, user: { username: u.username, xp: fresh.xp||0, level: getLevel(fresh.xp||0), avatarColor: fresh.avatarColor, avatarUrl: fresh.avatarUrl||null, songsAdded: fresh.songsAdded||0, thumbsReceived: fresh.thumbsReceived||0, streak: streakInfo.streak, streakBonus: streakInfo.streakBonus, isNewDay: streakInfo.isNewDay } })
})

app.get('/me', (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { username } = jwt.verify(auth.slice(7), JWT_SECRET)
    const u = getUser(username)
    if (!u) return res.status(404).json({ error: 'User not found' })
    const streakInfo = updateStreak(username)
    const fresh = getUser(username)
    res.json({ user: { username, xp: fresh.xp||0, level: getLevel(fresh.xp||0), avatarColor: fresh.avatarColor, avatarUrl: fresh.avatarUrl||null, songsAdded: fresh.songsAdded||0, thumbsReceived: fresh.thumbsReceived||0, streak: streakInfo.streak, streakBonus: streakInfo.streakBonus, isNewDay: streakInfo.isNewDay } })
  } catch (e) { res.status(401).json({ error: 'Invalid token' }) }
})

app.get('/profile/:username', (req, res) => {
  const u = getUser(req.params.username)
  if (!u) return res.status(404).json({ error: 'User not found' })
  res.json({ username: u.username, xp: u.xp||0, level: getLevel(u.xp||0), avatarColor: u.avatarColor, avatarUrl: u.avatarUrl||null, songsAdded: u.songsAdded||0, thumbsReceived: u.thumbsReceived||0, minutesListened: u.minutesListened||0 })
})

app.post('/upload-avatar', (req, res) => {
  const { username, imageData } = req.body
  if (!getUser(username)) return res.status(404).json({ error: 'User not found' })
  const matches = imageData?.match(/^data:image\/(jpeg|png|webp|gif);base64,(.+)$/)
  if (!matches) return res.status(400).json({ error: 'Invalid image data' })
  const buffer = Buffer.from(matches[2], 'base64')
  const filename = `${username}.${matches[1]}`
  fs.writeFileSync(path.join(AVATARS_DIR, filename), buffer)
  const avatarUrl = `/uploads/avatars/${filename}`
  db.prepare('UPDATE users SET avatarUrl = ? WHERE username = ?').run(avatarUrl, username)
  res.json({ avatarUrl })
})

app.post('/update-color', (req, res) => {
  const { username, color, clearAvatar } = req.body
  if (!getUser(username)) return res.status(404).json({ error: 'User not found' })
  if (clearAvatar) {
    db.prepare('UPDATE users SET avatarColor = ?, avatarUrl = NULL WHERE username = ?').run(color, username)
  } else {
    db.prepare('UPDATE users SET avatarColor = ? WHERE username = ?').run(color, username)
  }
  res.json({ success: true })
})

app.get('/search', async (req, res) => {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', q: req.query.q, type: 'video', videoCategoryId: '10', maxResults: 8, key: process.env.YOUTUBE_API_KEY }
    })
    res.json(response.data.items.map(item => ({
      videoId: item.id.videoId, title: item.snippet.title,
      artist: item.snippet.channelTitle, thumbnail: item.snippet.thumbnails.default.url
    })))
  } catch (e) { res.status(500).json({ error: 'Search failed' }) }
})

app.get('/leaderboard', (req, res) => {
  const top = db.prepare('SELECT * FROM users ORDER BY xp DESC LIMIT 10').all()
  res.json(top.map((u, i) => ({ rank: i+1, username: u.username, xp: u.xp||0, level: getLevel(u.xp||0), avatarColor: u.avatarColor||'#e94560', avatarUrl: u.avatarUrl||null })))
})

const getUserPresence = (username) => {
  let roomId = null
  io.sockets.sockets.forEach(s => { if (s.data.username === username && s.data.roomId) roomId = s.data.roomId })
  return { online: [...io.sockets.sockets.values()].some(s => s.data.username === username), roomId, roomName: roomId ? rooms[roomId]?.name : null }
}

app.get('/favorites/:username', (req, res) => {
  if (!getUser(req.params.username)) return res.status(404).json({ error: 'User not found' })
  res.json(db.prepare('SELECT * FROM favorites WHERE username = ? ORDER BY favoritedAt DESC').all(req.params.username))
})

app.post('/favorites/add', (req, res) => {
  const { username, song } = req.body
  if (!getUser(username)) return res.status(404).json({ error: 'User not found' })
  db.prepare('INSERT OR IGNORE INTO favorites (username,videoId,title,artist,thumbnail,favoritedAt) VALUES (?,?,?,?,?,?)').run(username, song.videoId, song.title, song.artist, song.thumbnail, Date.now())
  res.json({ success: true })
})

app.post('/favorites/remove', (req, res) => {
  const { username, videoId } = req.body
  if (!getUser(username)) return res.status(404).json({ error: 'User not found' })
  db.prepare('DELETE FROM favorites WHERE username = ? AND videoId = ?').run(username, videoId)
  res.json({ success: true })
})

app.get('/friends/:username', (req, res) => {
  const u = getUser(req.params.username)
  if (!u) return res.status(404).json({ error: 'User not found' })
  const friendNames  = db.prepare('SELECT friend   FROM friendships    WHERE username = ?').all(req.params.username).map(r => r.friend)
  const requestNames = db.prepare('SELECT fromUser FROM friend_requests WHERE toUser = ?').all(req.params.username).map(r => r.fromUser)
  const sentNames    = db.prepare('SELECT toUser   FROM friend_requests WHERE fromUser = ?').all(req.params.username).map(r => r.toUser)
  const friends  = friendNames.map(f  => { const fu = getUser(f);  if (!fu) return null; return { username: f,  avatarColor: fu.avatarColor||'#e94560', avatarUrl: fu.avatarUrl||null, xp: fu.xp||0, level: getLevel(fu.xp||0), ...getUserPresence(f)  } }).filter(Boolean)
  const requests = requestNames.map(f => { const fu = getUser(f);  if (!fu) return null; return { username: f,  avatarColor: fu.avatarColor||'#e94560', avatarUrl: fu.avatarUrl||null } }).filter(Boolean)
  res.json({ friends, requests, sentRequests: sentNames })
})

app.get('/search-users', (req, res) => {
  const { q } = req.query
  if (!q || q.length < 2) return res.json([])
  res.json(db.prepare('SELECT * FROM users WHERE username LIKE ? LIMIT 6').all(`%${q}%`)
    .map(u => ({ username: u.username, avatarColor: u.avatarColor||'#e94560', avatarUrl: u.avatarUrl||null, xp: u.xp||0, level: getLevel(u.xp||0) })))
})

app.get('/rooms', (req, res) => {
  res.json(Object.entries(rooms).map(([id, room]) => ({ id, name: room.name, host: room.host, userCount: room.users.length, currentSong: room.queue[0]||null })))
})

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('connected:', socket.id)

  socket.on('create-room', ({ roomName, username, avatarColor }) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase()
    rooms[roomId] = { name: roomName, host: username, users: [username], queue: [], messages: [], skipVoters: [], history: [], currentSongStartTime: null, currentPosition: null }
    socket.data.roomId = roomId
    socket.data.username = username
    socket.data.avatarColor = avatarColor || '#e94560'
    socket.join(roomId)
    socket.emit('room-created', { roomId, room: rooms[roomId], userColors: getRoomColors(roomId), userLevels: getRoomLevels(roomId), userAvatarUrls: getRoomAvatarUrls(roomId) })
  })

  socket.on('join-room', ({ roomId, username, avatarColor }) => {
    if (!rooms[roomId]) return socket.emit('error', { message: 'Room not found' })
    if (!rooms[roomId].users.includes(username)) rooms[roomId].users.push(username)
    socket.data.roomId = roomId
    socket.data.username = username
    socket.data.avatarColor = avatarColor || '#6366f1'
    socket.join(roomId)
    const elapsed = rooms[roomId].currentSongStartTime ? Math.max(0, (Date.now() - rooms[roomId].currentSongStartTime) / 1000) : 0
    socket.emit('room-joined', { roomId, room: rooms[roomId], elapsed, userColors: getRoomColors(roomId), userLevels: getRoomLevels(roomId), userAvatarUrls: getRoomAvatarUrls(roomId), history: rooms[roomId].history })
    socket.to(roomId).emit('user-joined', { users: rooms[roomId].users, userColors: getRoomColors(roomId), userLevels: getRoomLevels(roomId), userAvatarUrls: getRoomAvatarUrls(roomId) })
  })

  socket.on('leave-room', ({ roomId, username }) => {
    if (!rooms[roomId]) return
    rooms[roomId].users = rooms[roomId].users.filter(u => u !== username)
    socket.leave(roomId)
    socket.data.roomId = null
    socket.data.username = null
    if (rooms[roomId].users.length === 0) {
      delete rooms[roomId]
    } else if (username === rooms[roomId].host) {
      rooms[roomId].host = rooms[roomId].users[0]
      io.to(roomId).emit('host-changed', { newHost: rooms[roomId].host, users: rooms[roomId].users, userColors: getRoomColors(roomId), userLevels: getRoomLevels(roomId), userAvatarUrls: getRoomAvatarUrls(roomId) })
    } else {
      io.to(roomId).emit('user-left', { users: rooms[roomId].users, userColors: getRoomColors(roomId), userLevels: getRoomLevels(roomId), userAvatarUrls: getRoomAvatarUrls(roomId) })
    }
  })

  socket.on('add-to-queue', ({ roomId, song, addedBy }) => {
    if (!rooms[roomId]) return
    rooms[roomId].queue.push({ ...song, addedBy, thumbsUp: 0 })
    io.to(roomId).emit('queue-updated', { queue: rooms[roomId].queue })
    if (rooms[roomId].queue.length === 1) playSong(roomId, rooms[roomId].queue[0])
    if (getUser(addedBy)) {
      db.prepare('UPDATE users SET songsAdded = songsAdded + 1 WHERE username = ?').run(addedBy)
      const xpResult = addXP(addedBy, XP_REWARDS.addSong)
      if (xpResult) socket.emit('xp-gained', { amount: XP_REWARDS.addSong, source: 'addSong', ...xpResult })
    }
  })

  socket.on('thumbs-up', ({ roomId, username, songVideoId }) => {
    if (!rooms[roomId]) return
    const song = rooms[roomId].queue[0]
    if (!song || song.videoId !== songVideoId || song.addedBy === username) return
    if (!song.thumbsUpVoters) song.thumbsUpVoters = []
    if (song.thumbsUpVoters.includes(username)) return
    song.thumbsUpVoters.push(username)
    song.thumbsUp = (song.thumbsUp || 0) + 1
    io.to(roomId).emit('thumbs-updated', { thumbsUp: song.thumbsUp })
    if (getUser(song.addedBy)) {
      db.prepare('UPDATE users SET thumbsReceived = thumbsReceived + 1 WHERE username = ?').run(song.addedBy)
      const xpResult = addXP(song.addedBy, XP_REWARDS.thumbsUp)
      if (xpResult) {
        const fresh = getUser(song.addedBy)
        const ownerSocket = [...io.sockets.sockets.values()].find(s => s.data.username === song.addedBy && s.data.roomId === roomId)
        if (ownerSocket) ownerSocket.emit('xp-gained', { amount: XP_REWARDS.thumbsUp, source: 'thumbsUp', thumbsReceived: fresh?.thumbsReceived, ...xpResult })
      }
    }
  })

  socket.on('vote-skip', ({ roomId, username }) => {
    if (!rooms[roomId]) return
    if (!rooms[roomId].skipVoters) rooms[roomId].skipVoters = []
    if (rooms[roomId].skipVoters.includes(username)) return
    rooms[roomId].skipVoters.push(username)
    const votes = rooms[roomId].skipVoters.length
    const total = rooms[roomId].users.length
    io.to(roomId).emit('skip-votes-updated', { votes, totalUsers: total })
    if (votes > total / 2) {
      creditListeningTime(roomId)
      const skipped = rooms[roomId].queue[0]
      if (skipped) {
        rooms[roomId].history.unshift({ ...skipped, playedAt: Date.now(), skipped: true })
        if (rooms[roomId].history.length > 20) rooms[roomId].history.pop()
        io.to(roomId).emit('history-updated', { history: rooms[roomId].history })
      }
      rooms[roomId].queue.shift()
      rooms[roomId].skipVoters = []
      playSong(roomId, rooms[roomId].queue[0] || null)
      io.to(roomId).emit('queue-updated', { queue: rooms[roomId].queue })
    }
  })

  socket.on('song-ended', ({ roomId }) => {
    if (!rooms[roomId]) return
    creditListeningTime(roomId)
    const finished = rooms[roomId].queue[0]
    if (finished) {
      rooms[roomId].history.unshift({ ...finished, playedAt: Date.now() })
      if (rooms[roomId].history.length > 20) rooms[roomId].history.pop()
      io.to(roomId).emit('history-updated', { history: rooms[roomId].history })
    }
    rooms[roomId].queue.shift()
    rooms[roomId].skipVoters = []
    io.to(roomId).emit('queue-updated', { queue: rooms[roomId].queue })
    playSong(roomId, rooms[roomId].queue[0] || null)
  })

  socket.on('sync-heartbeat', ({ roomId, videoId, currentTime }) => {
    if (rooms[roomId]) rooms[roomId].currentPosition = { time: currentTime, receivedAt: Date.now(), videoId }
    socket.to(roomId).emit('sync-heartbeat', { videoId, currentTime })
  })

  socket.on('get-sync', ({ roomId }, callback) => {
    if (!rooms[roomId]) return callback(null)
    const song = rooms[roomId].queue[0] || null
    let elapsed = 0
    if (rooms[roomId].currentPosition) {
      elapsed = rooms[roomId].currentPosition.time + (Date.now() - rooms[roomId].currentPosition.receivedAt) / 1000
    } else if (rooms[roomId].currentSongStartTime) {
      elapsed = Math.max(0, (Date.now() - rooms[roomId].currentSongStartTime) / 1000)
    }
    callback({ song, elapsed: Math.max(0, elapsed) })
  })

  socket.on('send-message', ({ roomId, username, message }) => {
    if (!rooms[roomId]) return
    const msg = { username, message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    rooms[roomId].messages.push(msg)
    io.to(roomId).emit('new-message', msg)
  })

  socket.on('typing',      ({ roomId, username }) => socket.to(roomId).emit('typing',      { username }))
  socket.on('stop-typing', ({ roomId, username }) => socket.to(roomId).emit('stop-typing', { username }))
  socket.on('song-reaction', ({ roomId, username, emoji }) => io.to(roomId).emit('song-reaction', { username, emoji }))

  // ── Friends ───────────────────────────────────────────────────────────────
  const findSocket = (username) => [...io.sockets.sockets.values()].find(s => s.data.username === username)

  socket.on('send-friend-request', ({ from, to }) => {
    if (!getUser(from) || !getUser(to) || from === to) return
    if (db.prepare('SELECT 1 FROM friendships    WHERE username = ? AND friend   = ?').get(from, to)) return
    if (db.prepare('SELECT 1 FROM friend_requests WHERE fromUser  = ? AND toUser   = ?').get(from, to)) return
    db.prepare('INSERT OR IGNORE INTO friend_requests (fromUser,toUser) VALUES (?,?)').run(from, to)
    socket.emit('friend-request-sent', { to })
    const targetSocket = findSocket(to)
    if (targetSocket) targetSocket.emit('friend-request-received', { from, avatarColor: getUser(from)?.avatarColor || '#e94560' })
  })

  socket.on('accept-friend-request', ({ from, acceptedBy }) => {
    if (!getUser(from) || !getUser(acceptedBy)) return
    db.prepare('INSERT OR IGNORE INTO friendships (username,friend) VALUES (?,?)').run(acceptedBy, from)
    db.prepare('INSERT OR IGNORE INTO friendships (username,friend) VALUES (?,?)').run(from, acceptedBy)
    db.prepare('DELETE FROM friend_requests WHERE fromUser = ? AND toUser = ?').run(from, acceptedBy)
    socket.emit('friend-accepted', { username: from,       avatarColor: getUser(from)?.avatarColor       || '#e94560', ...getUserPresence(from) })
    const fromSocket = findSocket(from)
    if (fromSocket) fromSocket.emit('friend-accepted', { username: acceptedBy, avatarColor: getUser(acceptedBy)?.avatarColor || '#e94560', ...getUserPresence(acceptedBy) })
  })

  socket.on('decline-friend-request', ({ from, declinedBy }) => {
    db.prepare('DELETE FROM friend_requests WHERE fromUser = ? AND toUser = ?').run(from, declinedBy)
    socket.emit('friend-request-declined', { from })
  })

  socket.on('remove-friend', ({ username, friend }) => {
    db.prepare('DELETE FROM friendships WHERE (username=? AND friend=?) OR (username=? AND friend=?)').run(username, friend, friend, username)
    socket.emit('friend-removed', { friend })
    const friendSocket = findSocket(friend)
    if (friendSocket) friendSocket.emit('friend-removed', { friend: username })
  })

  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id)
    const { roomId, username } = socket.data
    if (roomId && rooms[roomId] && username) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u !== username)
      if (rooms[roomId].users.length === 0) {
        delete rooms[roomId]
      } else if (username === rooms[roomId].host) {
        rooms[roomId].host = rooms[roomId].users[0]
        io.to(roomId).emit('host-changed', { newHost: rooms[roomId].host, users: rooms[roomId].users, userColors: getRoomColors(roomId), userLevels: getRoomLevels(roomId) })
      } else {
        io.to(roomId).emit('user-left', { users: rooms[roomId].users, userColors: getRoomColors(roomId), userLevels: getRoomLevels(roomId) })
      }
    }
  })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => console.log(`server running on port ${PORT}`))