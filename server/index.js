require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { v2: cloudinary } = require('cloudinary');

const app = express();
/*app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", methods: ["GET", "POST"] }));
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.FRONTEND_URL || "http://localhost:3000", methods: ["GET", "POST"] } });
*/

// --- BULLETPROOF CORS SETUP ---
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5500', // <--- ADD THIS for VS Code Live Server
    'http://127.0.0.1:5500', // <--- ADD THIS just in case
    'https://glowing-scone-f48160.netlify.app',
    process.env.FRONTEND_URL
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); // Allow non-browser requests
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'CORS policy does not allow access from this origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
}));

app.use(express.json({ limit: '10mb' })); 

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});


const userSocketMap = {};

// --- DATABASE & CLOUD CONFIG ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- MONGOOSE SCHEMAS ---
const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, lowercase: true },
    passwordHash: String,
    publicKey: String,
    profilePic: String,
    isVerified: { type: Boolean, default: false },
    verifyToken: String
});

const MessageSchema = new mongoose.Schema({
    id: String, senderId: String, senderName: String, text: String,
    timestamp: { type: Date, default: Date.now }, isEncrypted: Boolean,
    encryptedPayload: mongoose.Schema.Types.Mixed, isFile: Boolean,
    fileId: String, fileName: String, fileType: String, fileSize: Number
}, { _id: false });

const RoomSchema = new mongoose.Schema({
    type: String, groupName: String, adminId: String,
    participants: [String], messages: [MessageSchema]
});

const RequestSchema = new mongoose.Schema({
    type: String, fromUserId: String, toUserId: String, status: String,
    roomId: String, groupName: String, timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Room = mongoose.model('Room', RoomSchema);
const Request = mongoose.model('Request', RequestSchema);


// --- EMAIL CONFIGURATION (Using Resend REST API to avoid SMTP timeouts) ---
async function sendEmailViaResend(to, subject, html) {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
            from: 'PureChat <onboarding@resend.dev>', // Resend's official test domain (no verification needed!)
            to: [to],
            subject: subject,
            html: html
        })
    });

    if (!response.ok) {
        const error = await response.text();
        console.error("Resend API Error:", error);
        throw new Error('Failed to send email via Resend');
    }
    return await response.json();
}


// --- UPDATED EMAIL FUNCTIONS (Dynamic Base URL) ---
async function sendVerificationEmail(email, token, baseUrl) {
    const verifyLink = `${baseUrl}/?verifyToken=${token}`; // Uses the dynamic URL!
    const html = `<div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
      <h2 style="color: #0096FF;">Welcome to PureChat!</h2>
      <p>Please click the button below to verify your email address and activate your account.</p>
      <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Verify Email</a>
      <p style="font-size: 12px; color: #8696a0;">This link expires in 15 minutes.</p></div>`;
    await sendEmailViaResend(email, "Verify your PureChat account", html);
}

async function sendPasswordResetEmail(email, token, baseUrl) {
    const resetLink = `${baseUrl}/?resetToken=${token}`;
    const html = `<div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
      <h2 style="color: #0096FF;">Reset Your Password</h2>
      <p>Click the button below to choose a new password.</p>
      <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Reset Password</a>
      <p style="font-size: 12px; color: #8696a0;">This link expires in 15 minutes.</p></div>`;
    await sendEmailViaResend(email, "Reset your PureChat password", html);
}

async function sendEmailChangeEmail(newEmail, token, baseUrl) {
    const verifyLink = `${baseUrl}/?changeEmailToken=${token}`;
    const html = `<div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
      <h2 style="color: #0096FF;">Confirm New Email</h2>
      <p>Click the button below to confirm this email change.</p>
      <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Confirm Email Change</a>
      <p style="font-size: 12px; color: #8696a0;">This link expires in 15 minutes.</p></div>`;
    await sendEmailViaResend(newEmail, "Verify your new PureChat email", html);
}


// --- EMAIL CONFIGURATION ---



/*async function getTransporter() {
    return nodemailer.createTransport({
        host: "smtp.resend.com", port: 465, secure: true,
        auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
    });
}

async function sendVerificationEmail(email, token) {
    const transport = await getTransporter();
    const verifyLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?verifyToken=${token}`;
    await transport.sendMail({
        from: '"PureChat Security" <no-reply@purechat.com>', to: email,
        subject: "Verify your PureChat account", text: `Verify here: ${verifyLink}`,
        html: `<div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
      <h2 style="color: #0096FF;">Welcome to PureChat!</h2>
      <p>Please click the button below to verify your email address and activate your account.</p>
      <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Verify Email</a>
      <p style="font-size: 12px; color: #8696a0;">This link expires in 15 minutes.</p></div>`
    });
}

async function sendPasswordResetEmail(email, token) {
    const transport = await getTransporter();
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?resetToken=${token}`;
    await transport.sendMail({
        from: '"PureChat Security" <no-reply@purechat.com>', to: email,
        subject: "Reset your PureChat password", text: `Reset here: ${resetLink}`,
        html: `<div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
      <h2 style="color: #0096FF;">Reset Your Password</h2>
      <p>Click the button below to choose a new password.</p>
      <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Reset Password</a>
      <p style="font-size: 12px; color: #8696a0;">This link expires in 15 minutes.</p></div>`
    });
}

async function sendEmailChangeEmail(newEmail, token) {
    const transport = await getTransporter();
    const verifyLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?changeEmailToken=${token}`;
    await transport.sendMail({
        from: '"PureChat Security" <no-reply@purechat.com>', to: newEmail,
        subject: "Verify your new PureChat email", text: `Confirm here: ${verifyLink}`,
        html: `<div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
      <h2 style="color: #0096FF;">Confirm New Email</h2>
      <p>Click the button below to confirm this email change.</p>
      <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Confirm Email Change</a>
      <p style="font-size: 12px; color: #8696a0;">This link expires in 15 minutes.</p></div>`
    });
}*/

// --- AUTH ROUTES ---
app.post('/api/auth/signup', async (req, res) => {
    // 🕵️ DEBUG: Log exactly what the server is receiving
    console.log("📥 SIGNUP REQUEST RECEIVED");
    console.log("👉 Content-Type Header:", req.headers['content-type']);
    console.log("👉 Request Body:", req.body);

    // Safety check to prevent the crash
    if (!req.body) {
        console.error("❌ ERROR: req.body is undefined! The frontend is not sending JSON correctly.");
        return res.status(400).json({ error: 'Bad Request: Missing JSON body. Check frontend headers.' });
    }

    try {
        const { email, password, name, publicKey } = req.body;
        if (!email || !password || !name) return res.status(400).json({ error: 'Missing required fields' });

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) return res.status(400).json({ error: 'Email already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);

        if (!process.env.JWT_SECRET) {
            console.error("❌ CRITICAL: JWT_SECRET is missing from Render Environment Variables!");
            return res.status(500).json({ error: 'Server configuration error: Missing JWT_SECRET' });
        }

        const verifyToken = jwt.sign({ email: email.toLowerCase() }, process.env.JWT_SECRET, { expiresIn: '15m' });

        await User.create({ email: email.toLowerCase(), name, passwordHash: hashedPassword, publicKey, isVerified: false, verifyToken });

        try {
            // Detect if the request came from Localhost or Netlify
            const requestOrigin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
            await sendVerificationEmail(email.toLowerCase(), verifyToken, requestOrigin);
            res.json({ success: true, message: 'Verification email sent.' });
        } catch (emailErr) {
            console.error("Email send error:", emailErr);
            res.status(500).json({ error: 'User created, but failed to send verification email.' });
        }
    } catch (err) {
        console.error("💥 SIGNUP CRASH:", err);
        res.status(500).json({ error: 'Internal server error during signup. Check Render logs.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isVerified) return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', email: user.email });

    const token = jwt.sign({ userId: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, profilePic: user.profilePic, publicKey: user.publicKey } });
});

app.post('/api/auth/verify-email', async (req, res) => {
    const { token } = req.body;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ email: decoded.email, verifyToken: token });
        if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

        user.isVerified = true; user.verifyToken = null; await user.save();
        const authToken = jwt.sign({ userId: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: authToken, user: { id: user._id, name: user.name, email: user.email, profilePic: user.profilePic } });
    } catch (err) { res.status(400).json({ error: 'Invalid or expired token' }); }
});

app.post('/api/auth/resend-verification', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'User already verified' });

    const verifyToken = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '15m' });
    user.verifyToken = verifyToken; await user.save();

    try { await sendVerificationEmail(user.email, verifyToken); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: 'Failed to send email' }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });

    const resetToken = jwt.sign({ userId: user._id, email: user.email, type: 'password_reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    try {
        // await sendPasswordResetEmail(user.email, resetToken);

        const requestOrigin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
        await sendPasswordResetEmail(user.email, resetToken, requestOrigin);
        res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }
    catch (err) { res.status(500).json({ error: 'Failed to send reset email' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'All fields are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'password_reset') return res.status(400).json({ error: 'Invalid token type' });
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: 'Password reset successfully.' });
    } catch (err) { res.status(400).json({ error: 'Invalid or expired reset link' }); }
});

app.post('/api/auth/verify-email-change', async (req, res) => {
    const { token } = req.body;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'email_change') return res.status(400).json({ error: 'Invalid token type' });
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.email = decoded.newEmail; await user.save();
        const authToken = jwt.sign({ userId: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: authToken, user: { id: user._id, name: user.name, email: user.email, profilePic: user.profilePic } });
    } catch (err) { res.status(400).json({ error: 'Invalid or expired token' }); }
});

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'Unauthorized' }); }
};

// --- USER & PROFILE ROUTES ---
app.get('/api/users/search', authMiddleware, async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User does not exist yet.' });
    res.json({ id: user._id, name: user.name, email: user.email, publicKey: user.publicKey });
});

app.post('/api/users/profile-picture', authMiddleware, async (req, res) => {
    const { profilePic } = req.body;
    if (!profilePic) return res.status(400).json({ error: 'No image data provided' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.profilePic = profilePic; await user.save();
    res.json({ success: true, profilePic });
});

app.post('/api/users/update-profile', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name || name.trim() === '') return res.status(400).json({ error: 'Name cannot be empty' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.name = name.trim(); await user.save();
    const newToken = jwt.sign({ userId: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, profilePic: user.profilePic }, token: newToken });
});

app.post('/api/users/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'All fields are required' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });
    user.passwordHash = await bcrypt.hash(newPassword, 10); await user.save();
    res.json({ success: true, message: 'Password updated successfully' });
});

app.post('/api/users/change-email', authMiddleware, async (req, res) => {
    const { newEmail, currentPassword } = req.body;
    if (!newEmail || !currentPassword) return res.status(400).json({ error: 'All fields are required' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });
    if (await User.findOne({ email: newEmail.toLowerCase() })) return res.status(400).json({ error: 'Email is already in use' });

    const token = jwt.sign({ userId: user._id, newEmail: newEmail.toLowerCase(), type: 'email_change' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    try {
        //await sendEmailChangeEmail(newEmail, token);
        const requestOrigin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
        await sendEmailChangeEmail(newEmail, token, requestOrigin);
        res.json({ success: true, message: 'Verification sent to new email.' });
    }
    catch (err) { res.status(500).json({ error: 'Failed to send verification email' }); }
});

// --- REQUESTS ROUTES ---
app.post('/api/requests/send', authMiddleware, async (req, res) => {
    const { toUserId } = req.body;
    const isFriend = await Room.exists({ type: 'direct', participants: { $all: [req.user.userId, toUserId] } });
    if (isFriend) return res.status(400).json({ error: 'Already connected with this user.' });

    const existingReq = await Request.findOne({ fromUserId: req.user.userId, toUserId, status: 'pending' });
    if (existingReq) return res.status(400).json({ error: 'Request already sent.' });

    const newReq = await Request.create({ type: 'friend', fromUserId: req.user.userId, toUserId, status: 'pending' });

    const targetSocketId = userSocketMap[toUserId];
    if (targetSocketId) {
        const fromUser = await User.findById(req.user.userId);
        io.to(targetSocketId).emit('new_request', { ...newReq.toObject(), fromUser: { name: fromUser.name, email: fromUser.email } });
    }
    res.json({ success: true });
});

app.get('/api/requests/pending', authMiddleware, async (req, res) => {
    const pending = await Request.find({ toUserId: req.user.userId, status: 'pending' });
    const populated = [];
    for (const r of pending) {
        const fromUser = await User.findById(r.fromUserId);
        populated.push({ ...r.toObject(), fromUser: { name: fromUser.name, email: fromUser.email } });
    }
    res.json(populated);
});

app.post('/api/requests/respond', authMiddleware, async (req, res) => {
    const { requestId, action } = req.body;
    const request = await Request.findOne({ _id: requestId, toUserId: req.user.userId });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const senderSocketId = userSocketMap[request.fromUserId];
    const responder = await User.findById(req.user.userId);

    if (action === 'accept') {
        request.status = 'accepted'; await request.save();
        let newRoomId = null;

        if (request.type === 'group_invite') {
            const directRoomExists = await Room.exists({ type: 'direct', participants: { $all: [request.fromUserId, request.toUserId] } });
            if (!directRoomExists) await Room.create({ type: 'direct', participants: [request.fromUserId, request.toUserId], messages: [] });

            const groupRoom = await Room.findById(request.roomId);
            if (groupRoom && !groupRoom.participants.includes(request.toUserId.toString())) {
                groupRoom.participants.push(request.toUserId);
                await groupRoom.save();
                io.to(request.roomId).emit('system_message', { text: `${responder.name} joined the group`, roomId: request.roomId });
                groupRoom.participants.forEach(pid => { const pSocket = userSocketMap[pid]; if (pSocket) io.to(pSocket).emit('refresh_sidebar'); });
            }
            if (senderSocketId) io.to(senderSocketId).emit('request_accepted', { toUserName: responder.name, isGroup: true, groupName: groupRoom?.groupName });
            newRoomId = request.roomId;
        } else {
            const newRoom = await Room.create({ type: 'direct', participants: [request.fromUserId, request.toUserId], messages: [] });
            newRoomId = newRoom._id;
            if (senderSocketId) io.to(senderSocketId).emit('request_accepted', { toUserName: responder.name, isGroup: false });
        }
        res.json({ success: true, roomId: newRoomId });
    } else {
        request.status = 'rejected'; await request.save();
        if (senderSocketId) io.to(senderSocketId).emit('request_rejected', { toUserName: responder.name });
        res.json({ success: true });
    }
});

// --- ROOMS & GROUPS ROUTES ---
app.post('/api/rooms/group', authMiddleware, async (req, res) => {
    const { name, memberIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const newGroup = await Room.create({ type: 'group', groupName: name, adminId: req.user.userId, participants: [req.user.userId], messages: [] });
    const creatorSocket = userSocketMap[req.user.userId];
    if (creatorSocket) io.to(creatorSocket).emit('join_room', newGroup._id);
    res.json(newGroup);
});

app.post('/api/rooms/:roomId/add-member', authMiddleware, async (req, res) => {
    const { userId } = req.body;
    const room = await Room.findOne({ _id: req.params.roomId, type: 'group' });
    if (!room) return res.status(404).json({ error: 'Group not found' });
    if (room.participants.includes(userId)) return res.status(400).json({ error: 'User is already in the group' });

    const isFriend = await Room.exists({ type: 'direct', participants: { $all: [req.user.userId, userId] } });

    if (isFriend) {
        room.participants.push(userId); await room.save();
        const targetSocket = userSocketMap[userId];
        if (targetSocket) io.to(targetSocket).emit('added_to_group', { roomId: room._id, groupName: room.groupName });
        io.to(room._id).emit('system_message', { text: `${(await User.findById(userId)).name} was added to the group`, roomId: room._id });
        room.participants.forEach(pid => { const pSocket = userSocketMap[pid]; if (pSocket) io.to(pSocket).emit('refresh_sidebar'); });
        res.json({ success: true, addedDirectly: true });
    } else {
        const existingReq = await Request.findOne({ fromUserId: req.user.userId, toUserId: userId, status: 'pending' });
        if (existingReq) return res.status(400).json({ error: 'Request already pending' });

        const newReq = await Request.create({ type: 'group_invite', fromUserId: req.user.userId, toUserId: userId, roomId: room._id, groupName: room.groupName, status: 'pending' });
        const targetSocket = userSocketMap[userId];
        if (targetSocket) {
            const fromUser = await User.findById(req.user.userId);
            io.to(targetSocket).emit('new_request', { ...newReq.toObject(), fromUser: { name: fromUser.name } });
        }
        res.json({ success: true, addedDirectly: false, message: 'Invite sent' });
    }
});

app.get('/api/rooms', authMiddleware, async (req, res) => {
    let userRooms = await Room.find({ participants: req.user.userId });

    userRooms.sort((a, b) => {
        const lastMsgA = a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].timestamp).getTime() : 0;
        const lastMsgB = b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].timestamp).getTime() : 0;
        return (lastMsgB || b._id.getTimestamp()) - (lastMsgA || a._id.getTimestamp());
    });

    const roomsPreview = [];
    for (const room of userRooms) {
        if (room.type === 'group') {
            roomsPreview.push({ id: room._id, type: 'group', name: room.groupName, memberCount: room.participants.length, lastMessage: room.messages.length > 0 ? room.messages[room.messages.length - 1] : null });
        } else {
            const otherUserId = room.participants.find(id => id !== req.user.userId);
            const otherUser = await User.findById(otherUserId);
            roomsPreview.push({ id: room._id, type: 'direct', name: otherUser ? otherUser.name : 'Unknown', publicKey: otherUser ? otherUser.publicKey : null, profilePic: otherUser ? otherUser.profilePic : null, lastMessage: room.messages.length > 0 ? room.messages[room.messages.length - 1] : null });
        }
    }
    res.json(roomsPreview);
});

app.get('/api/rooms/:roomId/messages', authMiddleware, async (req, res) => {
    const room = await Room.findOne({ _id: req.params.roomId, participants: req.user.userId });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    let response = { messages: room.messages, type: room.type };
    if (room.type === 'group') response.groupName = room.groupName;
    else {
        const otherUserId = room.participants.find(id => id !== req.user.userId);
        const otherUser = await User.findById(otherUserId);
        response.name = otherUser ? otherUser.name : 'Unknown';
        response.profilePic = otherUser ? otherUser.profilePic : null;
        response.recipientPublicKey = otherUser ? otherUser.publicKey : null;
    }
    res.json(response);
});

// --- FILE ROUTES (CLOUDINARY) ---
app.post('/api/files/upload', authMiddleware, async (req, res) => {
    const { encryptedContent } = req.body;
    if (!encryptedContent) return res.status(400).json({ error: 'No content provided' });

    const base64Content = Buffer.from(encryptedContent).toString('base64');
    const dataUri = `data:text/plain;base64,${base64Content}`;

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
        resource_type: 'raw',
        folder: 'purechat_encrypted_files'
    });

    res.json({ fileId: uploadResult.public_id });
});

app.get('/api/files/:fileId', authMiddleware, async (req, res) => {
    try {
        // Fetch the raw text content directly from Cloudinary
        const response = await fetch(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/${req.params.fileId}`);
        const content = await response.text();
        res.json({ content });
    } catch (err) {
        res.status(404).json({ error: 'File not found' });
    }
});

// --- WEBSOCKETS ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try { socket.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
    catch { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
    userSocketMap[socket.user.userId] = socket.id;

    socket.on('join_room', (roomId) => socket.join(roomId));

    socket.on('send_message', async (data) => {
        const room = await Room.findOne({ _id: data.roomId, participants: socket.user.userId });
        if (!room) return;

        const isEncrypted = data.isEncrypted || false;
        const isFile = data.isFile || false;

        const newMessage = {
            id: Date.now().toString(), senderId: socket.user.userId, senderName: socket.user.name,
            isEncrypted: isEncrypted, isFile: isFile
        };

        if (isFile) {
            newMessage.fileId = data.fileId;
            newMessage.fileName = data.fileName;
            newMessage.fileType = data.fileType;
            newMessage.fileSize = data.fileSize;
            newMessage.text = `📎 ${data.fileName}`;
        } else if (isEncrypted) {
            newMessage.encryptedPayload = data.encryptedPayload;
            newMessage.text = "[Encrypted]";
        } else {
            newMessage.text = data.text;
        }

        room.messages.push(newMessage);
        await room.save();

        io.to(data.roomId).emit('receive_message', { message: newMessage, roomId: data.roomId });

        room.participants.forEach(participantId => {
            const pSocket = userSocketMap[participantId];
            if (pSocket) io.to(pSocket).emit('refresh_sidebar');
        });
    });

    socket.on('disconnect', () => { delete userSocketMap[socket.user.userId]; });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));