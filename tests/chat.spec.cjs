const { test, expect } = require('@playwright/test');
const ChatPage = require('../pages/ChatPage.cjs');

const API_URL = 'http://localhost:3004';

test.beforeEach(async ({ request }) => {
  // Start every test from a known, clean state: only the two default rooms
  // (General, Random) exist, and no messages.
  await request.post(`${API_URL}/api/test-reset`);
});

test('default rooms are shown after joining', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Ian');

  await expect(chatPage.getRoomItem('General')).toBeVisible();
  await expect(chatPage.getRoomItem('Random')).toBeVisible();
  // The app should land in the first room (General) by default
  await expect(page.locator('.chat-header h1')).toHaveText('General');
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
  await expect(chatPageB.getMessage('Hi Bob, can you see this live?')).toBeVisible({ timeout: 10000 });

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

test('creating a new room adds it to the sidebar and switches into it', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Ian');

  await chatPage.createRoom('Project Updates');

  await expect(chatPage.getRoomItem('Project Updates')).toBeVisible();
  await expect(page.locator('.chat-header h1')).toHaveText('Project Updates');
});

test('a newly created room appears live for a second connected user', async ({ browser }) => {
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

  await chatPageA.createRoom('Design Team');

  // Bob never created or reloaded — this only passes if the "room-created"
  // broadcast actually reached his sidebar live.
  await expect(chatPageB.getRoomItem('Design Team')).toBeVisible({ timeout: 10000 });

  await contextA.close();
  await contextB.close();
});

test('messages in one room do not leak into another room', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Ian');

  await chatPage.sendMessage('This belongs in General');

  await chatPage.selectRoom('Random');
  await expect(chatPage.getMessage('This belongs in General')).toHaveCount(0);

  await chatPage.sendMessage('This belongs in Random');
  await expect(chatPage.getMessage('This belongs in Random')).toBeVisible();

  await chatPage.selectRoom('General');
  await expect(chatPage.getMessage('This belongs in General')).toBeVisible();
  await expect(chatPage.getMessage('This belongs in Random')).toHaveCount(0);
});
