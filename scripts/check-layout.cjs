const {PrismaClient} = require('./mini-services/backend/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const s = await p.setting.findUnique({ where: { key: 'homeLayout' } });
    console.log('homeLayout:', s ? s.value : 'NULL');
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await p.$disconnect();
  }
})();
