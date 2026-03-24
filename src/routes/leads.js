import { Router } from "express";
import multer from "multer";
import prisma from "../lib/prisma.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { io } from "../index.js";
import XLSX from "xlsx";
const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/* =====================================================
   HELPER — LOAD BALANCED TELECALLER DISTRIBUTION
===================================================== */


async function getTelecallerForLead() {

  const MIN_ACTIVE_LEADS = 3
  const MAX_CAPACITY = 10

  const telecallers = await prisma.user.findMany({
    where: {
      role: "TELECALLER",
      isOnline: true
    },
    include: {
      _count: {
        select: { assignedLeads: true }
      }
    }
  })

  if (!telecallers.length) return null

  // remove full capacity
  const available = telecallers.filter(
    t => t._count.assignedLeads < MAX_CAPACITY
  )

  if (!available.length) return null

  /* =============================
     STEP 1 — MINIMUM LEADS FIRST
  ============================= */

  const belowMinimum = available.filter(
    t => t._count.assignedLeads < MIN_ACTIVE_LEADS
  )

  if (belowMinimum.length) {

    belowMinimum.sort(
      (a, b) => a._count.assignedLeads - b._count.assignedLeads
    )

    return belowMinimum[0].id
  }

  /* =============================
     STEP 2 — TOP PERFORMERS
  ============================= */

  const sortedByPerformance = available.sort(
    (a, b) => (b.performanceScore || 0) - (a.performanceScore || 0)
  )

  const topGroup = sortedByPerformance.slice(0, Math.ceil(sortedByPerformance.length * 0.3))

  topGroup.sort(
    (a, b) => a._count.assignedLeads - b._count.assignedLeads
  )

  return topGroup[0].id
}

/* =====================================================
   GET LEADS
===================================================== */

router.get("/", authenticate, async (req, res) => {

  try {

    const { status, search, today, from, to } = req.query;

    /* =====================================
       BOOKED / PAYMENT_PENDING
       (DATA COMES FROM MEETING TABLE)
    ====================================== */

    if (status === "BOOKED" || status === "PAYMENT_PENDING") {
      const meetWhere = { bookingStatus: status };

      // Role filter for meetings
      if (req.user.role === "TELECALLER") meetWhere.lead = { telecallerId: req.user.id };
      if (req.user.role === "ASSOCIATE") meetWhere.associateId = req.user.id;

      const meetings = await prisma.meeting.findMany({
        where: meetWhere,
        include: {
          lead: {
            include: {
              telecaller: { select: { id: true, name: true } },
              associate: { select: { id: true, name: true } }
            }
          }
        }
      });

      // Get unique leads
      const leadMap = new Map();
      meetings.forEach(m => {
        if (m.lead && !leadMap.has(m.lead.id)) {
          leadMap.set(m.lead.id, m.lead);
        }
      });
      const leads = Array.from(leadMap.values());

      await prisma.user.update({
        where: { id: req.user.id },
        data: { lastActiveAt: new Date() }
      });

      return res.json(leads);

    }

    /* =====================================
       NORMAL LEAD FILTER
    ====================================== */

    const where = {};

    /* ROLE FILTER */

    if (req.user.role === "TELECALLER")
      where.telecallerId = req.user.id;

    if (req.user.role === "ASSOCIATE")
      where.associateId = req.user.id;

    /* UNASSIGNED */

    if (status === "unassigned")
      where.telecallerId = null;

    /* STATUS FILTER */

    if (status && status !== "all") {

      if (["NEW", "HOT", "WARM", "COLD", "LATER"].includes(status)) {
        where.status = status;
      }

      if (status === "SITEVISIT") {
        where.assocStatus = "SITEVISIT";
      }

      if (status === "FOLLOWUP") {
        where.assocStatus = "FOLLOWUP";
      }

      if (status === "FOLLOWUPS") {
        where.OR = [
          { status: "LATER" },
          { assocStatus: "FOLLOWUP" }
        ];
      }
    }

    if (today === "true") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      where.updatedAt = { gte: startOfDay };
      // Generally "Done Today" means some action was taken, so excluding NEW leads
      where.status = { not: "NEW" };
    }

    /* SEARCH */

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } }
      ];
    }
    /* DATE FILTER */

    if (from || to) {

      where.createdAt = {};

      if (from) {
        where.createdAt.gte = new Date(from + "T00:00:00");
      }

      if (to) {
        where.createdAt.lte = new Date(to + "T23:59:59");
      }

    }

    /* FETCH LEADS */

    const leads = await prisma.lead.findMany({
      where,
      include: {
        telecaller: { select: { id: true, name: true } },
        associate: { select: { id: true, name: true } },
        meetings: true,
        callLogs: { select: { id: true, callbackAt: true } } // For reminder polling
      },
      orderBy: { updatedAt: "desc" }
    });

    res.json(leads);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   LEAD HISTORY
===================================================== */

router.get("/:id/history", authenticate, async (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        callLogs: {
          include: { telecaller: { select: { name: true } } },
          orderBy: { createdAt: "desc" }
        },
        meetings: {
          include: { associate: { select: { name: true } } },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    res.json({ calls: lead.callLogs, meetings: lead.meetings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   UPDATE LEAD (ADMIN)
===================================================== */

router.patch("/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { name, phone, email, location, source, sourceDetail, status, assocStatus } = req.body;
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        name,
        phone,
        email,
        location,
        source,
        sourceDetail,
        status,
        assocStatus,
      },
      include: {
        telecaller: { select: { id: true, name: true } },
        associate: { select: { id: true, name: true } },
      },
    });

    await prisma.activity.create({
      data: {
        userId: req.user.id,
        text: `Lead <strong>${lead.name}</strong> was updated by ${req.user.name}`,
        color: "#3b82f6",
      },
    });

    io.emit("lead:updated", lead);
    res.json(lead);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   DELETE LEAD (ADMIN)
===================================================== */

router.delete("/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const lead = await prisma.lead.delete({
      where: { id: req.params.id },
    });

    await prisma.activity.create({
      data: {
        userId: req.user.id,
        text: `Lead <strong>${lead.name}</strong> was deleted by ${req.user.name}`,
        color: "#ef4444",
      },
    });

    io.emit("lead:updated");
    res.json({ success: true, message: "Lead deleted successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   ASSIGN TELECALLER (ADMIN)
===================================================== */

router.patch(
  "/:id/assign",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {

    try {

      const { telecallerId, associateId } = req.body;

      const lead = await prisma.lead.update({
        where: { id: req.params.id },
        data: { 
          telecallerId: telecallerId !== undefined ? telecallerId : undefined,
          associateId: associateId !== undefined ? associateId : undefined,
          assignedById: req.user.id
        },
        include: {
          telecaller: true,
          associate: true
        }
      });

      let activityText = "";
      if (telecallerId !== undefined) {
        activityText = `${lead.name} reassigned to telecaller ${lead.telecaller?.name || "None"}`;
      } else if (associateId !== undefined) {
        activityText = `${lead.name} reassigned to associate ${lead.associate?.name || "None"}`;
      }

      if (activityText) {
        await prisma.activity.create({
          data: {
            userId: req.user.id,
            text: activityText
          }
        });
      }

      // Notify Telecaller (if not the one who made the change)
      if (telecallerId && String(telecallerId) !== String(req.user.id)) {
        io.to(String(telecallerId)).emit("notification", {
          title: "Lead Assigned",
          message: `${lead.name} has been assigned to you by ${req.user.name}`,
          leadId: lead.id,
          type: "lead_assigned"
        });
      }

      // Also notify Associate if one is already linked (if not the one who made the change)
      if (lead.associateId && String(lead.associateId) !== String(req.user.id)) {
        io.to(String(lead.associateId)).emit("notification", {
          title: "Lead Update",
          message: `Your active lead ${lead.name} was reassigned to a new telecaller: ${lead.telecaller?.name}`,
          leadId: lead.id,
          type: "associate_lead"
        });
      }

      io.emit("lead:updated");
      res.json(lead);

    } catch (e) {

      console.error(e);
      res.status(500).json({ error: "Server error" });

    }

  }
);


/* =====================================================
   TELECALLER CALL UPDATE
===================================================== */

router.patch(
  "/:id/call",
  authenticate,
  requireRole("TELECALLER"),
  async (req, res) => {

    try {

      const { status, notes, callbackAt } = req.body;

      let lead = await prisma.lead.update({
        where: { id: req.params.id },
        data: {
          status,
          notes,
          ...(status !== "HOT" && { associateId: null })
        },
        include: {
          telecaller: true,
          associate: true
        }
      });

      /* =========================
         AUTO ASSIGN ASSOCIATE
      ========================= */

      if (status === "HOT" && !lead.associateId) {

        const associates = await prisma.user.findMany({
          where: {
            role: "ASSOCIATE",
            availability: "AVAILABLE",
            isOnline: true
          },
          include: {
            _count: {
              select: { associateLeads: true }
            }
          }
        });

        if (!associates.length) {

          await prisma.activity.create({
            data: {
              userId: req.user.id,
              text: `${lead.name} marked HOT but no associate online`
            }
          });

        } else {

          const MIN_ASSOCIATE_LEADS = 2;
          const MAX_ASSOCIATE_CAPACITY = 10;

          const available = associates.filter(
            a => a._count.associateLeads < MAX_ASSOCIATE_CAPACITY
          );

          if (available.length) {

            let selected;

            const belowMinimum = available.filter(
              a => a._count.associateLeads < MIN_ASSOCIATE_LEADS
            );

            if (belowMinimum.length) {

              belowMinimum.sort(
                (a, b) => a._count.associateLeads - b._count.associateLeads
              );

              selected = belowMinimum[0];

            } else {

              const sorted = available.sort(
                (a, b) => (b.performanceScore || 0) - (a.performanceScore || 0)
              );

              const topBucket = sorted.slice(0, Math.ceil(sorted.length * 0.3));
              const midBucket = sorted.slice(
                Math.ceil(sorted.length * 0.3),
                Math.ceil(sorted.length * 0.7)
              );
              const lowBucket = sorted.slice(Math.ceil(sorted.length * 0.7));

              const r = Math.random();

              let pool;

              if (r < 0.5) pool = topBucket;
              else if (r < 0.8) pool = midBucket;
              else pool = lowBucket;

              if (!pool.length) pool = available;

              pool.sort(
                (a, b) => a._count.associateLeads - b._count.associateLeads
              );

              selected = pool[0];

            }

            if (selected) {

              lead = await prisma.lead.update({
                where: { id: req.params.id },
                data: { associateId: selected.id },
                include: {
                  associate: { select: { id: true, name: true } },
                  telecaller: true
                }
              });

              await prisma.activity.create({
                data: {
                  userId: req.user.id,
                  text: `${lead.name} transferred to associate ${selected.name}`
                }
              });

              if (String(selected.id) !== String(req.user.id)) {
                io.to(String(selected.id)).emit("notification", {
                  title: "New Hot Lead",
                  message: `${lead.name} assigned to you by Telecaller ${req.user.name}`,
                  leadId: lead.id,
                  type: "associate_lead"
                });
              }

              // Also update telecaller with a clean confirmation (if they are not the same person)
              if (String(req.user.id) !== String(req.user.id)) { // This is always false, but following the pattern. 
                // Actually, telecaller *should* see the success message for their own action? 
                // The user specifically asked "y telecaller itself getting the notification". 
                // They probably mean the "Status Update" one, but let's be safe.
              }
              // Let's keep the assignment success for the TC because it's feedback for their action.
              // Wait, the user's screenshot showing Priya Sharma (TC) gets "Lead Status Update: sri marked HOT by Priya Sharma".
              // That's what they want to stop.

              // This one below is a feedback message, maybe keep it? Or skip if it's annoying.
              // I'll skip it to be safe and let the UI handle success states.
              /*
              io.to(String(req.user.id)).emit("notification", {
                title: "Lead Assigned",
                message: `Lead ${lead.name} auto-assigned to associate ${selected.name}`,
                leadId: lead.id,
                type: "assignment_success"
              });
              */
            }

          }

        }

      }

      /* =========================
         SAVE CALL HISTORY
      ========================= */

      await prisma.callLog.create({
        data: {
          leadId: req.params.id,
          telecallerId: req.user.id,
          status,
          notes,
          callbackAt: callbackAt ? new Date(callbackAt) : null
        }
      });

      /* =========================
         COLD LEAD ALERT (5x CONSECUTIVE)
      ========================= */

      if (status === "COLD") {

        const lastLogs = await prisma.callLog.findMany({
          where: { leadId: req.params.id },
          orderBy: { createdAt: "desc" },
          take: 5
        });

        if (lastLogs.length >= 5 && lastLogs.every(l => l.status === "COLD")) {

          const admins = await prisma.user.findMany({
            where: { role: "ADMIN" },
            select: { id: true }
          });

          const alertText = `REASSIGN LEAD: <strong>${lead.name}</strong> has been marked COLD <strong>5 times consecutively</strong> by ${req.user.name}.`;

          for (const admin of admins) {

            await prisma.activity.create({
              data: {
                userId: admin.id,
                text: alertText,
                color: "#ff4444"
              }
            });

            if (String(admin.id) !== String(req.user.id)) {
              io.to(String(admin.id)).emit("notification", {
                title: "Lead Alert",
                message: alertText,
                leadId: lead.id,
                type: "cold_warning"
              });
            }

          }

        }

      }

      /* =========================
         STATUS UPDATE NOTIFICATIONS
      ========================= */

      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true }
      });

      for (const admin of admins) {

        if (admin.id !== req.user.id) {

          await prisma.activity.create({
            data: {
              userId: admin.id,
              text: `${lead.name} → ${status} by ${req.user.name}`
            }
          });

          if (String(admin.id) !== String(req.user.id)) {
            io.to(String(admin.id)).emit("notification", {
              title: "Lead Status Update",
              message: `${lead.name} marked ${status} by ${req.user.name}`,
              leadId: lead.id,
              type: "lead_status"
            });
          }

        }

      }

      io.emit("lead:updated");

      await prisma.user.update({
        where: { id: req.user.id },
        data: { lastActiveAt: new Date() }
      });

      res.json(lead);

    } catch (e) {

      console.error(e);
      res.status(500).json({ error: "Server error" });

    }

  }
);
/* =====================================================
   CREATE LEAD
===================================================== */
router.post(
  "/",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {

    try {

      const {
        name,
        phone,
        email,
        location,
        source,
        sourceDetail
      } = req.body;

      if (!name || !phone) {
        return res.status(400).json({
          error: "Name and phone are required"
        });
      }

      /* Duplicate check */

      const existing = await prisma.lead.findFirst({
        where: { phone }
      });

      if (existing) {
        return res.status(400).json({
          error: "Lead with this phone already exists"
        });
      }

      /* Get least-loaded telecaller */

      const telecallers = await prisma.user.findMany({
        where: {
          role: "TELECALLER",
          // availability: "AVAILABLE",
          isOnline: true
        },
        include: {
          _count: {
            select: { assignedLeads: true }
          }
        }
      });

      if (!telecallers.length) {
        return res.status(400).json({
          error: "No telecaller available"
        });
      }

      telecallers.sort(
        (a, b) =>
          a._count.assignedLeads - b._count.assignedLeads
      );

      const selected = telecallers[0];

      /* Create lead */

      const lead = await prisma.lead.create({
        data: {
          name,
          phone,
          email,
          location,
          source,
          sourceDetail,
          telecallerId: selected.id,
          assignedById: req.user.id
        }
      });

      io.to(String(selected.id)).emit("notification", {
        title: "New Lead Assigned",
        message: `${lead.name} assigned by ${req.user.name}`,
        leadId: lead.id,
        type: "lead_assigned"
      });
      io.emit("lead:updated");

      res.json(lead);

    } catch (e) {

      console.error(e);
      res.status(500).json({ error: "Server error" });

    }

  }
);
/* =====================================================
   BULK CREATE LEADS (AUTO DISTRIBUTION)
===================================================== */

router.post(
  "/bulk",
  authenticate,
  requireRole("ADMIN"),
  upload.single("file"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      /* ===============================
         READ EXCEL / CSV
      =============================== */

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet);

      if (!rows.length) {
        return res.status(400).json({ error: "File is empty" });
      }

      /* ===============================
         LOAD TELECALLERS ONCE
      =============================== */

      const telecallers = await prisma.user.findMany({
        where: {
          role: "TELECALLER",
          // availability: "AVAILABLE",
          isOnline: true
        },
        include: {
          _count: {
            select: { assignedLeads: true }
          }
        }
      });

      if (!telecallers.length) {
        return res.status(400).json({
          error: "No available telecallers online"
        });
      }

      const created = [];
      let skipped = 0;

      /* ===============================
         PROCESS ROWS
      =============================== */

      for (const row of rows) {

        const name = String(row.name || "").trim();
        const phone = String(row.phone || "").trim();

        let source = (row.source || "OTHER")
          .toString()
          .toUpperCase();

        const allowedSources = [
          "WEBSITE",
          "SOCIAL_MEDIA",
          "REFERRAL",
          "WALK_IN",
          "OTHER"
        ];

        if (!allowedSources.includes(source)) {
          source = "OTHER";
        }

        if (!name || !phone) continue;

        /* ===============================
           DUPLICATE CHECK
        =============================== */

        const existing = await prisma.lead.findFirst({
          where: { phone }
        });

        if (existing) {
          skipped++;
          continue;
        }

        /* ===============================
           LEAST LOADED TELECALLER
        =============================== */

        telecallers.sort(
          (a, b) =>
            a._count.assignedLeads - b._count.assignedLeads
        );

        const selected = telecallers[0];

        /* ===============================
           CREATE LEAD
        =============================== */

        const lead = await prisma.lead.create({
          data: {
            name,
            phone,
            source,
            telecallerId: selected.id,
            assignedById: req.user.id
          }
        });

        created.push(lead);

        /* ===============================
           UPDATE LOCAL COUNT
        =============================== */

        selected._count.assignedLeads++;

        /* ===============================
           SOCKET UPDATE
        =============================== */

        io.to(String(selected.id)).emit("notification", {
          title: "New Lead Assigned",
          message: `${lead.name} assigned by ${req.user.name}`,
          leadId: lead.id,
          type: "lead_assigned"
        });
      }

      io.emit("lead:updated");

      /* ===============================
         RESPONSE
      =============================== */

      res.json({
        message: "Leads uploaded and distributed successfully",
        created: created.length,
        skipped
      });

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error: "Upload failed"
      });

    }

  }
);
/* =====================================================
   HISTORY
===================================================== */

router.get("/:id/history", authenticate, async (req, res) => {

  try {

    const leadId = req.params.id;


    const calls = await prisma.callLog.findMany({
      where: { leadId },
      include: {
        telecaller: {
          select: { name: true }
        },
        lead: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const meetings = await prisma.meeting.findMany({
      where: { leadId },
      include: {
        lead: {
          select: { name: true }
        },
        associate: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json({
      calls,
      meetings
    });

  } catch (e) {

    console.error(e);
    res.status(500).json({ error: "Server error" });

  }

});
router.post("/:id/meeting", authenticate, async (req, res) => {

  try {

    const {
      outcome,
      meetingDate,
      notes,
      interested,
      bookingStatus,
      followUpDate,
      followUpTime
    } = req.body;

    // ✅ FIX: fetch lead FIRST so `lead.name` is available below
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id }
    });

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const meeting = await prisma.meeting.create({
      data: {
        leadId: req.params.id,
        associateId: req.user.id,
        outcome,
        meetingDate: meetingDate ? new Date(meetingDate) : null,
        notes,
        interested,
        bookingStatus,
        followUpDate: followUpDate
          ? new Date(`${followUpDate}T${followUpTime}`)
          : null
      }
    });

    const leadUpdate = {
      assocStatus: bookingStatus === "BOOKED" || bookingStatus === "PAYMENT_PENDING"
        ? bookingStatus
        : (followUpDate ? "FOLLOWUP" : outcome),
      updatedAt: new Date()
    };

    await prisma.lead.update({
      where: { id: req.params.id },
      data: leadUpdate
    });

    // Notify all admins
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true }
    });

    for (const admin of admins) {
      if (String(admin.id) !== String(req.user.id)) {

        await prisma.activity.create({
          data: {
            userId: admin.id,
            text: `Meeting: <strong>${lead.name}</strong> → ${bookingStatus || outcome} by ${req.user.name}`,
            color: "#f59e0b"
          }
        });

        io.to(String(admin.id)).emit("notification", {
          title: "Associate Lead Update",
          message: `${lead.name} updated to ${bookingStatus || outcome} by ${req.user.name}`,
          leadId: req.params.id,
          type: "associate_update"
        });
      }
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { lastActiveAt: new Date() }
    });

    io.emit("lead:updated");

    res.json(meeting);

  } catch (e) {

    console.error(e);
    res.status(500).json({ error: "Server error" });

  }

});
export default router;