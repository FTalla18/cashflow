# "Cash": the CashFlow game's AI coach (Botpress)

The game already has a built-in coach (the **Ask Cash 💬** button reads your financial statement and gives your next best moves, with no AI or internet needed). This folder sets up the optional **AI chat** version on Botpress, the same way Vee works on Velora.

## Setup (about 10 minutes)

1. In Botpress, create a new bot named **Cash**.
2. **Instructions:** paste everything in [`cash-instructions.md`](cash-instructions.md) into the Autonomous Node's instructions (Studio → Main flow → Autonomous Node).
3. **Knowledge base:** Studio → Knowledge Bases → New → add [`cash-knowledge.md`](cash-knowledge.md) as a document. Turn knowledge search on in the Autonomous Node.
4. **Webchat style:** Webchat → Theme: primary color `#3cf5a0`, dark mode on, bot name "Cash", avatar 💸, greeting: "yo, I'm Cash 💸 ask me anything about the game or about money".
5. **Publish** the bot, then open Webchat → **Embed** and copy the two `<script src="…">` URLs.
6. Paste them into [`../js/coach-config.js`](../js/coach-config.js) (`inject` and `config`), or send them to Claude to do it.

After that, the Ask Cash dialog shows a **Chat with Cash (AI)** button that opens the Botpress chat.
