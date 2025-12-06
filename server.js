// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const { sequelize, User, CallHistory } = require('./models');
const { sendCallNotification, sendCallEndedNotification } = require('./utils/pushNotifications');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');
const callRoutes = require('./routes/callRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/calls', callRoutes);

let onlineUsers = {};
let socketToCarNumber = {};
let activeCalls = {};

io.on('connection', (socket) => {
    console.log('✅ Socket:', socket.id);

    socket.on('join', async (carNumber) => {
        const oldSocketId = onlineUsers[carNumber];
        if (oldSocketId && oldSocketId !== socket.id) {
            const oldSocket = io.sockets.sockets.get(oldSocketId);
            if (oldSocket) oldSocket.disconnect(true);
            delete socketToCarNumber[oldSocketId];
            delete activeCalls[oldSocketId];
        }
        onlineUsers[carNumber] = socket.id;
        socketToCarNumber[socket.id] = carNumber;
        socket.join(carNumber);
        await User.update({ isOnline: true }, { where: { carNumber } });
        io.emit('user_status', { carNumber, isOnline: true });
        console.log(`✅ ${carNumber} joined`);
    });

    socket.on('call_user', async (data) => {
        try {
            const { userToCall, signalData, fromCarNumber, isVideo } = data;
            const receiver = await User.findOne({ where: { carNumber: userToCall } });
            const caller = await User.findOne({ where: { carNumber: fromCarNumber } });
            
            if (!receiver) {
                socket.emit("call_failed", { reason: "User not found" });
                return;
            }

            const receiverSocketId = onlineUsers[userToCall];
            activeCalls[socket.id] = {
                caller: fromCarNumber,
                receiver: userToCall,
                isVideo,
                startTime: Date.now(),
            };

            if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                if (receiverSocket?.connected) {
                    io.to(receiverSocketId).emit("incoming_call", { 
                        signal: signalData,
                        from: socket.id,
                        fromCarNumber,
                        isVideo
                    });
                }
            }
            
            if (receiver.fcmToken) {
                const pushResult = await sendCallNotification(receiver.fcmToken, {
                    fromCarNumber,
                    fromName: caller?.name || fromCarNumber,
                    isVideo,
                    signal: signalData,
                });
                
                if (!pushResult.success && pushResult.shouldRemoveToken) {
                    await User.update({ fcmToken: null }, { where: { carNumber: userToCall } });
                }
            }

            if (!receiverSocketId && !receiver.fcmToken) {
                await CallHistory.create({
                    callerCarNumber: fromCarNumber,
                    receiverCarNumber: userToCall,
                    status: 'missed',
                    callType: isVideo ? 'video' : 'audio',
                    duration: 0
                });
                socket.emit("call_failed", { reason: "User offline" });
            }
        } catch (error) {
            console.error('❌ Call error:', error);
            socket.emit("call_failed", { reason: "Server error" });
        }
    });

    socket.on("answer_call", async (data) => {
        const { signal, to } = data;
        const callerSocketId = onlineUsers[to];
        if (callerSocketId) {
            if (activeCalls[callerSocketId]) {
                activeCalls[callerSocketId].answered = true;
                activeCalls[callerSocketId].answerTime = Date.now();
            }
            io.to(callerSocketId).emit("call_accepted", signal);
        }
    });
    
    socket.on("reject_call", async (data) => {
        const { to } = data;
        const receiverCarNumber = socketToCarNumber[socket.id];
        const callerSocketId = onlineUsers[to];
        
        await CallHistory.create({
            callerCarNumber: to,
            receiverCarNumber: receiverCarNumber,
            status: 'rejected',
            callType: activeCalls[callerSocketId]?.isVideo ? 'video' : 'audio',
            duration: 0
        });
        
        if (callerSocketId) {
            io.to(callerSocketId).emit("call_rejected");
            delete activeCalls[callerSocketId];
        }
    });

    socket.on("end_call", async (data) => {
        const { to } = data;
        const myCarNumber = socketToCarNumber[socket.id];
        let callData = activeCalls[socket.id] || activeCalls[onlineUsers[to]];
        
        if (callData?.answered) {
            const duration = Math.floor((Date.now() - callData.answerTime) / 1000);
            await CallHistory.create({
                callerCarNumber: callData.caller,
                receiverCarNumber: callData.receiver,
                status: 'completed',
                callType: callData.isVideo ? 'video' : 'audio',
                duration,
            });
        }
        
        const receiverSocketId = onlineUsers[to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("call_ended");
            delete activeCalls[receiverSocketId];
        }
        delete activeCalls[socket.id];
    });

    socket.on("ice_candidate", (data) => {
        const receiverSocketId = onlineUsers[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("ice_candidate", { 
                candidate: data.candidate,
                from: socketToCarNumber[socket.id]
            });
        }
    });

    socket.on("send_message", (data) => {
        const receiverSocketId = onlineUsers[data.toCarNumber];
        if (receiverSocketId) io.to(receiverSocketId).emit("new_message", data);
    });

    socket.on('disconnect', async () => {
        const carNumber = socketToCarNumber[socket.id];
        if (carNumber) {
            delete onlineUsers[carNumber];
            delete socketToCarNumber[socket.id];
            await User.update({ isOnline: false, lastSeen: new Date() }, { where: { carNumber } });
            io.emit('user_status', { carNumber, isOnline: false });
        }
        delete activeCalls[socket.id];
    });
});

const PORT = process.env.PORT || 5000;
sequelize.sync({ alter: true }).then(() => {
    server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
});

module.exports = { io };