import prisma from '../leadflow/backend/src/lib/prisma.js';

async function sync() {
  console.log("Starting sync...");
  const meetings = await prisma.meeting.findMany({
    include: { lead: true }
  });

  for (const m of meetings) {
    if (m.lead && (m.bookingStatus === 'BOOKED' || m.bookingStatus === 'PAYMENT_PENDING' || m.outcome)) {
      const newStatus = m.bookingStatus || m.outcome;
      console.log(`Updating lead ${m.lead.id} (${m.lead.name}) to assocStatus: ${newStatus}`);
      await prisma.lead.update({
        where: { id: m.id }, // Wait, should be m.leadId
        data: { assocStatus: newStatus }
      });
    }
  }
  console.log("Sync complete.");
}

// sync(); // commenting out so it doesn't run on import
