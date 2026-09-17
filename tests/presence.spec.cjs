const { test, expect } = require('@playwright/test');
const ChatPage = require('../pages/ChatPage.cjs');

const API_URL = 'http://localhost:3004';

test.beforeEach(async ({ request }) => {
  await request.post(`${API_URL}/api/test-reset`);
});

test('typing in a room shows a live typing indicator to another user in that room', async ({ browser }) => {
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

  // Both default into General. Bob never sends or reloads — this only
  // passes if the "typing" broadcast actually reached his side live.
  await chatPageA.typeIntoComposer('Hey Bob');

  await expect(chatPageB.getTypingIndicator()).toHaveText(/Alice is typing/, { timeout: 5000 });

  await contextA.close();
  await contextB.close();
});

test('the typing indicator clears shortly after the typer stops typing', async ({ browser }) => {
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

  await chatPageA.typeIntoComposer('Hey Bob');
  await expect(chatPageB.getTypingIndicator()).toHaveText(/Alice is typing/, { timeout: 5000 });

  // No further keystrokes — the client should tell the server Alice
  // stopped typing after a short pause, without Bob needing to reload.
  await expect(chatPageB.getTypingIndicator()).toBeHidden({ timeout: 5000 });

  await contextA.close();
  await contextB.close();
});

test('the typing indicator clears immediately once the message is actually sent', async ({ browser }) => {
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

  await chatPageA.typeIntoComposer('Hey Bob, incoming');
  await expect(chatPageB.getTypingIndicator()).toHaveText(/Alice is typing/, { timeout: 5000 });

  await chatPageA.sendMessage('Hey Bob, incoming');

  // Sending clears the indicator right away rather than waiting out the
  // normal "stopped typing" pause.
  await expect(chatPageB.getTypingIndicator()).toBeHidden({ timeout: 3000 });

  await contextA.close();
  await contextB.close();
});

test('typing in a Direct Message only shows the indicator to that conversation partner', async ({ browser }) => {
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

  await chatPageA.typeIntoComposer('Quick question');

  await expect(chatPageB.getTypingIndicator()).toHaveText(/Alice is typing/, { timeout: 5000 });

  await contextA.close();
  await contextB.close();
});

test('a user in a different room never sees a typing indicator meant for another room', async ({ browser }) => {
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

  // Alice and Bob stay in General (the default); Carol switches to Random.
  await chatPageC.selectRoom('Random');

  await chatPageA.typeIntoComposer('Hello General');

  await expect(chatPageB.getTypingIndicator()).toHaveText(/Alice is typing/, { timeout: 5000 });
  // Carol is in a different room and should never see it.
  await expect(chatPageC.getTypingIndicator()).toBeHidden();

  await contextA.close();
  await contextB.close();
  await contextC.close();
});
