
/*
            below code adds the major upgrade incl grp chat and request*/
const nodemailer = require('nodemailer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;




// --- EMAIL CONFIGURATION ---
let testAccount;
async function getTransporter() {
    // Local Dev: Uses Ethereal to generate a fake SMTP server and preview links
    if (!testAccount) {
        testAccount = await nodemailer.createTestAccount();
    }
    return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
    });

    /* PRODUCTION SETUP (Uncomment and use when deploying):
    return nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: process.env.RESEND_API_KEY }, // Set RESEND_API_KEY in Render environment variables
    });
    */
}

async function sendVerificationEmail(email, token) {
    const transport = await getTransporter();
    const verifyLink = `http://localhost:3000/?verifyToken=${token}`; // Change to Netlify URL in prod

    const info = await transport.sendMail({
        from: '"PureChat Security" <no-reply@purechat.com>',
        to: email,
        subject: "Verify your PureChat account",
        text: `Click here to verify your account: ${verifyLink}`,
        html: `
      <div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
        <h2 style="color: #00a884;">Welcome to PureChat!</h2>
        <p>Please click the button below to verify your email address and activate your account.</p>
        <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #00a884; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Verify Email</a>
        <p style="font-size: 12px; color: #8696a0;">If you didn't request this, please ignore this email. This link expires in 15 minutes.</p>
      </div>
    `
    });

    // Prints the preview URL in the terminal for local testing
    console.log("📧 EMAIL PREVIEW URL: %s", nodemailer.getTestMessageUrl(info));
}


const app = express();
app.use(cors({ origin: "http://localhost:3000", methods: ["GET", "POST"] }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] } });

const JWT_SECRET = 'super_secret_privacy_key_change_in_production';
const DB_FILE = './db.json';
const userSocketMap = {};

// --- DB HELPER ---
async function getDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        const db = JSON.parse(data);
        if (!db.requests) db.requests = [];
        // Ensure all rooms have a type (migration for old DBs)
        db.rooms.forEach(r => { if (!r.type) r.type = 'direct'; });
        return db;
    } catch {
        return { users: [], rooms: [], requests: [] };
    }
}
async function saveDB(db) { await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2)); }

// --- AUTH --- wihout email verify
/*app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name } = req.body;
    const db = await getDB();
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now().toString(), email, name, passwordHash: hashedPassword };
    db.users.push(newUser);
    await saveDB(db);
    const token = jwt.sign({ userId: newUser.id, name: newUser.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email } });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const db = await getDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});*/


app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name } = req.body;
    const db = await getDB();
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const verifyToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '15m' }); // Short-lived token

    const newUser = {
        id: Date.now().toString(), email, name, passwordHash: hashedPassword,
        isVerified: false, verifyToken
    };
    db.users.push(newUser);
    await saveDB(db);

    try {
        await sendVerificationEmail(email, verifyToken);
        res.json({ success: true, message: 'Verification email sent.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const db = await getDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });

    // NEW: Check if email is verified
    if (!user.isVerified) {
        return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', email: user.email });
    }

    const token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});



// Verify Email via Magic Link
app.post('/api/auth/verify-email', async (req, res) => {
    const { token } = req.body;
    const db = await getDB();

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.users.find(u => u.email === decoded.email && u.verifyToken === token);

        if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

        user.isVerified = true;
        delete user.verifyToken;
        await saveDB(db);

        // Issue the final, long-lasting Auth Token
        const authToken = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: authToken, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        res.status(400).json({ error: 'Invalid or expired token' });
    }
});

// Resend Verification Email
app.post('/api/auth/resend-verification', async (req, res) => {
    const { email } = req.body;
    const db = await getDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'User already verified' });

    const verifyToken = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '15m' });
    user.verifyToken = verifyToken;
    await saveDB(db);

    try {
        await sendVerificationEmail(user.email, verifyToken);
        res.json({ success: true, message: 'Verification email resent.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send email' });
    }
});



const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'Unauthorized' }); }
};

// --- USER SEARCH ---
app.get('/api/users/search', authMiddleware, async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const db = await getDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.id !== req.user.userId);
    if (!user) return res.status(404).json({ error: 'User does not exist yet.' });
    res.json({ id: user.id, name: user.name, email: user.email });
});



// --- STANDARD FRIEND REQUESTS (1v1) ---

// Send a friend/chat request
/*app.post('/api/requests/send', authMiddleware, async (req, res) => {
    const { toUserId } = req.body;
    const db = await getDB();

    // Check if already friends (have a direct room)
    const isFriend = db.rooms.some(r => r.type === 'direct' && r.participants.includes(req.user.userId) && r.participants.includes(toUserId));
    if (isFriend) return res.status(400).json({ error: 'Already connected with this user.' });

    // Check if request already sent
    const existingReq = db.requests.find(r => r.fromUserId === req.user.userId && r.toUserId === toUserId && r.status === 'pending');
    if (existingReq) return res.status(400).json({ error: 'Request already sent.' });

    const newReq = {
        id: Date.now().toString(),
        type: 'friend', // Explicitly mark as a standard friend request
        fromUserId: req.user.userId,
        toUserId,
        status: 'pending',
        timestamp: new Date().toISOString()
    };

    db.requests.push(newReq);
    await saveDB(db);

    // Notify receiver in real-time if they are online
    const targetSocketId = userSocketMap[toUserId];
    if (targetSocketId) {
        const fromUser = db.users.find(u => u.id === req.user.userId);
        io.to(targetSocketId).emit('new_request', { ...newReq, fromUser: { name: fromUser.name, email: fromUser.email } });
    }

    res.json({ success: true });
});*/

/*handling group and conenction status logic */


// 1. Create Group
app.post('/api/rooms/group', authMiddleware, async (req, res) => {
    const { name, memberIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const db = await getDB();

    // FIX: Only add the creator initially. 
    // The frontend will loop through memberIds and call /add-member, 
    // which will correctly handle the friend vs non-friend logic.
    const newGroup = {
        id: Date.now().toString(),
        type: 'group',
        groupName: name,
        adminId: req.user.userId,
        participants: [req.user.userId], // <--- ONLY THE CREATOR IS ADDED HERE
        messages: []
    };

    db.rooms.push(newGroup);
    await saveDB(db);

    // Join creator to socket room
    const creatorSocket = userSocketMap[req.user.userId];
    if (creatorSocket) io.to(creatorSocket).emit('join_room', newGroup.id);

    res.json(newGroup);
});

// Get pending requests for the logged-in user
app.get('/api/requests/pending', authMiddleware, async (req, res) => {
    const db = await getDB();
    const pending = db.requests.filter(r => r.toUserId === req.user.userId && r.status === 'pending');

    const populated = pending.map(r => {
        const fromUser = db.users.find(u => u.id === r.fromUserId);
        return { ...r, fromUser: { name: fromUser.name, email: fromUser.email } };
    });

    res.json(populated);
});


// --- GROUP CHAT LOGIC ---

// 1. Create Group
app.post('/api/rooms/group', authMiddleware, async (req, res) => {
    const { name, memberIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const db = await getDB();
    const participants = [req.user.userId, ...(memberIds || [])];

    const newGroup = {
        id: Date.now().toString(),
        type: 'group',
        groupName: name,
        adminId: req.user.userId,
        participants: [...new Set(participants)], // Remove duplicates
        messages: []
    };

    db.rooms.push(newGroup);
    await saveDB(db);

    // Join creator to socket room
    const creatorSocket = userSocketMap[req.user.userId];
    if (creatorSocket) io.to(creatorSocket).emit('join_room', newGroup.id);

    res.json(newGroup);
});

// 2. Add Member to Group (Handles Friend + Group Invite)
app.post('/api/rooms/:roomId/add-member', authMiddleware, async (req, res) => {
    const { userId } = req.body;
    const roomId = req.params.roomId;
    const db = await getDB();

    const room = db.rooms.find(r => r.id === roomId && r.type === 'group');
    if (!room) return res.status(404).json({ error: 'Group not found' });
    if (room.participants.includes(userId)) return res.status(400).json({ error: 'User is already in the group' });

    // Check if they are already friends (have a direct room)
    const isFriend = db.rooms.some(r => r.type === 'direct' && r.participants.includes(req.user.userId) && r.participants.includes(userId));

    if (isFriend) {
        // Direct add to group
        room.participants.push(userId);
        await saveDB(db);

        const targetSocket = userSocketMap[userId];
        if (targetSocket) {
            io.to(targetSocket).emit('added_to_group', { roomId, groupName: room.groupName });
        }
        io.to(roomId).emit('system_message', { text: `${db.users.find(u => u.id === userId).name} was added to the group`, roomId });
        res.json({ success: true, addedDirectly: true });
    } else {
        // Create compound request: Friend + Group Invite
        const existingReq = db.requests.find(r => r.fromUserId === req.user.userId && r.toUserId === userId && r.status === 'pending');
        if (existingReq) return res.status(400).json({ error: 'Request already pending' });

        const newReq = {
            id: Date.now().toString(),
            type: 'group_invite',
            fromUserId: req.user.userId,
            toUserId: userId,
            roomId: roomId,
            groupName: room.groupName,
            status: 'pending',
            timestamp: new Date().toISOString()
        };
        db.requests.push(newReq);
        await saveDB(db);

        const targetSocket = userSocketMap[userId];
        if (targetSocket) {
            const fromUser = db.users.find(u => u.id === req.user.userId);
            io.to(targetSocket).emit('new_request', { ...newReq, fromUser: { name: fromUser.name } });
        }
        res.json({ success: true, addedDirectly: false, message: 'Invite sent' });
    }
});

// 3. Respond to Request (Handles both Friend and Group Invite)
app.post('/api/requests/respond', authMiddleware, async (req, res) => {
    const { requestId, action } = req.body;
    const db = await getDB();
    const reqIndex = db.requests.findIndex(r => r.id === requestId && r.toUserId === req.user.userId);
    if (reqIndex === -1) return res.status(404).json({ error: 'Request not found' });

    const request = db.requests[reqIndex];
    const senderSocketId = userSocketMap[request.fromUserId];
    const responder = db.users.find(u => u.id === req.user.userId);

    if (action === 'accept') {
        request.status = 'accepted';

        if (request.type === 'group_invite') {
            // 1. Make them friends (create direct room)
            const directRoomExists = db.rooms.some(r => r.type === 'direct' && r.participants.includes(request.fromUserId) && r.participants.includes(request.toUserId));
            if (!directRoomExists) {
                db.rooms.push({ id: Date.now().toString() + '_direct', type: 'direct', participants: [request.fromUserId, request.toUserId], messages: [] });
            }

            // 2. Add to group
            const groupRoom = db.rooms.find(r => r.id === request.roomId);
            if (groupRoom && !groupRoom.participants.includes(request.toUserId)) {
                groupRoom.participants.push(request.toUserId);
                io.to(request.roomId).emit('system_message', { text: `${responder.name} joined the group`, roomId: request.roomId });
            }

            if (senderSocketId) io.to(senderSocketId).emit('request_accepted', { toUserName: responder.name, isGroup: true, groupName: groupRoom?.groupName });
        } else {
            // Standard friend request
            db.rooms.push({ id: Date.now().toString() + '_direct', type: 'direct', participants: [request.fromUserId, request.toUserId], messages: [] });
            if (senderSocketId) io.to(senderSocketId).emit('request_accepted', { toUserName: responder.name, isGroup: false });
        }

        await saveDB(db);
        res.json({ success: true });
    } else {
        request.status = 'rejected';
        await saveDB(db);
        if (senderSocketId) io.to(senderSocketId).emit('request_rejected', { toUserName: responder.name });
        res.json({ success: true });
    }
});

// --- FETCHING DATA ---
app.get('/api/rooms', authMiddleware, async (req, res) => {
    const db = await getDB();
    const userRooms = db.rooms.filter(room => room.participants.includes(req.user.userId));

    const roomsPreview = userRooms.map(room => {
        if (room.type === 'group') {
            return {
                id: room.id, type: 'group', name: room.groupName,
                memberCount: room.participants.length,
                lastMessage: room.messages.length > 0 ? room.messages[room.messages.length - 1] : null
            };
        } else {
            const otherUserId = room.participants.find(id => id !== req.user.userId);
            const otherUser = db.users.find(u => u.id === otherUserId);
            return {
                id: room.id, type: 'direct', name: otherUser ? otherUser.name : 'Unknown',
                lastMessage: room.messages.length > 0 ? room.messages[room.messages.length - 1] : null
            };
        }
    });
    res.json(roomsPreview);
});

app.get('/api/rooms/:roomId/messages', authMiddleware, async (req, res) => {
    const db = await getDB();
    const room = db.rooms.find(r => r.id === req.params.roomId && r.participants.includes(req.user.userId));
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ messages: room.messages, type: room.type, groupName: room.groupName });
});

// --- WEBSOCKETS ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
    userSocketMap[socket.user.userId] = socket.id;

    socket.on('join_room', (roomId) => socket.join(roomId));

    socket.on('send_message', async (data) => {
        const db = await getDB();
        const room = db.rooms.find(r => r.id === data.roomId && r.participants.includes(socket.user.userId));
        if (!room) return;

        const newMessage = {
            id: Date.now().toString(), senderId: socket.user.userId, senderName: socket.user.name,
            text: data.text, timestamp: new Date().toISOString()
        };
        room.messages.push(newMessage);
        await saveDB(db);
        io.to(data.roomId).emit('receive_message', { message: newMessage, roomId: data.roomId });
    });

    socket.on('disconnect', () => { delete userSocketMap[socket.user.userId]; });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));









/*const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;

const app = express();
app.use(cors({ origin: "http://localhost:3000", methods: ["GET", "POST"] }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

const JWT_SECRET = 'super_secret_privacy_key_change_in_production';
const DB_FILE = './db.json';

// Track online users for real-time notifications
const userSocketMap = {};

// --- SIMPLE LOCAL DATABASE HELPER ---
async function getDB() {
try {
const data = await fs.readFile(DB_FILE, 'utf8');
const db = JSON.parse(data);
if (!db.requests) db.requests = []; // Ensure requests array exists for older DBs
return db;
} catch {
return { users: [], rooms: [], requests: [] };
}
}
async function saveDB(db) {
await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

// --- AUTHENTICATION (Email/Password) ---
app.post('/api/auth/signup', async (req, res) => {
const { email, password, name } = req.body;
const db = await getDB();
if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
return res.status(400).json({ error: 'Email already registered' });
}
const hashedPassword = await bcrypt.hash(password, 10);
const newUser = { id: Date.now().toString(), email, name, passwordHash: hashedPassword };
db.users.push(newUser);
await saveDB(db);
const token = jwt.sign({ userId: newUser.id, name: newUser.name }, JWT_SECRET, { expiresIn: '7d' });
res.json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email } });
});

app.post('/api/auth/login', async (req, res) => {
const { email, password } = req.body;
const db = await getDB();
const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
return res.status(401).json({ error: 'Invalid email or password' });
}
const token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

const authMiddleware = (req, res, next) => {
const token = req.headers.authorization?.split(' ')[1];
try { req.user = jwt.verify(token, JWT_SECRET); next(); }
catch { res.status(401).json({ error: 'Unauthorized' }); }
};

// --- USER SEARCH & REQUESTS ---

// 1. Search for a user by email
app.get('/api/users/search', authMiddleware, async (req, res) => {
const { email } = req.query;
if (!email) return res.status(400).json({ error: 'Email required' });

const db = await getDB();
const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.id !== req.user.userId);

if (!user) return res.status(404).json({ error: 'User does not exist yet.' });

// Check if already in a room together
const existingRoom = db.rooms.find(r => r.participants.length === 2 && r.participants.includes(req.user.userId) && r.participants.includes(user.id));
if (existingRoom) return res.status(400).json({ error: 'You are already chatting with this user.', roomId: existingRoom.id });

// Check if request already sent
const existingReq = db.requests.find(r => r.fromUserId === req.user.userId && r.toUserId === user.id && r.status === 'pending');
if (existingReq) return res.status(400).json({ error: 'Request already sent.' });

res.json({ id: user.id, name: user.name, email: user.email });
});

// 2. Send a friend/chat request
app.post('/api/requests/send', authMiddleware, async (req, res) => {
const { toUserId } = req.body;
const db = await getDB();

const newReq = {
id: Date.now().toString(),
fromUserId: req.user.userId,
toUserId,
status: 'pending',
timestamp: new Date().toISOString()
};

db.requests.push(newReq);
await saveDB(db);

// Notify receiver in real-time if they are online
const targetSocketId = userSocketMap[toUserId];
if (targetSocketId) {
const fromUser = db.users.find(u => u.id === req.user.userId);
io.to(targetSocketId).emit('new_request', { ...newReq, fromUser: { name: fromUser.name, email: fromUser.email } });
}

res.json({ success: true });
});

// 3. Get pending requests for the logged-in user
app.get('/api/requests/pending', authMiddleware, async (req, res) => {
const db = await getDB();
const pending = db.requests.filter(r => r.toUserId === req.user.userId && r.status === 'pending');

const populated = pending.map(r => {
const fromUser = db.users.find(u => u.id === r.fromUserId);
return { ...r, fromUser: { name: fromUser.name, email: fromUser.email } };
});

res.json(populated);
});

// 4. Accept or Reject a request
app.post('/api/requests/respond', authMiddleware, async (req, res) => {
const { requestId, action } = req.body;
const db = await getDB();

const reqIndex = db.requests.findIndex(r => r.id === requestId && r.toUserId === req.user.userId);
if (reqIndex === -1) return res.status(404).json({ error: 'Request not found' });

const request = db.requests[reqIndex];
const senderSocketId = userSocketMap[request.fromUserId];
const responder = db.users.find(u => u.id === req.user.userId);

if (action === 'accept') {
request.status = 'accepted';
// Create the private chat room
const newRoom = {
id: Date.now().toString(),
participants: [request.fromUserId, request.toUserId],
messages: []
};
db.rooms.push(newRoom);
await saveDB(db);

if (senderSocketId) {
io.to(senderSocketId).emit('request_accepted', { roomId: newRoom.id, toUserName: responder.name });
}
res.json({ success: true, room: newRoom });
} else {
request.status = 'rejected';
await saveDB(db);
if (senderSocketId) {
io.to(senderSocketId).emit('request_rejected', { toUserName: responder.name });
}
res.json({ success: true });
}
});

// --- FETCHING DATA (Chat History) ---
app.get('/api/rooms', authMiddleware, async (req, res) => {
const db = await getDB();
const userRooms = db.rooms.filter(room => room.participants.includes(req.user.userId));
const roomsPreview = userRooms.map(room => {
const otherUserId = room.participants.find(id => id !== req.user.userId);
const otherUser = db.users.find(u => u.id === otherUserId);
return {
id: room.id,
name: otherUser ? otherUser.name : 'Unknown',
lastMessage: room.messages.length > 0 ? room.messages[room.messages.length - 1] : null
};
});
res.json(roomsPreview);
});

app.get('/api/rooms/:roomId/messages', authMiddleware, async (req, res) => {
const db = await getDB();
const room = db.rooms.find(r => r.id === req.params.roomId && r.participants.includes(req.user.userId));
if (!room) return res.status(404).json({ error: 'Room not found' });
res.json(room.messages);
});

// --- REAL-TIME CHAT (WebSockets) ---
io.use((socket, next) => {
const token = socket.handshake.auth.token;
try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
catch { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
// Track online user
userSocketMap[socket.user.userId] = socket.id;
console.log(`${socket.user.name} connected`);

socket.on('join_room', async (roomId) => {
const db = await getDB();
const room = db.rooms.find(r => r.id === roomId);
if (room && room.participants.includes(socket.user.userId)) {
socket.join(roomId);
}
});

socket.on('send_message', async (data) => {
const db = await getDB();
const room = db.rooms.find(r => r.id === data.roomId);
if (!room || !room.participants.includes(socket.user.userId)) return;

const newMessage = {
id: Date.now().toString(),
senderId: socket.user.userId,
senderName: socket.user.name,
text: data.text,
timestamp: new Date().toISOString()
};

room.messages.push(newMessage);
await saveDB(db);
io.to(data.roomId).emit('receive_message', { message: newMessage, roomId: data.roomId });
});

socket.on('disconnect', () => {
delete userSocketMap[socket.user.userId];
console.log(`${socket.user.name} disconnected`);
});
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));*/
