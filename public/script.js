// Socket.IO client-side code
const socket = io();

// DOM elements
const loginScreen = document.getElementById('login-screen');
const mainApp = document.getElementById('main-app');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const usersList = document.getElementById('users-list');
const onlineCount = document.getElementById('online-count');
const voiceStatus = document.getElementById('voice-status');
const micBtn = document.getElementById('mic-btn');
const leaveVoiceBtn = document.getElementById('leave-voice-btn');

// User state
let currentUser = null;
let currentVoiceChannel = null;
let localStream = null;
let peerConnections = new Map();

// Join chat
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        currentUser = username;
        socket.emit('join', username);
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
    }
});

// Send message
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('chatMessage', { message });
        messageInput.value = '';
    }
}

// Receive messages
socket.on('chatMessage', (data) => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.innerHTML = `
        <span class="username">${data.username}</span>
        <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>
        <span class="content">${data.message}</span>
    `;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// User list management
socket.on('userList', (users) => {
    usersList.innerHTML = '';
    onlineCount.textContent = users.length;
    
    users.forEach(user => {
        const userElement = document.createElement('div');
        userElement.classList.add('user-item');
        userElement.innerHTML = `
            <div class="user-status online"></div>
            <div class="user-name">${user.username}</div>
        `;
        usersList.appendChild(userElement);
    });
});

socket.on('userJoined', (user) => {
    // User list will be updated via userList event
});

socket.on('userDisconnected', (user) => {
    // User list will be updated via userList event
});

// Voice channel functionality
document.querySelectorAll('.voice-channel').forEach(channel => {
    channel.addEventListener('click', () => {
        const channelName = channel.getAttribute('data-channel');
        joinVoiceChannel(channelName);
    });
});

function joinVoiceChannel(channelName) {
    if (currentVoiceChannel) {
        leaveVoiceChannel();
    }
    
    // Request access to microphone
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            localStream = stream;
            
            // Update UI
            currentVoiceChannel = channelName;
            voiceStatus.innerHTML = `
                <span class="status-indicator connected"></span>
                <span class="status-text">In ${channelName}</span>
            `;
            
            // Join voice channel on server
            socket.emit('joinVoiceChannel', channelName);
        })
        .catch(err => {
            console.error('Error accessing microphone:', err);
            alert('Could not access microphone. Voice chat requires microphone access.');
        });
}

function leaveVoiceChannel() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Close all peer connections
    peerConnections.forEach((pc, userId) => {
        pc.close();
    });
    peerConnections.clear();
    
    // Update UI
    currentVoiceChannel = null;
    voiceStatus.innerHTML = `
        <span class="status-indicator"></span>
        <span class="status-text">Not in voice channel</span>
    `;
}

leaveVoiceBtn.addEventListener('click', leaveVoiceChannel);

// WebRTC functionality
socket.on('userJoinedVoice', (data) => {
    // Create peer connection when someone joins the voice channel
    createPeerConnection(data.userId, data.username);
});

socket.on('userLeftVoice', (data) => {
    // Close peer connection when someone leaves the voice channel
    if (peerConnections.has(data.userId)) {
        peerConnections.get(data.userId).close();
        peerConnections.delete(data.userId);
    }
});

socket.on('webrtcOffer', (data) => {
    // Handle incoming WebRTC offer
    handleIncomingOffer(data.offer, data.senderId, data.username);
});

socket.on('webrtcAnswer', (data) => {
    // Handle incoming WebRTC answer
    handleIncomingAnswer(data.answer, data.senderId);
});

socket.on('webrtcIceCandidate', (data) => {
    // Handle incoming ICE candidate
    handleIncomingIceCandidate(data.candidate, data.senderId);
});

// WebRTC helper functions
function createPeerConnection(userId, username) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });
    
    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        // Create audio element for remote stream
        const audio = document.createElement('audio');
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtcIceCandidate', {
                targetUserId: userId,
                candidate: event.candidate
            });
        }
    };
    
    // Create offer
    pc.createOffer()
        .then(offer => {
            return pc.setLocalDescription(offer);
        })
        .then(() => {
            socket.emit('webrtcOffer', {
                targetUserId: userId,
                offer: pc.localDescription
            });
        });
    
    peerConnections.set(userId, pc);
}

function handleIncomingOffer(offer, senderId, username) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });
    
    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        // Create audio element for remote stream
        const audio = document.createElement('audio');
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtcIceCandidate', {
                targetUserId: senderId,
                candidate: event.candidate
            });
        }
    };
    
    pc.setRemoteDescription(offer)
        .then(() => {
            return pc.createAnswer();
        })
        .then(answer => {
            return pc.setLocalDescription(answer);
        })
        .then(() => {
            socket.emit('webrtcAnswer', {
                targetUserId: senderId,
                answer: pc.localDescription
            });
        });
    
    peerConnections.set(senderId, pc);
}

function handleIncomingAnswer(answer, senderId) {
    const pc = peerConnections.get(senderId);
    if (pc) {
        pc.setRemoteDescription(answer);
    }
}

function handleIncomingIceCandidate(candidate, senderId) {
    const pc = peerConnections.get(senderId);
    if (pc) {
        pc.addIceCandidate(candidate);
    }
}