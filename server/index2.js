const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({ origin: "http://localhost:3000", methods: ["GET", "POST"] }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] } });

const JWT_SECRET = 'super_secret_privacy_key_change_in_production';
const DB_FILE = './db.json';
const userSocketMap = {};

// --- EMAIL CONFIGURATION ---
let testAccount;
async function getTransporter() {
    if (!testAccount) {
        testAccount = await nodemailer.createTestAccount();
    }
    return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
    });
}

async function sendVerificationEmail(email, token) {
    const transport = await getTransporter();
    const verifyLink = `http://localhost:3000/?verifyToken=${token}`;
    const info = await transport.sendMail({
        from: '"PureChat Security" <no-reply@purechat.com>',
        to: email,
        subject: "Verify your PureChat account",
        text: `Click here to verify your account: ${verifyLink}`,
        html: `
     <div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
        <h2 style="color: #0096FF;">Welcome to PureChat!</h2>
        <p>Please click the button below to verify your email address and activate your account.</p>
        <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Verify Email</a>
        <p style="font-size: 12px; color: #8696a0;">If you didn't request this, please ignore this email. This link expires in 15 minutes.</p>
      </div>
    `
    });
    console.log("📧 EMAIL PREVIEW URL: %s", nodemailer.getTestMessageUrl(info));
}

async function sendEmailChangeEmail(newEmail, token) {
    const transport = await getTransporter();
    const verifyLink = `http://localhost:3000/?changeEmailToken=${token}`;

    const info = await transport.sendMail({
        from: '"PureChat Security" <no-reply@purechat.com>',
        to: newEmail,
        subject: "Verify your new PureChat email",
        text: `Click here to confirm your new email address: ${verifyLink}`,
        html: `
      <div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
        <h2 style="color: #0096FF;">Confirm New Email</h2>
        <p>You requested to change your PureChat email address. Please click the button below to confirm this change.</p>
        <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Confirm Email Change</a>
        <p style="font-size: 12px; color: #8696a0;">If you didn't request this, please ignore this email. This link expires in 15 minutes.</p>
      </div>
    `
    });
    console.log("📧 EMAIL CHANGE PREVIEW URL: %s", nodemailer.getTestMessageUrl(info));
}

// -- Forgot Password

async function sendPasswordResetEmail(email, token) {
    const transport = await getTransporter();
    const resetLink = `http://localhost:3000/?resetToken=${token}`; // Change to Netlify URL in prod

    const info = await transport.sendMail({
        from: '"PureChat Security" <no-reply@purechat.com>',
        to: email,
        subject: "Reset your PureChat password",
        text: `Click here to reset your password: ${resetLink}`,
        html: `
      <div style="font-family: sans-serif; padding: 20px; background: #111b21; color: #e9edef; border-radius: 8px; max-width: 500px; margin: auto;">
        <h2 style="color: #0096FF;">Reset Your Password</h2>
        <p>We received a request to reset your password. Click the button below to choose a new one.</p>
        <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #0096FF; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Reset Password</a>
        <p style="font-size: 12px; color: #8696a0;">If you didn't request this, please ignore this email. This link expires in 15 minutes.</p>
      </div>
    `
    });
    console.log("📧 PASSWORD RESET PREVIEW URL: %s", nodemailer.getTestMessageUrl(info));
}



// --- DB HELPER ---
async function getDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        const db = JSON.parse(data);
        if (!db.requests) db.requests = [];
        db.rooms.forEach(r => { if (!r.type) r.type = 'direct'; });
        return db;
    } catch {
        return { users: [], rooms: [], requests: [] };
    }
}
async function saveDB(db) { await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2)); }

// =============================================
// AUTHENTICATION
// =============================================

app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name } = req.body;
    const db = await getDB();
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const verifyToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '15m' });

    const newUser = {
        id: Date.now().toString(), email, name, passwordHash: hashedPassword,
        publicKey: req.body.publicKey, // <--- ADD THIS for encyription
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

    if (!user.isVerified) {
        return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', email: user.email });
    }

    const token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});


// --- FORGOT PASSWORD: Send Reset Link ---
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const db = await getDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());

    // Always return success even if user doesn't exist (security best practice - prevents email enumeration)
    if (!user) {
        return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }

    const resetToken = jwt.sign(
        { userId: user.id, email: user.email, type: 'password_reset' },
        JWT_SECRET,
        { expiresIn: '15m' }
    );

    try {
        await sendPasswordResetEmail(user.email, resetToken);
        res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send reset email' });
    }
});

// --- RESET PASSWORD: Finalize via Magic Link ---
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'All fields are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = await getDB();

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'password_reset') return res.status(400).json({ error: 'Invalid token type' });

        const user = db.users.find(u => u.id === decoded.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        await saveDB(db);

        res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
    } catch (err) {
        res.status(400).json({ error: 'Invalid or expired reset link' });
    }
});




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

        const authToken = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: authToken, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        res.status(400).json({ error: 'Invalid or expired token' });
    }
});

// Finalize Email Change via Magic Link
app.post('/api/auth/verify-email-change', async (req, res) => {
    const { token } = req.body;
    const db = await getDB();

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'email_change') return res.status(400).json({ error: 'Invalid token type' });

        const user = db.users.find(u => u.id === decoded.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Update the email in the database
        user.email = decoded.newEmail;
        await saveDB(db);

        // Issue a new Auth Token with the updated email
        const authToken = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token: authToken,
            user: { id: user.id, name: user.name, email: user.email, profilePic: user.profilePic }
        });
    } catch (err) {
        res.status(400).json({ error: 'Invalid or expired token' });
    }
});

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

// --- INITIATE EMAIL CHANGE ---
app.post('/api/users/change-email', authMiddleware, async (req, res) => {
    const { newEmail, currentPassword } = req.body;

    if (!newEmail || !currentPassword) return res.status(400).json({ error: 'All fields are required' });

    const db = await getDB();
    const user = db.users.find(u => u.id === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 1. Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

    // 2. Check if new email is already taken
    if (db.users.find(u => u.email.toLowerCase() === newEmail.toLowerCase())) {
        return res.status(400).json({ error: 'Email is already in use' });
    }

    // 3. Generate a special token containing the userId and the newEmail
    const token = jwt.sign(
        { userId: user.id, newEmail: newEmail.toLowerCase(), type: 'email_change' },
        JWT_SECRET,
        { expiresIn: '15m' }
    );

    // 4. Send email to the NEW address
    try {
        await sendEmailChangeEmail(newEmail, token);
        res.json({ success: true, message: 'Verification sent to new email.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});
// --- UPDATE USER NAME ---
app.post('/api/users/update-profile', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name || name.trim() === '') return res.status(400).json({ error: 'Name cannot be empty' });

    const db = await getDB();
    const user = db.users.find(u => u.id === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update name in database
    user.name = name.trim();
    await saveDB(db);

    // Issue a new JWT token with the updated name
    const newToken = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
        success: true,
        user: { id: user.id, name: user.name, email: user.email, profilePic: user.profilePic },
        token: newToken
    });
});

// --- CHANGE PASSWORD ---
app.post('/api/users/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const db = await getDB();
    const user = db.users.find(u => u.id === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 1. Verify the current password
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // 2. Hash and save the new password
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await saveDB(db);

    res.json({ success: true, message: 'Password updated successfully' });
});

// --- PROFILE PICTURE UPDATE ---
app.post('/api/users/profile-picture', authMiddleware, async (req, res) => {
    const { profilePic } = req.body; // Expecting a Base64 string
    if (!profilePic) return res.status(400).json({ error: 'No image data provided' });

    const db = await getDB();
    const user = db.users.find(u => u.id === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.profilePic = profilePic;
    await saveDB(db);

    res.json({ success: true, profilePic });

});


// =============================================
// USER SEARCH
// =============================================

app.get('/api/users/search', authMiddleware, async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const db = await getDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.id !== req.user.userId);
    if (!user) return res.status(404).json({ error: 'User does not exist yet.' });
    //  res.json({ id: user.id, name: user.name, email: user.email });

    res.json({ id: user.id, name: user.name, email: user.email, publicKey: user.publicKey, 
        profilePic: user.profilePic || null });
    //res.json({ id: user.id, name: user.name, email: user.email, profilePic: user.profilePic || null });
});

// =============================================
// FRIEND REQUESTS (1v1)
// =============================================

app.post('/api/requests/send', authMiddleware, async (req, res) => {
    const { toUserId } = req.body;
    const db = await getDB();

    const isFriend = db.rooms.some(r => r.type === 'direct' && r.participants.includes(req.user.userId) && r.participants.includes(toUserId));
    if (isFriend) return res.status(400).json({ error: 'Already connected with this user.' });

    const existingReq = db.requests.find(r => r.fromUserId === req.user.userId && r.toUserId === toUserId && r.status === 'pending');
    if (existingReq) return res.status(400).json({ error: 'Request already sent.' });

    const newReq = {
        id: Date.now().toString(),
        type: 'friend',
        fromUserId: req.user.userId,
        toUserId,
        status: 'pending',
        timestamp: new Date().toISOString()
    };

    db.requests.push(newReq);
    await saveDB(db);

    const targetSocketId = userSocketMap[toUserId];
    if (targetSocketId) {
        const fromUser = db.users.find(u => u.id === req.user.userId);
        io.to(targetSocketId).emit('new_request', { ...newReq, fromUser: { name: fromUser.name, email: fromUser.email } });
    }

    res.json({ success: true });
});

app.get('/api/requests/pending', authMiddleware, async (req, res) => {
    const db = await getDB();
    const pending = db.requests.filter(r => r.toUserId === req.user.userId && r.status === 'pending');

    const populated = pending.map(r => {
        const fromUser = db.users.find(u => u.id === r.fromUserId);
        return { ...r, fromUser: { name: fromUser.name, email: fromUser.email } };
    });

    res.json(populated);
});

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
            const directRoomExists = db.rooms.some(r => r.type === 'direct' && r.participants.includes(request.fromUserId) && r.participants.includes(request.toUserId));
            if (!directRoomExists) {
                db.rooms.push({ id: Date.now().toString() + '_direct', type: 'direct', participants: [request.fromUserId, request.toUserId], messages: [] });
            }

            const groupRoom = db.rooms.find(r => r.id === request.roomId);
            if (groupRoom && !groupRoom.participants.includes(request.toUserId)) {
                groupRoom.participants.push(request.toUserId);
                io.to(request.roomId).emit('system_message', { text: `${responder.name} joined the group`, roomId: request.roomId });

                // NEW: Refresh sidebar for all group members
                groupRoom.participants.forEach(pid => {
                    const pSocket = userSocketMap[pid];
                    if (pSocket) io.to(pSocket).emit('refresh_sidebar');
                });
            }

            if (senderSocketId) io.to(senderSocketId).emit('request_accepted', { toUserName: responder.name, isGroup: true, groupName: groupRoom?.groupName });
        } else {
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

// =============================================
// GROUP CHAT
// =============================================

app.post('/api/rooms/group', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const db = await getDB();

    const newGroup = {
        id: Date.now().toString(),
        type: 'group',
        groupName: name,
        adminId: req.user.userId,
        participants: [req.user.userId],
        messages: []
    };

    db.rooms.push(newGroup);
    await saveDB(db);

    const creatorSocket = userSocketMap[req.user.userId];
    if (creatorSocket) io.to(creatorSocket).emit('join_room', newGroup.id);

    res.json(newGroup);
});

app.post('/api/rooms/:roomId/add-member', authMiddleware, async (req, res) => {
    const { userId } = req.body;
    const roomId = req.params.roomId;
    const db = await getDB();

    const room = db.rooms.find(r => r.id === roomId && r.type === 'group');
    if (!room) return res.status(404).json({ error: 'Group not found' });
    if (room.participants.includes(userId)) return res.status(400).json({ error: 'User is already in the group' });

    const isFriend = db.rooms.some(r => r.type === 'direct' && r.participants.includes(req.user.userId) && r.participants.includes(userId));

    if (isFriend) {
        room.participants.push(userId);
        await saveDB(db);

        const targetSocket = userSocketMap[userId];
        if (targetSocket) {
            io.to(targetSocket).emit('added_to_group', { roomId, groupName: room.groupName });
        }
        io.to(roomId).emit('system_message', { text: `${db.users.find(u => u.id === userId).name} was added to the group`, roomId });


        // NEW: Refresh sidebar for all group members
        room.participants.forEach(pid => {
            const pSocket = userSocketMap[pid];
            if (pSocket) io.to(pSocket).emit('refresh_sidebar');
        });

        res.json({ success: true, addedDirectly: true });
    } else {
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

// =============================================
// FETCHING DATA
// =============================================
/*
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
});*/

// =============================================
// FETCHING DATA WITH SORTING
// =============================================

// --- FETCHING DATA ---
app.get('/api/rooms', authMiddleware, async (req, res) => {
    const db = await getDB();

    // 1. Filter rooms the user is part of
    let userRooms = db.rooms.filter(room => room.participants.includes(req.user.userId));

    // 2. NEW: Sort rooms by the timestamp of their last message (Most Recent First)
    userRooms.sort((a, b) => {
        // Get the timestamp of the last message in each room
        const lastMsgA = a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].timestamp).getTime() : 0;
        const lastMsgB = b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].timestamp).getTime() : 0;

        // Fallback: If no messages exist yet, use the Room's creation time (the ID is a timestamp)
        const fallbackA = parseInt(a.id) || 0;
        const fallbackB = parseInt(b.id) || 0;

        const timeA = lastMsgA || fallbackA;
        const timeB = lastMsgB || fallbackB;

        // Return difference to sort descending (newest/highest timestamp first)
        return timeB - timeA;
    });

    // 3. Map to the preview format
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
                publicKey: otherUser ? otherUser.publicKey : null, // <--- ADD THIS for encryption
                profilePic: otherUser ? otherUser.profilePic : null, // <--- ADD THIS
                lastMessage: room.messages.length > 0 ? room.messages[room.messages.length - 1] : null
            };
        }
    });

    res.json(roomsPreview);
});

/*app.get('/api/rooms/:roomId/messages', authMiddleware, async (req, res) => {
    const db = await getDB();
    const room = db.rooms.find(r => r.id === req.params.roomId && r.participants.includes(req.user.userId));
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ messages: room.messages, type: room.type, groupName: room.groupName });
});*/


app.get('/api/rooms/:roomId/messages', authMiddleware, async (req, res) => {
    const db = await getDB();
    const room = db.rooms.find(r => r.id === req.params.roomId && r.participants.includes(req.user.userId));
    if (!room) return res.status(404).json({ error: 'Room not found' });

    let response = { messages: room.messages, type: room.type };

    if (room.type === 'group') {
        response.groupName = room.groupName;
    } else {
        // For direct chats, find the other user and return their name and profile pic
        const otherUserId = room.participants.find(id => id !== req.user.userId);
        const otherUser = db.users.find(u => u.id === otherUserId);
        response.name = otherUser ? otherUser.name : 'Unknown';
        response.profilePic = otherUser ? otherUser.profilePic : null; // <--- ADDED THIS
        response.recipientPublicKey = otherUser ? otherUser.publicKey : null; // <--- ADD THIS for encryption
    }

    res.json(response);
});


// =============================================
// WEBSOCKETS
// =============================================

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
    userSocketMap[socket.user.userId] = socket.id;
    console.log(`${socket.user.name} connected`);
    socket.on('join_room', (roomId) => socket.join(roomId));
   /* socket.on('join_room', (roomId) => socket.join(roomId));

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

    socket.on('disconnect', () => {
        delete userSocketMap[socket.user.userId];
        console.log(`${socket.user.name} disconnected`);
    });*/


    /* realtime update*/
    socket.on('send_message', async (data) =>
    {
        const db = await getDB();
        const room = db.rooms.find(r => r.id === data.roomId && r.participants.includes(socket.user.userId));
        if (!room) return;

        const newMessage = {
            id: Date.now().toString(), senderId: socket.user.userId, senderName: socket.user.name,
            text: data.text, timestamp: new Date().toISOString()
        };
        room.messages.push(newMessage);
        await saveDB(db);

        // 1. Emit to the active chat room (for the main chat view)
        io.to(data.roomId).emit('receive_message', { message: newMessage, roomId: data.roomId });

        // 2. NEW: Emit a sidebar refresh directly to ALL participants' personal sockets
        room.participants.forEach(participantId => {
            const pSocket = userSocketMap[participantId];
            if (pSocket) {
                io.to(pSocket).emit('refresh_sidebar');
            }
        });
    });

    socket.on('disconnect', () => {
        delete userSocketMap[socket.user.userId];
        console.log(`${socket.user.name} disconnected`);
    });


});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));