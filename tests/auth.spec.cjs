const { test, expect } = require('@playwright/test');
const ChatPage = require('../pages/ChatPage.cjs');

const API_URL = 'http://localhost:3004';

test.beforeEach(async ({ request }) => {
  // Start every test from a known, clean state: no users, only the two
  // default rooms, and no messages.
  await request.post(`${API_URL}/api/test-reset`);
});

test('signing up creates an account and logs the user in immediately', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Alice');

  await expect(page.locator('.message-form input')).toBeVisible();
  await expect(page.locator('.current-user')).toContainText('Alice');
});

test('a password shorter than 6 characters is rejected before reaching the chat', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.switchToSignUp();
  await chatPage.submitAuthForm('Grace', 'abc');

  await expect(chatPage.getAuthError()).toHaveText(/at least 6 characters/i);
  await expect(page.locator('.message-form input')).not.toBeVisible();
});

test('signing up with an already-taken username shows an error and does not log in', async ({ page, request }) => {
  await request.post(`${API_URL}/api/auth/signup`, { data: { username: 'Alice', password: 'TestPass123!' } });

  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.switchToSignUp();
  await chatPage.submitAuthForm('Alice', 'ADifferentPass1');

  await expect(chatPage.getAuthError()).toHaveText(/already taken/i);
  await expect(page.locator('.message-form input')).not.toBeVisible();
});

test('logging in with the wrong password shows an error and does not log in', async ({ page, request }) => {
  await request.post(`${API_URL}/api/auth/signup`, { data: { username: 'Bob', password: 'CorrectPass1' } });

  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.logIn('Bob', 'WrongPassword');

  await expect(chatPage.getAuthError()).toHaveText(/invalid username or password/i);
  await expect(page.locator('.message-form input')).not.toBeVisible();
});

test('logging in with correct credentials signs the user back in', async ({ page, request }) => {
  await request.post(`${API_URL}/api/auth/signup`, { data: { username: 'Carol', password: 'CorrectPass1' } });

  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.logIn('Carol', 'CorrectPass1');

  await expect(page.locator('.message-form input')).toBeVisible();
  await expect(page.locator('.current-user')).toContainText('Carol');
});

test('logging out returns to the login screen and ends the session', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Dana');

  await chatPage.logOut();

  await expect(page.locator('.auth-form')).toBeVisible();
  await expect(page.locator('input[name="username"]')).toBeVisible();
});

test('reloading the page keeps the user signed in without re-entering credentials', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Eve');

  await page.reload();

  // No login call here on purpose — a persisted session should skip the
  // auth screen entirely and go straight back into the chat.
  await expect(page.locator('.message-form input')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.current-user')).toContainText('Eve');
});

test('an invalid or expired session is rejected and returns to the login screen', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.join('Frank');

  // Simulate a tampered/expired token by overwriting the stored session
  // with garbage, then reloading — the server should refuse the socket
  // handshake and the app should fall back to the login screen.
  await page.evaluate(() => {
    localStorage.setItem('chatAuth', JSON.stringify({ token: 'not-a-real-token', username: 'Frank' }));
  });
  await page.reload();

  await expect(page.locator('.auth-form')).toBeVisible({ timeout: 10000 });
  await expect(chatPage.getAuthError()).toContainText(/session expired/i);
});
