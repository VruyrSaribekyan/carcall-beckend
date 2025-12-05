require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const { sequelize, User, CallHistory } = require('./models');

// Импорт роутов
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');
const callRoutes = require('./routes/callRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    maxHttpBufferSize: 1e8,
    allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/calls', callRoutes);

// --- ИСПРАВЛЕННАЯ SOCKET.IO ЛОГИКА ---
let onlineUsers = {}; 
let socketToCarNumber = {}; 
let activeCalls = {}; 

const cleanupSocket = (socketId) => {
    const carNumber = socketToCarNumber[socketId];
    if (carNumber) {
        delete onlineUsers[carNumber];
        delete socketToCarNumber[socketId];
        console.log(`🧹 Cleaned up socket ${socketId} for ${carNumber}`);
    }
    delete activeCalls[socketId];
};

io.on('connection', (socket) => {
    console.log('✅ Connected socket ID:', socket.id);

    socket.on('join', async (carNumber) => {
        console.log('📝 Join from carNumber:', carNumber);
        try {
            const oldSocketId = onlineUsers[carNumber];
            if (oldSocketId && oldSocketId !== socket.id) {
                console.log(`🔄 User ${carNumber} reconnecting from ${oldSocketId} to ${socket.id}`);
                
                const oldSocket = io.sockets.sockets.get(oldSocketId);
                if (oldSocket) {
                    oldSocket.disconnect(true);
                }
                
                delete socketToCarNumber[oldSocketId];
                delete activeCalls[oldSocketId];
            }

            onlineUsers[carNumber] = socket.id;
            socketToCarNumber[socket.id] = carNumber;
            socket.join(carNumber);
            
            await User.update({ isOnline: true }, { where: { carNumber } });
            
            io.emit('user_status', { carNumber, isOnline: true });
            console.log(`✅ User ${carNumber} joined with socket ${socket.id}`);
        } catch (error) {
            console.error('❌ Join error:', error);
        }
    });

    socket.on('call_user', async (data) => {
        try {
            const { userToCall, signalData, fromCarNumber, isVideo } = data;
            
            console.log(`📞 Call from ${fromCarNumber} (${socket.id}) to ${userToCall}`);
            console.log(`📞 Signal type: ${signalData.type}`);
            
            const receiverSocketId = onlineUsers[userToCall];
            console.log('📞 Receiver socket ID:', receiverSocketId);
            
            if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                
                if (receiverSocket && receiverSocket.connected) {
                    activeCalls[socket.id] = {
                        caller: fromCarNumber,
                        receiver: userToCall,
                        isVideo,
                        startTime: Date.now(),
                        callerSocketId: socket.id,
                        receiverSocketId: receiverSocketId
                    };
                    
                    // ✅ ИСПРАВЛЕНО: Отправляем offer в правильном формате
                    io.to(receiverSocketId).emit("incoming_call", { 
                        signal: signalData,  // Это offer (type: 'offer')
                        from: socket.id,
                        fromCarNumber,
                        isVideo
                    });
                    
                    console.log(`✅ Call signal sent to ${userToCall} (${receiverSocketId})`);
                } else {
                    console.log(`⚠️ Receiver socket ${receiverSocketId} not connected`);
                    cleanupSocket(receiverSocketId);
                    
                    await CallHistory.create({
                        callerCarNumber: fromCarNumber,
                        receiverCarNumber: userToCall,
                        status: 'missed',
                        callType: isVideo ? 'video' : 'audio',
                        duration: 0
                    });
                    
                    socket.emit("call_failed", { reason: "User offline" });
                }
            } else {
                await CallHistory.create({
                    callerCarNumber: fromCarNumber,
                    receiverCarNumber: userToCall,
                    status: 'missed',
                    callType: isVideo ? 'video' : 'audio',
                    duration: 0
                });
                
                socket.emit("call_failed", { reason: "User offline" });
                console.log(`❌ User ${userToCall} is offline`);
            }
        } catch (error) {
            console.error('❌ Call user error:', error);
            socket.emit("call_failed", { reason: "Server error" });
        }
    });

    socket.on("answer_call", async (data) => {
        try {
            const { signal, to } = data; // signal = answer, to = callerCarNumber
            const receiverCarNumber = socketToCarNumber[socket.id];
            
            console.log(`✅ Call answered by ${receiverCarNumber} (${socket.id}) to caller ${to}`);
            console.log(`✅ Answer signal type: ${signal.type}`);
            
            const callerSocketId = onlineUsers[to];
            
            if (!callerSocketId) {
                console.log(`❌ Caller ${to} not found in onlineUsers`);
                socket.emit("call_ended");
                return;
            }
            
            const callerSocket = io.sockets.sockets.get(callerSocketId);
            
            if (callerSocket && callerSocket.connected) {
                if (activeCalls[callerSocketId]) {
                    activeCalls[callerSocketId].answered = true;
                    activeCalls[callerSocketId].answerTime = Date.now();
                }
                
                // ✅ ИСПРАВЛЕНО: Отправляем answer как сигнал (не как объект signal)
                io.to(callerSocketId).emit("call_accepted", signal);
                console.log(`✅ Sent call_accepted (answer) to caller socket ${callerSocketId}`);
            } else {
                console.log(`⚠️ Caller socket ${callerSocketId} not connected`);
                socket.emit("call_ended");
            }
        } catch (error) {
            console.error('❌ Answer call error:', error);
            socket.emit("call_ended");
        }
    });
    
    socket.on("reject_call", async (data) => {
        try {
            const { to } = data;
            const receiverCarNumber = socketToCarNumber[socket.id];
            
            console.log(`❌ Call rejected by ${receiverCarNumber} from ${to}`);
            
            const callerSocketId = onlineUsers[to];
            let callInfo = null;
            
            if (callerSocketId) {
                callInfo = activeCalls[callerSocketId];
            }
            
            await CallHistory.create({
                callerCarNumber: to,
                receiverCarNumber: receiverCarNumber,
                status: 'rejected',
                callType: callInfo?.isVideo ? 'video' : 'audio',
                duration: 0
            });
            
            if (callerSocketId) {
                const callerSocket = io.sockets.sockets.get(callerSocketId);
                if (callerSocket && callerSocket.connected) {
                    io.to(callerSocketId).emit("call_rejected");
                    console.log(`✅ Sent call_rejected to ${callerSocketId}`);
                }
                delete activeCalls[callerSocketId];
            }
            
        } catch (error) {
            console.error('❌ Reject call error:', error);
        }
    });

    socket.on("end_call", async (data) => {
        try {
            const { to } = data;
            const myCarNumber = socketToCarNumber[socket.id];
            
            console.log(`📴 Call ended by ${myCarNumber} (${socket.id}), notifying ${to}`);
            
            let callData = activeCalls[socket.id];
            
            if (!callData) {
                const otherSocketId = onlineUsers[to];
                if (otherSocketId) {
                    callData = activeCalls[otherSocketId];
                }
            }
            
            if (callData && callData.answered) {
                const duration = Math.floor((Date.now() - callData.answerTime) / 1000);
                
                await CallHistory.create({
                    callerCarNumber: callData.caller,
                    receiverCarNumber: callData.receiver,
                    status: 'completed',
                    callType: callData.isVideo ? 'video' : 'audio',
                    duration,
                    startTime: new Date(callData.answerTime),
                    endTime: new Date()
                });
                
                console.log(`💾 Saved call: ${callData.caller} -> ${callData.receiver}, duration: ${duration}s`);
            }
            
            const receiverSocketId = onlineUsers[to];
            if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                if (receiverSocket && receiverSocket.connected) {
                    io.to(receiverSocketId).emit("call_ended");
                    console.log(`✅ Sent call_ended to ${to} (${receiverSocketId})`);
                }
                delete activeCalls[receiverSocketId];
            }
            
            delete activeCalls[socket.id];
            
        } catch (error) {
            console.error('❌ End call error:', error);
        }
    });

    // ✅ КРИТИЧНО: ICE candidates должны корректно пересылаться
    socket.on("ice_candidate", (data) => {
        try {
            const { to, candidate } = data;
            const fromCarNumber = socketToCarNumber[socket.id];
            
            console.log(`🧊 ICE candidate from ${fromCarNumber} to ${to}`);
            
            const receiverSocketId = onlineUsers[to];
            if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                if (receiverSocket && receiverSocket.connected) {
                    io.to(receiverSocketId).emit("ice_candidate", { 
                        candidate,
                        from: fromCarNumber  // ✅ Отправляем carNumber, не socketId
                    });
                    console.log(`✅ ICE candidate forwarded to ${to}`);
                } else {
                    console.log(`⚠️ Receiver socket ${receiverSocketId} not connected`);
                }
            } else {
                console.log(`❌ Receiver ${to} not found in onlineUsers`);
            }
        } catch (error) {
            console.error('❌ ICE candidate error:', error);
        }
    });

    socket.on("send_message", (data) => {
        try {
            const receiverSocketId = onlineUsers[data.toCarNumber];
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("new_message", data);
            }
        } catch (error) {
            console.error('❌ Send message error:', error);
        }
    });

    socket.on('disconnect', async (reason) => {
        try {
            console.log(`🔌 Socket ${socket.id} disconnected: ${reason}`);
            
            const carNumber = socketToCarNumber[socket.id];
            
            if (carNumber) {
                delete onlineUsers[carNumber];
                delete socketToCarNumber[socket.id];
                
                await User.update({ 
                    isOnline: false, 
                    lastSeen: new Date() 
                }, { 
                    where: { carNumber } 
                });
                
                io.emit('user_status', { carNumber, isOnline: false });
                console.log(`❌ User ${carNumber} went offline`);
            }
            
            delete activeCalls[socket.id];
        } catch (error) {
            console.error('❌ Disconnect error:', error);
        }
    });

    socket.on('error', (error) => {
        console.error('❌ Socket error:', socket.id, error);
    });
});

// Запуск
const PORT = process.env.PORT || 5000;

sequelize.sync({ alter: true })
    .then(() => {
        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📦 Database Connected`);
        });
    })
    .catch(err => {
        console.error("❌ Database sync error:", err);
    });

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, closing server gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Экспорт io для использования в контроллерах
module.exports = { io };