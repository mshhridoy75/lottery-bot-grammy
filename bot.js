/**
 * 🌟 Competitii Bot (Node.js + grammY + MongoDB + OpenAI)
 * - Persistent sessions via @grammyjs/session + @grammyjs/storage-file
 * - Auto retry for failed Telegram API requests (@grammyjs/auto-retry)
 * - Inline buttons, bilingual (EN/RO), admin draw tools
 * - Referral + Leaderboard system
 */


import 'dotenv/config';
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

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN not found in .env");
  process.exit(1);
}

// =============== DATABASE ===============
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB connection error:", err));

const drawSchema = new mongoose.Schema({
  id: String,
  title: String,
  active: Boolean,
  winners: [String],
}, { timestamps: true });

const participantSchema = new mongoose.Schema({
  drawId: String,
  userId: Number,
}, { timestamps: true });

const referralSchema = new mongoose.Schema({
  referrerId: Number,
  referredId: Number,
}, { timestamps: true });

const Draw = mongoose.model("Draw", drawSchema);
const Participant = mongoose.model("Participant", participantSchema);
const Referral = mongoose.model("Referral", referralSchema);

// =============== BOT SETUP ===============
const bot = new Bot(BOT_TOKEN);
bot.api.config.use(autoRetry());

const DATA_DIR = path.resolve("./data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

bot.use(session({
  initial: () => ({ lang: "en" }),
  storage: new FileAdapter({ path: path.join(DATA_DIR, "sessions.json") }),
}));

// =============== LANGUAGE PACK ===============
const LANG = {
  en: {
    welcome: "🎉 Welcome to Competitii!\nJoin random giveaways and win prizes 🏆",
    start_menu: "Use the buttons below or type commands.\nCommands: /join /mytickets /winners /rules /about",
    joined: "✅ You're in! Good luck 🍀",
    already_joined: "⚠️ You already joined this draw!",
    no_active: "😕 No active draw right now. Stay tuned on our channel!",
    mytickets: "🎟️ You are in the current draw:",
    winners_none: "No winners announced yet.",
    rules: "📜 Rules:\n1) Join active draws.\n2) One user = one entry.\n3) Winners are chosen randomly.\n4) Admin decisions are final.",
    about: "🤖 Competitii — Fair • Transparent • Fun\nChannel: " + CHANNEL_USERNAME,
    admin_only: "❌ This command is for admin only.",
    new_draw_started: (t) => `✅ New draw started: *${t}*`,
    closed_draw: (t) => `🚫 Entries closed for: *${t}*`,
    draw_no_part: "No participants in this draw.",
    draw_results: (t, list) => `🎰 Draw Results - ${t}\n\n🏆 Winners:\n${list.join("\n")}`,
    prompt_draw_count: "Usage: /draw <count>",
    ref_link: (username, uid) => `🔗 Your referral link:\nhttps://t.me/${username}?start=ref_${uid}`,
    new_referral: (name) => `👥 New referral joined: ${name}`,
    no_referrals: (username, uid) => `😕 You haven't referred anyone yet.\nShare your link:\nhttps://t.me/${username}?start=ref_${uid}`,
    referral_list: (count, list, username, uid) =>
      `👥 You have referred *${count}* user(s):\n${list}\n\nKeep sharing your link!\nhttps://t.me/${username}?start=ref_${uid}`,
    leaderboard_empty: "📊 No referrals yet. Be the first!",
    leaderboard_title: "🏆 *Top Inviters*",
    leaderboard_entry: (rank, name, count) => `${rank}. ${name} — ${count} referrals`,
  },
  ro: {
    welcome: "🎉 Salut! Bine ai venit la Competitii!\nParticipă la tombole și câștigă premii 🏆",
    start_menu: "Folosește butoanele de mai jos sau tastează comenzi.\nComenzi: /join /mytickets /winners /rules /about",
    joined: "✅ Ești înscris! Mult succes 🍀",
    already_joined: "⚠️ Ești deja înscris la această tombolă!",
    no_active: "😕 Nu este nicio tombolă activă acum. Urmărește canalul nostru!",
    mytickets: "🎟️ Ești înscris la tombola curentă:",
    winners_none: "Nu au fost anunțați câștigători încă.",
    rules: "📜 Reguli:\n1) Folosește Join pentru a intra la tombolele active.\n2) Un utilizator = o înscriere.\n3) Câștigătorii sunt aleși la întâmplare.\n4) Deciziile adminilor sunt finale.",
    about: "🤖 Competitii — Corect • Transparent • Distractiv\nCanal: " + CHANNEL_USERNAME,
    admin_only: "❌ Această comandă este doar pentru admin.",
    new_draw_started: (t) => `✅ A început o nouă tombolă: *${t}*`,
    closed_draw: (t) => `🚫 Înscrierile s-au încheiat pentru: *${t}*`,
    draw_no_part: "Nu există participanți la această tombolă.",
    draw_results: (t, list) => `🎰 Rezultatele tombolei - ${t}\n\n🏆 Câștigători:\n${list.join("\n")}`,
    prompt_draw_count: "Utilizare: /draw <număr>",
  },
};

// =============== HELPERS ===============
const mainKeyboard = (lang) =>
  new InlineKeyboard()
    .text(lang === "ro" ? "🎟️ Înscrie-te" : "🎟️ Join", "join")
    .row()
    .text(lang === "ro" ? "🏆 Câștigători" : "🏆 View Winners", "view_winners")
    .row()
    .text(lang === "ro" ? "🌐 Schimbă limba" : "🌐 Switch Language", "switch_lang");

// =============== COMMANDS ===============
bot.command("start", async (ctx) => {
  const uid = ctx.from.id;
  const args = ctx.message.text.split(" ");
  const refTag = args[1];
  if (refTag && refTag.startsWith("ref_")) {
    const refId = Number(refTag.replace("ref_", ""));
    if (refId && refId !== uid) {
      const exists = await Referral.findOne({ referrerId: refId, referredId: uid });
      if (!exists) {
        await Referral.create({ referrerId: refId, referredId: uid });
        try {
          await ctx.api.sendMessage(refId, LANG.en.new_referral(ctx.from.first_name || ctx.from.username || uid));
        } catch {}
      }
    }
  }

  ctx.reply(
    `${LANG.en.welcome}\n\n${LANG.en.start_menu}\n\n${LANG.en.ref_link(ctx.me.username, uid)}`,
    { reply_markup: mainKeyboard(ctx.session.lang) }
  );
});

bot.callbackQuery("switch_lang", async (ctx) => {
  ctx.session.lang = ctx.session.lang === "en" ? "ro" : "en";
  await ctx.answerCallbackQuery({ text: "Language switched ✅" });
  await ctx.editMessageReplyMarkup(mainKeyboard(ctx.session.lang));
});

bot.callbackQuery("join", async (ctx) => {
  const uid = ctx.from.id;
  const active = await Draw.findOne({ active: true });
  if (!active)
    return ctx.answerCallbackQuery({ text: LANG.en.no_active, show_alert: true });
  const already = await Participant.findOne({ drawId: active.id, userId: uid });
  if (already)
    return ctx.answerCallbackQuery({ text: LANG.en.already_joined, show_alert: true });
  await Participant.create({ drawId: active.id, userId: uid });
  await ctx.answerCallbackQuery({ text: LANG.en.joined });
});

bot.callbackQuery("view_winners", async (ctx) => {
  const last = await Draw.findOne({ winners: { $exists: true, $ne: [] } }).sort({ createdAt: -1 });
  if (!last)
    return ctx.answerCallbackQuery({ text: LANG.en.winners_none, show_alert: true });
  await ctx.reply(LANG.en.draw_results(last.title, last.winners));
});

bot.command("newdraw", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const title = ctx.message.text.split(" ").slice(1).join(" ");
  if (!title) return ctx.reply("Usage: /newdraw <title>");
  const id = Date.now().toString();
  await Draw.create({ id, title, active: true, winners: [] });
  ctx.reply(LANG.en.new_draw_started(title), { parse_mode: "Markdown" });
});

bot.command("closedraw", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const active = await Draw.findOne({ active: true });
  if (!active) return ctx.reply("No active draw.");
  active.active = false;
  await active.save();
  ctx.reply(LANG.en.closed_draw(active.title), { parse_mode: "Markdown" });
});

bot.command("draw", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const count = Number(ctx.message.text.split(" ")[1]) || 1;
  const draw = await Draw.findOne({ active: false, winners: { $size: 0 } }).sort({ createdAt: -1 });
  if (!draw) return ctx.reply("No closed draw available.");
  const participants = await Participant.find({ drawId: draw.id });
  if (participants.length === 0) return ctx.reply(LANG.en.draw_no_part);
  const shuffled = participants.sort(() => 0.5 - Math.random()).slice(0, count);
  const winners = [];
  for (const p of shuffled) {
    try {
      const chat = await bot.api.getChat(p.userId);
      winners.push(chat.username ? "@" + chat.username : chat.first_name || p.userId);
    } catch {
      winners.push(String(p.userId));
    }
  }
  draw.winners = winners;
  await draw.save();
  const msg = LANG.en.draw_results(draw.title, winners);
  await ctx.reply(msg, { parse_mode: "Markdown" });
  try {
    await bot.api.sendMessage(CHANNEL_USERNAME, `📢 *Competitii Draw Results*\n\n${msg}`, { parse_mode: "Markdown" });
  } catch {}
});

bot.command("leaderboard", async (ctx) => {
  const board = await Referral.aggregate([
    { $group: { _id: "$referrerId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  if (!board.length) return ctx.reply(LANG.en.leaderboard_empty);
  let msg = `${LANG.en.leaderboard_title}\n\n`;
  for (let i = 0; i < board.length; i++) {
    const e = board[i];
    let name = `User ${e._id}`;
    try {
      const chat = await ctx.api.getChat(e._id);
      name = chat.username ? "@" + chat.username : chat.first_name || name;
    } catch {}
    msg += LANG.en.leaderboard_entry(i + 1, name, e.count) + "\n";
  }
  ctx.reply(msg, { parse_mode: "Markdown" });
});
// --- /stats ---
bot.command("stats", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const totalDraws = await Draw.countDocuments();
  const totalParts = await Participant.countDocuments();
  const totalRefs = await Referral.countDocuments();
  ctx.reply(`📊 Stats:\n🎟️ Draws: ${totalDraws}\n👥 Participants: ${totalParts}\n🔗 Referrals: ${totalRefs}`);
});

// --- /backupdb ---
bot.command("backupdb", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply(LANG.en.admin_only);
  const backup = {
    draws: await Draw.find(),
    participants: await Participant.find(),
    referrals: await Referral.find(),
  };
  const file = path.join(DATA_DIR, `backup_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  await ctx.replyWithDocument(new InputFile(file));
});

// =============== AI CHAT ===============
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text?.trim();
  if (!text || text.startsWith("/")) return;
  if (ctx.from.is_bot) return;

  const chatType = ctx.chat.type;
  const username = bot.botInfo?.username || "competitii_bot";
  if (["group", "supergroup", "channel"].includes(chatType)) {
    const isMention = text.includes(`@${username}`);
    const isReplyToBot = ctx.message.reply_to_message?.from?.username === username;
    if (!isMention && !isReplyToBot) return;
  }

  await ctx.reply("🤖 Thinking...");
  try {
    const clean = text.replace(`@${username}`, "").trim();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: clean }],
    });
    const reply = completion.choices[0]?.message?.content || "Hmm... nu am un răspuns acum.";
    await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id });
  } catch (e) {
    console.error("AI Error:", e);
    await ctx.reply("⚠️ Oops, ceva nu a mers bine cu AI-ul.");
  }
});

// =============== START ===============

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

(async () => {
  try {
    console.log("🚀 Starting Competitii Bot...");
    await bot.api.deleteWebhook();
    await bot.init();
    await bot.start();
    console.log(`✅ Competitii Bot (@${bot.botInfo.username}) started!`);
  } catch (err) {
    console.error("❌ Failed to start bot:", err);
  }
})();
