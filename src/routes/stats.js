import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()

/* =========================================
DASHBOARD STATS
========================================= */

router.get('/dashboard', authenticate, async (req, res) => {

  try {

    const [
      total,
      hot,
      warm,
      cold,
      newL,
      later,
      unassigned,
      sitevisits,
      booked,
      paymentPending,
      followups
    ] = await Promise.all([

      prisma.lead.count(),

      prisma.lead.count({ where: { status: 'HOT' } }),

      prisma.lead.count({ where: { status: 'WARM' } }),

      prisma.lead.count({ where: { status: 'COLD' } }),

      prisma.lead.count({ where: { status: 'NEW' } }),

      prisma.lead.count({ where: { status: 'LATER' } }),
      prisma.lead.count({ where: { telecallerId: null } }),
      prisma.lead.count({ where: { assocStatus: 'SITEVISIT' } }),
      prisma.meeting.count({
        where: {
          bookingStatus: "BOOKED"
        }
      }),
      prisma.meeting.count({
        where: {
          bookingStatus: "PAYMENT_PENDING"
        }
      }),
      prisma.meeting.count({
        where: {
          outcome: "FOLLOWUP"
        }
      })
    ])

    // Top 10 Telecallers (by Hot/Warm leads)
    const topTelecallers = await prisma.user.findMany({
      where: { role: 'TELECALLER' },
      select: {
        id: true,
        name: true,
        assignedLeads: {
          where: { status: { in: ['HOT', 'WARM'] } }
        }
      }
    });

    const tcPerformance = topTelecallers.map(u => ({
      id: u.id,
      name: u.name,
      score: u.assignedLeads.length
    })).sort((a, b) => b.score - a.score);

    // Top 10 Associates (by Bookings)
    const topAssociates = await prisma.user.findMany({
      where: { role: 'ASSOCIATE' },
      select: {
        id: true,
        name: true,
        associateLeads: {
          where: { assocStatus: 'BOOKED' }
        }
      }
    });

    const assocPerformance = topAssociates.map(u => ({
      id: u.id,
      name: u.name,
      score: u.associateLeads.length
    })).sort((a, b) => b.score - a.score);

    res.json({
      total,
      hot,
      warm,
      cold,
      new: newL,
      later,
      unassigned,
      sitevisits,
      booked,
      paymentPending,
      followups,
      totalFollowups: later + followups,
      rankings: {
        telecallers: {
          top10: tcPerformance.slice(0, 10),
          bottom10: tcPerformance.slice(-10).reverse()
        },
        associates: {
          top10: assocPerformance.slice(0, 10),
          bottom10: assocPerformance.slice(-10).reverse()
        }
      }
    })

  } catch (e) {

    console.error(e)

    res.status(500).json({ error: 'Server error' })

  }

})

router.get('/today-calls', authenticate, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const where = {
      updatedAt: { gte: startOfDay },
      status: { not: "NEW" }
    };

    if (req.user.role === 'TELECALLER') where.telecallerId = req.user.id;
    if (req.user.role === 'ASSOCIATE') where.associateId = req.user.id;

    const count = await prisma.lead.count({ where });
    res.json({ count });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
})

/* =========================================
PERFORMANCE PAGE
========================================= */

router.get('/performance', authenticate, async (req, res) => {

  try {

    const { from, to } = req.query

    const dateFilter = {}

    if (from) dateFilter.gte = new Date(from)

    if (to) dateFilter.lte = new Date(to + "T23:59:59")

    const where =
      Object.keys(dateFilter).length
        ? { updatedAt: dateFilter }
        : {}

    const user = req.user

    /* ADMIN → ALL USERS */

    if (user.role === "ADMIN") {

      const tcs = await prisma.user.findMany({
        where: { role: 'TELECALLER' },
        select: { id: true, name: true }
      })

      const ases = await prisma.user.findMany({
        where: { role: 'ASSOCIATE' },
        select: { id: true, name: true }
      })

      const tcPerf = await Promise.all(
        tcs.map(async tc => {

          const base = { ...where, telecallerId: tc.id }

          const [total, hot, warm, cold] = await Promise.all([

            prisma.lead.count({ where: base }),

            prisma.lead.count({ where: { ...base, status: 'HOT' } }),

            prisma.lead.count({ where: { ...base, status: 'WARM' } }),

            prisma.lead.count({ where: { ...base, status: 'COLD' } }),

          ])

          return {
            ...tc,
            total,
            hot,
            warm,
            cold,
            hotRate: total ? ((hot / total) * 100).toFixed(2) : '0'
          }

        })
      )

      const asPerf = await Promise.all(
        ases.map(async a => {

          const base = { ...where, associateId: a.id }

          const [total, sv, interested] = await Promise.all([

            prisma.lead.count({ where: base }),

            prisma.lead.count({
              where: { ...base, assocStatus: 'SITEVISIT' }
            }),

            prisma.lead.count({
              where: { ...base, assocStatus: 'INTERESTED' }
            })

          ])

          return {
            ...a,
            total,
            sitevisits: sv,
            interested,
            svRate: total ? ((sv / total) * 100).toFixed(2) : '0'
          }

        })
      )

      return res.json({
        telecallers: tcPerf,
        associates: asPerf
      })

    }

    /* TELECALLER PERFORMANCE */

    if (user.role === "TELECALLER") {

      const base = { ...where, telecallerId: user.id }

      const [total, hot, warm, cold] = await Promise.all([

        prisma.lead.count({ where: base }),

        prisma.lead.count({ where: { ...base, status: 'HOT' } }),

        prisma.lead.count({ where: { ...base, status: 'WARM' } }),

        prisma.lead.count({ where: { ...base, status: 'COLD' } }),

      ])

      return res.json({

        telecallers: [{
          id: user.id,
          name: user.name,
          total,
          hot,
          warm,
          cold,
          hotRate: total ? ((hot / total) * 100).toFixed(1) : '0'
        }],

        associates: []

      })

    }

    /* ASSOCIATE PERFORMANCE */

    if (user.role === "ASSOCIATE") {

      const base = { ...where, associateId: user.id }

      const [total, sv, interested] = await Promise.all([

        prisma.lead.count({ where: base }),

        prisma.lead.count({
          where: { ...base, assocStatus: 'SITEVISIT' }
        }),

        prisma.lead.count({
          where: { ...base, assocStatus: 'INTERESTED' }
        })

      ])

      return res.json({

        telecallers: [],

        associates: [{
          id: user.id,
          name: user.name,
          total,
          sitevisits: sv,
          interested,
          svRate: total ? ((sv / total) * 100).toFixed(1) : '0'
        }]

      })

    }

  } catch (e) {

    console.error(e)

    res.status(500).json({ error: 'Server error' })

  }

})

/* =========================================
LEADERBOARD
========================================= */

router.get('/leaderboard', authenticate, async (req, res) => {

  try {

    const telecallers = await prisma.user.findMany({

      where: { role: 'TELECALLER' },

      select: { id: true, name: true }

    })

    const perf = await Promise.all(

      telecallers.map(async tc => {

        const hot = await prisma.lead.count({

          where: {
            telecallerId: tc.id,
            status: 'HOT'
          }

        })

        return {
          id: tc.id,
          name: tc.name,
          hot
        }

      })

    )

    const leaderboard = perf
      .sort((a, b) => b.hot - a.hot)
      .slice(0, 5)

    res.json(leaderboard)

  } catch (e) {

    res.status(500).json({ error: "Server error" })

  }

})


router.get("/insights", authenticate, requireRole("ADMIN"), async (req, res) => {

  try {

    const today = new Date()
    const weekStart = new Date()
    weekStart.setDate(today.getDate() - 7)

    /* TOP TELECALLER */

    const telecallers = await prisma.user.findMany({
      where: { role: "TELECALLER" },
      select: { id: true, name: true }
    })

    const tcStats = await Promise.all(
      telecallers.map(async tc => {

        const hot = await prisma.lead.count({
          where: {
            telecallerId: tc.id,
            status: "HOT"
          }
        })

        return { ...tc, hot }

      })
    )

    const topTC =
      tcStats.sort((a, b) => b.hot - a.hot)[0]


    /* BEST ASSOCIATE */

    const associates = await prisma.user.findMany({
      where: { role: "ASSOCIATE" },
      select: { id: true, name: true }
    })

    const asStats = await Promise.all(
      associates.map(async a => {

        const total = await prisma.lead.count({
          where: { associateId: a.id }
        })

        const sv = await prisma.lead.count({
          where: {
            associateId: a.id,
            assocStatus: "SITEVISIT"
          }
        })

        const rate = total ? (sv / total) * 100 : 0

        return { ...a, rate }

      })
    )

    const bestAssociate =
      asStats.sort((a, b) => b.rate - a.rate)[0]


    /* WEEKLY GROWTH */

    const lastWeekLeads = await prisma.lead.count({
      where: { createdAt: { gte: weekStart } }
    })

    const prevWeek = new Date()
    prevWeek.setDate(today.getDate() - 14)

    const previousLeads = await prisma.lead.count({
      where: {
        createdAt: {
          gte: prevWeek,
          lt: weekStart
        }
      }
    })

    const growth =
      previousLeads
        ? (((lastWeekLeads - previousLeads) / previousLeads) * 100).toFixed(2)
        : 0


    /* UNCONTACTED 24 HOURS */

    const yesterday = new Date()
    yesterday.setHours(yesterday.getHours() - 24)

    const uncontacted = await prisma.lead.count({
      where: {
        status: "NEW",
        createdAt: { lt: yesterday }
      }
    })


    res.json({
      topTelecaller: topTC,
      bestAssociate,
      weeklyGrowth: growth,
      uncontacted
    })

  }

  catch (e) {

    console.error(e)
    res.status(500).json({ error: "Server error" })

  }

})
export default router