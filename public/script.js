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
const voiceUsersList = document.getElementById('voice-users-list');
const voiceChannelName = document.getElementById('voice-channel-name');

// User state
let currentUser = null;
let currentVoiceChannel = null;
let localStream = null;
let peerConnections = new Map();
const voiceUsers = new Map(); // Store voice channel users

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
    // Remove user from voice users list if they were in voice channel
    if (voiceUsers.has(user.id)) {
        voiceUsers.delete(user.id);
        removeUserFromVoiceChannelDisplay(user.id);
    }
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
            voiceChannelName.textContent = channelName;
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
    
    // Stop all voice activity monitoring
    voiceActivityMonitors.clear();
    
    // Clear voice users list
    voiceUsers.clear();
    voiceUsersList.innerHTML = '';
    
    // Update voice channel name display
    voiceChannelName.textContent = 'None';
    
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
    // Add user to voice users list
    voiceUsers.set(data.userId, { 
        id: data.userId, 
        username: data.username, 
        talking: false 
    });
    
    // Add user to voice channel display
    addUserToVoiceChannelDisplay(data.userId, data.username);
    
    // Create peer connection for the new user
    createPeerConnection(data.userId, data.username);
});

socket.on('userLeftVoice', (data) => {
    // Remove user from voice users list
    voiceUsers.delete(data.userId);
    
    // Remove user from voice channel display
    removeUserFromVoiceChannelDisplay(data.userId);
    
    // Stop voice activity monitoring for this user
    stopVoiceActivityMonitoring(data.userId);
    
    // Close peer connection for this user
    if (peerConnections.has(data.userId)) {
        const pc = peerConnections.get(data.userId);
        pc.close();
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

// Audio context for voice activity detection
let audioContext = null;
let voiceActivityMonitors = new Map(); // Track voice activity for each user

// Function to update voice users list in UI
function updateVoiceUsersList() {
    voiceUsersList.innerHTML = '';
    
    voiceUsers.forEach(user => {
        addUserToVoiceChannelDisplay(user.id, user.username);
    });
}

// Function to add user to voice channel display
function addUserToVoiceChannelDisplay(userId, username) {
    // Check if user is already in the display
    if (document.querySelector(`.user-item[data-user-id="${userId}"]`)) {
        return; // User already displayed
    }
    
    const userElement = document.createElement('div');
    userElement.classList.add('user-item');
    userElement.setAttribute('data-user-id', userId);
    userElement.innerHTML = `
        <div class="user-status online"></div>
        <div class="user-name">${username}</div>
    `;
    voiceUsersList.appendChild(userElement);
}

// Function to remove user from voice channel display
function removeUserFromVoiceChannelDisplay(userId) {
    const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (userElement) {
        userElement.remove();
    }
}

// Function to update voice indicators in the UI
function updateVoiceIndicator(userId, isActive) {
    const userElements = document.querySelectorAll(`.user-item[data-user-id="${userId}"]`);
    userElements.forEach(element => {
        const statusElement = element.querySelector('.user-status');
        if (statusElement) {
            // Remove previous state classes
            statusElement.classList.remove('online', 'offline', 'talking');
            
            // Add appropriate class based on state
            if (isActive) {
                statusElement.classList.add('talking');
                statusElement.title = 'Currently talking';
            } else {
                statusElement.classList.add('online');
                statusElement.title = 'Online';
            }
        }
    });
}

// Function to start monitoring voice activity for a user
function startVoiceActivityMonitoring(stream, userId) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Create audio source and analyzer
    const source = audioContext.createMediaStreamSource(stream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    
    source.connect(analyzer);
    
    // Store the analyzer for this user
    voiceActivityMonitors.set(userId, analyzer);
    
    // Start monitoring
    monitorVoiceActivity(userId);
}

// Function to monitor voice activity for a specific user
function monitorVoiceActivity(userId) {
    const analyzer = voiceActivityMonitors.get(userId);
    if (!analyzer) return;
    
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
    
    function checkVoiceActivity() {
        if (!voiceActivityMonitors.has(userId)) {
            return; // Stop if user is no longer in voice channel
        }
        
        analyzer.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // Determine if user is talking based on volume threshold
        const isTalking = average > 20; // Adjust threshold as needed
        
        // Update user's talking status if changed
        if (voiceUsers.has(userId)) {
            const user = voiceUsers.get(userId);
            if (user.talking !== isTalking) {
                user.talking = isTalking;
                updateVoiceIndicator(userId, isTalking);
            }
        }
        
        // Continue monitoring
        requestAnimationFrame(checkVoiceActivity);
    }
    
    checkVoiceActivity();
}

// Function to stop monitoring voice activity for a user
function stopVoiceActivityMonitoring(userId) {
    voiceActivityMonitors.delete(userId);
}

// WebRTC helper functions
function createPeerConnection(userId, username) {
    // Check if we already have a connection with this user
    if (peerConnections.has(userId)) {
        console.warn('Peer connection already exists for user:', userId);
        const existingPc = peerConnections.get(userId);
        existingPc.close();
        peerConnections.delete(userId);
        
        // Also remove from voice activity monitoring
        stopVoiceActivityMonitoring(userId);
    }
    
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
        
        // Start monitoring voice activity for this user
        startVoiceActivityMonitoring(event.streams[0], userId);
        
        // Add to voice users list if not already present
        if (!voiceUsers.has(userId)) {
            voiceUsers.set(userId, { 
                id: userId, 
                username: username, 
                talking: false 
            });
            
            // Add user to voice channel display
            addUserToVoiceChannelDisplay(userId, username);
        }
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
        })
        .catch(err => {
            console.error('Error creating offer:', err);
        });
    
    peerConnections.set(userId, pc);
}

function handleIncomingOffer(offer, senderId, username) {
    // Check if we already have a connection with this user
    if (peerConnections.has(senderId)) {
        console.warn('Peer connection already exists for user:', senderId);
        const existingPc = peerConnections.get(senderId);
        existingPc.close();
        peerConnections.delete(senderId);
        
        // Also remove from voice activity monitoring
        stopVoiceActivityMonitoring(senderId);
    }
    
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
        
        // Start monitoring voice activity for this user
        startVoiceActivityMonitoring(event.streams[0], senderId);
        
        // Add to voice users list if not already present
        if (!voiceUsers.has(senderId)) {
            voiceUsers.set(senderId, { 
                id: senderId, 
                username: username, 
                talking: false 
            });
            
            // Add user to voice channel display
            addUserToVoiceChannelDisplay(senderId, username);
        }
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
        })
        .catch(err => {
            console.error('Error handling incoming offer:', err);
        });
    
    peerConnections.set(senderId, pc);
}

function handleIncomingAnswer(answer, senderId) {
    const pc = peerConnections.get(senderId);
    if (pc) {
        // Check if connection is in the correct state for answer
        if (pc.signalingState === 'have-local-offer') {
            pc.setRemoteDescription(answer)
                .then(() => {
                    console.log('Remote description set successfully');
                })
                .catch(err => {
                    console.error('Error setting remote description:', err);
                });
        } else {
            console.warn('Peer connection not in correct state for answer:', pc.signalingState);
        }
    }
}

function handleIncomingIceCandidate(candidate, senderId) {
    const pc = peerConnections.get(senderId);
    if (pc) {
        pc.addIceCandidate(candidate)
            .catch(err => {
                console.error('Error adding received ice candidate:', err);
            });
    }
}