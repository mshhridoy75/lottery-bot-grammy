/**
 * 🌟 Competitii Bot (grammY + MongoDB + OpenAI)
 * - Auto restart on crash
 * - HTML formatting in messages
 * - Persistent sessions via FileAdapter
 * - Referral + Leaderboard + AI replies
 */

import "dotenv/config";
import { Bot, InlineKeyboard, session } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { FileAdapter } from "@grammyjs/storage-file";
import OpenAI from "openai";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";

// =============== CONFIG ===============
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "@CompetitiiChannel";

// Support multiple admin IDs via ADMIN_IDS (comma separated) or single ADMIN_ID.
const ADMIN_IDS = (process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n))
  : ADMIN_ID && ADMIN_ID !== 0
    ? [ADMIN_ID]
    : []);

function isAdmin(ctx) {
  const id = ctx?.from?.id;
  if (!id) return false;
  if (ADMIN_IDS.length === 0) return false;
  return ADMIN_IDS.includes(id);
}

if (ADMIN_IDS.length === 0) {
  console.warn("⚠️ No ADMIN_ID or ADMIN_IDS set; admin-only commands will be disabled until configured.");
}

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing in .env file");
  process.exit(1);
}

// =============== DATABASE ===============
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing in .env file");
  process.exit(1);
}

// Enhanced MongoDB connection with better error handling
const mongooseOptions = {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 5,
  retryWrites: true,
  w: 'majority',
  retryReads: true,
};

let isDbConnected = false;

async function connectDatabase() {
  try {
    await mongoose.connect(MONGO_URI, mongooseOptions);
    isDbConnected = true;
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    isDbConnected = false;
  }
}

// Initialize database connection
connectDatabase();

// Database connection events
mongoose.connection.on('connected', () => {
  isDbConnected = true;
  console.log('✅ MongoDB connected successfully');
});

mongoose.connection.on('error', (err) => {
  isDbConnected = false;
  console.error('❌ MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  isDbConnected = false;
  console.log('⚠️ MongoDB disconnected');
});

// Auto-reconnect
mongoose.connection.on('disconnected', () => {
  console.log('🔄 Attempting to reconnect to MongoDB...');
  setTimeout(connectDatabase, 5000);
});

// Database schemas
const drawSchema = new mongoose.Schema(
  {
    id: String,
    title: String,
    active: Boolean,
    winners: [String],
  },
  { timestamps: true }
);

const participantSchema = new mongoose.Schema(
  {
    drawId: String,
    userId: Number,
  },
  { timestamps: true }
);

const referralSchema = new mongoose.Schema(
  {
    referrerId: Number,
    referredId: Number,
  },
  { timestamps: true }
);

const Draw = mongoose.model("Draw", drawSchema);
const Participant = mongoose.model("Participant", participantSchema);
const Referral = mongoose.model("Referral", referralSchema);

// =============== DATABASE HEALTH CHECK ===============
async function checkDbHealth() {
  if (!isDbConnected) {
    await connectDatabase();
  }
  
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch (error) {
    console.error('❌ Database health check failed:', error.message);
    isDbConnected = false;
    return false;
  }
}

// =============== SAFE DATABASE OPERATIONS ===============
async function safeDbOperation(operation, fallbackValue = null, operationName = "DB Operation") {
  if (!await checkDbHealth()) {
    console.warn(`⚠️ Database not available for: ${operationName}`);
    return fallbackValue;
  }

  try {
    const result = await operation();
    return result;
  } catch (error) {
    console.error(`❌ Database operation failed (${operationName}):`, error.message);
    
    // If it's a timeout error, mark as disconnected
    if (error.name === 'MongooseError' && error.message.includes('buffering timed out')) {
      isDbConnected = false;
    }
    
    return fallbackValue;
  }
}

// Safe versions of common operations
const db = {
  findOne: (model, query, fallback = null) => 
    safeDbOperation(() => model.findOne(query), fallback, `findOne on ${model.modelName}`),
  
  find: (model, query, fallback = []) => 
    safeDbOperation(() => model.find(query), fallback, `find on ${model.modelName}`),
  
  create: (model, data, fallback = null) => 
    safeDbOperation(() => model.create(data), fallback, `create on ${model.modelName}`),
  
  count: (model, query, fallback = 0) => 
    safeDbOperation(() => model.countDocuments(query), fallback, `count on ${model.modelName}`),
  
  aggregate: (model, pipeline, fallback = []) => 
    safeDbOperation(() => model.aggregate(pipeline), fallback, `aggregate on ${model.modelName}`),
  
  update: (model, query, update, fallback = null) => 
    safeDbOperation(() => model.findOneAndUpdate(query, update, { new: true }), fallback, `update on ${model.modelName}`)
};

// =============== LANG PACK ===============
const LANG = {
  en: {
    welcome:
      "🎉 <b>Welcome to Competitii!</b>\nJoin random giveaways and win prizes 🏆",
    start_menu:
      "Use the buttons below or type commands:\n<code>/join</code> / <code>/mytickets</code> / <code>/winners</code> / <code>/rules</code> / <code>/about</code>",
    joined: "✅ You're in! Good luck 🍀",
    already_joined: "⚠️ You already joined this draw!",
    no_active: "😕 No active draw right now.",
    rules:
      "📜 <b>Rules</b>:\n1️⃣ One user = one entry\n2️⃣ Winners are random\n3️⃣ Admin decisions are final.",
    about:
      "🤖 <b>Competitii</b> — Fair • Transparent • Fun\nChannel: " +
      CHANNEL_USERNAME,
    new_draw_started: (t) => `✅ New draw started: <b>${t}</b>`,
    closed_draw: (t) => `🚫 Entries closed for: <b>${t}</b>`,
    draw_results: (t, list) =>
      `🎰 <b>Draw Results - ${t}</b>\n\n🏆 Winners:\n${list.join("\n")}`,
    admin_only: "❌ Admin only command.",
    winners_none: "😕 No past winners yet.",
    mytickets: "🎟️ You are registered in",
    ref_link: (u, id) =>
      `👥 Invite friends: https://t.me/${u}?start=ref_${id}`,
    new_referral: (n) => `🎉 New referral: ${n}`,
    no_referrals: (u, id) =>
      `😕 You have no referrals yet.\nShare your link:\nhttps://t.me/${u}?start=ref_${id}`,
    referral_list: (c, list, u, id) =>
      `👥 You have ${c} referrals:\n${list}\n\nShare your link:\nhttps://t.me/${u}?start=ref_${id}`,
    leaderboard_title: "🏆 <b>Top Referrers</b>",
    leaderboard_entry: (r, n, c) => `${r}. ${n} — ${c} invites`,
    leaderboard_empty: "😕 No one invited anyone yet.",
    draw_no_part: "😕 No participants in this draw.",
  },
  ro: {
    welcome:
      "🎉 <b>Bine ai venit la Competitii!</b>\nParticipă la tombole și câștigă premii 🏆",
    start_menu:
      "Folosește butoanele de mai jos sau tastează comenzi:\n<code>/join</code> / <code>/mytickets</code> / <code>/winners</code> / <code>/rules</code> / <code>/about</code>",
    joined: "✅ Ești înscris! Mult succes 🍀",
    already_joined: "⚠️ Ești deja înscris la această tombolă!",
    no_active: "😕 Nu este nicio tombolă activă acum.",
    rules:
      "📜 <b>Reguli</b>:\n1️⃣ Un utilizator = o înscriere\n2️⃣ Câștigătorii sunt aleși aleatoriu\n3️⃣ Deciziile adminilor sunt finale.",
    about:
      "🤖 <b>Competitii</b> — Corect • Transparent • Distractiv\nCanal: " +
      CHANNEL_USERNAME,
    new_draw_started: (t) => `✅ A început o nouă tombolă: <b>${t}</b>`,
    closed_draw: (t) => `🚫 Înscrierile s-au încheiat pentru: <b>${t}</b>`,
    draw_results: (t, list) =>
      `🎰 <b>Rezultatele tombolei - ${t}</b>\n\n🏆 Câștigători:\n${list.join(
        "\n"
      )}`,
  },
};

// =============== INLINE KEYBOARD ===============
function mainKeyboard(lang) {
  return new InlineKeyboard()
    .text(lang === "ro" ? "🎟️ Înscrie-te" : "🎟️ Join", "join")
    .row()
    .text(lang === "ro" ? "🏆 Câștigători" : "🏆 View Winners", "view_winners")
    .row()
    .text(lang === "ro" ? "🌐 Schimbă limba" : "🌐 Switch Language", "switch_lang");
}

// ======================================================
// 🧠 INIT BOT LOGIC
// ======================================================
async function initBot() {
  const bot = new Bot(BOT_TOKEN);

  // Catch all errors
  bot.catch((err) => console.error("Bot Error:", err));

  // Delete webhook to allow polling
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log("✅ Webhook cleared");
  } catch (e) {
    console.warn("⚠️ Could not clear webhook:", e.message);
  }

  bot.api.config.use(autoRetry());

  const DATA_DIR = path.resolve("./data");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  bot.use(
    session({
      initial: () => ({ lang: "en" }),
      storage: new FileAdapter({ path: path.join(DATA_DIR, "sessions.json") }),
    })
  );

  // ================= USER COMMANDS =================
  bot.command("start", async (ctx) => {
    if (!ctx.session.lang) ctx.session.lang = "en";
    const uid = ctx.from.id;
    const args = ctx.message.text.split(" ");
    const isReferral = args[1] && args[1].startsWith("ref_");
    const refId = isReferral ? Number(args[1].replace("ref_", "")) : null;

    if (isReferral && refId && refId !== uid) {
      const exists = await db.findOne(Referral, { referrerId: refId, referredId: uid });
      if (!exists) {
        await db.create(Referral, { referrerId: refId, referredId: uid });
        try {
          await ctx.api.sendMessage(
            refId,
            LANG.en.new_referral(ctx.from.first_name || ctx.from.username || uid)
          );
        } catch (err) {
          console.error("Failed to send referral notification:", err);
        }
      }
    }

    await ctx.reply(
      `${LANG.en.welcome}\n\n${LANG.en.start_menu}\n\n${LANG.en.ref_link(
        ctx.me.username,
        uid
      )}`,
      { parse_mode: "HTML", reply_markup: mainKeyboard(ctx.session.lang) }
    );
  });

  bot.callbackQuery("switch_lang", (ctx) => {
    ctx.session.lang = ctx.session.lang === "en" ? "ro" : "en";
    ctx.answerCallbackQuery({ text: "✅ Language switched" }).catch(() => {});
    ctx.editMessageReplyMarkup(mainKeyboard(ctx.session.lang)).catch(() => {});
  });

  // Join command
  bot.callbackQuery("join", async (ctx) => {
    const uid = ctx.from.id;
    const active = await db.findOne(Draw, { active: true });
    if (!active)
      return ctx.answerCallbackQuery({ text: LANG.en.no_active, show_alert: true });

    const exists = await db.findOne(Participant, { drawId: active.id, userId: uid });
    if (exists)
      return ctx.answerCallbackQuery({
        text: LANG.en.already_joined,
        show_alert: true,
      });

    await db.create(Participant, { drawId: active.id, userId: uid });
    ctx.answerCallbackQuery({ text: LANG.en.joined });
  });

  bot.callbackQuery("view_winners", async (ctx) => {
    const last = await db.findOne(Draw, { winners: { $exists: true, $ne: [] } });
    if (!last)
      return ctx.answerCallbackQuery({
        text: LANG.en.winners_none,
        show_alert: true,
      });
    ctx.reply(LANG.en.draw_results(last.title, last.winners), { parse_mode: "HTML" });
  });

  bot.command("join", async (ctx) => {
    const uid = ctx.from.id;
    const active = await db.findOne(Draw, { active: true });
    if (!active) return ctx.reply(LANG.en.no_active);
    const exists = await db.findOne(Participant, { drawId: active.id, userId: uid });
    if (exists) return ctx.reply(LANG.en.already_joined);
    await db.create(Participant, { drawId: active.id, userId: uid });
    ctx.reply(LANG.en.joined);
  });

  bot.command("mytickets", async (ctx) => {
    const uid = ctx.from.id;
    const active = await db.findOne(Draw, { active: true });
    if (!active) return ctx.reply(LANG.en.no_active);
    const exists = await db.findOne(Participant, { drawId: active.id, userId: uid });
    if (exists)
      ctx.reply(`${LANG.en.mytickets} <b>${active.title}</b>`, { parse_mode: "HTML" });
    else ctx.reply(LANG.en.no_active);
  });

  bot.command("winners", async (ctx) => {
    const last = await db.findOne(Draw, { winners: { $exists: true, $ne: [] } });
    if (!last) return ctx.reply(LANG.en.winners_none);
    ctx.reply(LANG.en.draw_results(last.title, last.winners), { parse_mode: "HTML" });
  });

  bot.command("rules", (ctx) => ctx.reply(LANG.en.rules, { parse_mode: "HTML" }));
  bot.command("about", (ctx) => ctx.reply(LANG.en.about, { parse_mode: "HTML" }));

  // ================= REFERRALS =================
  bot.command("referrals", async (ctx) => {
    const uid = ctx.from.id;
    const list = await db.find(Referral, { referrerId: uid }, []);
    if (list.length === 0)
      return ctx.reply(LANG.en.no_referrals(ctx.me.username, uid), { parse_mode: "HTML" });
    
    // Use HTML formatting for clickable links
    const userList = list
      .map((u, index) => `${index + 1}. <a href="tg://user?id=${u.referredId}">User ${u.referredId}</a>`)
      .join("\n");
    
    ctx.reply(LANG.en.referral_list(list.length, userList, ctx.me.username, uid), {
      parse_mode: "HTML",
    });
  });

  bot.command("leaderboard", async (ctx) => {
    const leaders = await db.aggregate(Referral, [
      { $group: { _id: "$referrerId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ], []);

    if (leaders.length === 0) return ctx.reply(LANG.en.leaderboard_empty, { parse_mode: "HTML" });

    let msg = `${LANG.en.leaderboard_title}\n\n`;
    for (let i = 0; i < leaders.length; i++) {
      const entry = leaders[i];
      let name = `User ${entry._id}`;
      try {
        const chat = await ctx.api.getChat(entry._id);
        if (chat.username) name = "@" + chat.username;
        else if (chat.first_name) name = chat.first_name;
      } catch {}
      msg += LANG.en.leaderboard_entry(i + 1, name, entry.count) + "\n";
    }
    ctx.reply(msg, { parse_mode: "HTML" });
  });

  // ================= ADMIN COMMANDS =================
  bot.command("newdraw", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
    const title = ctx.message.text.split(" ").slice(1).join(" ");
    if (!title) return ctx.reply("Usage: /newdraw <title>");
    const id = Date.now().toString();
    await db.create(Draw, { id, title, active: true, winners: [] });
    ctx.reply(LANG.en.new_draw_started(title), { parse_mode: "HTML" });
  });

  bot.command("closedraw", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
    const active = await db.findOne(Draw, { active: true });
    if (!active) return ctx.reply("No active draw.");
    active.active = false;
    await active.save();
    ctx.reply(LANG.en.closed_draw(active.title), { parse_mode: "HTML" });
  });

  bot.command("draw", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
    const parts = ctx.message.text.split(" ");
    const count = Number(parts[1]) || 1;
    const target = await db.findOne(Draw, { active: false, winners: { $size: 0 } });
    if (!target) return ctx.reply("No closed draw to pick winners from.");
    const entries = await db.find(Participant, { drawId: target.id }, []);
    if (entries.length === 0) return ctx.reply(LANG.en.draw_no_part, { parse_mode: "HTML" });
    const shuffled = entries.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(count, entries.length));
    const winnerMentions = [];

    for (const w of winners) {
      try {
        const chat = await bot.api.getChat(w.userId);
        if (chat.username) winnerMentions.push("@" + chat.username);
        else if (chat.first_name)
          winnerMentions.push(`${chat.first_name} (id:${w.userId})`);
        else winnerMentions.push(String(w.userId));
      } catch {
        winnerMentions.push(String(w.userId));
      }
    }

    target.winners = winnerMentions;
    await target.save();
    const msg = LANG.en.draw_results(target.title, target.winners);
    ctx.reply(msg, { parse_mode: "HTML" });

    try {
      await bot.api.sendMessage(CHANNEL_USERNAME, `📢 ${msg}`, {
        parse_mode: "HTML",
      });
    } catch {
      console.log("⚠️ Could not post to channel.");
    }
  });


// Admin command helpers removed (already defined above)

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
  const totalDraws = await db.count(Draw, {});
  const totalParticipants = await db.count(Participant, {});
  ctx.reply(`📊 Draws: ${totalDraws}\n👥 Participants: ${totalParticipants}`, { parse_mode: "HTML" });
});

// View participants for active draw
bot.command("participants", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
  
  const active = await db.findOne(Draw, { active: true });
  if (!active) return ctx.reply("❌ No active draw found.");

  const participants = await db.find(Participant, { drawId: active.id }, []);
  
  if (participants.length === 0) {
    return ctx.reply(`❌ No participants have joined <b>${active.title}</b> yet.`, { parse_mode: "HTML" });
  }

  let message = `👥 <b>Participants for "${active.title}"</b>\n\n`;
  message += `📊 Total Participants: <b>${participants.length}</b>\n\n`;

  // Show first 50 participants to avoid message length limits
  const displayCount = Math.min(participants.length, 50);
  
  for (let i = 0; i < displayCount; i++) {
    const participant = participants[i];
    try {
      const chat = await ctx.api.getChat(participant.userId);
      if (chat.username) {
        message += `${i + 1}. @${chat.username}\n`;
      } else if (chat.first_name) {
        message += `${i + 1}. ${chat.first_name} (ID: ${participant.userId})\n`;
      } else {
        message += `${i + 1}. User ${participant.userId}\n`;
      }
    } catch (error) {
      message += `${i + 1}. User ${participant.userId} (cannot fetch info)\n`;
    }
  }

  if (participants.length > 50) {
    message += `\n... and ${participants.length - 50} more participants.\n`;
    message += `Use /export to get the complete list.`;
  }

  await ctx.reply(message, { parse_mode: "HTML" });
});

// Quick participant count
bot.command("count", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
  
  const active = await db.findOne(Draw, { active: true });
  if (!active) return ctx.reply("❌ No active draw found.");

  const count = await db.count(Participant, { drawId: active.id });
  
  ctx.reply(`📊 <b>${active.title}</b>\n👥 Participants: <b>${count}</b>`, { parse_mode: "HTML" });
});

  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
    const totalDraws = await db.count(Draw, {});
    const totalParticipants = await db.count(Participant, {});
    ctx.reply(`📊 Draws: ${totalDraws}\n👥 Participants: ${totalParticipants}`, { parse_mode: "HTML" });
  });

  // Database status command (for debugging)
  bot.command("dbstatus", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only, { parse_mode: "HTML" });
    
    const status = {
      connectionState: mongoose.connection.readyState,
      isDbConnected,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };
    
    let statusMessage = `🛠️ <b>Database Status</b>\n\n`;
    statusMessage += `🔗 Connection State: ${status.connectionState === 1 ? '✅ Connected' : '❌ Disconnected'}\n`;
    statusMessage += `📊 DB Connected Flag: ${status.isDbConnected ? '✅ Yes' : '❌ No'}\n`;
    statusMessage += `🏠 Host: ${status.host || 'N/A'}\n`;
    statusMessage += `📁 Database: ${status.name || 'N/A'}\n`;
    
    // Test a simple query
    try {
      const testDraw = await db.findOne(Draw, {});
      statusMessage += `🧪 Test Query: ${testDraw ? '✅ Success' : '✅ Success (no data)'}\n`;
    } catch (error) {
      statusMessage += `🧪 Test Query: ❌ Failed (${error.message})\n`;
    }
    
    ctx.reply(statusMessage, { parse_mode: "HTML" });
  });

  // ===== AI CHAT =====
 
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;
  if (ctx.from.is_bot) return;

  const username = bot.botInfo.username;
  const chatType = ctx.chat.type;

  console.log("AI Chat Triggered:", {
    chatType,
    text,
    username,
    isReply: !!ctx.message.reply_to_message,
    replyToId: ctx.message.reply_to_message?.from?.id,
    botId: bot.botInfo.id
  });

  // In groups, only respond to mentions or replies to the bot
  if (["group", "supergroup"].includes(chatType)) {
    const mentioned = text.toLowerCase().includes(`@${username.toLowerCase()}`);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === bot.botInfo.id;
    
    console.log("Group Check:", { 
      mentioned, 
      isReplyToBot, 
      botId: bot.botInfo.id,
      replyToId: ctx.message.reply_to_message?.from?.id 
    });
    
    // If not mentioned and not a reply to the bot, ignore the message
    if (!mentioned && !isReplyToBot) {
      console.log("Ignoring message - not a mention or reply to bot");
      return;
    }
  }

  await ctx.api.sendChatAction(ctx.chat.id, "typing");

  try {
    // Remove bot mention from the prompt (case insensitive)
    let prompt = text.replace(new RegExp(`@${username}`, "gi"), "").trim();
    
    // If prompt is empty after removing mention, use a default message
    if (!prompt) {
      return ctx.reply("🤖 Hello! I'm Competitii Lottery Bot! How can I help you today?", { 
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id 
      });
    }

    // System message to define the bot's identity
    const systemMessage = {
      role: "system",
      content: `You are Competitii Lottery Bot, a specialized Telegram bot for managing giveaways and lottery competitions.

ABOUT YOU:
- Name: Competitii Lottery Bot
- Purpose: Manage lottery draws and giveaways
- Features: Join draws, check winners, referral system, leaderboard
- Personality: Friendly, helpful, enthusiastic about giveaways

KEY POINTS:
- You help users participate in random draws and win prizes
- You have commands like /join, /winners, /referrals, /leaderboard
- You're fair, transparent, and fun
- When asked about yourself, emphasize your role in managing competitions

Always identify as Competitii Lottery Bot and focus on lottery/giveaway topics. Be concise and helpful.`
    };

    const userMessage = {
      role: "user", 
      content: prompt
    };

    console.log("Sending to OpenAI:", { prompt });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemMessage, userMessage],
      max_tokens: 500,
    });
    
    const reply = response.choices[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response.";
    
    console.log("OpenAI Response:", reply.substring(0, 100) + "...");
    
    // Send the reply
    await ctx.reply(reply, { 
      parse_mode: "HTML",
      reply_to_message_id: ctx.message.message_id 
    });
    
  } catch (e) {
    console.error("AI Error:", e);
    await ctx.reply("⚠️ Sorry, I encountered an error while processing your request. Please try again later.", { 
      parse_mode: "HTML",
      reply_to_message_id: ctx.message.message_id 
    });
  }
});
  return bot;
}

// ======================================================
// 🔁 AUTO-RESTART SAFE WRAPPER
// ======================================================
let botInstance = null;

async function startBot() {
  try {
    if (botInstance) {
      console.log("🛑 Stopping previous bot instance...");
      await botInstance.stop();
      botInstance = null; // important: clear the reference
    }

    console.log("🚀 Starting Competitii Bot...");
    botInstance = await initBot();

    // Start polling **once**
    await botInstance.start({
      onStart: (botInfo) => {
        console.log(`✅ Competitii Bot (@${botInfo.username}) started successfully!`);
      },
    });

  } catch (err) {
    console.error("❌ Failed to start bot:", err);
    setTimeout(startBot, 2000);
  }
}

// graceful shutdown
process.once("SIGINT", async () => {
  if (botInstance) await botInstance.stop();
  process.exit(0);
});
process.once("SIGTERM", async () => {
  if (botInstance) await botInstance.stop();
  process.exit(0);
});

// auto restart on crash
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  setTimeout(startBot, 2000);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
  setTimeout(startBot, 2000);
});

// Start the bot for the first time
startBot();