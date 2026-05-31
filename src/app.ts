import "dotenv/config";
import express from "express";
import { promises as fs } from "fs";
import { Markup, Telegraf } from "telegraf";

type Item = { title: string; price?: number; description?: string; active: boolean };
type MediaItem = {
  id: string;
  type: "photo" | "video" | "document";
  fileId: string;
  title?: string;
  caption?: string;
  category?: string;
  tags?: string[];
  uploadedBy?: number;
  createdAt: string;
  active: boolean;
  views?: number;
  downloads?: number;
};
type PaymentOrder = {
  id: string;
  chatId: number;
  username?: string;
  title: string;
  amount: number;
  authority?: string;
  refId?: string;
  status: "PENDING" | "PAID" | "FAILED" | "CANCELED";
  createdAt: string;
  paidAt?: string;
};
type Settings = {
  businessName: string;
  welcomeMessage: string;
  supportContact: string;
  aboutText: string;
  items: Item[];
  mediaItems: MediaItem[];
  mediaCategories: string[];
  forceJoinEnabled: boolean;
  forceJoinChannel: string;
  autoDeleteSeconds: number;
  formQuestions: string[];
  payment: {
    paymentLink: string;
    cardNumber: string;
    cardHolder: string;
    zarinpalMerchantId: string;
    zarinpalSandbox: boolean;
    note: string;
  };
  admins: number[];
  orders: PaymentOrder[];
};

type UserSession = {
  mode: "form" | "support" | "reservation" | "service" | "shop" | "course" | "media";
  step: number;
  answers: string[];
  meta?: Record<string, string>;
};

type AdminState =
  | { action: "ADD_ITEM" }
  | { action: "EDIT_ITEM"; index: number }
  | { action: "EDIT_FIELD"; field: "businessName" | "welcomeMessage" | "supportContact" | "aboutText" }
  | { action: "EDIT_FORM_QUESTIONS" }
  | { action: "SET_MEDIA_CATEGORIES" }
  | { action: "SET_FORCE_JOIN" }
  | { action: "SET_AUTO_DELETE" }
  | { action: "SET_CARD" }
  | { action: "SET_PAYMENT_LINK" }
  | { action: "SET_ZARINPAL" }
  | { action: "TOGGLE_ZARINPAL_SANDBOX" }
  | { action: "ADD_ADMIN" }
  | { action: "BROADCAST" };

const token = process.env.CUSTOMER_BOT_TOKEN;
const primaryAdminId = Number(process.env.CUSTOMER_ADMIN_ID || "0");
const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
const dataPath = process.env.SETTINGS_FILE || "./data/settings.json";
const testExpiresAt = Number(process.env.TEST_EXPIRES_AT || "0");

const bot = new Telegraf(token || "missing");
const app = express();
app.use(express.json());

const status = { ready: false, startedAt: new Date().toISOString(), error: null as string | null };

const TEMPLATE_CODE: string = "MEDIA_GALLERY";
const TEMPLATE_TITLE = "فیلم و عکس / آرشیو رسانه";
const FEATURES = [
  "آپلود فیلم و عکس",
  "دسته‌بندی رسانه",
  "پنل مدیریت رسانه",
  "پنل مدیریت ساده",
  "پرداخت کارت‌به‌کارت و تایید رسید"
];
const FEATURE_CODES = [
  "MEDIA_UPLOAD",
  "MEDIA_CATEGORIES",
  "MEDIA_ADMIN",
  "ADMIN_PANEL",
  "CARD_TO_CARD"
];
const HAS_PAYMENT_GATEWAY = false;
const HAS_CARD_TO_CARD = true;
const HAS_ADMIN_PANEL = true;
const DETAILS_RAW = "{\n  \"mode\": \"options\",\n  \"template\": \"MEDIA_GALLERY\",\n  \"platform\": \"TELEGRAM\",\n  \"flags\": [\n    \"search\",\n    \"latest\",\n    \"userRequests\",\n    \"popular\"\n  ],\n  \"flagTitles\": [\n    \"🔍 جستجوی فیلم/عکس\",\n    \"📩 درخواست فیلم توسط کاربر\",\n    \"🆕 بخش جدیدترین‌ها در منوی کاربر\",\n    \"🔥 بخش پربازدیدترین‌ها در منوی کاربر\"\n  ],\n  \"categories\": [\n    \"فیلم ایرانی\",\n    \"سریال خارجی\",\n    \"انیمیشن\",\n    \"کلیپ\",\n    \"عکس\",\n    \"آموزشی\",\n    \"مستند\",\n    \"سریال ایرانی\",\n    \"فیلم خارجی\"\n  ],\n  \"contentModel\": \"FREE\",\n  \"autoDeleteSeconds\": 300,\n  \"raw\": \"قالب: فیلم و عکس / آرشیو رسانه\\nپلتفرم: 🤖 ربات تلگرام\\nامکانات انتخاب‌شده: 🔍 جستجوی فیلم/عکس، 📩 درخواست فیلم توسط کاربر، 🆕 بخش جدیدترین‌ها در منوی کاربر، 🔥 بخش پربازدیدترین‌ها در منوی کاربر\\nدسته‌ها: فیلم ایرانی، سریال خارجی، انیمیشن، کلیپ، عکس، آموزشی، مستند، سریال ایرانی، فیلم خارجی\\nحذف خودکار: 300 ثانیه\\nمدل محتوا: FREE\\nقفل عضویت: اگر فعال باشد، کانال از پنل مدیریت ربات مشتری تنظیم می‌شود.\"\n}";
const DETAIL_LINES = [
  "فیلم ایرانی",
  "سریال خارجی",
  "انیمیشن",
  "کلیپ",
  "عکس",
  "آموزشی",
  "مستند",
  "سریال ایرانی",
  "فیلم خارجی"
];
const DETAIL_SPEC: any = {
  "mode": "options",
  "template": "MEDIA_GALLERY",
  "platform": "TELEGRAM",
  "flags": [
    "search",
    "latest",
    "userRequests",
    "popular"
  ],
  "flagTitles": [
    "🔍 جستجوی فیلم/عکس",
    "📩 درخواست فیلم توسط کاربر",
    "🆕 بخش جدیدترین‌ها در منوی کاربر",
    "🔥 بخش پربازدیدترین‌ها در منوی کاربر"
  ],
  "categories": [
    "فیلم ایرانی",
    "سریال خارجی",
    "انیمیشن",
    "کلیپ",
    "عکس",
    "آموزشی",
    "مستند",
    "سریال ایرانی",
    "فیلم خارجی"
  ],
  "contentModel": "FREE",
  "autoDeleteSeconds": 300,
  "raw": "قالب: فیلم و عکس / آرشیو رسانه\nپلتفرم: 🤖 ربات تلگرام\nامکانات انتخاب‌شده: 🔍 جستجوی فیلم/عکس، 📩 درخواست فیلم توسط کاربر، 🆕 بخش جدیدترین‌ها در منوی کاربر، 🔥 بخش پربازدیدترین‌ها در منوی کاربر\nدسته‌ها: فیلم ایرانی، سریال خارجی، انیمیشن، کلیپ، عکس، آموزشی، مستند، سریال ایرانی، فیلم خارجی\nحذف خودکار: 300 ثانیه\nمدل محتوا: FREE\nقفل عضویت: اگر فعال باشد، کانال از پنل مدیریت ربات مشتری تنظیم می‌شود."
};

const sessions = new Map<number, UserSession>();
const adminStates = new Map<number, AdminState>();
const knownUsers = new Set<number>();
let cachedSettings: Settings | null = null;

function parsePrice(input: string): number | undefined {
  const normalized = input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^0-9]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function formatToman(amount?: number) {
  if (!amount || amount <= 0) return "قیمت ثبت نشده";
  return new Intl.NumberFormat("fa-IR").format(amount) + " تومان";
}

function parseItemLine(line: string): Item {
  const parts = line.split(/\s*[|\-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const title = parts[0] || line.trim() || "آیتم بدون نام";
  const price = parsePrice(parts[1] || "");
  const description = parts.slice(price ? 2 : 1).join(" - ") || undefined;
  return { title, price, description, active: true };
}

function defaultItems() {
  if (Array.isArray(DETAIL_SPEC?.items) && DETAIL_SPEC.items.length) {
    return DETAIL_SPEC.items.map(parseItemLine);
  }
  if (TEMPLATE_CODE === "MEDIA_GALLERY" && Array.isArray(DETAIL_SPEC?.categories) && DETAIL_SPEC.categories.length) {
    return DETAIL_SPEC.categories.map((category: string) => ({ title: String(category), description: "دسته رسانه", active: true }));
  }
  const fallback: Record<string, string[]> = {
    SHOP: ["محصول نمونه | 100000 | توضیحات محصول", "خدمت نمونه | 200000 | توضیحات خدمت"],
    RESERVATION: ["مشاوره | 300000 | نوبت ۳۰ دقیقه‌ای", "ویزیت | 400000 | نوبت حضوری"],
    SERVICE_ORDER: ["خدمت اول | 500000 | توضیحات خدمت", "مشاوره | 300000 | بررسی اولیه"],
    COURSE_FILE: ["دوره نمونه | 600000 | فایل/ویدیو آموزشی"],
    SUPPORT: ["سوالات عمومی", "مشکل سفارش", "ارتباط با پشتیبانی"],
    MEDIA_GALLERY: ["فیلم‌های ایرانی", "سریال‌های خارجی", "انیمیشن", "عکس‌های آموزشی"],
    TEST_BOT: ["آیتم تست | 0 | نمونه رایگان ۵ دقیقه‌ای"],
    FORM: ["نام و نام خانوادگی", "شماره تماس", "توضیحات"]
  };
  const lines = DETAIL_LINES.length ? DETAIL_LINES : (fallback[TEMPLATE_CODE] || fallback.SERVICE_ORDER);
  if (TEMPLATE_CODE === "FORM") return [];
  return lines.map(parseItemLine);
}

function defaultFormQuestions() {
  if (TEMPLATE_CODE === "FORM") {
    return DETAIL_LINES.length ? DETAIL_LINES : ["نام و نام خانوادگی", "شماره تماس", "توضیحات یا درخواست شما"];
  }
  return ["نام و نام خانوادگی", "شماره تماس", "توضیحات"];
}

function defaultSettings(): Settings {
  return {
    businessName: "تیدیدید",
    welcomeMessage: "پیدیدژددیدژ",
    supportContact: "دیدیدژددی",
    aboutText: "این ربات به صورت خودکار ساخته شده و اطلاعات آن توسط مدیر ربات قابل ویرایش است.",
    items: defaultItems(),
    mediaItems: [],
    mediaCategories:
      TEMPLATE_CODE === "MEDIA_GALLERY"
        ? (Array.isArray(DETAIL_SPEC?.categories) && DETAIL_SPEC.categories.length
            ? DETAIL_SPEC.categories.map((x: string) => String(x))
            : defaultItems().map((x) => x.title))
        : [],
    forceJoinEnabled: Array.isArray(DETAIL_SPEC?.flags) ? DETAIL_SPEC.flags.includes("forceJoin") : false,
    forceJoinChannel: "",
    autoDeleteSeconds: Number.isFinite(Number(DETAIL_SPEC?.autoDeleteSeconds)) ? Number(DETAIL_SPEC.autoDeleteSeconds) : 0,
    formQuestions: defaultFormQuestions(),
    payment: {
      paymentLink: process.env.PAYMENT_LINK || "",
      cardNumber: process.env.CARD_NUMBER || "",
      cardHolder: process.env.CARD_HOLDER || "",
      zarinpalMerchantId: process.env.ZARINPAL_MERCHANT_ID || "",
      zarinpalSandbox: process.env.ZARINPAL_SANDBOX === "true",
      note: "بعد از پرداخت، رسید یا اطلاعات پرداخت را برای پشتیبانی ارسال کنید."
    },
    admins: primaryAdminId ? [primaryAdminId] : [],
    orders: []
  };
}

async function ensureDir() {
  const dir = dataPath.split("/").slice(0, -1).join("/");
  if (dir) await fs.mkdir(dir, { recursive: true });
}

async function loadSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = await fs.readFile(dataPath, "utf8");
    const parsed = JSON.parse(raw) as Settings;
    const base = defaultSettings();
    cachedSettings = {
      ...base,
      ...parsed,
      payment: { ...base.payment, ...(parsed.payment || {}) },
      orders: Array.isArray((parsed as any).orders) ? (parsed as any).orders : [],
      mediaItems: Array.isArray((parsed as any).mediaItems) ? (parsed as any).mediaItems : [],
      mediaCategories: Array.isArray((parsed as any).mediaCategories) ? (parsed as any).mediaCategories : base.mediaCategories,
      forceJoinEnabled: typeof (parsed as any).forceJoinEnabled === "boolean" ? (parsed as any).forceJoinEnabled : base.forceJoinEnabled,
      forceJoinChannel: typeof (parsed as any).forceJoinChannel === "string" ? (parsed as any).forceJoinChannel : base.forceJoinChannel,
      autoDeleteSeconds: Number.isFinite(Number((parsed as any).autoDeleteSeconds)) ? Number((parsed as any).autoDeleteSeconds) : base.autoDeleteSeconds
    };
  } catch {
    cachedSettings = defaultSettings();
    await saveSettings(cachedSettings);
  }
  return cachedSettings;
}

async function saveSettings(settings: Settings) {
  cachedSettings = settings;
  await ensureDir();
  await fs.writeFile(dataPath, JSON.stringify(settings, null, 2), "utf8");
}

function isAdminId(chatId?: number) {
  if (!chatId) return false;
  const settings = cachedSettings;
  return chatId === primaryAdminId || !!settings?.admins.includes(chatId);
}

async function isAdmin(chatId?: number) {
  if (!chatId) return false;
  const settings = await loadSettings();
  return chatId === primaryAdminId || settings.admins.includes(chatId);
}

function userLabel(ctx: any) {
  return ctx.from?.username ? "@" + ctx.from.username : String(ctx.chat?.id || "unknown");
}

function userMenu(settings: Settings, showAdminButton = false) {
  const rows: string[][] = [];
  if (TEMPLATE_CODE === "MEDIA_GALLERY") {
    rows.push(["📂 دسته‌بندی‌ها", "🔍 جستجو"]);
    rows.push(["🆕 جدیدترین‌ها", "📩 درخواست محتوا"]);
  }
  else if (TEMPLATE_CODE === "TEST_BOT") rows.push(["🧪 تست ربات", "📝 شروع فرم"]);
  else if (TEMPLATE_CODE === "SHOP") rows.push(["🛍 محصولات", "🧾 ثبت سفارش"]);
  else if (TEMPLATE_CODE === "SUPPORT") rows.push(["🎫 ثبت تیکت", "❓ سوالات متداول"]);
  else if (TEMPLATE_CODE === "RESERVATION") rows.push(["📅 رزرو نوبت", "📋 خدمات"]);
  else if (TEMPLATE_CODE === "COURSE_FILE") rows.push(["🎓 دوره‌ها / فایل‌ها", "🧾 درخواست خرید"]);
  else if (TEMPLATE_CODE === "FORM") rows.push(["📝 شروع فرم", "ℹ️ راهنما"]);
  else rows.push(["📝 ثبت سفارش خدمات", "📋 خدمات"]);
  rows.push(["💳 پرداخت", "☎️ پشتیبانی"]);
  rows.push(["ℹ️ درباره ما"]);
  if (showAdminButton) rows.push(["🧰 پنل مدیریت"]);
  void settings;
  return Markup.keyboard(rows).resize();
}

async function menuFor(chatId: number | undefined, settings: Settings) {
  return userMenu(settings, await isAdmin(chatId));
}

function adminMenu() {
  const rows: string[][] = [
    ["🧰 پنل مدیریت"],
    ["📦 مدیریت آیتم‌ها", "✏️ ویرایش متن‌ها"],
  ];
  if (TEMPLATE_CODE === "MEDIA_GALLERY") {
    rows.push(["🎬 مدیریت رسانه", "🔒 قفل عضویت"]);
    rows.push(["⏱ حذف خودکار فایل", "📂 مدیریت دسته‌ها"]);
  }
  rows.push(["💳 تنظیم پرداخت", "📊 گزارش‌ها"]);
  rows.push(["📣 پیام همگانی", "👥 مدیریت ادمین‌ها"]);
  rows.push(["🔙 منوی کاربر"]);
  return Markup.keyboard(rows).resize();
}

function itemListText(settings: Settings) {
  if (!settings.items.length) return "هنوز آیتمی ثبت نشده است.";
  return settings.items
    .map((item, i) => String(i + 1) + ". " + (item.active ? "✅" : "⛔️") + " " + item.title + "\nقیمت: " + formatToman(item.price) + (item.description ? "\n" + item.description : ""))
    .join("\n\n");
}

function itemsInline(settings: Settings) {
  const rows = settings.items.slice(0, 20).flatMap((item, i) => [
    [Markup.button.callback("✏️ ویرایش " + String(i + 1), "ADM_ITEM_EDIT_" + String(i)), Markup.button.callback("🗑 حذف " + String(i + 1), "ADM_ITEM_DEL_" + String(i))]
  ]);
  rows.push([Markup.button.callback("➕ افزودن آیتم", "ADM_ITEM_ADD")]);
  return Markup.inlineKeyboard(rows);
}

function normalizeQuery(text: string) {
  return text.toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").trim();
}

function mediaCategories(settings: Settings) {
  const set = new Set<string>();
  for (const c of settings.mediaCategories || []) if (c.trim()) set.add(c.trim());
  for (const m of settings.mediaItems || []) if (m.active && m.category) set.add(m.category.trim());
  return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, "fa"));
}

function mediaCategoryInline(settings: Settings) {
  const cats = mediaCategories(settings);
  const rows = cats.length ? cats.map((cat) => [Markup.button.callback("📁 " + cat.slice(0, 40), "MEDIA_CAT_" + encodeURIComponent(cat))]) : [[Markup.button.callback("عمومی", "MEDIA_CAT_" + encodeURIComponent("عمومی"))]];
  rows.push([Markup.button.callback("🆕 جدیدترین‌ها", "MEDIA_LATEST")]);
  return Markup.inlineKeyboard(rows);
}

function mediaListInline(items: MediaItem[], page = 0) {
  const perPage = 8;
  const start = page * perPage;
  const selected = items.slice(start, start + perPage);
  const rows = selected.map((item, i) => [Markup.button.callback((item.type === "photo" ? "🖼 " : item.type === "video" ? "🎬 " : "📎 ") + (item.title || item.caption || "رسانه").slice(0, 45), "MEDIA_VIEW_" + String(start + i))]);
  if (!rows.length) rows.push([Markup.button.callback("موردی پیدا نشد", "NOOP")]);
  return Markup.inlineKeyboard(rows);
}

function parseMediaCaption(caption: string) {
  const parts = caption.split("|").map((p) => p.trim()).filter(Boolean);
  const result: { title?: string; category?: string; tags?: string[]; caption?: string } = { caption };
  for (const part of parts) {
    const m = part.match(/^(?:دسته|category)\s*[:：]\s*(.+)$/i);
    if (m) { result.category = m[1].trim(); continue; }
    const t = part.match(/^(?:عنوان|title)\s*[:：]\s*(.+)$/i);
    if (t) { result.title = t[1].trim(); continue; }
    const tags = part.match(/^(?:تگ|tags?)\s*[:：]\s*(.+)$/i);
    if (tags) { result.tags = tags[1].split(/[،,]/).map((x) => x.trim()).filter(Boolean); continue; }
  }
  if (!result.title) result.title = parts.find((p) => !/^(?:دسته|category|عنوان|title|تگ|tags?)\s*[:：]/i.test(p)) || caption || "رسانه بدون عنوان";
  return result;
}

async function checkForceJoin(ctx: any, settings: Settings) {
  if (!settings.forceJoinEnabled || !settings.forceJoinChannel) return true;
  try {
    const member = await ctx.telegram.getChatMember(settings.forceJoinChannel, ctx.from.id);
    return !["left", "kicked"].includes(member.status);
  } catch (error) {
    console.error("force join check failed:", error);
    return false;
  }
}

async function requireForceJoin(ctx: any, settings: Settings) {
  if (await checkForceJoin(ctx, settings)) return true;
  await ctx.reply(
    "🔒 برای دریافت محتوا ابتدا باید عضو کانال شوید.\n\n" +
      "کانال: " + settings.forceJoinChannel + "\n\n" +
      "بعد از عضویت دوباره روی محتوا بزنید.",
    Markup.inlineKeyboard([[Markup.button.url("عضویت در کانال", "https://t.me/" + settings.forceJoinChannel.replace(/^@/, ""))]])
  );
  return false;
}

async function sendMediaItem(ctx: any, item: MediaItem, settings: Settings) {
  if (!(await requireForceJoin(ctx, settings))) return;
  const caption = (item.title ? item.title + "\n" : "") + (item.caption || "") + "\n\nدسته: " + (item.category || "عمومی");
  let sent: any;
  if (item.type === "photo") sent = await ctx.replyWithPhoto(item.fileId, { caption });
  else if (item.type === "video") sent = await ctx.replyWithVideo(item.fileId, { caption });
  else sent = await ctx.replyWithDocument(item.fileId, { caption });
  item.downloads = (item.downloads || 0) + 1;
  await saveSettings(settings);
  const seconds = Number(settings.autoDeleteSeconds || 0);
  if (seconds > 0 && sent?.message_id) {
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => undefined);
    }, seconds * 1000);
    await ctx.reply("⏱ این فایل بعد از " + seconds + " ثانیه از صفحه ربات حذف می‌شود. می‌توانید آن را برای خودتان ذخیره یا فوروارد کنید.");
  }
}

function textSettingsInline() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🏷 نام کسب‌وکار", "ADM_EDIT_businessName")],
    [Markup.button.callback("👋 متن خوش‌آمد", "ADM_EDIT_welcomeMessage")],
    [Markup.button.callback("☎️ پشتیبانی", "ADM_EDIT_supportContact")],
    [Markup.button.callback("ℹ️ درباره ما", "ADM_EDIT_aboutText")],
    [Markup.button.callback("📝 سوال‌های فرم", "ADM_EDIT_FORM_QUESTIONS")]
  ]);
}

function paymentInline() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💳 کارت‌به‌کارت", "ADM_SET_CARD")],
    [Markup.button.callback("🔗 لینک پرداخت", "ADM_SET_PAYMENT_LINK")],
    [Markup.button.callback("🟣 مرچنت زرین‌پال/API", "ADM_SET_ZARINPAL")],
    [Markup.button.callback("🧪 تغییر حالت تست زرین‌پال", "ADM_TOGGLE_ZARINPAL_SANDBOX")]
  ]);
}

async function notifyAdmin(title: string, ctx: any, body: string) {
  const settings = await loadSettings();
  const text =
    title + "\n\n" +
    "کسب‌وکار: " + settings.businessName + "\n" +
    "نوع ربات: " + TEMPLATE_TITLE + "\n" +
    "کاربر: " + userLabel(ctx) + "\n\n" +
    body;
  for (const id of settings.admins) {
    try { await ctx.telegram.sendMessage(id, text); } catch (error) { console.error("notify admin failed", id, error); }
  }
}

function startSession(chatId: number, mode: UserSession["mode"], firstQuestion: string) {
  sessions.set(chatId, { mode, step: 0, answers: [], meta: {} });
  return firstQuestion;
}

async function finishFormLike(ctx: any, session: UserSession, title: string, questions: string[]) {
  const summary = questions.map((q, i) => String(i + 1) + ") " + q + ":\n" + (session.answers[i] || "-")).join("\n\n");
  sessions.delete(ctx.chat.id);
  await notifyAdmin(title, ctx, summary);
  const settings = await loadSettings();
  await ctx.reply("اطلاعات شما ثبت شد ✅\nمدیر به‌زودی بررسی می‌کند.", await menuFor(ctx.chat.id, settings));
}

function describePayment(settings: Settings) {
  let text = "روش‌های پرداخت:\n";
  if (HAS_PAYMENT_GATEWAY) {
    if (settings.payment.paymentLink) text += "\n🔗 لینک پرداخت عمومی:\n" + settings.payment.paymentLink + "\n";
    if (settings.payment.zarinpalMerchantId) {
      text += "\n🟣 پرداخت آنلاین زرین‌پال فعال است.";
      text += "\nحالت: " + (settings.payment.zarinpalSandbox ? "تست/Sandbox" : "واقعی/Production") + "\n";
    }
    if (!settings.payment.paymentLink && !settings.payment.zarinpalMerchantId) text += "\nدرگاه آنلاین هنوز توسط مدیر تکمیل نشده است.\n";
  }
  if (HAS_CARD_TO_CARD || settings.payment.cardNumber) {
    if (settings.payment.cardNumber) text += "\n💳 کارت‌به‌کارت:\n" + settings.payment.cardNumber + "\nبه نام: " + (settings.payment.cardHolder || "-") + "\n";
    else text += "\nکارت‌به‌کارت هنوز توسط مدیر تکمیل نشده است.\n";
  }
  text += "\n" + settings.payment.note;
  return text;
}

function zarinpalApiBase(settings: Settings) {
  return settings.payment.zarinpalSandbox ? "https://sandbox.zarinpal.com/pg/v4/payment" : "https://payment.zarinpal.com/pg/v4/payment";
}

function zarinpalStartPayBase(settings: Settings) {
  return settings.payment.zarinpalSandbox ? "https://sandbox.zarinpal.com/pg/StartPay/" : "https://payment.zarinpal.com/pg/StartPay/";
}

function publicPaymentCallbackUrl(orderId: string) {
  if (!baseUrl) throw new Error("BASE_URL تنظیم نشده است");
  return baseUrl + "/payment/zarinpal/callback?orderId=" + encodeURIComponent(orderId);
}

function findOrder(settings: Settings, orderId?: string, authority?: string) {
  return settings.orders.find((o) => (orderId && o.id === orderId) || (authority && o.authority === authority));
}

async function zarinpalRequest(settings: Settings, order: PaymentOrder) {
  if (!settings.payment.zarinpalMerchantId) throw new Error("مرچنت زرین‌پال تنظیم نشده است");
  const response = await fetch(zarinpalApiBase(settings) + "/request.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      merchant_id: settings.payment.zarinpalMerchantId,
      amount: order.amount,
      currency: "IRT",
      callback_url: publicPaymentCallbackUrl(order.id),
      description: "پرداخت " + order.title,
      metadata: {}
    })
  });
  const data: any = await response.json().catch(() => ({}));
  const code = data?.data?.code;
  const authority = data?.data?.authority;
  if (!response.ok || code !== 100 || !authority) {
    throw new Error("خطا در ساخت لینک پرداخت زرین‌پال: " + JSON.stringify(data));
  }
  order.authority = authority;
  return zarinpalStartPayBase(settings) + authority;
}

async function zarinpalVerify(settings: Settings, order: PaymentOrder, authority: string) {
  const response = await fetch(zarinpalApiBase(settings) + "/verify.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      merchant_id: settings.payment.zarinpalMerchantId,
      amount: order.amount,
      authority
    })
  });
  const data: any = await response.json().catch(() => ({}));
  const code = Number(data?.data?.code);
  if (!response.ok || (code !== 100 && code !== 101)) {
    throw new Error("تایید پرداخت زرین‌پال ناموفق بود: " + JSON.stringify(data));
  }
  return { code, refId: String(data?.data?.ref_id || "") };
}

async function createPaymentForItem(ctx: any, item: Item) {
  const settings = await loadSettings();
  const amount = item.price || 0;
  if (!amount) {
    await ctx.reply("برای این آیتم قیمت ثبت نشده است. لطفاً با پشتیبانی تماس بگیرید.", await menuFor(ctx.chat.id, settings));
    return;
  }
  const order: PaymentOrder = {
    id: "ord_" + Date.now().toString(36) + "_" + String(ctx.chat.id),
    chatId: ctx.chat.id,
    username: ctx.from?.username,
    title: item.title,
    amount,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };
  settings.orders.push(order);
  await saveSettings(settings);

  try {
    const paymentUrl = await zarinpalRequest(settings, order);
    await saveSettings(settings);
    await ctx.reply(
      "لینک پرداخت آنلاین ساخته شد ✅\n\n" +
        "آیتم: " + item.title + "\n" +
        "مبلغ: " + formatToman(amount) + "\n\n" +
        "بعد از پرداخت، نتیجه به صورت خودکار در ربات ثبت می‌شود.",
      Markup.inlineKeyboard([[Markup.button.url("💳 پرداخت آنلاین", paymentUrl)]])
    );
  } catch (error) {
    order.status = "FAILED";
    await saveSettings(settings);
    await ctx.reply(
      "ساخت لینک پرداخت آنلاین ناموفق بود ⚠️\n" +
        (error instanceof Error ? error.message : String(error)) +
        "\n\nمی‌توانید از کارت‌به‌کارت یا پشتیبانی استفاده کنید.",
      await menuFor(ctx.chat.id, settings)
    );
  }
}

function isTestExpired() {
  return !!testExpiresAt && Date.now() > testExpiresAt;
}

bot.use(async (ctx, next) => {
  if (isTestExpired()) {
    await ctx.reply("⏳ زمان ربات تست رایگان تمام شده است. این ربات فقط ۵ دقیقه فعال بود. برای ساخت نسخه کامل، از ربات‌ساز سفارش ثبت کنید.");
    return;
  }
  return next();
});

bot.start(async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  if (await isAdmin(ctx.chat.id)) {
    await ctx.reply("سلام مدیر 👋\nاز منوی مدیریت می‌توانی محصولات، متن‌ها، قیمت‌ها و پرداخت را تغییر بدهی.", adminMenu());
  } else {
    await ctx.reply(settings.welcomeMessage, await menuFor(ctx.chat.id, settings));
  }
});



bot.hears("📂 دسته‌بندی‌ها", async (ctx) => {
  const settings = await loadSettings();
  if (TEMPLATE_CODE !== "MEDIA_GALLERY") return;
  await ctx.reply("یکی از دسته‌بندی‌ها را انتخاب کنید:", mediaCategoryInline(settings));
});

bot.hears("🆕 جدیدترین‌ها", async (ctx) => {
  const settings = await loadSettings();
  if (TEMPLATE_CODE !== "MEDIA_GALLERY") return;
  const items = settings.mediaItems.filter((x) => x.active).slice(-20).reverse();
  await ctx.reply("جدیدترین رسانه‌ها:", mediaListInline(items));
});

bot.hears("🔍 جستجو", async (ctx) => {
  if (TEMPLATE_CODE !== "MEDIA_GALLERY") return;
  sessions.set(ctx.chat.id, { mode: "media", step: 0, answers: [], meta: { action: "search" } });
  await ctx.reply("نام فیلم، سریال، عکس یا کلمه موردنظر را بفرست تا جستجو کنم.");
});

bot.hears("📩 درخواست محتوا", async (ctx) => {
  if (TEMPLATE_CODE !== "MEDIA_GALLERY") return;
  sessions.set(ctx.chat.id, { mode: "media", step: 0, answers: [], meta: { action: "request" } });
  await ctx.reply("اسم فیلم، سریال، عکس یا محتوایی که می‌خواهی را بفرست. درخواستت برای مدیر ارسال می‌شود.");
});

bot.action(/MEDIA_CAT_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  const category = decodeURIComponent(ctx.match[1]);
  const items = settings.mediaItems.filter((m) => m.active && (m.category || "عمومی") === category).slice(-30).reverse();
  await ctx.reply("محتوای دسته «" + category + "»: ", mediaListInline(items));
});

bot.action("MEDIA_LATEST", async (ctx) => {
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  const items = settings.mediaItems.filter((m) => m.active).slice(-30).reverse();
  await ctx.reply("جدیدترین رسانه‌ها:", mediaListInline(items));
});

bot.action(/MEDIA_VIEW_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  const items = settings.mediaItems.filter((m) => m.active).slice(-30).reverse();
  const item = items[Number(ctx.match[1])];
  if (!item) { await ctx.reply("این رسانه پیدا نشد."); return; }
  item.views = (item.views || 0) + 1;
  await saveSettings(settings);
  await ctx.reply(
    "🎬 اطلاعات محتوا\n\n" +
      "عنوان: " + (item.title || "بدون عنوان") + "\n" +
      "دسته: " + (item.category || "عمومی") + "\n" +
      "توضیح: " + (item.caption || "-") + "\n" +
      "بازدید: " + (item.views || 0) + "\n" +
      "دانلود/ارسال: " + (item.downloads || 0),
    Markup.inlineKeyboard([[Markup.button.callback("📥 دریافت فایل", "MEDIA_SEND_" + String(Number(ctx.match[1])))]]),
  );
});

bot.action(/MEDIA_SEND_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  const items = settings.mediaItems.filter((m) => m.active).slice(-30).reverse();
  const item = items[Number(ctx.match[1])];
  if (!item) { await ctx.reply("این رسانه پیدا نشد."); return; }
  await sendMediaItem(ctx, item, settings);
});

bot.hears("🎬 مدیریت رسانه", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  const settings = await loadSettings();
  await ctx.reply(
    "🎬 مدیریت رسانه\n\n" +
      "تعداد رسانه‌ها: " + settings.mediaItems.length + "\n" +
      "دسته‌ها: " + (mediaCategories(settings).join("، ") || "ثبت نشده") + "\n" +
      "قفل عضویت: " + (settings.forceJoinEnabled ? "فعال " + settings.forceJoinChannel : "خاموش") + "\n" +
      "حذف خودکار: " + (settings.autoDeleteSeconds ? settings.autoDeleteSeconds + " ثانیه" : "خاموش") + "\n\n" +
      "برای افزودن محتوا، فیلم/عکس/فایل را همینجا بفرست. کپشن پیشنهادی:\n" +
      "عنوان: نام فیلم | دسته: انیمیشن | تگ: اکشن، 2024 | توضیح کوتاه",
    adminMenu(),
  );
});

bot.hears("📂 مدیریت دسته‌ها", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  adminStates.set(ctx.chat.id, { action: "SET_MEDIA_CATEGORIES" });
  await ctx.reply("دسته‌بندی‌ها را خط‌به‌خط بفرست. مثال:\nفیلم ایرانی\nسریال خارجی\nانیمیشن\nعکس آموزشی");
});

bot.hears("🔒 قفل عضویت", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  adminStates.set(ctx.chat.id, { action: "SET_FORCE_JOIN" });
  await ctx.reply("اگر می‌خواهی قفل عضویت فعال شود، آیدی کانال را بفرست مثل @channel.\nبرای خاموش کردن بنویس: OFF\n\nنکته: ربات باید در آن کانال ادمین باشد تا عضویت را بررسی کند.");
});

bot.hears("⏱ حذف خودکار فایل", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  adminStates.set(ctx.chat.id, { action: "SET_AUTO_DELETE" });
  await ctx.reply("مدت حذف خودکار فایل را به ثانیه بفرست. مثال: 60\nبرای خاموش کردن بنویس: 0 یا OFF");
});

bot.on(["photo", "video", "document"], async (ctx, next) => {
  if (TEMPLATE_CODE !== "MEDIA_GALLERY") return next();
  if (!(await isAdmin(ctx.chat?.id))) {
    await ctx.reply("ارسال رسانه فقط برای ادمین فعال است. برای درخواست محتوا از دکمه 📩 درخواست محتوا استفاده کنید.");
    return;
  }
  const settings = await loadSettings();
  const message: any = ctx.message;
  const caption = String(message.caption || "");
  let type: MediaItem["type"] = "document";
  let fileId = "";
  if (message.photo?.length) { type = "photo"; fileId = message.photo[message.photo.length - 1].file_id; }
  else if (message.video) { type = "video"; fileId = message.video.file_id; }
  else if (message.document) { type = "document"; fileId = message.document.file_id; }
  if (!fileId) return next();
  const parsed = parseMediaCaption(caption);
  const item: MediaItem = {
    id: String(Date.now()) + "_" + String(settings.mediaItems.length + 1),
    type,
    fileId,
    title: parsed.title,
    caption: parsed.caption,
    category: parsed.category || settings.mediaCategories[0] || "عمومی",
    tags: parsed.tags || [],
    uploadedBy: ctx.chat.id,
    createdAt: new Date().toISOString(),
    active: true,
    views: 0,
    downloads: 0,
  };
  settings.mediaItems.push(item);
  if (item.category && !settings.mediaCategories.includes(item.category)) settings.mediaCategories.push(item.category);
  await saveSettings(settings);
  await ctx.reply("رسانه ثبت شد ✅\nعنوان: " + (item.title || "-") + "\nدسته: " + item.category, adminMenu());
  await notifyAdmin("رسانه جدید آپلود شد 📂", ctx, "نوع: " + type + "\nدسته: " + item.category + "\nعنوان: " + (item.title || "-") + "\nکپشن: " + (caption || "-"));
});

bot.hears("🧰 پنل مدیریت", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  await ctx.reply("پنل مدیریت ربات مشتری:\nهر چیزی که لازم داری از همینجا قابل تغییر است.", adminMenu());
});

bot.hears("📦 مدیریت آیتم‌ها", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  const settings = await loadSettings();
  await ctx.reply("آیتم‌های فعلی:\n\n" + itemListText(settings), itemsInline(settings));
});

bot.hears("✏️ ویرایش متن‌ها", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  await ctx.reply("کدام متن را می‌خواهی تغییر بدهی؟", textSettingsInline());
});

bot.hears("💳 تنظیم پرداخت", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  const settings = await loadSettings();
  await ctx.reply("وضعیت فعلی پرداخت:\n\n" + describePayment(settings), paymentInline());
});

bot.hears("📊 گزارش‌ها", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  await ctx.reply("گزارش ساده:\nکاربران دیده‌شده از زمان روشن شدن ربات: " + knownUsers.size + "\nتعداد آیتم‌ها: " + (await loadSettings()).items.length, adminMenu());
});

bot.hears("📣 پیام همگانی", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  adminStates.set(ctx.chat.id, { action: "BROADCAST" });
  await ctx.reply("متن پیام همگانی را بفرست.\nفعلاً پیام به کاربرانی ارسال می‌شود که از زمان روشن شدن ربات /start زده‌اند.");
});

bot.hears("👥 مدیریت ادمین‌ها", async (ctx) => {
  if (!(await isAdmin(ctx.chat.id))) return;
  const settings = await loadSettings();
  await ctx.reply("ادمین‌های فعلی:\n" + settings.admins.join("\n") + "\n\nبرای افزودن ادمین جدید، آیدی عددی را بفرست.");
  adminStates.set(ctx.chat.id, { action: "ADD_ADMIN" });
});

bot.hears("🔙 منوی کاربر", async (ctx) => {
  const settings = await loadSettings();
  await ctx.reply("منوی کاربر:", await menuFor(ctx.chat.id, settings));
});

bot.action("ADM_ITEM_ADD", async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  adminStates.set(ctx.chat!.id, { action: "ADD_ITEM" });
  await ctx.reply("آیتم جدید را با این فرمت بفرست:\nعنوان | قیمت | توضیح\n\nمثال:\nمحصول تست | 250000 | توضیحات محصول");
});

bot.action(/ADM_ITEM_EDIT_(\d+)/, async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  adminStates.set(ctx.chat!.id, { action: "EDIT_ITEM", index: Number(ctx.match[1]) });
  await ctx.reply("مقدار جدید را با این فرمت بفرست:\nعنوان | قیمت | توضیح");
});

bot.action(/ADM_ITEM_DEL_(\d+)/, async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  const index = Number(ctx.match[1]);
  if (settings.items[index]) settings.items.splice(index, 1);
  await saveSettings(settings);
  await ctx.reply("حذف شد ✅\n\n" + itemListText(settings), itemsInline(settings));
});

bot.action(/ADM_EDIT_(businessName|welcomeMessage|supportContact|aboutText)/, async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  adminStates.set(ctx.chat!.id, { action: "EDIT_FIELD", field: ctx.match[1] as any });
  await ctx.reply("متن جدید را بفرست.");
});

bot.action("ADM_EDIT_FORM_QUESTIONS", async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  adminStates.set(ctx.chat!.id, { action: "EDIT_FORM_QUESTIONS" });
  await ctx.reply("سوال‌های فرم را خط به خط بفرست.");
});

bot.action("ADM_SET_CARD", async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  adminStates.set(ctx.chat!.id, { action: "SET_CARD" });
  await ctx.reply("شماره کارت و نام صاحب کارت را با این فرمت بفرست:\nشماره کارت | نام صاحب کارت");
});

bot.action("ADM_SET_PAYMENT_LINK", async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  adminStates.set(ctx.chat!.id, { action: "SET_PAYMENT_LINK" });
  await ctx.reply("لینک پرداخت را بفرست. مثال:\nhttps://...");
});

bot.action("ADM_SET_ZARINPAL", async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  adminStates.set(ctx.chat!.id, { action: "SET_ZARINPAL" });
  await ctx.reply("مرچنت زرین‌پال را بفرست.\nاگر می‌خواهی حالت تست فعال باشد، بعد از مرچنت بنویس: | sandbox\n\nمثال:\nxxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx | sandbox");
});

bot.action("ADM_TOGGLE_ZARINPAL_SANDBOX", async (ctx) => {
  if (!(await isAdmin(ctx.chat?.id))) return;
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  settings.payment.zarinpalSandbox = !settings.payment.zarinpalSandbox;
  await saveSettings(settings);
  await ctx.reply("حالت زرین‌پال تغییر کرد ✅\nحالت فعلی: " + (settings.payment.zarinpalSandbox ? "تست/Sandbox" : "واقعی/Production"), adminMenu());
});

bot.hears("ℹ️ درباره ما", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  const features = FEATURES.map((f) => "• " + f).join("\n") || "ثبت نشده";
  await ctx.reply(settings.businessName + "\n\n" + settings.aboutText + "\n\nنوع ربات: " + TEMPLATE_TITLE + "\n\nامکانات فعال:\n" + features, await menuFor(ctx.chat.id, settings));
});

bot.hears("☎️ پشتیبانی", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  if (settings.supportContact && settings.supportContact !== "ثبت نشده") {
    await ctx.reply("راه ارتباطی پشتیبانی:\n" + settings.supportContact, await menuFor(ctx.chat.id, settings));
  } else {
    sessions.set(ctx.chat.id, { mode: "support", step: 0, answers: [], meta: {} });
    await ctx.reply("پیام پشتیبانی خود را بنویسید تا برای مدیر ارسال شود.");
  }
});

bot.hears("💳 پرداخت", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  await ctx.reply(describePayment(settings), await menuFor(ctx.chat.id, settings));
});

bot.hears(["📋 خدمات", "❓ سوالات متداول", "🎓 دوره‌ها / فایل‌ها"], async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  const active = settings.items.filter((item) => item.active);
  await ctx.reply(active.length ? itemListText({ ...settings, items: active }) : "اطلاعات هنوز توسط مدیر تکمیل نشده است.", await menuFor(ctx.chat.id, settings));
});

bot.hears("🛍 محصولات", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  const items = settings.items.filter((item) => item.active);
  if (!items.length) {
    await ctx.reply("هنوز محصولی ثبت نشده است.", await menuFor(ctx.chat.id, settings));
    return;
  }
  await ctx.reply("محصولات / خدمات:\n\n" + itemListText({ ...settings, items }), Markup.inlineKeyboard(items.slice(0, 20).map((item, i) => [Markup.button.callback("🛒 سفارش: " + item.title.slice(0, 32), "BUY_" + i)])));
});

bot.action(/BUY_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  knownUsers.add(ctx.chat!.id);
  const settings = await loadSettings();
  const index = Number(ctx.match[1]);
  const item = settings.items.filter((x) => x.active)[index] || { title: "محصول انتخاب‌شده", active: true };
  const rows = [];
  if (HAS_PAYMENT_GATEWAY && settings.payment.zarinpalMerchantId && item.price) rows.push([Markup.button.callback("💳 پرداخت آنلاین زرین‌پال", "PAY_ZP_" + index)]);
  if (settings.payment.paymentLink) rows.push([Markup.button.url("🔗 لینک پرداخت عمومی", settings.payment.paymentLink)]);
  if (settings.payment.cardNumber) rows.push([Markup.button.callback("💳 کارت‌به‌کارت", "PAY_CARD_" + index)]);
  rows.push([Markup.button.callback("🧾 ثبت سفارش و ارسال به مدیر", "ORDER_ITEM_" + index)]);
  await ctx.reply(
    "آیتم انتخاب‌شده:\n" + item.title + "\n\n" +
      "قیمت: " + formatToman(item.price) +
      (item.description ? "\n" + item.description : "") +
      "\n\nروش موردنظر را انتخاب کنید:",
    Markup.inlineKeyboard(rows)
  );
});

bot.action(/PAY_ZP_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  const item = settings.items.filter((x) => x.active)[Number(ctx.match[1])];
  if (!item) { await ctx.reply("آیتم پیدا نشد."); return; }
  await createPaymentForItem(ctx, item);
});

bot.action(/PAY_CARD_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const settings = await loadSettings();
  const item = settings.items.filter((x) => x.active)[Number(ctx.match[1])];
  await ctx.reply(
    "برای پرداخت کارت‌به‌کارت:\n" +
      "آیتم: " + (item?.title || "-") + "\n" +
      "مبلغ: " + formatToman(item?.price) + "\n\n" +
      "شماره کارت: " + (settings.payment.cardNumber || "ثبت نشده") + "\n" +
      "به نام: " + (settings.payment.cardHolder || "-") + "\n\n" +
      "بعد از واریز، رسید را برای پشتیبانی ارسال کنید.",
    await menuFor(ctx.chat!.id, settings)
  );
});

bot.action(/ORDER_ITEM_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  knownUsers.add(ctx.chat!.id);
  const settings = await loadSettings();
  const item = settings.items.filter((x) => x.active)[Number(ctx.match[1])] || { title: "محصول انتخاب‌شده", active: true };
  sessions.set(ctx.chat!.id, { mode: "shop", step: 0, answers: [], meta: { item: item.title, price: String(item.price || "") } });
  await ctx.reply("برای سفارش «" + item.title + "» اطلاعات زیر را در یک پیام بفرستید:\nنام، شماره تماس، آدرس/توضیحات\n\nقیمت: " + formatToman(item.price));
});

bot.hears("🧾 ثبت سفارش", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  sessions.set(ctx.chat.id, { mode: "shop", step: 0, answers: [], meta: {} });
  await ctx.reply("لطفاً نام محصول/خدمت، تعداد، شماره تماس و توضیحات را ارسال کنید.");
});

bot.hears("🎫 ثبت تیکت", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  sessions.set(ctx.chat.id, { mode: "support", step: 0, answers: [], meta: {} });
  await ctx.reply("موضوع و متن مشکل/درخواست خود را بنویسید.");
});

bot.hears("📅 رزرو نوبت", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  const question = startSession(ctx.chat.id, "reservation", "نام خدمت موردنظر، روز/ساعت پیشنهادی، نام و شماره تماس را ارسال کنید.");
  await ctx.reply(question + "\n\nخدمات:\n" + itemListText(settings));
});

bot.hears("📝 ثبت سفارش خدمات", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  sessions.set(ctx.chat.id, { mode: "service", step: 0, answers: [], meta: {} });
  await ctx.reply("لطفاً نوع خدمت، توضیحات کامل، زمان موردنظر و شماره تماس را ارسال کنید.");
});

bot.hears("🧾 درخواست خرید", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  sessions.set(ctx.chat.id, { mode: "course", step: 0, answers: [], meta: {} });
  await ctx.reply("نام دوره/فایل موردنظر و شماره تماس خود را ارسال کنید.");
});

bot.hears("📝 شروع فرم", async (ctx) => {
  knownUsers.add(ctx.chat.id);
  const settings = await loadSettings();
  const questions = settings.formQuestions.length ? settings.formQuestions : ["نام و نام خانوادگی", "شماره تماس", "توضیحات"];
  sessions.set(ctx.chat.id, { mode: "form", step: 0, answers: [], meta: {} });
  await ctx.reply("فرم شروع شد ✅\n\n" + questions[0]);
});

bot.hears("ℹ️ راهنما", async (ctx) => {
  const settings = await loadSettings();
  await ctx.reply("برای ثبت اطلاعات روی «📝 شروع فرم» بزنید و سوال‌ها را مرحله‌به‌مرحله پاسخ دهید.", await menuFor(ctx.chat.id, settings));
});

async function handleAdminText(ctx: any, text: string) {
  const state = adminStates.get(ctx.chat.id);
  if (!state || !(await isAdmin(ctx.chat.id))) return false;
  const settings = await loadSettings();

  if (state.action === "ADD_ITEM") {
    settings.items.push(parseItemLine(text));
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("آیتم اضافه شد ✅\n\n" + itemListText(settings), itemsInline(settings));
    return true;
  }

  if (state.action === "EDIT_ITEM") {
    if (!settings.items[state.index]) {
      adminStates.delete(ctx.chat.id);
      await ctx.reply("این آیتم پیدا نشد.", adminMenu());
      return true;
    }
    settings.items[state.index] = parseItemLine(text);
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("آیتم ویرایش شد ✅\n\n" + itemListText(settings), itemsInline(settings));
    return true;
  }

  if (state.action === "EDIT_FIELD") {
    settings[state.field] = text;
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("ذخیره شد ✅", adminMenu());
    return true;
  }

  if (state.action === "EDIT_FORM_QUESTIONS") {
    settings.formQuestions = text.split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean).slice(0, 30);
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("سوال‌های فرم ذخیره شد ✅", adminMenu());
    return true;
  }

  if (state.action === "SET_MEDIA_CATEGORIES") {
    settings.mediaCategories = text.split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean).slice(0, 80);
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("دسته‌بندی‌ها ذخیره شد ✅\n" + settings.mediaCategories.join("\n"), adminMenu());
    return true;
  }

  if (state.action === "SET_FORCE_JOIN") {
    if (/^(off|خاموش|0)$/i.test(text.trim())) {
      settings.forceJoinEnabled = false;
      settings.forceJoinChannel = "";
    } else {
      settings.forceJoinEnabled = true;
      settings.forceJoinChannel = text.trim();
    }
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("تنظیم قفل عضویت ذخیره شد ✅\nوضعیت: " + (settings.forceJoinEnabled ? "فعال " + settings.forceJoinChannel : "خاموش"), adminMenu());
    return true;
  }

  if (state.action === "SET_AUTO_DELETE") {
    settings.autoDeleteSeconds = /^(off|خاموش)$/i.test(text.trim()) ? 0 : Math.max(0, Number(text.replace(/[^0-9]/g, "")) || 0);
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("حذف خودکار ذخیره شد ✅\nوضعیت: " + (settings.autoDeleteSeconds ? settings.autoDeleteSeconds + " ثانیه" : "خاموش"), adminMenu());
    return true;
  }

  if (state.action === "SET_CARD") {
    const parts = text.split("|").map((x: string) => x.trim());
    settings.payment.cardNumber = parts[0] || text.trim();
    settings.payment.cardHolder = parts[1] || "";
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("اطلاعات کارت ذخیره شد ✅", adminMenu());
    return true;
  }

  if (state.action === "SET_PAYMENT_LINK") {
    settings.payment.paymentLink = text.trim();
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("لینک پرداخت ذخیره شد ✅", adminMenu());
    return true;
  }

  if (state.action === "SET_ZARINPAL") {
    const parts = text.split("|").map((x: string) => x.trim()).filter(Boolean);
    settings.payment.zarinpalMerchantId = parts[0] || text.trim();
    if (parts.some((p: string) => /sandbox|test|تست/i.test(p))) settings.payment.zarinpalSandbox = true;
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("مرچنت زرین‌پال ذخیره شد ✅\nCallback خودکار فعال است.\nحالت فعلی: " + (settings.payment.zarinpalSandbox ? "تست/Sandbox" : "واقعی/Production"), adminMenu());
    return true;
  }

  if (state.action === "ADD_ADMIN") {
    const id = Number(text.replace(/[^0-9]/g, ""));
    if (!id) {
      await ctx.reply("آیدی عددی درست نیست. دوباره بفرست.");
      return true;
    }
    if (!settings.admins.includes(id)) settings.admins.push(id);
    await saveSettings(settings);
    adminStates.delete(ctx.chat.id);
    await ctx.reply("ادمین اضافه شد ✅", adminMenu());
    return true;
  }

  if (state.action === "BROADCAST") {
    let sent = 0;
    for (const id of knownUsers) {
      try { await ctx.telegram.sendMessage(id, text); sent++; } catch {}
    }
    adminStates.delete(ctx.chat.id);
    await ctx.reply("پیام ارسال شد ✅\nتعداد ارسال: " + sent, adminMenu());
    return true;
  }

  return false;
}

bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  knownUsers.add(ctx.chat.id);
  if (await handleAdminText(ctx, text)) return;
  if (text.startsWith("/")) return;

  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const settings = await loadSettings();
  if (!session) {
    await ctx.reply("از منوی پایین یک گزینه را انتخاب کنید.", (await isAdmin(chatId)) ? adminMenu() : await menuFor(ctx.chat.id, settings));
    return;
  }

  if (session.mode === "form") {
    const questions = settings.formQuestions.length ? settings.formQuestions : ["نام و نام خانوادگی", "شماره تماس", "توضیحات"];
    session.answers.push(text);
    session.step += 1;
    if (session.step >= questions.length) {
      await finishFormLike(ctx, session, "فرم جدید ثبت شد 📝", questions);
      return;
    }
    sessions.set(chatId, session);
    await ctx.reply(questions[session.step]);
    return;
  }

  if (session.mode === "media" && session.meta?.action === "search") {
    const q = normalizeQuery(text);
    const items = settings.mediaItems.filter((m) => {
      const hay = normalizeQuery([m.title, m.caption, m.category, ...(m.tags || [])].filter(Boolean).join(" "));
      return m.active && hay.includes(q);
    }).slice(-30).reverse();
    sessions.delete(chatId);
    await ctx.reply(items.length ? "نتیجه جستجو برای «" + text + "»: " : "موردی برای «" + text + "» پیدا نشد.", mediaListInline(items));
    return;
  }

  if (session.mode === "media" && session.meta?.action === "request") {
    sessions.delete(chatId);
    await notifyAdmin("درخواست محتوای جدید 📩", ctx, text);
    await ctx.reply("درخواست شما برای مدیر ارسال شد ✅", await menuFor(ctx.chat.id, settings));
    return;
  }

  const titles: Record<string, string> = {
    support: "تیکت پشتیبانی جدید 🎫",
    reservation: "درخواست رزرو جدید 📅",
    service: "سفارش خدمات جدید 📝",
    shop: "سفارش فروشگاهی جدید 🛍",
    course: "درخواست خرید دوره/فایل 🎓",
    media: "درخواست رسانه جدید 📂"
  };

  const selectedItem = session.meta?.item ? "آیتم انتخاب‌شده: " + session.meta.item + "\nقیمت: " + formatToman(parsePrice(session.meta.price || "")) + "\n\n" : "";
  sessions.delete(chatId);
  await notifyAdmin(titles[session.mode] || "پیام جدید", ctx, selectedItem + text);
  await ctx.reply("درخواست شما ثبت و برای مدیر ارسال شد ✅", await menuFor(ctx.chat.id, settings));
});

app.get("/payment/zarinpal/callback", async (req, res) => {
  const orderId = String(req.query.orderId || "");
  const authority = String(req.query.Authority || "");
  const statusQuery = String(req.query.Status || "");
  const settings = await loadSettings();
  const order = findOrder(settings, orderId, authority);

  function page(title: string, body: string) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send("<!doctype html><html lang='fa' dir='rtl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + title + "</title><style>body{font-family:tahoma,sans-serif;background:#f6f7fb;padding:24px}.card{max-width:560px;margin:40px auto;background:white;border-radius:16px;padding:24px;box-shadow:0 8px 30px #0001;line-height:1.9}</style></head><body><div class='card'><h2>" + title + "</h2><p>" + body + "</p></div></body></html>");
  }

  if (!order) {
    page("پرداخت پیدا نشد", "سفارش پرداختی پیدا نشد. لطفاً با پشتیبانی تماس بگیرید.");
    return;
  }

  if (order.status === "PAID") {
    page("پرداخت قبلاً تایید شده", "این پرداخت قبلاً با موفقیت ثبت شده است. کد پیگیری: " + (order.refId || "-"));
    return;
  }

  if (statusQuery !== "OK") {
    order.status = statusQuery === "NOK" ? "CANCELED" : "FAILED";
    await saveSettings(settings);
    try { await bot.telegram.sendMessage(order.chatId, "پرداخت ناموفق یا لغو شد ❌\nسفارش: " + order.title); } catch {}
    page("پرداخت ناموفق", "پرداخت ناموفق بود یا توسط شما لغو شد.");
    return;
  }

  try {
    const result = await zarinpalVerify(settings, order, authority);
    order.status = "PAID";
    order.authority = authority;
    order.refId = result.refId;
    order.paidAt = new Date().toISOString();
    await saveSettings(settings);
    try { await bot.telegram.sendMessage(order.chatId, "پرداخت شما با موفقیت ثبت شد ✅\nسفارش: " + order.title + "\nمبلغ: " + formatToman(order.amount) + "\nکد پیگیری: " + (order.refId || "-")); } catch {}
    for (const id of settings.admins) {
      try { await bot.telegram.sendMessage(id, "پرداخت آنلاین موفق ✅\nسفارش: " + order.title + "\nکاربر: " + (order.username ? "@" + order.username : order.chatId) + "\nمبلغ: " + formatToman(order.amount) + "\nکد پیگیری: " + (order.refId || "-")); } catch {}
    }
    page("پرداخت موفق", "پرداخت شما با موفقیت تایید شد. کد پیگیری: " + (order.refId || "-"));
  } catch (error) {
    order.status = "FAILED";
    await saveSettings(settings);
    page("خطا در تایید پرداخت", error instanceof Error ? error.message : String(error));
  }
});

app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.json(status));

const port = Number(process.env.PORT || 10000);
app.listen(port, "0.0.0.0", async () => {
  console.log("Listening on " + port);
  try {
    if (!token) throw new Error("CUSTOMER_BOT_TOKEN is missing");
    if (!baseUrl) throw new Error("BASE_URL is missing");
    await loadSettings();
    const path = "/webhook/" + token.split(":")[0];
    app.post(path, async (req, res) => {
      try {
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
      } catch (error) {
        console.error(error);
        res.sendStatus(200);
      }
    });
    await bot.telegram.setWebhook(baseUrl + path, { drop_pending_updates: true });
    status.ready = true;
    status.error = null;
    console.log("Customer bot ready");
  } catch (error) {
    status.ready = false;
    status.error = error instanceof Error ? error.message : String(error);
    console.error(error);
  }
});
