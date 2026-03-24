import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing
  await prisma.activity.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.callLog.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.user.deleteMany();

  const hash = (p) => bcrypt.hashSync(p, 10);

  // Create users
  const admin = await prisma.user.create({ data: { name: 'Admin User', email: 'admin@leadflow.com', password: hash('admin123'), role: 'ADMIN' } });
  const tc1   = await prisma.user.create({ data: { name: 'Ravi Kumar',   email: 'ravi@leadflow.com',   password: hash('ravi123'),   role: 'TELECALLER', phone: '9876543210' } });
  const tc2   = await prisma.user.create({ data: { name: 'Priya Sharma', email: 'priya@leadflow.com',  password: hash('priya123'),  role: 'TELECALLER', phone: '9876543211' } });
  const tc3   = await prisma.user.create({ data: { name: 'Arjun Nair',   email: 'arjun@leadflow.com',  password: hash('arjun123'),  role: 'TELECALLER', phone: '9876543212' } });
  const as1   = await prisma.user.create({ data: { name: 'Deepak Reddy', email: 'deepak@leadflow.com', password: hash('deepak123'), role: 'ASSOCIATE',  phone: '9876543220' } });
  const as2   = await prisma.user.create({ data: { name: 'Sneha Patel',  email: 'sneha@leadflow.com',  password: hash('sneha123'),  role: 'ASSOCIATE',  phone: '9876543221' } });

  // Demo leads
  const demoLeads = [
    { name:'Amit Sharma',  phone:'9876500001', email:'amit@gmail.com',   source:'WEBSITE',      sourceDetail:'99Acres',          location:'Hyderabad',    status:'HOT',  telecallerId:tc1.id, associateId:as1.id },
    { name:'Sunita Reddy', phone:'9876500002', email:'sunita@gmail.com', source:'SOCIAL_MEDIA', sourceDetail:'Facebook',         location:'Secunderabad', status:'WARM', telecallerId:tc1.id },
    { name:'Vijay Patel',  phone:'9876500003', email:'vijay@gmail.com',  source:'WEBSITE',      sourceDetail:'MagicBricks',      location:'Gachibowli',   status:'NEW',  telecallerId:tc2.id },
    { name:'Kavitha Nair', phone:'9876500004', email:'kavitha@gmail.com',source:'REFERRAL',     sourceDetail:'Client Referral',  location:'Madhapur',     status:'COLD', telecallerId:tc2.id },
    { name:'Rajesh Gupta', phone:'9876500005', email:'rajesh@gmail.com', source:'SOCIAL_MEDIA', sourceDetail:'Instagram',        location:'Kondapur',     status:'LATER',telecallerId:tc1.id },
    { name:'Pooja Mishra', phone:'9876500006', email:'pooja@gmail.com',  source:'WALK_IN',      sourceDetail:'Office Walk-in',   location:'Banjara Hills',status:'NEW' },
    { name:'Suresh Babu',  phone:'9876500007', email:'suresh@gmail.com', source:'WEBSITE',      sourceDetail:'Housing.com',      location:'Hyderabad',    status:'HOT',  telecallerId:tc2.id, associateId:as2.id },
    { name:'Anjali Singh', phone:'9876500008', email:'anjali@gmail.com', source:'SOCIAL_MEDIA', sourceDetail:'LinkedIn',         location:'Secunderabad', status:'WARM', telecallerId:tc3.id },
  ];

  for (const lead of demoLeads) {
    await prisma.lead.create({ data: lead });
  }

  await prisma.activity.create({ data: { text: 'System initialized — LeadFlow CRM ready', color: '#3b82f6' } });

  console.log('✅ Seed complete!');
  console.log('\n📋 Login Credentials:');
  console.log('  Admin:      admin@leadflow.com   / admin123');
  console.log('  Telecaller: ravi@leadflow.com    / ravi123');
  console.log('  Telecaller: priya@leadflow.com   / priya123');
  console.log('  Telecaller: arjun@leadflow.com   / arjun123');
  console.log('  Associate:  deepak@leadflow.com  / deepak123');
  console.log('  Associate:  sneha@leadflow.com   / sneha123');
}

main().catch(console.error).finally(() => prisma.$disconnect());
