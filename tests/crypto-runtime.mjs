import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
export default {
  async test() {
    const derived=pbkdf2Sync('runtime-test-only','runtime-salt',600000,32,'sha256');
    if(derived.length!==32 || !timingSafeEqual(derived,pbkdf2Sync('runtime-test-only','runtime-salt',600000,32,'sha256')))throw Error('Password KDF failed');
    console.log('PASS: runtime PBKDF2-SHA256 at 600,000 iterations');
  }
};
