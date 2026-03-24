// import jwt from 'jsonwebtoken';
// import prisma from '../lib/prisma.js';

// export const authenticate = async (req, res, next) => {
//   try {
//     const token = req.headers.authorization?.split(' ')[1];
//     if (!token) return res.status(401).json({ error: 'No token provided' });
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id:true, name:true, email:true, role:true, availability:true, isOnline:true } });
//     if (!user) return res.status(401).json({ error: 'User not found' });
//   await prisma.user.update({
//   where: { id: user.id },
//   data: {
//     isOnline: true
//   }
// })

// req.user = user;
// next();
//   } catch {
//     res.status(401).json({ error: 'Invalid token' });
//   }
// };

// export const requireRole = (...roles) => (req, res, next) => {
//   if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
//   next();
// };

// export const authenticateSocket = async (socket, next) => {
//   try {
//     const token = socket.handshake.auth?.token;
//     if (!token) return next(new Error('No token'));
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     socket.user = { id: decoded.userId, role: decoded.role };
//     next();
//   } catch {
//     next(new Error('Invalid token'));
//   }
// };



import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

/* ===============================
   HTTP AUTH (API REQUESTS)
================================ */

export const authenticate = async (req, res, next) => {

  try {

    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        availability: true,
        isOnline: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;

    next();

  } catch (err) {

    return res.status(401).json({ error: "Invalid token" });

  }

};


/* ===============================
   ROLE AUTH
================================ */

export const requireRole = (...roles) => (req, res, next) => {

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();

};


/* ===============================
   SOCKET AUTH
================================ */

export const authenticateSocket = async (socket, next) => {

  try {

    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("No token"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        role: true,
        name: true
      }
    });

    if (!user) {
      return next(new Error("User not found"));
    }

    socket.user = user;

    next();

  } catch (err) {

    next(new Error("Invalid token"));

  }

};