// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { sequelize, CallHistory, User } = require('./models'); // предполагается, что models экспортирует sequelize + модели
const { sendCallNotification } = require('./utils/pushNotifications');

const app = express();
const server = http.createServer(app);

const ioOptions = {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
};

// Optional Redis adapter for scaling (requires REDIS_URL env)
if (process.env.REDIS_URL) {
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const { createClient } = require('redis');
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
      const io = new Server(server, ioOptions);
      io.adapter(createAdapter(pubClient, subClient));
      console.log('✅ Socket.IO using Redis adapter');
      start(io);
    }).catch((err) => {
      console.error('❌ Redis adapter init failed, starting without it', err);
      const io = new Server(server, ioOptions);
      start(io);
    });
  } catch (err) {
    console.warn('⚠️ Redis libs not found, starting without redis adapter:', err.message);
    const io = new Server(server, ioOptions);
    start(io);
  }
} else {
  const io = new Server(server, ioOptions);
  start(io);
}

function start(io) {
  app.use(cors());
  app.use(express.json());
  app.use('/uploads', express.static('uploads'));

  // mount your routes (auth, users, chats, calls) here
  app.use('/api/auth', require('./routes/authRoutes'));
  app.use('/api/users', require('./routes/userRoutes'));
  app.use('/api/chat', require('./routes/chatRoutes'));
  app.use('/api/calls', require('./routes/callRoutes'));

  // In-memory maps. For multi-node use Redis or DB-backed mapping.
  const onlineUsers = new Map(); // carNumber -> socketId
  const socketToCarNumber = new Map(); // socketId -> carNumber
  const activeCalls = new Map(); // callerSocketId -> { caller, receiver, timeoutId, answered, startTime, answerTime }

  const CALL_TIMEOUT_MS = parseInt(process.env.CALL_TIMEOUT_MS || '30000', 10); // default 30s

  io.on('connection', (socket) => {
    console.log('✅ Socket connected', socket.id);

    socket.on('join', async (carNumber) => {
      try {
        if (!carNumber) return;
        console.log(`📝 join ${carNumber} <- ${socket.id}`);

        // Anti-duplicate: if same carNumber already connected, disconnect old socket
        const oldSocketId = onlineUsers.get(carNumber);
        if (oldSocketId && oldSocketId !== socket.id) {
          console.log('🔁 Detected duplicate connection for', carNumber, 'disconnecting old socket', oldSocketId);
          const oldSock = io.sockets.sockets.get(oldSocketId);
          if (oldSock) oldSock.disconnect(true);
          onlineUsers.delete(carNumber);
          socketToCarNumber.delete(oldSocketId);
          // cleanup activeCalls for old socket
          const oldCall = activeCalls.get(oldSocketId);
          if (oldCall && oldCall.timeoutId) {
            clearTimeout(oldCall.timeoutId);
            activeCalls.delete(oldSocketId);
          }
        }

        onlineUsers.set(carNumber, socket.id);
        socketToCarNumber.set(socket.id, carNumber);
        socket.join(carNumber);
        // mark user online in DB (async)
        User.update({ isOnline: true }, { where: { carNumber } }).catch(e => console.warn('DB update isOnline failed', e));
        io.emit('user_status', { carNumber, isOnline: true });
        console.log(`✅ ${carNumber} registered => ${socket.id}`);
      } catch (err) {
        console.error('join error', err);
      }
    });

    socket.on('call_user', async (data) => {
      /**
       * data = { userToCall, signalData, fromCarNumber, isVideo }
       * Flow:
       * - set activeCalls for caller socket
       * - if receiver online -> emit incoming_call (socket)
       * - if receiver offline but fcmToken -> send push
       * - set timeout: if not answered within CALL_TIMEOUT_MS -> mark missed and notify caller
       */
      try {
        const { userToCall, signalData, fromCarNumber, isVideo } = data;
        if (!userToCall || !fromCarNumber) {
          socket.emit('call_failed', { reason: 'Invalid data' });
          return;
        }

        const receiver = await User.findOne({ where: { carNumber: userToCall } });
        const caller = await User.findOne({ where: { carNumber: fromCarNumber } });

        if (!receiver) {
          socket.emit('call_failed', { reason: 'User not found' });
          return;
        }

        // Prevent calling yourself
        if (fromCarNumber === userToCall) {
          socket.emit('call_failed', { reason: 'Cannot call yourself' });
          return;
        }

        // Prevent simultaneous outgoing calls from the same caller
        if (activeCalls.has(socket.id)) {
          socket.emit('call_failed', { reason: 'Already in call attempt' });
          return;
        }

        // register the attempted call
        const callRecord = {
          caller: fromCarNumber,
          receiver: userToCall,
          isVideo: !!isVideo,
          startTime: Date.now(),
          answered: false,
          timeoutId: null,
        };
        activeCalls.set(socket.id, callRecord);

        const receiverSocketId = onlineUsers.get(userToCall);
        if (receiverSocketId) {
          console.log('📡 Delivering incoming_call to socket', receiverSocketId);
          io.to(receiverSocketId).emit('incoming_call', {
            signal: signalData,
            from: socket.id,
            fromCarNumber,
            isVideo,
          });
        } else {
          console.log('📴 Receiver offline, will try push if token present');
        }

        // push failover
        if (receiver && receiver.fcmToken) {
          try {
            const pushResult = await sendCallNotification(receiver.fcmToken, {
              fromCarNumber,
              fromName: caller?.name || fromCarNumber,
              isVideo,
              signal: signalData,
            });
            if (!pushResult.success && pushResult.shouldRemoveToken) {
              await User.update({ fcmToken: null }, { where: { carNumber: userToCall } });
            }
          } catch (err) {
            console.warn('Push failover error:', err);
          }
        }

        // If nobody online AND no push token -> immediate missed
        const noDelivery = !receiverSocketId && !receiver.fcmToken;
        if (noDelivery) {
          await CallHistory.create({
            callerCarNumber: fromCarNumber,
            receiverCarNumber: userToCall,
            status: 'missed',
            callType: isVideo ? 'video' : 'audio',
            duration: 0,
          });
          activeCalls.delete(socket.id);
          socket.emit('call_failed', { reason: 'User offline' });
          return;
        }

        // set timeout to mark missed if no answer
        const timeoutId = setTimeout(async () => {
          const active = activeCalls.get(socket.id);
          if (active && !active.answered) {
            console.log('⏰ Call timed out (no answer) for', fromCarNumber, '->', userToCall);
            try {
              await CallHistory.create({
                callerCarNumber: fromCarNumber,
                receiverCarNumber: userToCall,
                status: 'missed',
                callType: isVideo ? 'video' : 'audio',
                duration: 0,
              });
            } catch (err) {
              console.warn('Save missed call failed', err);
            }
            // notify caller client
            io.to(socket.id).emit('call_failed', { reason: 'No answer' });
            activeCalls.delete(socket.id);
          }
        }, CALL_TIMEOUT_MS);

        // save timeoutId
        callRecord.timeoutId = timeoutId;
        activeCalls.set(socket.id, callRecord);

      } catch (err) {
        console.error('call_user error', err);
        socket.emit('call_failed', { reason: 'Server error' });
      }
    });

    socket.on('answer_call', async (data) => {
      // data = { signal, to } where to = caller carNumber
      try {
        const { signal, to } = data;
        const callerSocketId = onlineUsers.get(to);
        if (callerSocketId) {
          // find active call
          const call = activeCalls.get(callerSocketId);
          if (call) {
            call.answered = true;
            call.answerTime = Date.now();
            if (call.timeoutId) {
              clearTimeout(call.timeoutId);
              call.timeoutId = null;
            }
            activeCalls.set(callerSocketId, call);
          }
          io.to(callerSocketId).emit('call_accepted', signal);
        }
      } catch (err) {
        console.error('answer_call error', err);
      }
    });

    socket.on('reject_call', async (data) => {
      try {
        const { to } = data;
        const callerSocketId = onlineUsers.get(to);
        const receiverCarNumber = socketToCarNumber.get(socket.id);
        // save rejected in history
        if (callerSocketId) {
          await CallHistory.create({
            callerCarNumber: to,
            receiverCarNumber,
            status: 'rejected',
            callType: activeCalls.get(callerSocketId)?.isVideo ? 'video' : 'audio',
            duration: 0,
          });
          io.to(callerSocketId).emit('call_rejected');
          activeCalls.delete(callerSocketId);
        }
      } catch (err) {
        console.error('reject_call error', err);
      }
    });

    socket.on('end_call', async (data) => {
      try {
        const { to } = data;
        const myCarNumber = socketToCarNumber.get(socket.id);
        // try to find call by caller socket or by target
        let callEntry = activeCalls.get(socket.id);
        if (!callEntry && to) {
          const toSocketId = onlineUsers.get(to);
          callEntry = activeCalls.get(toSocketId);
        }

        if (callEntry && callEntry.answered) {
          const duration = Math.floor((Date.now() - (callEntry.answerTime || callEntry.startTime)) / 1000);
          await CallHistory.create({
            callerCarNumber: callEntry.caller,
            receiverCarNumber: callEntry.receiver,
            status: 'completed',
            callType: callEntry.isVideo ? 'video' : 'audio',
            duration,
          });
        }

        // notify remote
        const receiverSocketId = onlineUsers.get(to);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('call_ended');
          activeCalls.delete(receiverSocketId);
        }
        activeCalls.delete(socket.id);
      } catch (err) {
        console.error('end_call error', err);
      }
    });

    socket.on('ice_candidate', (data) => {
      try {
        const receiverSocketId = onlineUsers.get(data.to);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('ice_candidate', {
            candidate: data.candidate,
            from: socketToCarNumber.get(socket.id),
          });
        }
      } catch (err) {
        console.error('ice_candidate error', err);
      }
    });

    socket.on('disconnect', async () => {
      try {
        const carNumber = socketToCarNumber.get(socket.id);
        if (carNumber) {
          console.log('❌ Socket disconnected', socket.id, 'car', carNumber);
          onlineUsers.delete(carNumber);
          socketToCarNumber.delete(socket.id);
          // mark offline in DB
          User.update({ isOnline: false, lastSeen: new Date() }, { where: { carNumber } }).catch(e => console.warn('DB update isOnline failed', e));
          io.emit('user_status', { carNumber, isOnline: false });
        }
        // cleanup activeCalls for this socket
        const call = activeCalls.get(socket.id);
        if (call) {
          if (call.timeoutId) clearTimeout(call.timeoutId);
          activeCalls.delete(socket.id);
        }
      } catch (err) {
        console.error('disconnect handler error', err);
      }
    });
  });

  const PORT = process.env.PORT || 5000;
  sequelize.sync({ alter: true }).then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Server listening on ${PORT}`);
    });
  }).catch(err => {
    console.error('DB sync error', err);
    server.listen(PORT, () => console.log(`🚀 Server listening on ${PORT} (DB error)`));
  });
}
