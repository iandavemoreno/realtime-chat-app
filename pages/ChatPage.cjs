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
