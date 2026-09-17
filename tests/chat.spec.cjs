const { test, expect } = require('@playwright/test');
const ChatPage = require('../pages/ChatPage.cjs');

const API_URL = 'http://localhost:3004';

test.beforeEach(async ({ request }) => {
  // Start every test from a clean chat history so assertions don't depend
  // on leftover messages from a previous run.
  await request.delete(`${API_URL}/api/messages`);
});

test('sending a message shows it in the chat', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Ian');

  await chatPage.sendMessage('Hello, this is a test message');

  await expect(chatPage.getMessage('Hello, this is a test message')).toBeVisible();
});

test('chat history persists after reloading the page', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Ian');

  await chatPage.sendMessage('This message should still be here after reload');

  // Reload and rejoin — the message should load from the server's history,
  // not just be sitting in React state from before the reload.
  await page.reload();
  await chatPage.join('Ian');

  await expect(chatPage.getMessage('This message should still be here after reload')).toBeVisible();
});

test('a message sent in one browser appears in another automatically', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const chatPageA = new ChatPage(pageA);
  const chatPageB = new ChatPage(pageB);

  await chatPageA.goto();
  await chatPageB.goto();

  await chatPageA.join('Alice');
  await chatPageB.join('Bob');

  await chatPageA.sendMessage('Hi Bob, can you see this live?');

  // pageB never sent or reloaded — this only passes if the Socket.io
  // broadcast actually pushed the message to it in realtime.
  await expect(chatPageB.getMessage('Hi Bob, can you see this live?')).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('messages from different users are labeled with the right sender', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Charlie');

  await chatPage.sendMessage('This one is from Charlie');

  const message = page.locator('.message', { hasText: 'This one is from Charlie' });
  await expect(message.locator('.message-username')).toHaveText('Charlie');
});
