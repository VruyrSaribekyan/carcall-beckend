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

// --- SOCKET.IO LOGIC ---
let onlineUsers = {}; // carNumber -> socketId
let socketToCarNumber = {}; // socketId -> carNumber (обратный маппинг)
let activeCalls = {}; // socketId -> callData

// Utility function для очистки отключённых сокетов
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

    // 1. Вход в сеть
    socket.on('join', async (carNumber) => {
        console.log('📝 Join from carNumber:', carNumber, 'Old socket:', onlineUsers[carNumber]);
        try {
            // Проверяем, не был ли этот пользователь подключён с другим сокетом
            const oldSocketId = onlineUsers[carNumber];
            if (oldSocketId && oldSocketId !== socket.id) {
                console.log(`🔄 User ${carNumber} reconnecting from ${oldSocketId} to ${socket.id}`);
                
                // Отключаем старый сокет если он всё ещё существует
                const oldSocket = io.sockets.sockets.get(oldSocketId);
                if (oldSocket) {
                    oldSocket.disconnect(true);
                }
                
                // Очищаем старые данные
                delete socketToCarNumber[oldSocketId];
                delete activeCalls[oldSocketId];
            }

            // Регистрируем новое соединение
            onlineUsers[carNumber] = socket.id;
            socketToCarNumber[socket.id] = carNumber;
            socket.join(carNumber);
            
            await User.update({ isOnline: true }, { where: { carNumber } });
            
            // Отправляем статус всем
            io.emit('user_status', { carNumber, isOnline: true });
            console.log(`✅ User ${carNumber} joined with socket ${socket.id}`);
        } catch (error) {
            console.error('❌ Join error:', error);
        }
    });

    socket.on('call_user', async (data) => {
        try {
            const { userToCall, signalData, from, fromCarNumber, isVideo } = data;
            
            console.log(`📞 Call from ${fromCarNumber} (${socket.id}) to ${userToCall}`);
            
            const receiverSocketId = onlineUsers[userToCall];
            console.log('📞 Receiver socket ID:', receiverSocketId);
            
            if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                
                if (receiverSocket && receiverSocket.connected) {
                    // Сохраняем информацию о звонке
                    activeCalls[socket.id] = {
                        caller: fromCarNumber,
                        receiver: userToCall,
                        isVideo,
                        startTime: Date.now()
                    };
                    
                    // Отправляем сигнал принимающей стороне
                    io.to(receiverSocketId).emit("incoming_call", { 
                        signal: signalData, 
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

    // 3. Принятие звонка
    socket.on("answer_call", async (data) => {
        try {
            const { signal, to } = data; // to = callerCarNumber
            const receiverCarNumber = socketToCarNumber[socket.id];
            
            console.log(`✅ Call answered by ${receiverCarNumber} (${socket.id}) to caller ${to}`);
            
            const callerSocketId = onlineUsers[to];
            
            if (!callerSocketId) {
                console.log(`❌ Caller ${to} not found in onlineUsers`);
                socket.emit("call_ended");
                return;
            }
            
            const callerSocket = io.sockets.sockets.get(callerSocketId);
            
            if (callerSocket && callerSocket.connected) {
                // Update call status
                if (activeCalls[callerSocketId]) {
                    activeCalls[callerSocketId].answered = true;
                    activeCalls[callerSocketId].answerTime = Date.now();
                }
                
                // Отправляем answer обратно звонящему
                io.to(callerSocketId).emit("call_accepted", signal);
                console.log(`✅ Sent call_accepted to caller socket ${callerSocketId}`);
            } else {
                console.log(`⚠️ Caller socket ${callerSocketId} not connected`);
                socket.emit("call_ended");
            }
        } catch (error) {
            console.error('❌ Answer call error:', error);
            socket.emit("call_ended");
        }
    });
    
    // 4. Отклонение звонка
    socket.on("reject_call", async (data) => {
        try {
            const { to } = data; // to = callerCarNumber
            const receiverCarNumber = socketToCarNumber[socket.id];
            
            console.log(`❌ Call rejected by ${receiverCarNumber} from ${to}`);
            
            // Найдём информацию о звонке
            const callerSocketId = onlineUsers[to];
            let callInfo = null;
            
            if (callerSocketId) {
                callInfo = activeCalls[callerSocketId];
            }
            
            // Сохраняем отклонённый звонок
            await CallHistory.create({
                callerCarNumber: to,
                receiverCarNumber: receiverCarNumber,
                status: 'rejected',
                callType: callInfo?.isVideo ? 'video' : 'audio',
                duration: 0
            });
            
            // Уведомляем звонящего
            if (callerSocketId) {
                const callerSocket = io.sockets.sockets.get(callerSocketId);
                if (callerSocket && callerSocket.connected) {
                    io.to(callerSocketId).emit("call_rejected");
                    console.log(`✅ Sent call_rejected to ${callerSocketId}`);
                }
            }
            
            // Очищаем данные о звонке
            if (callerSocketId) {
                delete activeCalls[callerSocketId];
            }
            
        } catch (error) {
            console.error('❌ Reject call error:', error);
        }
    });
    // 5. Завершение звонка
    socket.on("end_call", async (data) => {
        try {
            const { to } = data; // to = carNumber другой стороны
            const myCarNumber = socketToCarNumber[socket.id];
            
            console.log(`📴 Call ended by ${myCarNumber} (${socket.id}), notifying ${to}`);
            
            // Находим данные о звонке
            let callData = activeCalls[socket.id];
            
            // Если не нашли у себя, ищем у другой стороны
            if (!callData) {
                const otherSocketId = onlineUsers[to];
                if (otherSocketId) {
                    callData = activeCalls[otherSocketId];
                }
            }
            
            // Сохраняем завершённый звонок
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
            
            // Уведомляем другую сторону
            const receiverSocketId = onlineUsers[to];
            if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                if (receiverSocket && receiverSocket.connected) {
                    io.to(receiverSocketId).emit("call_ended");
                    console.log(`✅ Sent call_ended to ${to} (${receiverSocketId})`);
                }
                // Очищаем данные у получателя
                delete activeCalls[receiverSocketId];
            }
            
            // Очищаем свои данные
            delete activeCalls[socket.id];
            
        } catch (error) {
            console.error('❌ End call error:', error);
        }
    });
    // 6. ICE кандидаты
    socket.on("ice_candidate", (data) => {
        try {
            const { to, candidate } = data;
            
            const receiverSocketId = onlineUsers[to];
            if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                if (receiverSocket && receiverSocket.connected) {
                    io.to(receiverSocketId).emit("ice_candidate", { 
                        candidate,
                        from: socket.id 
                    });
                }
            }
        } catch (error) {
            console.error('❌ ICE candidate error:', error);
        }
    });

    // 7. Чат
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

    // 8. Отключение
    socket.on('disconnect', async (reason) => {
        try {
            console.log(`🔌 Socket ${socket.id} disconnected: ${reason}`);
            
            const carNumber = socketToCarNumber[socket.id];
            
            if (carNumber) {
                // Удаляем из онлайна
                delete onlineUsers[carNumber];
                delete socketToCarNumber[socket.id];
                
                // Обновляем статус в БД
                await User.update({ 
                    isOnline: false, 
                    lastSeen: new Date() 
                }, { 
                    where: { carNumber } 
                });
                
                // Уведомляем всех об оффлайне
                io.emit('user_status', { carNumber, isOnline: false });
                console.log(`❌ User ${carNumber} went offline`);
            }
            
            // Очищаем активные звонки
            delete activeCalls[socket.id];
        } catch (error) {
            console.error('❌ Disconnect error:', error);
        }
    });

    // Обработка ошибок сокета
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