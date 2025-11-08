/**
 * 🌟 Competitii Bot (Node.js + grammY)
 * - Persistent sessions via @grammyjs/session + @grammyjs/storage-file
 * - Auto retry for failed Telegram API requests (@grammyjs/auto-retry)
 * - Inline buttons, bilingual (EN/RO), admin draw tools
 * - Referral + Leaderboard system
 */

import 'dotenv/config'; // loads .env automatically
import { Bot, InlineKeyboard, session } from "grammy";
import OpenAI from "openai";
import { FileAdapter } from "@grammyjs/storage-file";
import { autoRetry } from "@grammyjs/auto-retry";
import fs from "fs";
import path from "path";

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "@CompetitiiChannel";

if (!BOT_TOKEN) {
  console.error("❌ Error: BOT_TOKEN is not set in .env");
  process.exit(1);
}

// ================= CORE SETUP =================
const bot = new Bot(BOT_TOKEN);
bot.api.config.use(autoRetry());

// 🧠 Persistent session setup
const DATA_DIR = path.resolve("./data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function initialSession() {
  return {
    lang: "en",
    joinedDraws: [],
  };
}

const storage = new FileAdapter({
  path: path.join(DATA_DIR, "sessions.json"),
});

bot.use(session({ initial: initialSession, storage }));

// ================= STORAGE =================
const DRAWS_FILE = path.join(DATA_DIR, "draws.json");
const PART_FILE = path.join(DATA_DIR, "participants.json");
const REFERRALS_FILE = path.join(DATA_DIR, "referrals.json");

function loadJSON(file, defaultVal) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultVal, null, 2));
    return defaultVal;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("Failed to load", file, e);
    return defaultVal;
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let draws = loadJSON(DRAWS_FILE, {});
let participants = loadJSON(PART_FILE, {});
let referrals = loadJSON(REFERRALS_FILE, {});


// ================= LANGUAGE PACK =================
const LANG = {
  en: {
    welcome:
      "🎉 Welcome to Competitii!\nJoin random giveaways and win prizes 🏆",
    start_menu:
      "Use the buttons below or type commands.\nCommands: /join /mytickets /winners /rules /about",
    joined: "✅ You're in! Good luck 🍀",
    already_joined: "⚠️ You already joined this draw!",
    no_active: "😕 No active draw right now. Stay tuned on our channel!",
    mytickets: "🎟️ You are in the current draw:",
    winners_none: "No winners announced yet.",
    rules:
      "📜 Rules:\n1) Use Join to enter active draws.\n2) One user = one entry.\n3) Winners are picked randomly.\n4) Admin decisions are final.",
    about:
      "🤖 Competitii — Fair • Transparent • Fun\nChannel: " +
      CHANNEL_USERNAME,
    admin_only: "❌ This command is for admin only.",
    new_draw_started: (t) => `✅ New draw started: *${t}*`,
    closed_draw: (t) => `🚫 Entries closed for: *${t}*`,
    draw_no_part: "No participants in this draw.",
    draw_results: (t, list) =>
      `🎰 Draw Results - ${t}\n\n🏆 Winners:\n${list.join("\n")}`,
    prompt_draw_count: "Usage: /draw <count>",

    // Referral system
    ref_link: (username, uid) =>
      `🔗 Your referral link:\nhttps://t.me/${username}?start=ref_${uid}`,
    new_referral: (name) => `👥 New referral joined: ${name}`,
    no_referrals: (username, uid) =>
      `😕 You haven't referred anyone yet.\nShare your link:\nhttps://t.me/${username}?start=ref_${uid}`,
    referral_list: (count, list, username, uid) =>
      `👥 You have referred *${count}* user(s):\n${list}\n\nKeep sharing your link!\nhttps://t.me/${username}?start=ref_${uid}`,
    leaderboard_empty: "📊 No referrals yet. Be the first!",
    leaderboard_title: "🏆 *Top Inviters*",
    leaderboard_entry: (rank, name, count) =>
      `${rank}. ${name} — ${count} referrals`,
  },

  ro: {
    welcome:
      "🎉 Salut! Bine ai venit la Competitii!\nParticipă la tombole și câștigă premii 🏆",
    start_menu:
      "Folosește butoanele de mai jos sau tastează comenzi.\nComenzi: /join /mytickets /winners /rules /about",
    joined: "✅ Ești înscris! Mult succes 🍀",
    already_joined: "⚠️ Ești deja înscris la această tombolă!",
    no_active: "😕 Nu este nicio tombolă activă acum. Urmărește canalul nostru!",
    mytickets: "🎟️ Ești înscris la tombola curentă:",
    winners_none: "Nu au fost anunțați câștigători încă.",
    rules:
      "📜 Reguli:\n1) Folosește Join pentru a intra la tombolele active.\n2) Un utilizator = o înscriere.\n3) Câștigătorii sunt aleși la întâmplare.\n4) Deciziile adminilor sunt finale.",
    about:
      "🤖 Competitii — Corect • Transparent • Distractiv\nCanal: " +
      CHANNEL_USERNAME,
    admin_only: "❌ Această comandă este doar pentru admin.",
    new_draw_started: (t) => `✅ A început o nouă tombolă: *${t}*`,
    closed_draw: (t) => `🚫 Înscrierile s-au încheiat pentru: *${t}*`,
    draw_no_part: "Nu există participanți la această tombolă.",
    draw_results: (t, list) =>
      `🎰 Rezultatele tombolei - ${t}\n\n🏆 Câștigători:\n${list.join("\n")}`,
    prompt_draw_count: "Utilizare: /draw <număr>",

    // Referral system
    ref_link: (username, uid) =>
      `🔗 Linkul tău de recomandare:\nhttps://t.me/${username}?start=ref_${uid}`,
    new_referral: (name) =>
      `👥 Un nou utilizator s-a înscris prin linkul tău: ${name}`,
    no_referrals: (username, uid) =>
      `😕 Nu ai recomandat încă pe nimeni.\nDistribuie linkul tău:\nhttps://t.me/${username}?start=ref_${uid}`,
    referral_list: (count, list, username, uid) =>
      `👥 Ai recomandat *${count}* utilizator(i):\n${list}\n\nContinuă să distribui linkul tău!\nhttps://t.me/${username}?start=ref_${uid}`,
    leaderboard_empty: "📊 Nu există recomandări încă. Fii primul!",
    leaderboard_title: "🏆 *Cei mai activi invitați*",
    leaderboard_entry: (rank, name, count) =>
      `${rank}. ${name} — ${count} recomandări`,
  },
};

// ================= HELPERS =================

// NOTE: This helper is still defined but is no longer used for ctx.reply calls.
function t(ctx, key, ...args) {
  const lang = ctx.session?.lang || "en";
  const value = LANG[lang][key];
  return typeof value === "function" ? value(...args) : value;
}

function mainKeyboard(lang) {
  return new InlineKeyboard()
    .text(lang === "ro" ? "🎟️ Înscrie-te" : "🎟️ Join", "join")
    .row()
    .text(lang === "ro" ? "🏆 Câștigători" : "🏆 View Winners", "view_winners")
    .row()
    .text(lang === "ro" ? "🌐 Schimbă limba" : "🌐 Switch Language", "switch_lang");
}



// ================= USER COMMANDS =================

bot.command("start", async (ctx) => {
  if (!ctx.session.lang) ctx.session.lang = "en";
  const uid = ctx.from.id;
  const args = ctx.message.text.split(" ");
  const isReferral = args[1] && args[1].startsWith("ref_");
  const refId = isReferral ? Number(args[1].replace("ref_", "")) : null;

  // Handle referral tracking
  if (isReferral && refId && refId !== uid) {
    referrals[refId] = referrals[refId] || [];
    if (!referrals[refId].includes(uid)) {
      referrals[refId].push(uid);
      saveJSON(REFERRALS_FILE, referrals);
      try {
        await ctx.api.sendMessage(
          refId,
          LANG.en.new_referral(ctx.from.first_name || ctx.from.username || uid)
          // t({ session: { lang: "en" } }, "new_referral", ctx.from.first_name || ctx.from.username || uid)
        );
      } catch (err) {
        console.error("Failed to send referral notification:", err);
      }
    }
  }

  ctx.reply(
    `${LANG.en.welcome}\n\n${LANG.en.start_menu}\n\n${LANG.en.ref_link(
      ctx.me.username,
      uid
    )}`,
    { reply_markup: mainKeyboard(ctx.session.lang) }
  );
});

bot.callbackQuery("switch_lang", (ctx) => {
  ctx.session.lang = ctx.session.lang === "en" ? "ro" : "en";
  ctx.answerCallbackQuery({ text: "Language switched ✅" }).catch(() => {});
  ctx.editMessageReplyMarkup(mainKeyboard(ctx.session.lang)).catch(() => {});
  ctx.reply(LANG.en.welcome);
});

bot.callbackQuery("join", (ctx) => {
  const uid = ctx.from.id;
  const active = Object.values(draws).find((d) => d.active);
  if (!active)
    return ctx.answerCallbackQuery({
      text: LANG.en.no_active,
      show_alert: true,
    });
  participants[active.id] = participants[active.id] || [];
  if (participants[active.id].includes(uid))
    return ctx.answerCallbackQuery({
      text: LANG.en.already_joined,
      show_alert: true,
    });
  participants[active.id].push(uid);
  saveJSON(PART_FILE, participants);
  ctx.answerCallbackQuery({ text: LANG.en.joined });
});

bot.callbackQuery("view_winners", (ctx) => {
  const lastDraw = Object.values(draws)
    .reverse()
    .find((d) => d.winners && d.winners.length);
  if (!lastDraw)
    return ctx.answerCallbackQuery({
      text: LANG.en.winners_none,
      show_alert: true,
    });
  ctx.reply(LANG.en.draw_results(lastDraw.title, lastDraw.winners));
});

bot.command("join", (ctx) => {
  const uid = ctx.from.id;
  const active = Object.values(draws).find((d) => d.active);
  if (!active) return ctx.reply(LANG.en.no_active);
  participants[active.id] = participants[active.id] || [];
  if (participants[active.id].includes(uid))
    return ctx.reply(LANG.en.already_joined);
  participants[active.id].push(uid);
  saveJSON(PART_FILE, participants);
  ctx.reply(LANG.en.joined);
});

bot.command("mytickets", (ctx) => {
  const uid = ctx.from.id;
  const active = Object.values(draws).find((d) => d.active);
  if (!active) return ctx.reply(LANG.en.no_active);
  const isIn =
    participants[active.id] && participants[active.id].includes(uid);
  if (isIn)
    ctx.reply(`${LANG.en.mytickets} *${active.title}*`, {
      parse_mode: "Markdown",
    });
  else ctx.reply(LANG.en.no_active);
});

bot.command("winners", (ctx) => {
  const lastDraw = Object.values(draws)
    .reverse()
    .find((d) => d.winners && d.winners.length);
  if (!lastDraw) return ctx.reply(LANG.en.winners_none);
  ctx.reply(LANG.en.draw_results(lastDraw.title, lastDraw.winners), {
    parse_mode: "Markdown",
  });
});

bot.command("rules", (ctx) => ctx.reply(LANG.en.rules));
bot.command("about", (ctx) => ctx.reply(LANG.en.about));

// ================= REFERRAL COMMANDS =================
bot.command("referrals", (ctx) => {
  const uid = ctx.from.id;
  const list = referrals[uid] || [];
  if (list.length === 0)
    return ctx.reply(LANG.en.no_referrals(ctx.me.username, uid));
  const userList = list
    .map((u) => `• [User ${u}](tg://user?id=${u})`)
    .join("\n");
  ctx.reply(
    LANG.en.referral_list(list.length, userList, ctx.me.username, uid),
    { parse_mode: "Markdown" }
  );
});

bot.command("leaderboard", async (ctx) => {
  const sorted = Object.entries(referrals)
    .map(([uid, arr]) => ({ uid, count: arr.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (sorted.length === 0) return ctx.reply(LANG.en.leaderboard_empty);

  let msg = `${LANG.en.leaderboard_title}\n\n`;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    let name = `User ${entry.uid}`;
    try {
      const chat = await ctx.api.getChat(entry.uid);
      if (chat.username) name = "@" + chat.username;
      else if (chat.first_name) name = chat.first_name;
    } catch {}
    msg += LANG.en.leaderboard_entry(i + 1, name, entry.count) + "\n";
  }
  ctx.reply(msg, { parse_mode: "Markdown" });
});

// ================= ADMIN COMMANDS =================
bot.command("newdraw", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const args = ctx.message.text.split(" ").slice(1).join(" ");
  if (!args) return ctx.reply("Usage: /newdraw <title>");
  const id = Date.now().toString();
  draws[id] = { id, title: args, active: true, winners: [] };
  saveJSON(DRAWS_FILE, draws);
  ctx.reply(LANG.en.new_draw_started(args), { parse_mode: "Markdown" });
});

bot.command("closedraw", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const active = Object.values(draws).find((d) => d.active);
  if (!active) return ctx.reply("No active draw.");
  active.active = false;
  saveJSON(DRAWS_FILE, draws);
  ctx.reply(LANG.en.closed_draw(active.title), { parse_mode: "Markdown" });
});

bot.command("draw", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const parts = ctx.message.text.split(" ");
  const count = Number(parts[1]) || 1;
  const target = Object.values(draws)
    .reverse()
    .find((d) => !d.active && (!d.winners || d.winners.length === 0));
  if (!target) return ctx.reply("No closed draw to pick winners from.");
  const entries = participants[target.id] || [];
  if (entries.length === 0) return ctx.reply(LANG.en.draw_no_part);
  const shuffled = entries.slice().sort(() => 0.5 - Math.random());
  const winners = shuffled.slice(0, Math.min(count, shuffled.length));
  const winnerMentions = [];
  for (const uid of winners) {
    try {
      const chat = await bot.api.getChat(uid);
      if (chat?.username) winnerMentions.push("@" + chat.username);
      else if (chat?.first_name)
        winnerMentions.push(`${chat.first_name} (id:${uid})`);
      else winnerMentions.push(String(uid));
    } catch {
      winnerMentions.push(String(uid));
    }
  }
  target.winners = winnerMentions;
  saveJSON(DRAWS_FILE, draws);
  const msg = LANG.en.draw_results(target.title, target.winners);
  ctx.reply(msg, { parse_mode: "Markdown" });
  try {
    await bot.api.sendMessage(
      CHANNEL_USERNAME,
      `📢 *Competitii Draw Results*\n\n${msg}`,
      { parse_mode: "Markdown" }
    );
  } catch {
    console.log(
      "⚠️ Could not post to channel. Ensure bot is admin and CHANNEL_USERNAME is correct."
    );
  }
});

bot.command("stats", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const totalDraws = Object.keys(draws).length;
  const totalParticipants = Object.values(participants).reduce(
    (s, a) => s + (a.length || 0),
    0
  );
  ctx.reply(`📊 Draws: ${totalDraws}\n👥 Participants: ${totalParticipants}`);
});

// ========== 🤖 AI Chat (in groups/channels only) ==========

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Handle all text messages (AI reply logic)
bot.on("message:text", async (ctx) => {
  try {
    // Ignore commands like /start, /join, etc.
    const text = ctx.message.text?.trim();
    if (!text || text.startsWith("/")) return;

    // Ignore messages from the bot itself
    if (ctx.from.is_bot) return;

    // Get chat info
    const chatType = ctx.chat.type;
    const username = bot.botInfo?.username || "competitii_bot";

    // Only reply in groups/channels when mentioned or replied to
    if (chatType === "group" || chatType === "supergroup" || chatType === "channel") {
      const isMention = text.includes(`@${username}`);
      const isReplyToBot = ctx.message.reply_to_message?.from?.username === username;

      if (!isMention && !isReplyToBot) return; // Not directed at bot
    }

    // (Optional) If you want to skip private chats entirely, uncomment:
    // if (chatType === "private") return;

    // Clean message (remove bot mention)
    const cleanText = text.replace(`@${username}`, "").trim();

    // Send a “thinking…” message
    await ctx.reply("🤖 Thinking...");

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: cleanText }],
    });

    const aiReply = completion.choices[0]?.message?.content || "Hmm... nu am un răspuns acum.";

    // Reply back
    await ctx.reply(aiReply, { reply_to_message_id: ctx.message.message_id });

  } catch (error) {
    console.error("AI Error:", error);
    await ctx.reply("⚠️ Oops, ceva nu a mers bine cu AI-ul.");
  }
});

// ================= LIFECYCLE =================

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

(async () => {
  try {
    console.log("🚀 Starting Competitii Bot...");
    await bot.api.deleteWebhook(); // ensure polling
    await bot.init();// fetch bot info (ctx.me ready)
    await bot.start();
    console.log(`✅ Competitii Bot (@${bot.botInfo.username}) started successfully!`);
  } catch (err) {
    console.error("❌ Failed to start bot:", err);
  }
})();