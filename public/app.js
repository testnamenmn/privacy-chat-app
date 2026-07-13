/*// --- PRODUCTION MIGRATION CHANGE ---
// This dynamically switches between your local backend and your live Render backend
const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://privacy-chat-app-backend.onrender.com'; // <-- REPLACE THIS WITH YOUR ACTUAL RENDER URL IF DIFFERENT
*/

// --- LOCAL TESTING SWITCH ---
// Set to TRUE to test local frontend against LIVE Render backend.
// Set to FALSE to test local frontend against LOCAL Node backend.
const USE_LIVE_BACKEND_FOR_LOCAL_TESTING = true;

const isProduction = window.location.hostname.includes('netlify.app');

let API_URL;
if (isProduction) {
    API_URL = 'https://privacy-chat-app-backend.onrender.com';
} else {
    // If local, check our master switch
    API_URL = USE_LIVE_BACKEND_FOR_LOCAL_TESTING
        ? 'https://privacy-chat-app-backend.onrender.com'
        : 'http://localhost:3001';
}
// NOTE: If you ever want to test your LOCAL frontend against the LIVE Render backend,
// just temporarily change 'http://localhost:3001' to your Render URL above!
 


let socket = null;
let currentUser = null;
let activeRoomId = null;
let activeRoomType = 'direct';
let authToken = localStorage.getItem('auth_token');
let myPrivateKeyJwk = null;

// Load private key on page load if already logged in
if (authToken) {
    const savedUser = JSON.parse(localStorage.getItem('current_user'));
    if (savedUser && savedUser.email) {
        myPrivateKeyJwk = localStorage.getItem('private_key_' + savedUser.email);
    }
}

// --- DOM ELEMENTS ---
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const forgotPasswordForm = document.getElementById('forgot-password-form');
const resetPasswordForm = document.getElementById('reset-password-form');
const verifyPendingScreen = document.getElementById('verify-pending-screen');
const authError = document.getElementById('auth-error');
const pendingEmailDisplay = document.getElementById('pending-email-display');

const roomsList = document.getElementById('rooms-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const welcomeScreen = document.getElementById('welcome-screen');
const activeChatView = document.getElementById('active-chat-view');
const searchResult = document.getElementById('search-result');
const requestsContainer = document.getElementById('requests-container');
const requestsList = document.getElementById('requests-list');

const groupModal = document.getElementById('group-modal');
const settingsModal = document.getElementById('settings-modal');
const settingsNameInput = document.getElementById('settings-name');
const settingsProfilePicPreview = document.getElementById('settings-profile-pic-preview');
const profilePicInput = document.getElementById('profile-pic-input');

// File Sharing DOM Elements
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const filePreviewContainer = document.getElementById('file-preview-container');
const filePreviewName = document.getElementById('file-preview-name');
const filePreviewSize = document.getElementById('file-preview-size');
const cancelFileBtn = document.getElementById('cancel-file-btn');
let selectedFile = null;

// --- AUTH UI TOGGLING ---
function showAuthScreen(screenId) {
    loginForm.classList.remove('active');
    signupForm.classList.remove('active');
    verifyPendingScreen.classList.remove('active');
    forgotPasswordForm.classList.remove('active');
    resetPasswordForm.classList.remove('active');
    authError.textContent = '';
    document.getElementById(screenId).classList.add('active');
}

document.getElementById('show-signup').onclick = (e) => { e.preventDefault(); showAuthScreen('signup-form'); };
document.getElementById('show-login').onclick = (e) => { e.preventDefault(); showAuthScreen('login-form'); };
document.getElementById('back-to-login').onclick = (e) => { e.preventDefault(); showAuthScreen('login-form'); };
document.getElementById('back-to-login-from-forgot').onclick = (e) => { e.preventDefault(); showAuthScreen('login-form'); };
document.getElementById('show-forgot-password').onclick = (e) => { e.preventDefault(); showAuthScreen('forgot-password-form'); };

// --- AUTH LOGIC ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: document.getElementById('login-password').value })
    });

    const data = await res.json();
    if (data.error === 'EMAIL_NOT_VERIFIED') { showVerifyPendingScreen(data.email); return; }
    if (data.error) return authError.textContent = data.error;

    const storedKey = localStorage.getItem('private_key_' + email);
    if (!storedKey) {
        alert("Security Error: Private encryption key missing for this account on this device.");
        return;
    }
    myPrivateKeyJwk = storedKey;
    localStorage.setItem('public_key_' + email, data.user.publicKey);

    handleAuthResponse(data);
});

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('signup-password').value;
    if (password !== document.getElementById('signup-confirm').value) return authError.textContent = "Passwords do not match";

    const email = document.getElementById('signup-email').value;
    const name = document.getElementById('signup-name').value;

    const keyPair = await cryptoUtils.generateKeyPair();
    const publicKeyJwk = await cryptoUtils.exportKey(keyPair.publicKey);
    const privateKeyJwk = await cryptoUtils.exportKey(keyPair.privateKey);

    localStorage.setItem('private_key_' + email, privateKeyJwk);
    localStorage.setItem('public_key_' + email, publicKeyJwk);
    myPrivateKeyJwk = privateKeyJwk;

  

    const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // <--- MUST HAVE THIS
        body: JSON.stringify({ name, email, password, publicKey: publicKeyJwk }) // <--- MUST HAVE THIS
    });

    const data = await res.json();
    if (data.error) return authError.textContent = data.error;
    showVerifyPendingScreen(email);
});

function handleAuthResponse(data) {
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('auth_token', authToken);
    localStorage.setItem('current_user', JSON.stringify(currentUser));
    initApp();
}

function showVerifyPendingScreen(email) {
    showAuthScreen('verify-pending-screen');
    pendingEmailDisplay.textContent = email;
}

if (authToken && !document.querySelector('.screen.active').id.includes('auth')) {
    currentUser = JSON.parse(localStorage.getItem('current_user'));
    initApp();
}

// --- FORGOT & RESET PASSWORD ---
forgotPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Sending...';
    const res = await fetch(`${API_URL}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await res.json();
    submitBtn.textContent = 'Send Reset Link';
    if (data.success) { alert(data.message); showAuthScreen('login-form'); }
    else { authError.textContent = data.error; }
});

resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPass = document.getElementById('reset-new-password').value;
    const confirmPass = document.getElementById('reset-confirm-password').value;
    if (newPass !== confirmPass) return authError.textContent = 'Passwords do not match.';
    if (newPass.length < 6) return authError.textContent = 'Password must be at least 6 characters.';

    const resetToken = new URLSearchParams(window.location.search).get('resetToken');
    if (!resetToken) return authError.textContent = 'Invalid reset link.';

    const submitBtn = resetPasswordForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Resetting...';
    const res = await fetch(`${API_URL}/api/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, newPassword: newPass }) });
    const data = await res.json();
    submitBtn.textContent = 'Reset Password';
    if (data.success) { alert('Password reset successfully!'); window.history.replaceState({}, document.title, '/'); showAuthScreen('login-form'); }
    else { authError.textContent = data.error; }
});

// --- APP INITIALIZATION ---
function initApp() {
    authScreen.classList.remove('active');
    appScreen.classList.add('active');
    document.getElementById('user-name-display').textContent = currentUser.name;
    fetchRooms();
    fetchPendingRequests();
    initSocket();
}

// --- SOCKET.IO SETUP ---
function initSocket() {
    if (socket) socket.disconnect();
    socket = io(API_URL, { auth: { token: authToken } });

    socket.on('connect', () => { if (activeRoomId) socket.emit('join_room', activeRoomId); });

    socket.on('receive_message', async (data) => {
        if (data.roomId === activeRoomId) {
            // 1. If it's a file message, just render it (file content is decrypted on download)
            if (data.message.isFile) {
                renderMessage(data.message);
            }
            // 2. If it's an encrypted text message
            else if (data.message.isEncrypted && myPrivateKeyJwk && data.message.encryptedPayload) {
                try {
                    const decryptedText = await cryptoUtils.decryptMessage(data.message.encryptedPayload, myPrivateKeyJwk);
                    const decryptedMessage = { ...data.message, text: decryptedText };
                    renderMessage(decryptedMessage);
                } catch (err) {
                    console.error("Decryption failed:", err);
                    renderMessage({ ...data.message, text: "[Decryption Failed]" });
                }
            }
            // 3. Plain text or group message
            else {
                renderMessage(data.message);
            }
        }
        fetchRooms();
    });

    socket.on('refresh_sidebar', () => { fetchRooms(); });
    socket.on('new_request', () => fetchPendingRequests());

    socket.on('request_accepted', (data) => {
        alert(data.isGroup ? `${data.toUserName} joined your group "${data.groupName}"!` : `${data.toUserName} accepted your request!`);
        fetchRooms();
    });

    socket.on('added_to_group', (data) => {
        alert(`You were added to group "${data.groupName}"`);
        fetchRooms();
    });

    socket.on('system_message', (data) => {
        if (data.roomId === activeRoomId) renderSystemMessage(data.text);
    });
}

// --- SEARCH & REQUESTS ---
document.getElementById('search-btn').addEventListener('click', async () => {
    const email = document.getElementById('search-email').value.trim();
    if (!email) return;
    searchResult.className = 'search-result visible';
    searchResult.innerHTML = 'Searching...';
    const res = await fetch(`${API_URL}/api/users/search?email=${encodeURIComponent(email)}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (!res.ok) { searchResult.className = 'search-result visible error'; searchResult.innerHTML = data.error; return; }

    searchResult.className = 'search-result visible success';
    searchResult.innerHTML = `<span>Found: <strong>${data.name}</strong></span><button onclick="sendFriendRequest('${data.id}', '${data.name}')">Send Request</button>`;
});

async function sendFriendRequest(userId, name) {
    const res = await fetch(`${API_URL}/api/requests/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ toUserId: userId }) });
    if (res.ok) { searchResult.innerHTML = `Request sent to ${name}!`; document.getElementById('search-email').value = ''; }
    else { searchResult.innerHTML = (await res.json()).error; }
}

async function fetchPendingRequests() {
    const res = await fetch(`${API_URL}/api/requests/pending`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const requests = await res.json();
    if (requests.length === 0) { requestsContainer.style.display = 'none'; return; }
    requestsContainer.style.display = 'block';
    requestsList.innerHTML = '';
    requests.forEach(req => {
        const div = document.createElement('div'); div.className = 'request-item';
        const text = req.type === 'group_invite' ? `<strong>${req.fromUser.name}</strong> invited you to group "<strong>${req.groupName}</strong>"` : `<strong>${req.fromUser.name}</strong> wants to chat`;
        div.innerHTML = `<div class="request-info">${text}<span>${req.fromUser.email}</span></div><div class="request-actions"><button class="btn-accept" data-id="${req.id}">Accept</button><button class="btn-reject" data-id="${req.id}">Reject</button></div>`;
        div.querySelector('.btn-accept').onclick = () => respondToRequest(req.id, 'accept');
        div.querySelector('.btn-reject').onclick = () => respondToRequest(req.id, 'reject');
        requestsList.appendChild(div);
    });
}

async function respondToRequest(requestId, action) {
    const res = await fetch(`${API_URL}/api/requests/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ requestId, action }) });
    if (res.ok) {
        const data = await res.json();
        fetchPendingRequests();
        fetchRooms();
        if (action === 'accept' && data.roomId) {
            openRoom(data.roomId);
        }
    }
}

// --- GROUP MODAL LOGIC ---
let selectedGroupMembers = [];
document.getElementById('new-group-btn').onclick = () => {
    groupModal.classList.add('active');
    selectedGroupMembers = [];
    renderSelectedMembers();
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-search-email').value = '';
    document.getElementById('group-search-result').className = 'search-result';
};
document.getElementById('close-modal-btn').onclick = () => groupModal.classList.remove('active');

document.getElementById('group-search-btn').addEventListener('click', async () => {
    const email = document.getElementById('group-search-email').value.trim();
    if (!email) return;
    const res = await fetch(`${API_URL}/api/users/search?email=${encodeURIComponent(email)}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    const resultDiv = document.getElementById('group-search-result');
    if (!res.ok) { resultDiv.className = 'search-result visible error'; resultDiv.innerHTML = data.error; return; }
    if (selectedGroupMembers.find(m => m.id === data.id)) { resultDiv.className = 'search-result visible error'; resultDiv.innerHTML = 'Already added'; return; }
    selectedGroupMembers.push({ id: data.id, name: data.name });
    renderSelectedMembers();
    document.getElementById('group-search-email').value = '';
    resultDiv.className = 'search-result';
});

function renderSelectedMembers() {
    document.getElementById('selected-members').innerHTML = selectedGroupMembers.map(m => `
    <div class="member-tag">${m.name} <span class="remove-member" onclick="removeMember('${m.id}')">&times;</span></div>
  `).join('');
}
window.removeMember = (id) => { selectedGroupMembers = selectedGroupMembers.filter(m => m.id !== id); renderSelectedMembers(); };

document.getElementById('create-group-submit').addEventListener('click', async () => {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) return alert('Group name required');
    const res = await fetch(`${API_URL}/api/rooms/group`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ name, memberIds: selectedGroupMembers.map(m => m.id) }) });
    if (res.ok) {
        const group = await res.json();
        groupModal.classList.remove('active');
        for (const member of selectedGroupMembers) {
            await fetch(`${API_URL}/api/rooms/${group.id}/add-member`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ userId: member.id }) });
        }
        openRoom(group.id);
        fetchRooms();
    }
});

document.getElementById('add-member-btn').addEventListener('click', async () => {
    const email = prompt("Enter email to add to this group:");
    if (!email) return;
    const res = await fetch(`${API_URL}/api/users/search?email=${encodeURIComponent(email)}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const user = await res.json();
    if (!res.ok) return alert(user.error);
    const addRes = await fetch(`${API_URL}/api/rooms/${activeRoomId}/add-member`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ userId: user.id }) });
    const addData = await addRes.json();
    if (addRes.ok) alert(addData.addedDirectly ? `${user.name} added to group!` : `Invite sent to ${user.name}!`);
    else alert(addData.error);
});

// --- ROOMS & CHAT HISTORY ---
async function fetchRooms() {
    const res = await fetch(`${API_URL}/api/rooms`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const rooms = await res.json();
    roomsList.innerHTML = '';

    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = `room-item ${room.id === activeRoomId ? 'active' : ''}`;
        div.dataset.roomId = room.id;

        let avatarHTML = '';
        if (room.type === 'group') avatarHTML = `<div class="room-avatar group">👥</div>`;
        else if (room.profilePic) avatarHTML = `<div class="room-avatar"><img src="${room.profilePic}" alt="${room.name}"></div>`;
        else avatarHTML = `<div class="room-avatar">${room.name.charAt(0).toUpperCase()}</div>`;

        const subtitle = room.type === 'group' ? `${room.memberCount} members` : '';

        let lastMessageText = 'Start chatting!';
        if (room.lastMessage) {
            if (room.lastMessage.isFile) {
                lastMessageText = `📎 ${room.lastMessage.fileName}`;
            } else if (room.lastMessage.isEncrypted && myPrivateKeyJwk && room.lastMessage.encryptedPayload) {
                lastMessageText = "[Encrypted]";
                // Decrypt asynchronously AFTER appending to DOM
                cryptoUtils.decryptMessage(room.lastMessage.encryptedPayload, myPrivateKeyJwk)
                    .then(decryptedText => {
                        const previewEl = div.querySelector('.room-preview');
                        if (previewEl) previewEl.textContent = decryptedText;
                    })
                    .catch(err => console.error("Sidebar decryption failed:", err));
            } else {
                lastMessageText = room.lastMessage.text;
            }
        }

        div.innerHTML = `${avatarHTML}<div class="room-details"><div class="room-name">${room.name} <span class="subtitle-text">${subtitle}</span></div><div class="room-preview">${lastMessageText}</div></div>`;
        div.onclick = () => openRoom(room.id);
        roomsList.appendChild(div);
    });
}

async function openRoom(roomId) {
    if (!roomId) return;
    activeRoomId = roomId;
    welcomeScreen.style.display = 'none';
    activeChatView.style.display = 'flex';
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
    if (activeEl) activeEl.classList.add('active');
    if (socket && socket.connected) socket.emit('join_room', roomId);

    const res = await fetch(`${API_URL}/api/rooms/${roomId}/messages`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) { console.error("Failed to load room messages for ID:", roomId); return; }

    const data = await res.json();
    activeRoomType = data.type;
    const titleEl = document.getElementById('chat-room-title');
    if (data.type === 'group') {
        titleEl.textContent = data.groupName;
    } else {
        titleEl.textContent = data.name || 'Chat';
        titleEl.dataset.publicKey = data.recipientPublicKey;
    }
    document.getElementById('chat-room-subtitle').textContent = '';

    const avatar = document.getElementById('chat-avatar');
    if (data.type === 'group') {
        avatar.className = 'room-avatar group';
        avatar.innerHTML = '👥';
        document.getElementById('add-member-btn').style.display = 'block';
    } else {
        avatar.className = 'room-avatar';
        document.getElementById('add-member-btn').style.display = 'none';
        if (data.profilePic) avatar.innerHTML = `<img src="${data.profilePic}" alt="${data.name}">`;
        else avatar.textContent = (data.name || 'U').charAt(0).toUpperCase();
    }

    messagesContainer.innerHTML = '';
    let lastMessage = null;
    if (data.messages && Array.isArray(data.messages)) {
        for (const msg of data.messages) {
            if (shouldShowDateSeparator(msg, lastMessage)) renderDateSeparator(formatDateSeparator(msg.timestamp));

            // Only try to decrypt if it's a text message with an actual encrypted payload
            if (msg.isEncrypted && myPrivateKeyJwk && msg.encryptedPayload) {
                try { msg.text = await cryptoUtils.decryptMessage(msg.encryptedPayload, myPrivateKeyJwk); }
                catch (err) { console.error("History decryption failed:", err); msg.text = "[Decryption Failed]"; }
            }
            renderMessage(msg);
            lastMessage = msg;
        }
    }
    fetchRooms();
}

// --- RENDERING ---
async function renderMessage(msg) {
    const div = document.createElement('div');
    const isMine = msg.senderId === currentUser.id;
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;

  /*  const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });*/

    // Fallback to current time if timestamp is missing or invalid
    const date = msg.timestamp ? new Date(msg.timestamp) : new Date();
    const timeStr = isNaN(date.getTime())
        ? new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
        : date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });



    if (activeRoomType === 'group' && !isMine) {
        const senderEl = document.createElement('span');
        senderEl.className = 'sender';
        senderEl.textContent = msg.senderName;
        senderEl.style.color = getColorForName(msg.senderName);
        div.appendChild(senderEl);
    }

    // --- FILE MESSAGE HANDLING ---
    if (msg.isFile) {
        const fileCard = document.createElement('div');
        fileCard.className = 'file-message-card';

        let fileName = msg.fileName;
        let fileType = msg.fileType;
        let fileSize = msg.fileSize;
        let fileId = msg.fileId;
        let isEncrypted = msg.isEncrypted;

        const isImage = fileType && fileType.startsWith('image/');
        const icon = isImage ? '🖼️' : '📄';

        fileCard.innerHTML = `
      <div class="file-icon">${icon}</div>
      <div class="file-details">
        <div class="file-name">${fileName}</div>
        <div class="file-size">${(fileSize / 1024).toFixed(2)} KB</div>
      </div>
      <button class="download-btn" data-fileid="${fileId}" data-encrypted="${isEncrypted}">
        ${isImage ? 'View' : 'Download'}
      </button>
    `;
        div.appendChild(fileCard);

        const btn = fileCard.querySelector('.download-btn');
        btn.onclick = async () => {
            btn.textContent = 'Loading...';
            try {
                const res = await fetch(`${API_URL}/api/files/${fileId}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                let finalBase64 = data.content;

                if (isEncrypted && myPrivateKeyJwk) {
                    const encryptedPayload = JSON.parse(data.content);
                    finalBase64 = await cryptoUtils.decryptMessage(encryptedPayload, myPrivateKeyJwk);
                } else {
                    // Group Chat Fallback: Handle different formats safely
                    try {
                        const parsed = JSON.parse(data.content);
                        if (parsed && typeof parsed === 'object' && parsed.encryptedText) {
                            finalBase64 = parsed.encryptedText; // Old JSON format
                        } else if (typeof parsed === 'string') {
                            finalBase64 = parsed; // In case it was accidentally stringified
                        }
                    } catch (e) {
                        // It's already a raw Base64 string, do nothing
                    }
                }

                const base64Data = finalBase64.includes(',') ? finalBase64.split(',')[1] : finalBase64;
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: fileType });
                const url = URL.createObjectURL(blob);

                if (isImage) {
                    window.open(url, '_blank');
                } else {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
                btn.textContent = isImage ? 'View' : 'Download';
            } catch (err) {
                console.error(err);
                btn.textContent = 'Error';
                alert('Failed to load file. It may be corrupted or your key is missing.');
            }
        };

    } else {
        // --- STANDARD TEXT MESSAGE ---
        const textEl = document.createElement('span');
        textEl.className = 'message-text';
        textEl.textContent = msg.text;
        div.appendChild(textEl);
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'message-time';
    timeEl.textContent = timeStr;
    div.appendChild(timeEl);

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function getColorForName(name) {
    const colors = ['#4db8ff', '#0096FF', '#e9a025', '#d1307d', '#7b6fe6', '#f15c6d'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function renderSystemMessage(text) {
    const div = document.createElement('div'); div.className = 'system-msg'; div.textContent = text;
    messagesContainer.appendChild(div);
}
function renderDateSeparator(dateString) {
    const div = document.createElement('div'); div.className = 'date-separator'; div.textContent = dateString;
    messagesContainer.appendChild(div);
}
function shouldShowDateSeparator(c, p) { if (!p) return true; return new Date(c.timestamp).toDateString() !== new Date(p.timestamp).toDateString(); }
function formatDateSeparator(d) {
    const date = new Date(d), today = new Date(), yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// --- MESSAGING & FILE UPLOAD (E2EE) ---
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        alert('File is too large. Maximum size is 5MB.');
        fileInput.value = '';
        return;
    }
    selectedFile = file;
    filePreviewName.textContent = file.name;
    filePreviewSize.textContent = (file.size / 1024).toFixed(2) + ' KB';
    filePreviewContainer.style.display = 'block';
});
cancelFileBtn.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    filePreviewContainer.style.display = 'none';
});

async function sendMessage() {
    const text = messageInput.value.trim();

    // If there is a file selected, send the file instead of text
    if (selectedFile) {
        const sendBtn = document.getElementById('send-btn');
        sendBtn.textContent = '';
        sendBtn.disabled = true;

        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64File = reader.result;

                const recipientPublicKey = document.getElementById('chat-room-title').dataset.publicKey;
                const myPublicKey = localStorage.getItem('public_key_' + currentUser.email);

                let encryptedPayload;
                let contentToUpload;

                if (activeRoomType === 'direct' && recipientPublicKey && myPublicKey) {
                    // Direct Chat: Encrypt the file
                    encryptedPayload = await cryptoUtils.encryptMessage(base64File, recipientPublicKey, myPublicKey);
                    contentToUpload = JSON.stringify(encryptedPayload);
                } else {
                    // Group Chat Fallback: Raw Base64 string (DO NOT stringify again!)
                    encryptedPayload = base64File;
                    contentToUpload = base64File;
                }

                const uploadRes = await fetch(`${API_URL}/api/files/upload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ encryptedContent: contentToUpload })
                });

                const uploadData = await uploadRes.json();
                if (!uploadRes.ok) throw new Error(uploadData.error);

                socket.emit('send_message', {
                    roomId: activeRoomId,
                    isFile: true,
                    fileId: uploadData.fileId,
                    fileName: selectedFile.name,
                    fileType: selectedFile.type,
                    fileSize: selectedFile.size,
                    isEncrypted: activeRoomType === 'direct'
                });

                selectedFile = null;
                fileInput.value = '';
                filePreviewContainer.style.display = 'none';
            };
            reader.readAsDataURL(selectedFile);
        } catch (err) {
            console.error(err);
            alert('Failed to send file.');
        } finally {
            sendBtn.textContent = 'Send';
            sendBtn.disabled = false;
        }
        return;
    }

    // --- STANDARD TEXT MESSAGE LOGIC ---
    if (!text || !socket || !activeRoomId) return;

    if (activeRoomType === 'direct') {
        const recipientPublicKey = document.getElementById('chat-room-title').dataset.publicKey;
        const myPublicKey = localStorage.getItem('public_key_' + currentUser.email);
        if (!recipientPublicKey || !myPublicKey) return alert("Could not fetch encryption keys.");
        const encryptedPayload = await cryptoUtils.encryptMessage(text, recipientPublicKey, myPublicKey);
        socket.emit('send_message', { roomId: activeRoomId, encryptedPayload, isEncrypted: true });
    } else {
        socket.emit('send_message', { text, roomId: activeRoomId });
    }
    messageInput.value = '';
}
document.getElementById('send-btn').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

// --- SETTINGS MODAL ---
document.getElementById('settings-btn').addEventListener('click', () => {
    settingsNameInput.value = currentUser.name;
    settingsProfilePicPreview.src = currentUser.profilePic || 'https://via.placeholder.com/50/2a3942/8696a0?text=' + currentUser.name.charAt(0).toUpperCase();

    const emailPass = document.getElementById('settings-email-password');
    const newEmail = document.getElementById('settings-new-email');
    const currentPass = document.getElementById('settings-current-password');
    const newPass = document.getElementById('settings-new-password');
    const confirmPass = document.getElementById('settings-confirm-password');
    if (emailPass) emailPass.value = '';
    if (newEmail) newEmail.value = '';
    if (currentPass) currentPass.value = '';
    if (newPass) newPass.value = '';
    if (confirmPass) confirmPass.value = '';

    settingsModal.classList.add('active');
});
document.getElementById('close-settings-btn').addEventListener('click', () => settingsModal.classList.remove('active'));
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.remove('active'); });

document.getElementById('upload-pic-btn').addEventListener('click', () => profilePicInput.click());
profilePicInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500000) return alert('Image is too large. Please choose an image under 500KB.');
    const reader = new FileReader();
    reader.onload = async (event) => {
        const base64Image = event.target.result;
        settingsProfilePicPreview.src = base64Image;
        const btn = document.getElementById('upload-pic-btn');
        btn.textContent = 'Saving...';
        const res = await fetch(`${API_URL}/api/users/profile-picture`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ profilePic: base64Image }) });
        const data = await res.json();
        if (data.success) {
            currentUser.profilePic = base64Image;
            localStorage.setItem('current_user', JSON.stringify(currentUser));
            btn.textContent = 'Saved!';
            setTimeout(() => { btn.textContent = 'Upload'; }, 2000);
            fetchRooms();
        } else { alert(data.error); btn.textContent = 'Upload'; }
    };
    reader.readAsDataURL(file);
});

document.querySelector('#settings-name').nextElementSibling.addEventListener('click', async () => {
    const newName = settingsNameInput.value.trim();
    if (!newName) return alert('Name cannot be empty');
    const btn = document.querySelector('#settings-name').nextElementSibling;
    btn.textContent = 'Saving...';
    const res = await fetch(`${API_URL}/api/users/update-profile`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ name: newName }) });
    const data = await res.json();
    if (data.success) {
        currentUser = data.user; authToken = data.token;
        localStorage.setItem('current_user', JSON.stringify(currentUser));
        localStorage.setItem('auth_token', authToken);
        document.getElementById('user-name-display').textContent = currentUser.name;
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = 'Save'; }, 2000);
    } else { alert(data.error); btn.textContent = 'Save'; }
});

document.getElementById('change-password-btn').addEventListener('click', async () => {
    const currentPass = document.getElementById('settings-current-password').value;
    const newPass = document.getElementById('settings-new-password').value;
    const confirmPass = document.getElementById('settings-confirm-password').value;
    if (!currentPass || !newPass || !confirmPass) return alert('Please fill in all password fields.');
    if (newPass !== confirmPass) return alert('New passwords do not match.');
    if (newPass.length < 6) return alert('Password must be at least 6 characters long.');
    const btn = document.getElementById('change-password-btn');
    btn.textContent = 'Updating...';
    const res = await fetch(`${API_URL}/api/users/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }) });
    const data = await res.json();
    if (data.success) {
        alert('Password changed successfully!');
        document.getElementById('settings-current-password').value = '';
        document.getElementById('settings-new-password').value = '';
        document.getElementById('settings-confirm-password').value = '';
        btn.textContent = 'Update';
    } else { alert(data.error); btn.textContent = 'Update'; }
});

document.getElementById('change-email-btn').addEventListener('click', async () => {
    const currentPass = document.getElementById('settings-email-password').value;
    const newEmail = document.getElementById('settings-new-email').value.trim();
    if (!currentPass || !newEmail) return alert('Please fill in all fields.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return alert('Please enter a valid email.');
    const btn = document.getElementById('change-email-btn');
    btn.textContent = 'Sending...';
    const res = await fetch(`${API_URL}/api/users/change-email`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ newEmail, currentPassword: currentPass }) });
    const data = await res.json();
    if (data.success) {
        alert(`Verification link sent to ${newEmail}. Please check your inbox to finalize the change.`);
        document.getElementById('settings-email-password').value = '';
        document.getElementById('settings-new-email').value = '';
        btn.textContent = 'Update';
    } else { alert(data.error); btn.textContent = 'Update'; }
});

document.getElementById('settings-logout-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to logout?')) {
        if (socket) socket.disconnect();
        localStorage.removeItem('auth_token');
        localStorage.removeItem('current_user');
        location.reload();
    }
});

// --- URL INTERCEPTORS (Magic Links) ---
const urlParams = new URLSearchParams(window.location.search);

const verifyToken = urlParams.get('verifyToken');
if (verifyToken) {
    (async () => {
        const res = await fetch(`${API_URL}/api/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verifyToken }) });
        const data = await res.json();
        window.history.replaceState({}, document.title, "/");
        if (data.error) alert("Verification failed: " + data.error);
        else handleAuthResponse(data);
    })();
}

const changeEmailToken = urlParams.get('changeEmailToken');
if (changeEmailToken) {
    (async () => {
        const res = await fetch(`${API_URL}/api/auth/verify-email-change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: changeEmailToken }) });
        const data = await res.json();
        window.history.replaceState({}, document.title, "/");
        if (data.error) alert("Email change failed: " + data.error);
        else {
            authToken = data.token; currentUser = data.user;
            localStorage.setItem('auth_token', authToken);
            localStorage.setItem('current_user', JSON.stringify(currentUser));
            alert("Email successfully changed to " + currentUser.email + "!");
            initApp();
        }
    })();
}

const resetToken = urlParams.get('resetToken');
if (resetToken) {
    showAuthScreen('reset-password-form');
}