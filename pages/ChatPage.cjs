const { expect } = require('@playwright/test');

// A default used by every test that doesn't care about the password itself
// (most of them) — the server's test-reset endpoint clears the users table
// before each test, so re-signing-up with the same username never collides.
const DEFAULT_TEST_PASSWORD = 'TestPass123!';

class ChatPage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/');
  }

  // Signs up a brand-new account and logs straight into the chat. This is
  // what nearly every existing test calls — it's named `join` for backward
  // compatibility with the pre-auth version of the app.
  async join(username, password = DEFAULT_TEST_PASSWORD) {
    return this.signUp(username, password);
  }

  async signUp(username, password = DEFAULT_TEST_PASSWORD) {
    await this.switchToSignUp();
    await this.submitAuthForm(username, password);
    // Confirms we've actually left the auth screen and the chat is ready
    await this.page.locator('.message-form input').waitFor({ state: 'visible' });
  }

  async logIn(username, password) {
    await this.switchToLogIn();
    await this.submitAuthForm(username, password);
  }

  // Fills and submits the auth form without asserting the outcome — use
  // this directly (after switchToSignUp/switchToLogIn) for negative cases
  // where you expect an error rather than a successful login.
  async submitAuthForm(username, password) {
    await this.page.locator('.auth-form input[name="username"]').fill(username);
    await this.page.locator('.auth-form input[name="password"]').fill(password);
    await this.page.locator('.auth-form button[type="submit"]').click();
  }

  switchToSignUp() {
    return this.page.locator('.auth-tab', { hasText: 'Sign Up' }).click();
  }

  switchToLogIn() {
    return this.page.locator('.auth-tab', { hasText: 'Log In' }).click();
  }

  getAuthError() {
    return this.page.locator('.auth-error');
  }

  async logOut() {
    await this.page.locator('.logout-button').click();
    await this.page.locator('.auth-form').waitFor({ state: 'visible' });
  }

  getRoomItem(roomName) {
    return this.page.locator('.room-item', { hasText: roomName });
  }

  async selectRoom(roomName) {
    await this.getRoomItem(roomName).click();
    // The header updates to the selected room's name once the switch lands
    await expect(this.page.locator('.chat-header h1')).toHaveText(roomName);
  }

  async createRoom(roomName) {
    await this.page.locator('.new-room-form input').fill(roomName);
    await this.page.locator('.new-room-form button').click();
    // Creating a room also switches into it
    await expect(this.page.locator('.chat-header h1')).toHaveText(roomName);
    await expect(this.getRoomItem(roomName)).toBeVisible();
  }

  async sendMessage(text) {
    const input = this.page.locator('.message-form input');
    await input.fill(text);
    await this.page.locator('.message-form button').click();
    // The message list only updates once the server broadcasts it back over
    // the socket, so waiting for it to appear is the real confirmation the
    // round-trip (not just the click) succeeded.
    await expect(this.getMessage(text)).toBeVisible({ timeout: 10000 });
  }

  getMessage(text) {
    return this.page.locator('.message-text', { hasText: text });
  }

  getDmItem(username) {
    return this.page.locator('.dm-item', { hasText: username });
  }

  async openDm(username) {
    await this.getDmItem(username).click();
    // The header updates to the other person's name once the switch lands
    await expect(this.page.locator('.chat-header h1')).toHaveText(username);
  }

  // Fills the composer without sending — for asserting on the OTHER side's
  // typing indicator without actually posting a message.
  async typeIntoComposer(text) {
    await this.page.locator('.message-form input').fill(text);
  }

  async clearComposer() {
    await this.page.locator('.message-form input').fill('');
  }

  getTypingIndicator() {
    return this.page.locator('.typing-indicator');
  }
}

module.exports = ChatPage;
