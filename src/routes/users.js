import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { parse } from "csv-parse/sync";
import { authenticate, requireRole } from '../middleware/auth.js';
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// GET /api/users
// router.get('/', authenticate, async (req, res) => {
//   try {

//     const users = await prisma.user.findMany({
//       select: {
//         id: true,
//         name: true,
//         email: true,
//         role: true,
//         phone: true,
//         availability: true,
//         isOnline: true,
//         lastLoginAt: true,
//         lastActiveAt: true
//       },
//       orderBy: { name: 'asc' }
//     });

//     const now = new Date();

//     const updatedUsers = users.map(u => {

//       if (!u.lastActiveAt) {
//         return {
//           ...u,
//           availability: 'OFFLINE',
//           isOnline: false
//         };
//       }

//       const diffMinutes =
//         (now - new Date(u.lastActiveAt)) / 1000 / 60;

//       if (diffMinutes < 5) {
//         return {
//           ...u,
//           availability: 'AVAILABLE',
//           isOnline: true
//         };
//       }

//       if (diffMinutes < 20) {
//         return {
//           ...u,
//           availability: 'AWAY',
//           isOnline: true
//         };
//       }

//       return {
//         ...u,
//         availability: 'OFFLINE',
//         isOnline: false
//       };
//     });

//     const enriched = await Promise.all(
//       updatedUsers.map(async u => ({
//         ...u,
//         leadCount: await prisma.lead.count({
//           where:
//             u.role === 'TELECALLER'
//               ? { telecallerId: u.id }
//               : { associateId: u.id }
//         })
//       }))
//     );

//     res.json(enriched);

//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: 'Server error' });
//   }
// });
router.get('/', authenticate, async (req, res) => {

  try {

    const users = await prisma.user.findMany({

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        availability: true,
        isOnline: true,
        lastActiveAt: true
      },

      orderBy: { name: 'asc' }

    });

    const now = new Date();

    const updatedUsers = users.map(u => {

      if (!u.lastActiveAt) {

        return {
          ...u,
          availability: "OFFLINE",
          isOnline: false
        };

      }

      const diffMinutes =
        (now - new Date(u.lastActiveAt)) / 1000 / 60;

      // if (diffMinutes < 5) {

      //   return {
      //     ...u,
      //     availability: "AVAILABLE",
      //     isOnline: true
      //   };

      // }

      // if (diffMinutes < 20) {

      //   return {
      //     ...u,
      //     availability: "AWAY",
      //     isOnline: true
      //   };

      // }

      // return {
      //   ...u,
      //   availability: "OFFLINE",
      //   isOnline: false
      // };
      if (diffMinutes > 180) {
        return {
          ...u,
          isOnline: false
        };
      }

      return u;
    });

    const enriched = await Promise.all(

      updatedUsers.map(async u => ({

        ...u,

        leadCount: await prisma.lead.count({

          where:
            u.role === "TELECALLER"
              ? { telecallerId: u.id }
              : { associateId: u.id }

        })

      }))

    );

    res.json(enriched);

  } catch (e) {

    console.error(e);
    res.status(500).json({ error: "Server error" });

  }

});

// GET /api/users/attendance
router.get('/attendance', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    
    // Default to today if no date provided
    const targetDate = date ? new Date(date) : new Date();
    
    // Start and end of the target day
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastLoginAt: true,
        lastActiveAt: true
      },
      orderBy: { name: 'asc' }
    });

    // To determine presence for a specific day, we check if they had activities or if their lastActiveAt/lastLoginAt falls in that day.
    const enrichedUsers = await Promise.all(
      users.map(async u => {
        // If targetDate is today, we can use lastActiveAt/lastLoginAt for a quick check.
        // For accurate logging historically, we check the Activity table for any actions they did on that target day.
        
        const [activityCount, callCount, meetingCount] = await Promise.all([
          prisma.activity.count({
            where: { userId: u.id, createdAt: { gte: startOfDay, lte: endOfDay } }
          }),
          prisma.callLog.count({
            where: { telecallerId: u.id, createdAt: { gte: startOfDay, lte: endOfDay } }
          }),
          prisma.meeting.count({
            where: { associateId: u.id, createdAt: { gte: startOfDay, lte: endOfDay } }
          })
        ]);
        
        const loggedInOrActiveThatDay = 
          (u.lastLoginAt && new Date(u.lastLoginAt) >= startOfDay && new Date(u.lastLoginAt) <= endOfDay) ||
          (u.lastActiveAt && new Date(u.lastActiveAt) >= startOfDay && new Date(u.lastActiveAt) <= endOfDay);

        const isPresent = activityCount > 0 || callCount > 0 || meetingCount > 0 || loggedInOrActiveThatDay;

        return {
          ...u,
          isPresent
        };
      })
    );

    res.json(enrichedUsers);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/users/:id/leads (ADMIN)
router.get('/:id/leads', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const userId = req.params.id;

    // First find the user to know their role
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    let where = {};
    if (targetUser.role === 'ADMIN') {
      where = { assignedById: userId };
    } else {
      where = {
        OR: [
          { telecallerId: userId },
          { associateId: userId }
        ]
      };
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from + "T00:00:00");
      if (to) where.createdAt.lte = new Date(to + "T23:59:59");
    }

    const leads = await prisma.lead.findMany({
      where,
      include: {
        telecaller: { select: { name: true } },
        associate: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(leads);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// CREATE USER
router.post('/', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {

    const { name, email, role, phone } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }

    if (!['TELECALLER', 'ASSOCIATE'].includes(role.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const exists = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (exists) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashed = await bcrypt.hash(req.body.password || "Realgo123", 10);

    const user = await prisma.user.create({
      data: {
        name,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        dob: req.body.dob ? new Date(req.body.dob) : null,
        gender: req.body.gender,
        email: email.toLowerCase(),
        password: hashed,
        role: role.toUpperCase(),
        phone,
        aadhaarNum: req.body.aadhaarNum,
        panNum: req.body.panNum,
        bankName: req.body.bankName,
        branch: req.body.branch,
        accountHolder: req.body.accountHolder,
        bankAccount: req.body.bankAccount,
        ifscCode: req.body.ifscCode,
        nomineeName: req.body.nomineeName,
        nomineePhone: req.body.nomineePhone,
        userAuthId: req.body.userAuthId || ('AUTH' + Math.floor(100000 + Math.random() * 900000).toString()),
        mustChangePassword: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        availability: true,
        isOnline: true
      }
    });

    res.status(201).json(user);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// DELETE USER
router.delete('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {

    await prisma.user.delete({
      where: { id: req.params.id }
    });

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// UPDATE USER (ADMIN)
router.patch('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, email, phone, role, password } = req.body;
    const data = {
      name,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      dob: req.body.dob ? new Date(req.body.dob) : undefined,
      gender: req.body.gender,
      email: email?.toLowerCase(),
      phone,
      role: role?.toUpperCase(),
      aadhaarNum: req.body.aadhaarNum,
      panNum: req.body.panNum,
      bankName: req.body.bankName,
      branch: req.body.branch,
      accountHolder: req.body.accountHolder,
      bankAccount: req.body.bankAccount,
      ifscCode: req.body.ifscCode,
      nomineeName: req.body.nomineeName,
      nomineePhone: req.body.nomineePhone,
      userAuthId: req.body.userAuthId,
    };

    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        availability: true,
        isOnline: true,
      },
    });

    res.json(user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// ACTIVITIES
router.get('/activities', authenticate, async (req, res) => {
  try {

    // 24h Auto Cleanup
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    await prisma.activity.deleteMany({
      where: { createdAt: { lt: twentyFourHoursAgo } }
    });

    const where =
      req.user.role === 'ADMIN'
        ? { createdAt: { gte: twentyFourHoursAgo } }
        : { userId: req.user.id, createdAt: { gte: twentyFourHoursAgo } };

    const acts = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        user: { select: { name: true } }
      }
    });

    res.json(acts);

  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// CLEAR ACTIVITIES
router.delete('/activities/clear', authenticate, async (req, res) => {
  try {
    const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
    await prisma.activity.deleteMany({ where });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// ASSOCIATE MEETINGS
router.get('/meetings', authenticate, requireRole('ASSOCIATE'), async (req, res) => {
  try {

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const meets = await prisma.meeting.findMany({
      where: { 
        associateId: req.user.id,
        createdAt: { gte: startOfToday }
      },
      include: {
        lead: {
          select: {
            name: true,
            phone: true,
            location: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(meets);

  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});
router.post(
  "/upload",
  authenticate,
  requireRole("ADMIN"),
  upload.single("file"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({ error: "CSV file required" });
      }

      const rows = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true
      });

      for (const r of rows) {

        const hashed = await bcrypt.hash(r.password || "Realgo123", 10);

        await prisma.user.create({
          data: {
            name: r.name || `${r.firstName} ${r.lastName}`,
            firstName: r.firstName,
            lastName: r.lastName,
            dob: r.dob ? new Date(r.dob) : null,
            gender: r.gender,
            email: r.email.toLowerCase(),
            phone: r.phone,
            password: hashed,
            role: r.role.toUpperCase(),
            aadhaarNum: r.aadhaarNum,
            panNum: r.panNum,
            bankName: r.bankName,
            branch: r.branch,
            accountHolder: r.accountHolder,
            bankAccount: r.bankAccount,
            ifscCode: r.ifscCode,
            nomineeName: r.nomineeName,
            nomineePhone: r.nomineePhone,
            userAuthId: r.userAuthId || ('AUTH' + Math.floor(100000 + Math.random() * 900000).toString()),
            mustChangePassword: true
          }
        });

      }

      res.json({ success: true });

    } catch (e) {

      console.error(e);
      res.status(500).json({ error: "Upload failed" });

    }

  }
);

router.patch("/:id/password", authenticate, async (req, res) => {

  const { password } = req.body

  const hashed = await bcrypt.hash(password, 10)

  await prisma.user.update({
    where: { id: req.params.id },
    data: { 
      password: hashed,
      mustChangePassword: false
    }
  })

  res.json({ message: "Password updated successfully" })

})
router.get("/sample-csv", authenticate, requireRole("ADMIN"), (req, res) => {

  const csv =
    `name,firstName,lastName,dob,gender,email,phone,password,role,aadhaarNum,panNum,bankName,bankAccount,ifscCode,nomineeName,nomineePhone,userAuthId
Ravi,Ravi,Kumar,1990-01-01,Male,ravi@gmail.com,9876543210,Realgo123,TELECALLER,123456789012,ABCDE1234F,SBI,1234567890,SBIN0001234,Sumit,9876543210,AUTH001`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=users_sample.csv");

  res.send(csv);

});


router.patch("/availability", authenticate, async (req, res) => {

  try {

    const { availability } = req.body;

    const allowed = ["AVAILABLE", "LUNCH", "BREAK", "MEETING"];

    if (!allowed.includes(availability)) {
      return res.status(400).json({ error: "Invalid availability status" });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        availability,
        lastActiveAt: new Date()
      }
    });

    res.json(user);

  } catch (e) {

    console.error(e);
    res.status(500).json({ error: "Server error" });

  }

});
export default router;