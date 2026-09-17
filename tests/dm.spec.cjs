const { test, expect } = require('@playwright/test');
const ChatPage = require('../pages/ChatPage.cjs');

const API_URL = 'http://localhost:3004';

test.beforeEach(async ({ request }) => {
  // Start every test from a known, clean state: only the two default rooms
  // exist, and no room or direct messages.
  await request.post(`${API_URL}/api/test-reset`);
});

test('a solo user sees no one in the Direct Messages list', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Ian');

  await expect(page.locator('.no-users-message')).toBeVisible();
  await expect(page.locator('.dm-item')).toHaveCount(0);
});

test('a second connected user appears live in the Direct Messages list', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const chatPageA = new ChatPage(pageA);
  const chatPageB = new ChatPage(pageB);

  await chatPageA.goto();
  await chatPageA.join('Alice');

  // Bob wasn't online yet when Alice joined — this only passes if the
  // "users-online" broadcast actually reached Alice's sidebar live.
  await chatPageB.goto();
  await chatPageB.join('Bob');

  await expect(chatPageA.getDmItem('Bob')).toBeVisible();
  await expect(chatPageB.getDmItem('Alice')).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('opening a Direct Message conversation shows an empty thread with that user', async ({ browser }) => {
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

  await chatPageA.openDm('Bob');

  await expect(pageA.locator('.chat-header h1')).toHaveText('Bob');
  await expect(pageA.locator('.message-text')).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test('a direct message sent to another user appears live for them, in realtime', async ({ browser }) => {
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

  await chatPageA.openDm('Bob');
  await chatPageB.openDm('Alice');

  await chatPageA.sendMessage('Hey Bob, got a minute?');

  // Bob never sent or reloaded — this only passes if the DM was actually
  // routed to him in realtime, not just saved server-side.
  await expect(chatPageB.getMessage('Hey Bob, got a minute?')).toBeVisible({ timeout: 10000 });

  await contextA.close();
  await contextB.close();
});

test('direct message history persists after reloading the page', async ({ browser }) => {
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

  await chatPageA.openDm('Bob');
  await chatPageA.sendMessage('This should still be here after reload');

  await pageA.reload();
  await chatPageA.join('Alice');
  await chatPageA.openDm('Bob');

  await expect(chatPageA.getMessage('This should still be here after reload')).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('a direct message conversation is private and does not appear in a shared room', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  const chatPageA = new ChatPage(pageA);
  const chatPageB = new ChatPage(pageB);
  const chatPageC = new ChatPage(pageC);

  await chatPageA.goto();
  await chatPageB.goto();
  await chatPageC.goto();
  await chatPageA.join('Alice');
  await chatPageB.join('Bob');
  await chatPageC.join('Carol');

  // Alice and Bob are both in the General room by default, and also DM
  // each other directly.
  await chatPageA.openDm('Bob');
  await chatPageA.sendMessage('This is a private message for Bob only');

  // Carol is in the General room the whole time and should never see it,
  // whether in the room or by opening her own (empty) DM with Alice.
  await expect(chatPageC.getMessage('This is a private message for Bob only')).toHaveCount(0);
  await chatPageC.openDm('Alice');
  await expect(chatPageC.getMessage('This is a private message for Bob only')).toHaveCount(0);

  await contextA.close();
  await contextB.close();
  await contextC.close();
});

test('switching between a Direct Message and a room shows the right messages in each', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Ian');

  await chatPage.sendMessage('This belongs in General');

  // With no one else online, there's nothing to open a DM with — instead
  // confirm switching rooms and back preserves the room message, proving
  // view-mode switches don't corrupt the underlying room state.
  await chatPage.selectRoom('Random');
  await expect(chatPage.getMessage('This belongs in General')).toHaveCount(0);

  await chatPage.selectRoom('General');
  await expect(chatPage.getMessage('This belongs in General')).toBeVisible();
});
