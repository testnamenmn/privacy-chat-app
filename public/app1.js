
/*
            below code adds the major upgrade incl grp chat and request*/

let authToken = localStorage.getItem('auth_token');
let myPrivateKeyJwk = null;

// If already logged in on page load, load the correct private key for this user
if (authToken) {
    const savedUser = JSON.parse(localStorage.getItem('current_user'));
    if (savedUser && savedUser.email) {
        myPrivateKeyJwk = localStorage.getItem('private_key_' + savedUser.email);
    }
}
const API_URL = 'http://localhost:3001';
let socket = null;
let currentUser = null;
let activeRoomId = null;
let activeRoomType = 'direct';
//let authToken = localStorage.getItem('auth_token');

const verifyPendingScreen = document.getElementById('verify-pending-screen');
const pendingEmailDisplay = document.getElementById('pending-email-display');

// Group Modal State
let selectedGroupMembers = [];

// --- DOM ELEMENTS ---
// We will store the private key in localStorage
//let myPrivateKeyJwk = localStorage.getItem('private_key');
const forgotPasswordForm = document.getElementById('forgot-password-form');
const resetPasswordForm = document.getElementById('reset-password-form');
const profilePicInput = document.getElementById('profile-pic-input');
const uploadPicBtn = document.getElementById('upload-pic-btn');
const settingsProfilePicPreview = document.getElementById('settings-profile-pic-preview');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsLogoutBtn = document.getElementById('settings-logout-btn');
const settingsNameInput = document.getElementById('settings-name');
const settingsEmailInput = document.getElementById('settings-email');
const authError = document.getElementById('auth-error');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const roomsList = document.getElementById('rooms-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const welcomeScreen = document.getElementById('welcome-screen');
const activeChatView = document.getElementById('active-chat-view');
const groupModal = document.getElementById('group-modal');

// --- AUTH LOGIC (Same as before) ---
/*document.getElementById('show-signup').onclick = (e) =>
{
    e.preventDefault(); document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'flex';
};
document.getElementById('show-login').onclick = (e) => {
    e.preventDefault(); document.getElementById('signup-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'flex';
};
*/

// --- AUTH UI TOGGLING Before Adding Forgot password ---
/*document.getElementById('show-signup').onclick = (e) => {
    e.preventDefault();
    loginForm.classList.remove('active');
    signupForm.classList.add('active');
    verifyPendingScreen.classList.remove('active');
    authError.textContent = '';
};
*/

// --- AUTH UI TOGGLING AFTER Adding Forgot password ---

// --- AUTH UI TOGGLING ---
document.getElementById('show-signup').onclick = (e) => { e.preventDefault(); showAuthScreen('signup-form'); };
document.getElementById('show-login').onclick = (e) => { e.preventDefault(); showAuthScreen('login-form'); };
document.getElementById('back-to-login').onclick = (e) => { e.preventDefault(); showAuthScreen('login-form'); };
document.getElementById('back-to-login-from-forgot').onclick = (e) => { e.preventDefault(); showAuthScreen('login-form'); };
document.getElementById('show-forgot-password').onclick = (e) => { e.preventDefault(); showAuthScreen('forgot-password-form'); };



// --- FORGOT PASSWORD LOGIC ---
forgotPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return;

    const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Sending...';

    const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });

    const data = await res.json();
    submitBtn.textContent = 'Send Reset Link';

    if (data.success) {
        alert(data.message);
        showAuthScreen('login-form');
    } else {
        authError.textContent = data.error;
    }
});

// --- RESET PASSWORD LOGIC ---
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

    const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: newPass })
    });

    const data = await res.json();
    submitBtn.textContent = 'Reset Password';

    if (data.success) {
        alert('Password reset successfully! You can now log in with your new password.');
        window.history.replaceState({}, document.title, '/'); // Clean URL
        showAuthScreen('login-form');
    } else {
        authError.textContent = data.error;
    }
});

document.getElementById('show-login').onclick = (e) => {
    e.preventDefault();
    signupForm.classList.remove('active');
    loginForm.classList.add('active');
    verifyPendingScreen.classList.remove('active');
    authError.textContent = '';
};

document.getElementById('back-to-login').onclick = (e) => {
    e.preventDefault();
    verifyPendingScreen.classList.remove('active');
    loginForm.classList.add('active');
    authError.textContent = '';
};



/*document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('login-email').value, password: document.getElementById('login-password').value }) });
    handleAuthResponse(await res.json());
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('signup-password').value;
    if (password !== document.getElementById('signup-confirm').value) return document.getElementById('auth-error').textContent = "Passwords do not match";
    const res = await fetch(`${API_URL}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('signup-name').value, email: document.getElementById('signup-email').value, password }) });
    handleAuthResponse(await res.json());
});*/

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // GENERATE KEYS FOR NEW USER
    const email = document.getElementById('signup-email').value;
    const keyPair = await cryptoUtils.generateKeyPair();
    const publicKeyJwk = await cryptoUtils.exportKey(keyPair.publicKey);
    const privateKeyJwk = await cryptoUtils.exportKey(keyPair.privateKey);

    // Save private key locally
    localStorage.setItem('private_key_' + email, privateKeyJwk);
    localStorage.setItem('public_key_' + email, publicKeyJwk); // <--- ADD THIS
    myPrivateKeyJwk = privateKeyJwk;

    const password = document.getElementById('signup-password').value;
    if (password !== document.getElementById('signup-confirm').value)
        return document.getElementById('auth-error').textContent = "Passwords do not match";

 
    const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('signup-name').value,
            email, password, publicKey: publicKeyJwk
        })
    });

    const data = await res.json();
    if (data.error) return document.getElementById('auth-error').textContent = data.error;

    // Success! Show the verification pending screen
    showVerifyPendingScreen(email);
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: document.getElementById('login-password').value })
    });

    const data = await res.json();
    if (data.error === 'EMAIL_NOT_VERIFIED') {
        showVerifyPendingScreen(data.email);
        return;
    }
    if (data.error) return document.getElementById('auth-error').textContent = data.error;


    // Ensure private key exists in local storage for existing users
   /* if (!localStorage.getItem('private_key')) {
        alert("Security Error: Private key missing for this device. Please clear cache and re-login.");
        return;
    }
    myPrivateKeyJwk = localStorage.getItem('private_key');
*/

    const userEmail = data.user.email;
    const storedKey = localStorage.getItem('private_key_' + userEmail);

    if (!storedKey) {
        alert("Security Error: Private encryption key missing for this account on this device. This happens if you cleared your browser data or are logging in from a new device. For security, your messages cannot be decrypted without the original private key.");
        return;
    }
    myPrivateKeyJwk = storedKey;
    localStorage.setItem('public_key_' + userEmail, data.user.publicKey); // <--- ADD THIS
    handleAuthResponse(data);
});

function handleAuthResponse(data) {
    if (data.error) return document.getElementById('auth-error').textContent = data.error;
    authToken = data.token; currentUser = data.user;
    localStorage.setItem('auth_token', authToken);
    localStorage.setItem('current_user', JSON.stringify(currentUser));
    initApp();
}

if (authToken) { currentUser = JSON.parse(localStorage.getItem('current_user')); initApp(); }

function initApp() {
    authScreen.classList.remove('active'); appScreen.classList.add('active');
    document.getElementById('user-name-display').textContent = currentUser.name;
    fetchRooms(); fetchPendingRequests(); initSocket();
}

// --- SOCKET.IO ---
function initSocket() {
    if (socket) socket.disconnect();
    socket = io(API_URL, { auth: { token: authToken } });
    socket.on('connect', () => { if (activeRoomId) socket.emit('join_room', activeRoomId); });

    socket.on('send_message', async (data) => {
        const db = await getDB();
        const room = db.rooms.find(r => r.id === data.roomId && r.participants.includes(socket.user.userId));
        if (!room) return;

        // Check if the incoming message is encrypted
        const isEncrypted = data.isEncrypted || false;

        const newMessage = {
            id: Date.now().toString(),
            senderId: socket.user.userId,
            senderName: socket.user.name,
            timestamp: new Date().toISOString(),
            isEncrypted: isEncrypted // Save the encryption flag
        };

        if (isEncrypted) {
            // Save the encrypted payload instead of plain text
            newMessage.encryptedPayload = data.encryptedPayload;
            newMessage.text = "[Encrypted]"; // Fallback text for server storage/sidebar preview
        } else {
            // Save plain text (used for Group Chats)
            newMessage.text = data.text;
        }

        room.messages.push(newMessage);
        await saveDB(db);

        // Broadcast to everyone in the room
        io.to(data.roomId).emit('receive_message', { message: newMessage, roomId: data.roomId });

        // Refresh sidebar for all participants
        room.participants.forEach(participantId => {
            const pSocket = userSocketMap[participantId];
            if (pSocket) io.to(pSocket).emit('refresh_sidebar');
        });
    });




    socket.on('receive_message', async (data) =>
    {
        if (data.roomId === activeRoomId) renderMessage(data.message);
       

        // Check if message is encrypted
        if (data.message.isEncrypted && myPrivateKeyJwk) {
            try {
                const decryptedText = await cryptoUtils.decryptMessage(data.message.encryptedPayload, myPrivateKeyJwk);
                // Create a fake plain message object for the render function
                const decryptedMessage = { ...data.message, text: decryptedText };
                renderMessage(decryptedMessage);
            } catch (err) {
                console.error("Decryption failed:", err);
                renderMessage({ ...data.message, text: "[Encrypted Message - Decryption Failed]" });
            }
        } else {
            renderMessage(data.message);
        }

        // NEW: Listen for the global sidebar refresh event
        socket.on('refresh_sidebar', () => {
            fetchRooms();
        });

        // fetchRooms();

        socket.on('new_request', () => fetchPendingRequests());
    });


    socket.on('new_request', () => fetchPendingRequests());
    socket.on('request_accepted', (data) => {
        alert(data.isGroup ? `${data.toUserName} joined your group "${data.groupName}"!` :
            `${data.toUserName} accepted your request!`);
        fetchRooms();
    });
    socket.on('added_to_group', (data) => {
        alert(`You were added to group "${data.groupName}"`);
        fetchRooms();
    });
    socket.on('system_message', (data) => { if (data.roomId === activeRoomId) renderSystemMessage(data.text); });
}

// --- STANDARD SEARCH (For 1v1) ---
document.getElementById('search-btn').addEventListener('click', async () => {
    const email = document.getElementById('search-email').value.trim();
    if (!email) return;
    const res = await fetch(`${API_URL}/api/users/search?email=${encodeURIComponent(email)}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    const searchResult = document.getElementById('search-result');

    if (!res.ok) { searchResult.className = 'search-result visible error'; searchResult.innerHTML = data.error; return; }

    searchResult.className = 'search-result visible success';
    searchResult.innerHTML = `<span>Found: <strong>${data.name}</strong></span><button onclick="sendFriendRequest('${data.id}', '${data.name}')">Send Request</button>`;
});

async function sendFriendRequest(userId, name) {
    const res = await fetch(`${API_URL}/api/requests/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ toUserId: userId }) });
    if (res.ok) alert(`Request sent to ${name}!`);
    else alert((await res.json()).error);
}

// --- GROUP MODAL LOGIC ---
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

    if (selectedGroupMembers.find(m => m.id === data.id)) {
        resultDiv.className = 'search-result visible error'; resultDiv.innerHTML = 'Already added'; return;
    }

    selectedGroupMembers.push({ id: data.id, name: data.name });
    renderSelectedMembers();
    document.getElementById('group-search-email').value = '';
    resultDiv.className = 'search-result';
});

function renderSelectedMembers() {
    const container = document.getElementById('selected-members');
    container.innerHTML = selectedGroupMembers.map(m => `
    <div class="member-tag">
      ${m.name} <span class="remove-member" onclick="removeMember('${m.id}')">&times;</span>
    </div>
  `).join('');
}

window.removeMember = (id) => {
    selectedGroupMembers = selectedGroupMembers.filter(m => m.id !== id);
    renderSelectedMembers();
};

document.getElementById('create-group-submit').addEventListener('click', async () => {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) return alert('Group name required');

    const res = await fetch(`${API_URL}/api/rooms/group`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ name, memberIds: selectedGroupMembers.map(m => m.id) })
    });

    if (res.ok) {
        const group = await res.json();
        groupModal.classList.remove('active');

        // Now add members (triggers friend+group requests for non-friends)
        for (const member of selectedGroupMembers) {
            await fetch(`${API_URL}/api/rooms/${group.id}/add-member`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ userId: member.id })
            });
        }

        openRoom(group.id);
        fetchRooms();
    }
});

// --- ADD MEMBER TO EXISTING GROUP ---
document.getElementById('add-member-btn').addEventListener('click', async () => {
    const email = prompt("Enter email to add to this group:");
    if (!email) return;

    const res = await fetch(`${API_URL}/api/users/search?email=${encodeURIComponent(email)}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const user = await res.json();
    if (!res.ok) return alert(user.error);

    const addRes = await fetch(`${API_URL}/api/rooms/${activeRoomId}/add-member`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ userId: user.id })
    });

    const addData = await addRes.json();
    if (addRes.ok) {
        alert(addData.addedDirectly ? `${user.name} added to group!` : `Invite sent to ${user.name}!`);
    } else {
        alert(addData.error);
    }
});

// --- ROOMS & MESSAGES ---
/*async function fetchRooms() {
    const res = await fetch(`${API_URL}/api/rooms`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const rooms = await res.json();
    roomsList.innerHTML = '';

    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = `room-item ${room.id === activeRoomId ? 'active' : ''}`;
        div.dataset.roomId = room.id;
*//*
        const avatarClass = room.type === 'group' ? 'room-avatar group' : 'room-avatar';
        const avatarText = room.type === 'group' ? '👥' : room.name.charAt(0).toUpperCase()*//*;


        // --- NEW AVATAR LOGIC ---
        let avatarHTML = '';
        if (room.type === 'group') {
            avatarHTML = `<div class="room-avatar group">👥</div>`;
        } else if (room.profilePic) {
            avatarHTML = `<div class="room-avatar"><img src="${room.profilePic}" alt="${room.name}"></div>`;
        } else {
            avatarHTML = `<div class="room-avatar">${room.name.charAt(0).toUpperCase()}</div>`;
        }
        // ------------------------


        const subtitle = room.type === 'group' ? `${room.memberCount} members` : '';

        div.innerHTML = `
      <div class="${avatarClass}">${avatarText}</div>
      <div class="room-details">
        <div class="room-name">${room.name} <span class="subtitle-text">${subtitle}</span></div>
        <div class="room-preview">${room.lastMessage ? room.lastMessage.text : 'Start chatting!'}</div>
      </div>
    `;
        div.onclick = () => openRoom(room.id);
        roomsList.appendChild(div);
    });
}
*/


async function fetchRooms() {
    const res = await fetch(`${API_URL}/api/rooms`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const rooms = await res.json();
    roomsList.innerHTML = '';

    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = `room-item ${room.id === activeRoomId ? 'active' : ''}`;
        div.dataset.roomId = room.id;

        // --- AVATAR LOGIC ---
        let avatarHTML = '';
        if (room.type === 'group') {
            avatarHTML = `<div class="room-avatar group">👥</div>`;
        } else if (room.profilePic) {
            avatarHTML = `<div class="room-avatar"><img src="${room.profilePic}" alt="${room.name}"></div>`;
        } else {
            avatarHTML = `<div class="room-avatar">${room.name.charAt(0).toUpperCase()}</div>`;
        }
        // -------------------

        const subtitle = room.type === 'group' ? `${room.memberCount} members` : '';

        div.innerHTML = `
      ${avatarHTML}
      <div class="room-details">
        <div class="room-name">${room.name} <span class="subtitle-text">${subtitle}</span></div>
        <div class="room-preview">${room.lastMessage ? room.lastMessage.text : 'Start chatting!'}</div>
      </div>
    `;
        div.onclick = () => openRoom(room.id);
        roomsList.appendChild(div);
    });
}




async function openRoom(roomId) {
    activeRoomId = roomId;
    welcomeScreen.style.display = 'none';
    activeChatView.style.display = 'flex';

    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
    if (activeEl) activeEl.classList.add('active');

    if (socket && socket.connected) socket.emit('join_room', roomId);

    const res = await fetch(`${API_URL}/api/rooms/${roomId}/messages`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();

    activeRoomType = data.type;
    document.getElementById('chat-room-title').textContent
        = data.type === 'group' ? data.groupName : data.messages[0]?.senderName || 'Chat'; // Fallback name

    document.getElementById('chat-room-subtitle').textContent = '';

    if (data.type === 'group') {
        
    } else {
      
        document.getElementById('chat-room-title').dataset.publicKey = data.recipientPublicKey;// <--- ADD THIS LINE
    }



    // Update Header UI
  /*  const avatar = document.getElementById('chat-avatar');
    if (data.type === 'group') {
        avatar.className = 'room-avatar group';
        avatar.textContent = '👥';
        document.getElementById('add-member-btn').style.display = 'block';
    } else {
        avatar.className = 'room-avatar';
        avatar.textContent = document.getElementById('chat-room-title').textContent.charAt(0).toUpperCase();
        document.getElementById('add-member-btn').style.display = 'none';
    }*/

    // Update Header UI
    const avatar = document.getElementById('chat-avatar');
    if (data.type === 'group') {
        avatar.className = 'room-avatar group';
        avatar.innerHTML = '';
        document.getElementById('add-member-btn').style.display = 'block';
    } else {
        avatar.className = 'room-avatar';
        document.getElementById('add-member-btn').style.display = 'none';

        // --- NEW HEADER AVATAR LOGIC ---
        if (data.profilePic) {
            avatar.innerHTML = `<img src="${data.profilePic}" alt="${data.name}">`;
        } else {
            avatar.textContent = data.name.charAt(0).toUpperCase();
        }
    }

    messagesContainer.innerHTML = '';
    let lastMessage = null;
    data.messages.forEach(msg => {
        if (shouldShowDateSeparator(msg, lastMessage)) renderDateSeparator(formatDateSeparator(msg.timestamp));
        renderMessage(msg);
        lastMessage = msg;
    });
    fetchRooms();
}

// --- RENDERING ---
function renderMessage(msg) {
    const div = document.createElement('div');
    const isMine = msg.senderId === currentUser.id;
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;

    const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Show sender name in groups if not mine
    if (activeRoomType === 'group' && !isMine) {
        const senderEl = document.createElement('span');
        senderEl.className = 'sender';
        senderEl.textContent = msg.senderName;
        senderEl.style.color = getColorForName(msg.senderName); // Unique color per user
        div.appendChild(senderEl);
    }

    const textEl = document.createElement('span');
    textEl.className = 'message-text';
    textEl.textContent = msg.text;
    div.appendChild(textEl);

    const timeEl = document.createElement('span');
    timeEl.className = 'message-time';
    timeEl.textContent = timeStr;
    div.appendChild(timeEl);

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Simple hash function to assign consistent colors to group members
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

// --- MESSAGING & LOGOUT ---
// -- msg without encryption
/*function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket || !activeRoomId) return;


    socket.emit('send_message', { text, roomId: activeRoomId });
    messageInput.value = '';
}*/

// -- msg with  encryption

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket || !activeRoomId) return;

    // For this MVP, we will encrypt for 1-on-1 chats. 
    // (Group chat E2EE requires encrypting the key for every participant, which we can add later).
    if (activeRoomType === 'direct') {
        // Get the recipient's public key from the DOM or fetch it
        const recipientPublicKey = document.getElementById('chat-room-title').dataset.publicKey;

        const myPublicKey = localStorage.getItem('public_key_' + currentUser.email); // <--- GET SENDER KEY

        if (!recipientPublicKey || !myPublicKey) {
            alert("Could not fetch recipient's public key for encryption.");
            return;
        }

        // Pass BOTH keys to the encrypt function
     //   const encryptedPayload = await cryptoUtils.encryptMessage(text, recipientPublicKey);
        const encryptedPayload = await cryptoUtils.encryptMessage(text, recipientPublicKey, myPublicKey);


        // Send the encrypted payload instead of plain text
        socket.emit('send_message', {
            roomId: activeRoomId,
            encryptedPayload,
            isEncrypted: true
        });
    } else {
        // Fallback for group chats (plain text for now, or implement multi-key encryption)
        socket.emit('send_message', { text, roomId: activeRoomId });
    }

    messageInput.value = '';
}


document.getElementById('send-btn').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });


// --- SETTINGS MODAL LOGIC ---
settingsBtn.addEventListener('click', () => {
    // Pre-fill current user data
    /*settingsNameInput.value = currentUser.name;
    settingsEmailInput.value = currentUser.email;*/
    document.getElementById('settings-email-password').value = '';
    document.getElementById('settings-new-email').value = '';

    settingsProfilePicPreview.src = currentUser.profilePic || 'https://via.placeholder.com/50/2a3942/8696a0?text=' + currentUser.name.charAt(0).toUpperCase();

    // NEW: Clear password fields for security when opening modal
    document.getElementById('settings-current-password').value = '';
    document.getElementById('settings-new-password').value = '';
    document.getElementById('settings-confirm-password').value = '';


    settingsModal.classList.add('active');
});

// --- PROFILE PICTURE UPLOAD LOGIC ---
uploadPicBtn.addEventListener('click', () => {
    profilePicInput.click(); // Trigger the hidden file input
});

profilePicInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (limit to 500KB to prevent bloating the JSON DB)
    if (file.size > 500000) {
        alert('Image is too large. Please choose an image under 500KB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        const base64Image = event.target.result;

        // Update preview immediately
        settingsProfilePicPreview.src = base64Image;
        uploadPicBtn.textContent = 'Saving...';

        // Send to backend
        const res = await fetch(`${API_URL}/api/users/profile-picture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ profilePic: base64Image })
        });

        const data = await res.json();
        if (data.success) {
            // Update local user object
            currentUser.profilePic = base64Image;
            localStorage.setItem('current_user', JSON.stringify(currentUser));

            uploadPicBtn.textContent = 'Saved!';
            setTimeout(() => { uploadPicBtn.textContent = 'Upload'; }, 2000);

            // TODO: In the next step, we will update the sidebar and chat header to display this new picture!
        } else {
            alert(data.error);
            uploadPicBtn.textContent = 'Upload';
        }
    };
    reader.readAsDataURL(file);
});

// --- UPDATE NAME LOGIC ---
const saveNameBtn = document.querySelector('#settings-name').nextElementSibling; // Gets the button next to the name input

saveNameBtn.addEventListener('click', async () => {
    const newName = document.getElementById('settings-name').value.trim();
    if (!newName) return alert('Name cannot be empty');

    saveNameBtn.textContent = 'Saving...';

    const res = await fetch(`${API_URL}/api/users/update-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ name: newName })
    });

    const data = await res.json();
    if (data.success) {
        // Update local state and tokens
        currentUser = data.user;
        authToken = data.token;
        localStorage.setItem('current_user', JSON.stringify(currentUser));
        localStorage.setItem('auth_token', authToken);

        // Update UI immediately
        document.getElementById('user-name-display').textContent = currentUser.name;

        // Visual feedback
        saveNameBtn.textContent = 'Saved!';
        setTimeout(() => { saveNameBtn.textContent = 'Save'; }, 2000);
    } else {
        alert(data.error);
        saveNameBtn.textContent = 'Save';
    }
});


// --- CHANGE PASSWORD LOGIC ---
const changePasswordBtn = document.getElementById('change-password-btn');

changePasswordBtn.addEventListener('click', async () => {
    const currentPass = document.getElementById('settings-current-password').value;
    const newPass = document.getElementById('settings-new-password').value;
    const confirmPass = document.getElementById('settings-confirm-password').value;

    // 1. Frontend Validation
    if (!currentPass || !newPass || !confirmPass) {
        return alert('Please fill in all password fields.');
    }
    if (newPass !== confirmPass) {
        return alert('New passwords do not match.');
    }
    if (newPass.length < 6) {
        return alert('Password must be at least 6 characters long.');
    }

    changePasswordBtn.textContent = 'Updating...';

    // 2. Send to Backend
    const res = await fetch(`${API_URL}/api/users/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass })
    });

    const data = await res.json();

    // 3. Handle Response
    if (data.success) {
        alert('Password changed successfully!');
        // Clear fields on success
        document.getElementById('settings-current-password').value = '';
        document.getElementById('settings-new-password').value = '';
        document.getElementById('settings-confirm-password').value = '';
        changePasswordBtn.textContent = 'Update';
    } else {
        alert(data.error); // Will show "Current password is incorrect" if wrong
        changePasswordBtn.textContent = 'Update';
    }
});

// --- CHANGE EMAIL LOGIC ---
const changeEmailBtn = document.getElementById('change-email-btn');

changeEmailBtn.addEventListener('click', async () => {
    const currentPass = document.getElementById('settings-email-password').value;
    const newEmail = document.getElementById('settings-new-email').value.trim();

    if (!currentPass || !newEmail) return alert('Please fill in all fields.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return alert('Please enter a valid email.');

    changeEmailBtn.textContent = 'Sending...';

    const res = await fetch(`${API_URL}/api/users/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ newEmail, currentPassword: currentPass })
    });

    const data = await res.json();

    if (data.success) {
        alert(`Verification link sent to ${newEmail}. Please check your inbox to finalize the change.`);
        document.getElementById('settings-email-password').value = '';
        document.getElementById('settings-new-email').value = '';
        changeEmailBtn.textContent = 'Update';
    } else {
        alert(data.error);
        changeEmailBtn.textContent = 'Update';
    }
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('active');
});

// Close modal if clicking outside the content
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove('active');
});

// Handle Logout from Settings
settingsLogoutBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to logout?')) {
        if (socket) socket.disconnect();
        // localStorage.clear();// this destroys keys

        // ONLY clear the auth session. Keep the private keys safe!
        localStorage.removeItem('auth_token');
        localStorage.removeItem('current_user');
        location.reload();
    }
});

// Placeholder alerts for static buttons (to be coded incrementally later)
/*document.querySelectorAll('.settings-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        alert('This feature is coming soon! We will code this incrementally.');
    });
});*/



// --- EMAIL VERIFICATION LOGIC ---

/*function showVerifyPendingScreen(email) {
    loginForm.style.display = 'none';
    signupForm.style.display = 'none';
    verifyPendingScreen.style.display = 'flex';
    pendingEmailDisplay.textContent = email;
    document.getElementById('auth-error').textContent = '';
}*/


function showVerifyPendingScreen(email) {
    // Remove active class from all forms
    loginForm.classList.remove('active');
    signupForm.classList.remove('active');


    forgotPasswordForm.classList.remove('active');
    resetPasswordForm.classList.remove('active');

    // Show the verify screen
    verifyPendingScreen.classList.add('active');
    pendingEmailDisplay.textContent = email;
    document.getElementById('auth-error').textContent = '';
}

function showAuthScreen(screenId) {
  // Remove active from all auth forms
  loginForm.classList.remove('active');
  signupForm.classList.remove('active');
  verifyPendingScreen.classList.remove('active');
  forgotPasswordForm.classList.remove('active');
  resetPasswordForm.classList.remove('active');
  authError.textContent = '';

  // Show the requested screen
  document.getElementById(screenId).classList.add('active');
}

document.getElementById('back-to-login').onclick = (e) => {
    e.preventDefault();
    verifyPendingScreen.style.display = 'none';
    loginForm.style.display = 'flex';
};

document.getElementById('resend-link-btn').addEventListener('click', async () => {
    const email = pendingEmailDisplay.textContent;
    const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (data.success) {
        document.getElementById('resend-link-btn').textContent = 'Link Resent! Check Console/Email';
        setTimeout(() => { document.getElementById('resend-link-btn').textContent = 'Resend Verification Link'; }, 3000);
    } else {
        alert(data.error);
    }
});

// Intercept Magic Link on Page Load
const urlParams = new URLSearchParams(window.location.search);
const verifyToken = urlParams.get('verifyToken');

if (verifyToken) {
    (async () => {
        const res = await fetch(`${API_URL}/api/auth/verify-email`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: verifyToken })
        });
        const data = await res.json();

        // Clean the URL
        window.history.replaceState({}, document.title, "/");

        if (data.error) {
            alert("Verification failed: " + data.error + ". Please request a new link.");
        } else {
            handleAuthResponse(data); // Logs them in automatically!
        }
    })();
}
// Intercept Email Change Magic Link on Page Load
const changeEmailToken = urlParams.get('changeEmailToken');

if (changeEmailToken) {
    (async () => {
        const res = await fetch(`${API_URL}/api/auth/verify-email-change`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: changeEmailToken })
        });
        const data = await res.json();

        // Clean the URL
        window.history.replaceState({}, document.title, "/");

        if (data.error) {
            alert("Email change failed: " + data.error);
        } else {
            // Update local storage and UI with the new email
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('auth_token', authToken);
            localStorage.setItem('current_user', JSON.stringify(currentUser));

            alert("Email successfully changed to " + currentUser.email + "!");
            initApp(); // Re-initialize the app to update UI
        }
    })();
}


// Intercept Password Reset Magic Link on Page Load
const resetToken = urlParams.get('resetToken');
if (resetToken) {
    showAuthScreen('reset-password-form');
}

//document.getElementById('logout-btn').addEventListener('click', () => { localStorage.clear(); location.reload(); });

// --- REQUESTS ---
async function fetchPendingRequests() {
    const res = await fetch(`${API_URL}/api/requests/pending`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const requests = await res.json();
    const container = document.getElementById('requests-container');
    const list = document.getElementById('requests-list');
    if (requests.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block'; list.innerHTML = '';
    requests.forEach(req => {
        const div = document.createElement('div'); div.className = 'request-item';
        const text = req.type === 'group_invite' ? `<strong>${req.fromUser.name}</strong> invited you to group "<strong>${req.groupName}</strong>"` : `<strong>${req.fromUser.name}</strong> wants to chat`;
        div.innerHTML = `<div class="request-info">${text}<span>${req.fromUser.email}</span></div><div class="request-actions"><button class="btn-accept" data-id="${req.id}">Accept</button><button class="btn-reject" data-id="${req.id}">Reject</button></div>`;
        div.querySelector('.btn-accept').onclick = () => respondToRequest(req.id, 'accept');
        div.querySelector('.btn-reject').onclick = () => respondToRequest(req.id, 'reject');
        list.appendChild(div);
    });
}
async function respondToRequest(requestId, action) {
    const res = await fetch(`${API_URL}/api/requests/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ requestId, action }) });
    if (res.ok) { fetchPendingRequests(); fetchRooms(); if (action === 'accept') openRoom((await res.json()).room?.id || activeRoomId); }
}







/*const API_URL = 'http://localhost:3001';
let socket = null;
let currentUser = null;
let activeRoomId = null;
let authToken = localStorage.getItem('auth_token');

// --- DOM ELEMENTS ---
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const authError = document.getElementById('auth-error');
const roomsList = document.getElementById('rooms-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const welcomeScreen = document.getElementById('welcome-screen');
const activeChatView = document.getElementById('active-chat-view');
const searchResult = document.getElementById('search-result');
const requestsContainer = document.getElementById('requests-container');
const requestsList = document.getElementById('requests-list');

// --- AUTH UI & LOGIC ---
document.getElementById('show-signup').onclick = (e) => { e.preventDefault(); loginForm.style.display = 'none'; signupForm.style.display = 'flex'; authError.textContent = ''; };
document.getElementById('show-login').onclick = (e) => { e.preventDefault(); signupForm.style.display = 'none'; loginForm.style.display = 'flex'; authError.textContent = ''; };

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('login-email').value, password: document.getElementById('login-password').value })
    });
    handleAuthResponse(await res.json());
});

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('signup-password').value;
    if (password !== document.getElementById('signup-confirm').value) return authError.textContent = "Passwords do not match";

    const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('signup-name').value,
            email: document.getElementById('signup-email').value,
            password
        })
    });
    handleAuthResponse(await res.json());
});

function handleAuthResponse(data) {
    if (data.error) return authError.textContent = data.error;
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('auth_token', authToken);
    localStorage.setItem('current_user', JSON.stringify(currentUser));
    initApp();
}

if (authToken) {
    currentUser = JSON.parse(localStorage.getItem('current_user'));
    initApp();
}

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

    socket.on('receive_message', (data) => {
        if (data.roomId === activeRoomId) renderMessage(data.message);
        fetchRooms();
    });

    // Real-time Request Notifications
    socket.on('new_request', (req) => {
        fetchPendingRequests(); // Refresh the UI
        // Optional: Add a browser notification here
    });

    socket.on('request_accepted', (data) => {
        alert(`${data.toUserName} accepted your request!`);
        fetchRooms(); // Refresh sidebar to show new chat
    });

    socket.on('request_rejected', (data) => {
        alert(`${data.toUserName} rejected your request.`);
    });
}

// --- SEARCH & REQUESTS LOGIC ---
document.getElementById('search-btn').addEventListener('click', async () => {
    const email = document.getElementById('search-email').value.trim();
    if (!email) return;

    searchResult.className = 'search-result visible';
    searchResult.innerHTML = 'Searching...';

    const res = await fetch(`${API_URL}/api/users/search?email=${encodeURIComponent(email)}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (!res.ok) {
        searchResult.className = 'search-result visible error';
        searchResult.innerHTML = data.error;
        if (data.roomId) {
            // If already chatting, just open the room
            setTimeout(() => openRoom(data.roomId), 1000);
        }
        return;
    }

    // User found
    searchResult.className = 'search-result visible success';
    searchResult.innerHTML = `
    <span>Found: <strong>${data.name}</strong> (${data.email})</span>
    <button id="send-req-btn" data-userid="${data.id}">Send Request</button>
  `;

    document.getElementById('send-req-btn').addEventListener('click', async () => {
        const sendRes = await fetch(`${API_URL}/api/requests/send`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ toUserId: data.id })
        });
        if (sendRes.ok) {
            searchResult.innerHTML = `Request sent to ${data.name}!`;
            document.getElementById('search-email').value = '';
        } else {
            const err = await sendRes.json();
            searchResult.innerHTML = err.error;
        }
    });
});

async function fetchPendingRequests() {
    const res = await fetch(`${API_URL}/api/requests/pending`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const requests = await res.json();

    if (requests.length === 0) {
        requestsContainer.style.display = 'none';
        return;
    }

    requestsContainer.style.display = 'block';
    requestsList.innerHTML = '';

    requests.forEach(req => {
        const div = document.createElement('div');
        div.className = 'request-item';
        div.innerHTML = `
      <div class="request-info">
        <strong>${req.fromUser.name}</strong>
        <span>${req.fromUser.email}</span>
      </div>
      <div class="request-actions">
        <button class="btn-accept" data-id="${req.id}">Accept</button>
        <button class="btn-reject" data-id="${req.id}">Reject</button>
      </div>
    `;

        div.querySelector('.btn-accept').onclick = () => respondToRequest(req.id, 'accept');
        div.querySelector('.btn-reject').onclick = () => respondToRequest(req.id, 'reject');

        requestsList.appendChild(div);
    });
}

async function respondToRequest(requestId, action) {
    const res = await fetch(`${API_URL}/api/requests/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ requestId, action })
    });

    if (res.ok) {
        fetchPendingRequests();
        if (action === 'accept') {
            const data = await res.json();
            openRoom(data.room.id); // Auto-open the newly created chat
        }
    }
}

// --- ROOMS & CHAT HISTORY ---
async function fetchRooms() {
    const res = await fetch(`${API_URL}/api/rooms`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const rooms = await res.json();

    roomsList.innerHTML = '';
    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = `room-item ${room.id === activeRoomId ? 'active' : ''}`;
        div.innerHTML = `
      <div class="room-name">${room.name}</div>
      <div class="room-preview">${room.lastMessage ? room.lastMessage.text : 'Start chatting!'}</div>
    `;
        div.onclick = () => openRoom(room.id);
        roomsList.appendChild(div);
    });
}

async function openRoom(roomId) {
    activeRoomId = roomId;
    welcomeScreen.style.display = 'none';
    activeChatView.style.display = 'flex';

    // Highlight active room
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    event.currentTarget?.classList.add('active');

    if (socket && socket.connected) socket.emit('join_room', roomId);

    const res = await fetch(`${API_URL}/api/rooms/${roomId}/messages`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const messages = await res.json();

   *//* messagesContainer.innerHTML = '';
    messages.forEach(renderMessage);*//*

    messagesContainer.innerHTML = '';
    let lastMessage = null;
    messages.forEach(msg => {
        if (shouldShowDateSeparator(msg, lastMessage)) {
            renderDateSeparator(formatDateSeparator(msg.timestamp));
        }
        renderMessage(msg);
        lastMessage = msg;
    });
    fetchRooms();
}

// --- MESSAGING ---
*//*function renderMessage(msg) {
    const div = document.createElement('div');
    const isMine = msg.senderId === currentUser.id;
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;
    if (!isMine) {
        const senderEl = document.createElement('div');
        senderEl.className = 'sender';
        senderEl.textContent = msg.senderName;
        div.appendChild(senderEl);
    }
    const textEl = document.createElement('div');
    textEl.textContent = msg.text;
    div.appendChild(textEl);
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
*//*

function renderMessage(msg) {
    const div = document.createElement('div');
    const isMine = msg.senderId === currentUser.id;
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;

    // Format timestamp
    const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    if (!isMine) {
        const senderEl = document.createElement('span');
        senderEl.className = 'sender';
        senderEl.textContent = msg.senderName;
        div.appendChild(senderEl);
    }

    const textEl = document.createElement('span');
    textEl.className = 'message-text';
    textEl.textContent = msg.text;
    div.appendChild(textEl);

    const timeEl = document.createElement('span');
    timeEl.className = 'message-time';
    timeEl.textContent = timeStr;
    div.appendChild(timeEl);

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}



function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket || !activeRoomId) return;
    socket.emit('send_message', { text, roomId: activeRoomId });
    messageInput.value = '';
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    location.reload();
});


function renderDateSeparator(dateString) {
    const div = document.createElement('div');
    div.className = 'date-separator';
    div.textContent = dateString;
    messagesContainer.appendChild(div);
}

function shouldShowDateSeparator(currentMsg, previousMsg) {
    if (!previousMsg) return true;
    const currentDate = new Date(currentMsg.timestamp).toDateString();
    const previousDate = new Date(previousMsg.timestamp).toDateString();
    return currentDate !== previousDate;
}

function formatDateSeparator(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
    }
}*/