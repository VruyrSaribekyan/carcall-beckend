require('dotenv').config();
const { User } = require('./models'); // Используйте ./models вместо ./models/User

(async () => {
  try {
    const users = await User.findAll({
      attributes: ['carNumber', 'fcmToken'],
      raw: true
    });
    
    console.log('\n📊 FCM Tokens in Database:');
    users.forEach(u => {
      console.log(`\n${u.carNumber}:`);
      console.log(`  Token: ${u.fcmToken ? '✅ ' + u.fcmToken.substring(0, 40) + '...' : '❌ NULL'}`);
    });
    process.exit(0);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();