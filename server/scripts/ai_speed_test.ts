import { db } from '../utils/drizzle';
import { users } from '../drizzle/schema';
import { prepareRoteChatContext } from '../utils/dbMethods/ai';
import { createChatCompletionStream } from '../utils/ai/client';

async function measureTime<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  console.log(`[Timer] ${name}: ${(end - start).toFixed(2)}ms`);
  return result;
}

async function testQuery(ownerId: string, message: string) {
  console.log(`\n=== Testing Query: "${message}" ===`);

  // 1. Prep context (Plan + Retrieval)
  const context = await measureTime('1. prepareRoteChatContext (Plan + Retrieval)', () =>
    prepareRoteChatContext({
      ownerId,
      message,
    })
  );

  if (context.clarification) {
    console.log('   Clarification needed:', context.clarification.question);
    return;
  }

  console.log('   Plan Summary:', context.plan.summary);
  console.log(`   Found ${context.sources.length} sources`);

  // 2. LLM Generation
  const stream = createChatCompletionStream(context.config.chat, context.messages);
  const startStream = performance.now();
  let firstTokenTime: number | null = null;
  let textLength = 0;

  for await (const chunk of stream) {
    if (!firstTokenTime) {
      firstTokenTime = performance.now();
      console.log(
        `[Timer] 2a. First Token Latency: ${(firstTokenTime - startStream).toFixed(2)}ms`
      );
    }
    textLength += chunk.length;
  }
  const endStream = performance.now();
  console.log(
    `[Timer] 2b. Total Generation Time: ${(endStream - startStream).toFixed(2)}ms (length: ${textLength})`
  );
  console.log(
    `[Timer] Total Query Time: ${(endStream - startStream + (firstTokenTime! - startStream)).toFixed(2)}ms (approx)`
  );
}

async function run() {
  const allUsers = await db.select().from(users).limit(1);
  if (allUsers.length === 0) {
    console.error('No users found in database to run tests.');
    process.exit(1);
  }
  const user = allUsers[0];
  console.log(`Using user: ${user.username} (${user.id})`);

  try {
    await testQuery(user.id, '#todo 有哪些');
    await testQuery(user.id, '我最近立了哪些还没收尾的 Flag？');
  } catch (error) {
    console.error('Error running test:', error);
  } finally {
    process.exit(0);
  }
}

run();
