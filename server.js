const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and voice channels
const users = new Map();
const voiceChannels = new Map();

// Helper function to get user by socket ID
function getUserById(socketId) {
  return users.get(socketId);
}

// Helper function to notify voice channel members
function notifyVoiceChannelMembers(channelName, event, data) {
  if (voiceChannels.has(channelName)) {
    const channelUsers = voiceChannels.get(channelName);
    for (const userId of channelUsers) {
      const userSocket = io.sockets.sockets.get(userId);
      if (userSocket && userId !== data.senderId) { // Don't send back to sender
        userSocket.emit(event, data);
      }
    }
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle user joining
  socket.on('join', (username) => {
    users.set(socket.id, { id: socket.id, username });
    socket.broadcast.emit('userJoined', { id: socket.id, username });
    io.emit('userList', Array.from(users.values()));
  });

  // Handle chat messages
  socket.on('chatMessage', (data) => {
    io.emit('chatMessage', {
      username: users.get(socket.id)?.username || 'Anonymous',
      message: data.message,
      timestamp: new Date()
    });
  });

  // Handle voice channel creation/joining
  socket.on('joinVoiceChannel', (channelName) => {
    // Remove user from any existing voice channel
    for (const [existingChannel, channelUsers] of voiceChannels) {
      if (channelUsers.has(socket.id)) {
        channelUsers.delete(socket.id);
        // Notify others that user left
        socket.to(existingChannel).emit('userLeftVoice', {
          userId: socket.id,
          username: users.get(socket.id)?.username
        });
        
        // Remove channel if empty
        if (channelUsers.size === 0) {
          voiceChannels.delete(existingChannel);
        }
        break;
      }
    }
    
    // Add user to requested voice channel
    if (!voiceChannels.has(channelName)) {
      voiceChannels.set(channelName, new Set());
    }
    voiceChannels.get(channelName).add(socket.id);
    
    // Notify others in the channel
    socket.to(channelName).emit('userJoinedVoice', {
      userId: socket.id,
      username: users.get(socket.id)?.username,
      senderId: socket.id
    });
    
    socket.join(channelName);
  });

  // Handle WebRTC offer
  socket.on('webrtcOffer', (data) => {
    const targetSocket = io.sockets.sockets.get(data.targetUserId);
    if (targetSocket) {
      // Verify both users are in the same voice channel
      let userInSameChannel = false;
      for (const [channelName, channelUsers] of voiceChannels) {
        if (channelUsers.has(socket.id) && channelUsers.has(data.targetUserId)) {
          userInSameChannel = true;
          break;
        }
      }
      
      if (userInSameChannel) {
        targetSocket.emit('webrtcOffer', {
          offer: data.offer,
          senderId: socket.id,
          username: users.get(socket.id)?.username
        });
      } else {
        // User is not in same voice channel, deny connection
        socket.emit('error', { message: 'Cannot establish connection with user not in same voice channel' });
      }
    }
  });

  // Handle WebRTC answer
  socket.on('webrtcAnswer', (data) => {
    socket.to(data.targetUserId).emit('webrtcAnswer', {
      answer: data.answer,
      senderId: socket.id
    });
  });

  // Handle ICE candidates
  socket.on('webrtcIceCandidate', (data) => {
    socket.to(data.targetUserId).emit('webrtcIceCandidate', {
      candidate: data.candidate,
      senderId: socket.id
    });
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (user) {
          // Remove user from voice channels
          for (const [channelName, channelUsers] of voiceChannels) {
              if (channelUsers.has(socket.id)) {
                  channelUsers.delete(socket.id);
                  
                  // Notify others in the channel
                  socket.to(channelName).emit('userLeftVoice', {
                      userId: socket.id,
                      username: user.username
                  });
                  
                  // Remove channel if empty
                  if (channelUsers.size === 0) {
                      voiceChannels.delete(channelName);
                  } else {
                      // Update voice channel user list for remaining users
                      const remainingUsers = Array.from(channelUsers).map(id => users.get(id)).filter(Boolean);
                      socket.to(channelName).emit('voiceUserList', {
                          channelName,
                          users: remainingUsers
                      });
                  }
              }
          }
          
          // Remove user from global users list
          users.delete(socket.id);
          
          // Notify all clients about disconnection
          io.emit('userDisconnected', { id: socket.id, username: user.username });
          io.emit('userList', Array.from(users.values()));
      }
      console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});