// import express from 'express';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import cors from 'cors';
// import dotenv from 'dotenv';
// import authRoutes from './routes/auth.js';
// import leadRoutes from './routes/leads.js';
// import userRoutes from './routes/users.js';
// import statsRoutes from './routes/stats.js';
// import { authenticateSocket } from './middleware/auth.js';

// dotenv.config();

// const app = express();
// const httpServer = createServer(app);

// export const io = new Server(httpServer, {
//   cors: { origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }
// });

// // ── Middleware ──
// app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // ── Routes ──
// app.use('/api/auth',  authRoutes);
// app.use('/api/leads', leadRoutes);
// app.use('/api/users', userRoutes);
// app.use('/api/stats', statsRoutes);

// app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// // ── Socket.io ──
// const onlineUsers = new Map(); // userId -> socketId

// io.use(authenticateSocket);

// io.on('connection', (socket) => {
//   const userId = socket.user.id;
//   onlineUsers.set(userId, socket.id);

//   // Broadcast user came online
//   io.emit('user:online', { userId, online: true });

//   socket.on('availability:change', ({ availability }) => {
//     io.emit('user:availability', { userId, availability });
//   });

//   socket.on('disconnect', () => {
//     onlineUsers.delete(userId);
//     io.emit('user:online', { userId, online: false });
//   });
// });

// export { onlineUsers };

// const PORT = process.env.PORT || 5000;
// httpServer.listen(PORT, () => console.log(`✅ LeadFlow server running on port ${PORT}`));




import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from './routes/auth.js';
import leadRoutes from './routes/leads.js';
import userRoutes from './routes/users.js';
import statsRoutes from './routes/stats.js';

import { authenticateSocket } from './middleware/auth.js';
import { PrismaClient } from "@prisma/client";
// import authRoutes from "./routes/auth.js";


const prisma = new PrismaClient();
dotenv.config();

const app = express();
const httpServer = createServer(app);

export const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
  }
});
// ── Middleware ──
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// ─────────────────────────────
// SOCKET.IO USER PRESENCE SYSTEM
// ─────────────────────────────

const onlineUsers = new Map();       // userId -> socketId
const lastActivity = new Map();      // userId -> timestamp

io.use(authenticateSocket);

io.on('connection', async (socket) => {

  const userId = socket.user.id;
  await prisma.user.update({
    where: { id: userId },
    data: {
      isOnline: true,
      lastActiveAt: new Date()
    }
  });
  // user becomes online
  onlineUsers.set(userId, socket.id);
  lastActivity.set(userId, Date.now());
  socket.join(userId); // Join room for targeted notifications
  // Auto-assign pending HOT leads when an associate logs in
  if (socket.user.role === "ASSOCIATE") {

    const hotLeads = await prisma.lead.findMany({
      where: {
        status: "HOT",
        associateId: null
      },
      orderBy: { createdAt: "asc" },
      take: 3   // assign up to 3 waiting HOT leads
    });

    for (const lead of hotLeads) {

      await prisma.lead.update({
        where: { id: lead.id },
        data: { associateId: userId }
      });

      io.to(String(userId)).emit("notification", {
        title: "New Hot Lead",
        message: `${lead.name} assigned automatically`,
        leadId: lead.id,
        type: "associate_lead"
      });

    }
  }
  io.emit('user:online', {
    userId,
    online: true
  });

  // manual availability change
  socket.on('availability:change', ({ availability }) => {

    io.emit('user:availability', {
      userId,
      availability
    });

  });

  // user active (mouse move etc)
  socket.on('user:active', () => {

    lastActivity.set(userId, Date.now());

    io.emit('user:availability', {
      userId,
      availability: 'AVAILABLE'
    });

  });

  // user inactive
  socket.on('user:inactive', () => {

    io.emit('user:availability', {
      userId,
      availability: 'BREAK'
    });

  });

  // browser closed
  socket.on('disconnect', async () => {

    onlineUsers.delete(userId);
    lastActivity.delete(userId);
    await prisma.user.update({
      where: { id: userId },
      data: {
        isOnline: false,
        lastActiveAt: new Date()
      }
    });
    io.emit('user:online', {
      userId,
      online: false
    });

  });

});

export { onlineUsers };

// ─────────────────────────────
// BACKGROUND REMINDER SERVICE
// ─────────────────────────────
setInterval(async () => {
  try {
    const now = new Date();
    const notificationThresholds = [5, 10, 15]; // minutes

    for (const mins of notificationThresholds) {
      const targetTime = new Date(now.getTime() + mins * 60000);
      const start = new Date(targetTime.setSeconds(0, 0));
      const end = new Date(targetTime.setSeconds(59, 999));

      // 1. Check Telecaller Callbacks (CallLog)
      const pendingCalls = await prisma.callLog.findMany({
        where: { callbackAt: { gte: start, lte: end } },
        include: { lead: true }
      });

      for (const log of pendingCalls) {
        if (log.telecallerId) {
          io.to(log.telecallerId).emit("notification", {
            title: "Follow-up Reminder",
            message: `Reminder: Call ${log.lead.name} in ${mins} minutes`,
            leadId: log.leadId,
            type: "reminder"
          });
        }
      }

      // 2. Check Associate Follow-ups (Meeting)
      const pendingMeets = await prisma.meeting.findMany({
        where: { followUpDate: { gte: start, lte: end } },
        include: { lead: true }
      });

      for (const meet of pendingMeets) {
        if (meet.associateId) {
          io.to(meet.associateId).emit("notification", {
            title: "Meeting Reminder",
            message: `Reminder: Follow up with ${meet.lead.name} in ${mins} minutes`,
            leadId: meet.leadId,
            type: "reminder"
          });
        }
      }
    }
  } catch (err) {
    console.error("Reminder Service Error:", err);
  }
}, 60000);

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`✅ LeadFlow server running on port ${PORT}`);
});


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../../frontend/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/dist/index.html"));
});