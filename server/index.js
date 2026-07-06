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

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// Serve uploaded avatar images
const AVATARS_DIR = path.join(__dirname, 'uploads', 'avatars')
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true })
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

// ── Persistent user storage ───────────────────────────────────────────────────
const USERS_FILE = path.join(__dirname, 'users.json')

const loadUsers = () => {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
  } catch (e) { console.error('Failed to load users:', e) }
  return {}
}

const saveUsers = () => {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)) }
  catch (e) { console.error('Failed to save users:', e) }
}

const users = loadUsers()
const rooms = {}
const JWT_SECRET = 'jam-app-secret-key'
const XP_REWARDS = { addSong: 10, thumbsUp: 25 }

const LEVELS = [
  { level: 1, title: 'Newcomer', minXP: 0 },
  { level: 2, title: 'Music Fan', minXP: 100 },
  { level: 3, title: 'DJ in Training', minXP: 250 },
  { level: 4, title: 'Crowd Pleaser', minXP: 500 },
  { level: 5, title: 'Vibe Master', minXP: 1000 },
  { level: 6, title: 'Legend', minXP: 2000 },
]

const getLevel = (xp) => {
  let current = LEVELS[0]
  for (const l of LEVELS) { if (xp >= l.minXP) current = l }
  return current
}

const addXP = (username, amount) => {
  if (!users[username]) return null
  const prevLevel = getLevel(users[username].xp || 0)
  users[username].xp = (users[username].xp || 0) + amount
  const newLevel = getLevel(users[username].xp)
  saveUsers()
  return { xp: users[username].xp, leveledUp: newLevel.level > prevLevel.level, newLevel }
}

const todayStr = () => new Date().toISOString().slice(0, 10)

// Update streak on login. Returns streak info to send to client.
const updateStreak = (username) => {
  const u = users[username]
  if (!u) return { streak: 0, streakBonus: 0, isNewDay: false }
  const today = todayStr()
  const lastLogin = u.lastLoginDate
  if (lastLogin === today) return { streak: u.streak || 1, streakBonus: 0, isNewDay: false }

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)
  const newStreak = lastLogin === yesterdayStr ? (u.streak || 1) + 1 : 1

  u.streak = newStreak
  u.lastLoginDate = today
  const streakBonus = Math.min(newStreak * 10, 100)
  const xpResult = addXP(username, streakBonus)
  return { streak: newStreak, streakBonus, isNewDay: true, xp: xpResult?.xp, leveledUp: xpResult?.leveledUp, newLevel: xpResult?.newLevel }
}

// Get { username: color } map for all connected users in a room
const getRoomColors = (roomId) => {
  const colors = {}
  io.sockets.sockets.forEach(s => {
    if (s.data.roomId === roomId && s.data.username) {
      colors[s.data.username] = s.data.avatarColor || '#6366f1'
    }
  })
  return colors
}

// Get { username: levelNumber } map for all connected users in a room
const getRoomLevels = (roomId) => {
  const levels = {}
  io.sockets.sockets.forEach(s => {
    if (s.data.roomId === roomId && s.data.username) {
      const xp = users[s.data.username]?.xp || 0
      levels[s.data.username] = getLevel(xp).level
    }
  })
  return levels
}

// Get { username: avatarUrl } map for all connected users in a room
const getRoomAvatarUrls = (roomId) => {
  const urls = {}
  io.sockets.sockets.forEach(s => {
    if (s.data.roomId === roomId && s.data.username) {
      const url = users[s.data.username]?.avatarUrl
      if (url) urls[s.data.username] = url
    }
  })
  return urls
}

const playSong = (roomId, song) => {
  rooms[roomId].currentSongStartTime = song ? Date.now() : null
  rooms[roomId].currentPosition = null
  io.to(roomId).emit('play-song', { song })
}

// Credit listening time to all registered users currently in a room
const creditListeningTime = (roomId) => {
  if (!rooms[roomId]?.currentSongStartTime) return
  const seconds = Math.floor((Date.now() - rooms[roomId].currentSongStartTime) / 1000)
  if (seconds < 5) return  // ignore accidental/instant skips
  io.sockets.sockets.forEach(s => {
    if (s.data.roomId === roomId && s.data.username && users[s.data.username]) {
      users[s.data.username].minutesListened = (users[s.data.username].minutesListened || 0) + seconds / 60
    }
  })
  saveUsers()
}

// ── REST endpoints ────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })
  if (users[username]) return res.status(400).json({ error: 'Username already taken' })
  const hashed = await bcrypt.hash(password, 10)
  users[username] = { username, password: hashed, xp: 0, avatarColor: '#e94560', songsAdded: 0, thumbsReceived: 0, streak: 1, lastLoginDate: todayStr() }
  saveUsers()
  const token = jwt.sign({ username }, JWT_SECRET)
  res.json({ token, user: { username, xp: 0, level: getLevel(0), avatarColor: '#e94560', songsAdded: 0, thumbsReceived: 0, streak: 1, streakBonus: 0, isNewDay: false } })
})

app.post('/login', async (req, res) => {
  const { username, password } = req.body
  if (!users[username]) return res.status(400).json({ error: 'User not found' })
  const valid = await bcrypt.compare(password, users[username].password)
  if (!valid) return res.status(400).json({ error: 'Wrong password' })
  const streakInfo = updateStreak(username)
  const token = jwt.sign({ username }, JWT_SECRET)
  const u = users[username]
  res.json({ token, user: { username, xp: u.xp || 0, level: getLevel(u.xp || 0), avatarColor: u.avatarColor, avatarUrl: u.avatarUrl || null, songsAdded: u.songsAdded || 0, thumbsReceived: u.thumbsReceived || 0, streak: streakInfo.streak, streakBonus: streakInfo.streakBonus, isNewDay: streakInfo.isNewDay } })
})

app.get('/me', (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { username } = jwt.verify(auth.slice(7), JWT_SECRET)
    const u = users[username]
    if (!u) return res.status(404).json({ error: 'User not found' })
    const streakInfo = updateStreak(username)
    res.json({ user: { username, xp: u.xp || 0, level: getLevel(u.xp || 0), avatarColor: u.avatarColor, avatarUrl: u.avatarUrl || null, songsAdded: u.songsAdded || 0, thumbsReceived: u.thumbsReceived || 0, streak: streakInfo.streak, streakBonus: streakInfo.streakBonus, isNewDay: streakInfo.isNewDay } })
  } catch (e) { res.status(401).json({ error: 'Invalid token' }) }
})

app.get('/profile/:username', (req, res) => {
  const u = users[req.params.username]
  if (!u) return res.status(404).json({ error: 'User not found' })
  res.json({ username: u.username, xp: u.xp || 0, level: getLevel(u.xp || 0), avatarColor: u.avatarColor, avatarUrl: u.avatarUrl || null, songsAdded: u.songsAdded || 0, thumbsReceived: u.thumbsReceived || 0, minutesListened: u.minutesListened || 0 })
})

app.post('/upload-avatar', (req, res) => {
  const { username, imageData } = req.body
  if (!users[username]) return res.status(404).json({ error: 'User not found' })
  const matches = imageData?.match(/^data:image\/(jpeg|png|webp|gif);base64,(.+)$/)
  if (!matches) return res.status(400).json({ error: 'Invalid image data' })
  const ext = matches[1]
  const buffer = Buffer.from(matches[2], 'base64')
  const filename = `${username}.${ext}`
  fs.writeFileSync(path.join(AVATARS_DIR, filename), buffer)
  users[username].avatarUrl = `/uploads/avatars/${filename}`
  saveUsers()
  res.json({ avatarUrl: users[username].avatarUrl })
})

app.post('/update-color', (req, res) => {
  const { username, color } = req.body
  if (!users[username]) return res.status(404).json({ error: 'User not found' })
  users[username].avatarColor = color
  saveUsers()
  res.json({ success: true })
})

app.get('/search', async (req, res) => {
  const { q } = req.query
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', q, type: 'video', videoCategoryId: '10', maxResults: 8, key: process.env.YOUTUBE_API_KEY }
    })
    const results = response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default.url
    }))
    res.json(results)
  } catch (e) { res.status(500).json({ error: 'Search failed' }) }
})

app.get('/leaderboard', (req, res) => {
  const leaderboard = Object.values(users)
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 10)
    .map((u, i) => ({
      rank: i + 1,
      username: u.username,
      xp: u.xp || 0,
      level: getLevel(u.xp || 0),
      avatarColor: u.avatarColor || '#e94560',
      avatarUrl: u.avatarUrl || null
    }))
  res.json(leaderboard)
})

// Helper: get online status + current room for a username
const getUserPresence = (username) => {
  let roomId = null
  io.sockets.sockets.forEach(s => { if (s.data.username === username && s.data.roomId) roomId = s.data.roomId })
  return { online: [...io.sockets.sockets.values()].some(s => s.data.username === username), roomId, roomName: roomId ? rooms[roomId]?.name : null }
}

app.get('/favorites/:username', (req, res) => {
  const u = users[req.params.username]
  if (!u) return res.status(404).json({ error: 'User not found' })
  res.json(u.favorites || [])
})

app.post('/favorites/add', (req, res) => {
  const { username, song } = req.body
  if (!users[username]) return res.status(404).json({ error: 'User not found' })
  if (!users[username].favorites) users[username].favorites = []
  if (!users[username].favorites.find(s => s.videoId === song.videoId)) {
    users[username].favorites.unshift({ videoId: song.videoId, title: song.title, artist: song.artist, thumbnail: song.thumbnail, favoritedAt: Date.now() })
    saveUsers()
  }
  res.json({ success: true })
})

app.post('/favorites/remove', (req, res) => {
  const { username, videoId } = req.body
  if (!users[username]) return res.status(404).json({ error: 'User not found' })
  users[username].favorites = (users[username].favorites || []).filter(s => s.videoId !== videoId)
  saveUsers()
  res.json({ success: true })
})

app.get('/friends/:username', (req, res) => {
  const u = users[req.params.username]
  if (!u) return res.status(404).json({ error: 'User not found' })
  const friends = (u.friends || []).map(fname => {
    const f = users[fname]
    if (!f) return null
    return { username: fname, avatarColor: f.avatarColor || '#e94560', avatarUrl: f.avatarUrl || null, xp: f.xp || 0, level: getLevel(f.xp || 0), ...getUserPresence(fname) }
  }).filter(Boolean)
  const requests = (u.friendRequests || []).map(fname => {
    const f = users[fname]
    if (!f) return null
    return { username: fname, avatarColor: f.avatarColor || '#e94560', avatarUrl: f.avatarUrl || null }
  }).filter(Boolean)
  res.json({ friends, requests, sentRequests: u.sentRequests || [] })
})

app.get('/search-users', (req, res) => {
  const { q } = req.query
  if (!q || q.length < 2) return res.json([])
  const results = Object.values(users)
    .filter(u => u.password && u.username.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 6)
    .map(u => ({ username: u.username, avatarColor: u.avatarColor || '#e94560', avatarUrl: u.avatarUrl || null, xp: u.xp || 0, level: getLevel(u.xp || 0) }))
  res.json(results)
})

app.get('/rooms', (req, res) => {
  const publicRooms = Object.entries(rooms).map(([id, room]) => ({
    id, name: room.name, host: room.host,
    userCount: room.users.length,
    currentSong: room.queue[0] || null
  }))
  res.json(publicRooms)
})

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('connected:', socket.id)

  socket.on('create-room', ({ roomName, username, avatarColor }) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase()
    rooms[roomId] = {
      name: roomName, host: username,
      users: [username], queue: [], messages: [],
      skipVoters: [], history: [],
      currentSongStartTime: null, currentPosition: null
    }
    socket.data.roomId = roomId
    socket.data.username = username
    socket.data.avatarColor = avatarColor || '#e94560'
    socket.join(roomId)
    socket.emit('room-created', {
      roomId,
      room: rooms[roomId],
      userColors: getRoomColors(roomId),
      userLevels: getRoomLevels(roomId),
      userAvatarUrls: getRoomAvatarUrls(roomId)
    })
  })

  socket.on('join-room', ({ roomId, username, avatarColor }) => {
    if (!rooms[roomId]) return socket.emit('error', { message: 'Room not found' })
    if (!rooms[roomId].users.includes(username)) rooms[roomId].users.push(username)
    socket.data.roomId = roomId
    socket.data.username = username
    socket.data.avatarColor = avatarColor || '#6366f1'
    socket.join(roomId)
    const elapsed = rooms[roomId].currentSongStartTime
      ? Math.max(0, (Date.now() - rooms[roomId].currentSongStartTime) / 1000)
      : 0
    socket.emit('room-joined', {
      roomId,
      room: rooms[roomId],
      elapsed,
      userColors: getRoomColors(roomId),
      userLevels: getRoomLevels(roomId),
      userAvatarUrls: getRoomAvatarUrls(roomId),
      history: rooms[roomId].history
    })
    socket.to(roomId).emit('user-joined', {
      users: rooms[roomId].users,
      userColors: getRoomColors(roomId),
      userLevels: getRoomLevels(roomId),
      userAvatarUrls: getRoomAvatarUrls(roomId)
    })
  })

  socket.on('leave-room', ({ roomId, username }) => {
    if (!rooms[roomId]) return
    rooms[roomId].users = rooms[roomId].users.filter(u => u !== username)
    socket.leave(roomId)
    socket.data.roomId = null
    socket.data.username = null
    if (rooms[roomId].users.length === 0) {
      delete rooms[roomId]
    } else {
      if (username === rooms[roomId].host) {
        rooms[roomId].host = rooms[roomId].users[0]
        io.to(roomId).emit('host-changed', {
          newHost: rooms[roomId].host,
          users: rooms[roomId].users,
          userColors: getRoomColors(roomId),
          userLevels: getRoomLevels(roomId),
          userAvatarUrls: getRoomAvatarUrls(roomId)
        })
      } else {
        io.to(roomId).emit('user-left', {
          users: rooms[roomId].users,
          userColors: getRoomColors(roomId),
          userLevels: getRoomLevels(roomId),
          userAvatarUrls: getRoomAvatarUrls(roomId)
        })
      }
    }
  })

  socket.on('add-to-queue', ({ roomId, song, addedBy }) => {
    if (!rooms[roomId]) return
    rooms[roomId].queue.push({ ...song, addedBy, thumbsUp: 0 })
    io.to(roomId).emit('queue-updated', { queue: rooms[roomId].queue })
    if (rooms[roomId].queue.length === 1) playSong(roomId, rooms[roomId].queue[0])
    if (users[addedBy]) {
      users[addedBy].songsAdded = (users[addedBy].songsAdded || 0) + 1
      const xpResult = addXP(addedBy, XP_REWARDS.addSong)
      if (xpResult) socket.emit('xp-gained', { amount: XP_REWARDS.addSong, source: 'addSong', ...xpResult })
    }
  })

  socket.on('thumbs-up', ({ roomId, username, songVideoId }) => {
    if (!rooms[roomId]) return
    const song = rooms[roomId].queue[0]
    if (!song || song.videoId !== songVideoId) return
    if (song.addedBy === username) return
    if (!song.thumbsUpVoters) song.thumbsUpVoters = []
    if (song.thumbsUpVoters.includes(username)) return
    song.thumbsUpVoters.push(username)
    song.thumbsUp = (song.thumbsUp || 0) + 1
    io.to(roomId).emit('thumbs-updated', { thumbsUp: song.thumbsUp })
    if (users[song.addedBy]) {
      users[song.addedBy].thumbsReceived = (users[song.addedBy].thumbsReceived || 0) + 1
      const xpResult = addXP(song.addedBy, XP_REWARDS.thumbsUp)
      if (xpResult) {
        const ownerSocket = [...io.sockets.sockets.values()].find(s => s.data.username === song.addedBy && s.data.roomId === roomId)
        if (ownerSocket) ownerSocket.emit('xp-gained', { amount: XP_REWARDS.thumbsUp, source: 'thumbsUp', thumbsReceived: users[song.addedBy].thumbsReceived, ...xpResult })
      }
    }
    saveUsers()
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
    if (rooms[roomId]) {
      rooms[roomId].currentPosition = { time: currentTime, receivedAt: Date.now(), videoId }
    }
    socket.to(roomId).emit('sync-heartbeat', { videoId, currentTime })
  })

  socket.on('get-sync', ({ roomId }, callback) => {
    if (!rooms[roomId]) return callback(null)
    const song = rooms[roomId].queue[0] || null
    let elapsed = 0
    if (rooms[roomId].currentPosition) {
      const { time, receivedAt } = rooms[roomId].currentPosition
      elapsed = time + (Date.now() - receivedAt) / 1000
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

  socket.on('typing', ({ roomId, username }) => {
    socket.to(roomId).emit('typing', { username })
  })

  socket.on('stop-typing', ({ roomId, username }) => {
    socket.to(roomId).emit('stop-typing', { username })
  })

  socket.on('song-reaction', ({ roomId, username, emoji }) => {
    io.to(roomId).emit('song-reaction', { username, emoji })
  })

  // ── Friends ───────────────────────────────────────────────────────────────
  const findSocket = (username) => [...io.sockets.sockets.values()].find(s => s.data.username === username)

  socket.on('send-friend-request', ({ from, to }) => {
    if (!users[from] || !users[to] || from === to) return
    if ((users[to].friends || []).includes(from)) return
    if ((users[to].friendRequests || []).includes(from)) return
    if (!users[to].friendRequests) users[to].friendRequests = []
    if (!users[from].sentRequests) users[from].sentRequests = []
    users[to].friendRequests.push(from)
    users[from].sentRequests.push(to)
    saveUsers()
    socket.emit('friend-request-sent', { to })
    const targetSocket = findSocket(to)
    if (targetSocket) targetSocket.emit('friend-request-received', { from, avatarColor: users[from].avatarColor || '#e94560' })
  })

  socket.on('accept-friend-request', ({ from, acceptedBy }) => {
    if (!users[from] || !users[acceptedBy]) return
    if (!users[acceptedBy].friends) users[acceptedBy].friends = []
    if (!users[from].friends) users[from].friends = []
    users[acceptedBy].friends.push(from)
    users[from].friends.push(acceptedBy)
    users[acceptedBy].friendRequests = (users[acceptedBy].friendRequests || []).filter(u => u !== from)
    users[from].sentRequests = (users[from].sentRequests || []).filter(u => u !== acceptedBy)
    saveUsers()
    socket.emit('friend-accepted', { username: from, avatarColor: users[from].avatarColor || '#e94560', ...getUserPresence(from) })
    const fromSocket = findSocket(from)
    if (fromSocket) fromSocket.emit('friend-accepted', { username: acceptedBy, avatarColor: users[acceptedBy].avatarColor || '#e94560', ...getUserPresence(acceptedBy) })
  })

  socket.on('decline-friend-request', ({ from, declinedBy }) => {
    if (users[declinedBy]) users[declinedBy].friendRequests = (users[declinedBy].friendRequests || []).filter(u => u !== from)
    if (users[from]) users[from].sentRequests = (users[from].sentRequests || []).filter(u => u !== declinedBy)
    saveUsers()
    socket.emit('friend-request-declined', { from })
  })

  socket.on('remove-friend', ({ username, friend }) => {
    if (users[username]) users[username].friends = (users[username].friends || []).filter(u => u !== friend)
    if (users[friend]) users[friend].friends = (users[friend].friends || []).filter(u => u !== username)
    saveUsers()
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
      } else {
        if (username === rooms[roomId].host) {
          rooms[roomId].host = rooms[roomId].users[0]
          io.to(roomId).emit('host-changed', {
            newHost: rooms[roomId].host,
            users: rooms[roomId].users,
            userColors: getRoomColors(roomId),
            userLevels: getRoomLevels(roomId)
          })
        } else {
          io.to(roomId).emit('user-left', {
            users: rooms[roomId].users,
            userColors: getRoomColors(roomId),
            userLevels: getRoomLevels(roomId)
          })
        }
      }
    }
  })
})

server.listen(3001, () => console.log('server running on port 3001'))