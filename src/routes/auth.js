import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { Availability } from "@prisma/client";
import { sendResetEmail } from '../lib/mailer.js';

const router = Router();


// GET CURRENT USER
router.get('/me', authenticate, async (req, res) => {

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      availability: true,
      isOnline: true,
      mustChangePassword: true,
      firstName: true,
      lastName: true,
      dob: true,
      gender: true,
      phone: true,
      aadhaarNum: true,
      panNum: true,
      bankName: true,
      branch: true,
      accountHolder: true,
      bankAccount: true,
      ifscCode: true,
      nomineeName: true,
      nomineePhone: true,
      userAuthId: true
    }
  });

  res.json(user);

});


// LOGIN
router.post('/login', async (req, res) => {
  try {

    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // mark online
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isOnline: true,
        availability: 'AVAILABLE',
        lastLoginAt: new Date(),
        lastActiveAt: new Date()
      }
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email,
        availability: 'AVAILABLE',
        mustChangePassword: user.mustChangePassword
      }
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// LOGOUT
router.post('/logout', authenticate, async (req, res) => {

  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      isOnline: false,
      availability: 'OFFLINE'
    }
  });

  res.json({ message: "Logout successfully" });

});

router.patch("/availability", authenticate, async (req, res) => {

  // console.log("BODY RECEIVED:", req.body)

  try {

    const availability = req.body?.availability

    if (!availability) {
      return res.status(400).json({
        error: "Availability missing"
      })
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { availability }
    })

    res.json(updatedUser)

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "Server error"
    })

  }

})

// FORGOT PASSWORD
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      // Don't leak if email exists or not, just return success
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }

    // Create a secure 15min JWT token containing the user's ID
    const resetToken = jwt.sign(
      { userId: user.id, action: 'RESET_PASSWORD' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const resetLink = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

    const sent = await sendResetEmail(user.email, resetLink);
    
    if (sent) {
      res.json({ message: 'If that email is registered, a reset link has been sent.' });
    } else {
      res.status(500).json({ error: 'Failed to send email. Check SMTP configuration.' });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// RESET PASSWORD
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (decoded.action !== 'RESET_PASSWORD') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        password: hashed,
        mustChangePassword: false
      }
    });

    res.json({ message: 'Password has been reset successfully.' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
