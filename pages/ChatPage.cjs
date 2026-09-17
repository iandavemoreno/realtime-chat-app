const { expect } = require('@playwright/test');

class ChatPage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/');
  }

  async join(username) {
    await this.page.locator('.join-screen input').fill(username);
    await this.page.locator('.join-screen button').click();
    // Confirms we've actually left the join screen and the chat is ready
    await this.page.locator('.message-form input').waitFor({ state: 'visible' });
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
}

module.exports = ChatPage;
