/**
 * Token Generator — generates real signed JWTs for the test app.
 * Run: npx ts-node generate-tokens.ts
 *
 * Copy the output tokens into test-app/src/app/page.tsx
 * (replace the makeTestJwt function's return value with these)
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET_APP1 = 'super-secret-jwt-1'; // must match server .env PROJECTS

const users = ['alice', 'bob'];

console.log('─'.repeat(60));
console.log('JWT Tokens for test-app (valid 30 days)');
console.log('Project: app1 | API Key: api-key-app1');
console.log('─'.repeat(60));

for (const userId of users) {
  const token = jwt.sign(
    { userId, projectId: 'app1' },
    JWT_SECRET_APP1,
    { expiresIn: '30d' },
  );
  console.log(`\n${userId}:\n${token}`);
}

console.log('\n' + '─'.repeat(60));
console.log('Update TOKENS map in test-app/src/app/page.tsx');
