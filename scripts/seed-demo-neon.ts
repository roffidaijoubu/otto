#!/usr/bin/env bun
/**
 * Idempotent Demo Data Seeder for Neon Serverless Postgres (`lma-studio`).
 *
 * Uses deterministic `*_demo_*` IDs so re-running never duplicates records,
 * and passing `--clear` cleanly removes only demo rows while keeping real data.
 *
 * Usage (inside Sprite):
 *   /.sprite/bin/bun run /home/sprite/lma/scripts/seed-demo-neon.ts
 *   /.sprite/bin/bun run /home/sprite/lma/scripts/seed-demo-neon.ts --clear
 */

import {
  forgetCloudMemory,
  rememberCloudMemory,
} from "../agent/lib/cloud-memory.ts";
import {
  deleteChannelMetric,
  deleteContact,
  deletePipelineItem,
  getStudioDbOverview,
  listCalendarEvents,
  listChannelMetrics,
  saveCalendarEventsBatch,
  upsertCalendarEvent,
  upsertContact,
  upsertDailyChannelMetric,
  upsertPipelineItem,
  type CalendarEvent,
  type ContactRole,
  type ContactStatus,
  type PipelineFormat,
  type PipelineStatus,
  type StudioMemoryCategory,
} from "../agent/lib/studio-db.ts";

const isClear = process.argv.includes("--clear");

function isoAtWib(dayOffset: number, hour: number, minute = 0): string {
  const now = new Date();
  // Build target date in WIB (UTC+7)
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wibNow.getUTCFullYear();
  const m = wibNow.getUTCMonth();
  const d = wibNow.getUTCDate() + dayOffset;
  const utcMs = Date.UTC(y, m, d, hour - 7, minute, 0, 0);
  return new Date(utcMs).toISOString();
}

function dateStrOffset(dayOffset: number): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000 + dayOffset * 24 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

const DEMO_CALENDAR: Array<Omit<CalendarEvent, "createdAt" | "updatedAt">> = [
  {
    id: "evt_demo_01",
    title: "【Ceramah Stream】Adab Berbeda Pendapat & Menjaga Ukhuwah",
    type: "stream",
    startAt: isoAtWib(1, 20, 0),
    endAt: isoAtWib(1, 22, 0),
    cron: null,
    notes: "Sesi ceramah santai + Q&A live chat. Siapkan Lower Third topik & timer 10 menit Starting Soon.",
    status: "planned",
    source: "local",
    googleEventId: null,
    googleHtmlLink: null,
    wakeups: [],
  },
  {
    id: "evt_demo_02",
    title: "【VUsTalk #3】Ngobrol Sejarah Islam & Q&A Komunitas (ft. Hanif)",
    type: "collab",
    startAt: isoAtWib(3, 20, 30),
    endAt: isoAtWib(3, 22, 30),
    cron: null,
    notes: "Audio check jam 20:00 WIB di Discord. Kumpulkan 5 pertanyaan terbaik dari komunitas sebelum live.",
    status: "planned",
    source: "local",
    googleEventId: null,
    googleHtmlLink: null,
    wakeups: [],
  },
  {
    id: "evt_demo_03",
    title: "Upload Video: 3 Salah Paham Paling Umum tentang Doa Kumail",
    type: "upload",
    startAt: isoAtWib(5, 19, 0),
    endAt: isoAtWib(5, 19, 30),
    cron: null,
    notes: "Final thumbnail dari Himeko Design + subtitle Indonesia/English sudah dicek.",
    status: "planned",
    source: "local",
    googleEventId: null,
    googleHtmlLink: null,
    wakeups: [],
  },
  {
    id: "evt_demo_04",
    title: "【VALORANT】Ustad Boomer Road to Diamond #3",
    type: "stream",
    startAt: isoAtWib(6, 21, 0),
    endAt: isoAtWib(6, 23, 30),
    cron: null,
    notes: "Gaming santai weekend + clip momen lucu untuk Shorts.",
    status: "planned",
    source: "local",
    googleEventId: null,
    googleHtmlLink: null,
    wakeups: [],
  },
  {
    id: "evt_demo_05",
    title: "【Free Talk】Zatsudan & Update Jadwal Konten",
    type: "stream",
    startAt: isoAtWib(-2, 20, 0),
    endAt: isoAtWib(-2, 21, 45),
    cron: null,
    notes: "VOD siap dipotong untuk 3 highlight Shorts.",
    status: "done",
    source: "local",
    googleEventId: null,
    googleHtmlLink: null,
    wakeups: [],
  },
];

const DEMO_IDEAS: Array<{
  id: string;
  title: string;
  format: PipelineFormat;
  status: PipelineStatus;
  hook: string;
  scheduledFor?: string | null;
  notes: string;
}> = [
  {
    id: "idea_demo_01",
    title: "【Ceramah】Adab Berbeda Pendapat & Menjaga Ukhuwah",
    format: "stream",
    status: "scheduled",
    hook: "Kenapa debat agama di medsos sering bikin capek, dan gimana adab para ulama klasik menghadapinya?",
    scheduledFor: dateStrOffset(1),
    notes: "Pakai 3 kutipan sejarah pendek + buka sesi Q&A 40 menit terakhir.",
  },
  {
    id: "idea_demo_02",
    title: "Bedah Nahjul Balaghah untuk Pemula dalam 10 Menit",
    format: "video",
    status: "prepping",
    hook: "Satu surat Imam Ali tentang keadilan & kepemimpinan yang masih relevan 1.400 tahun kemudian.",
    scheduledFor: dateStrOffset(8),
    notes: "Script outline di Studio Files; butuh brief thumbnail ke Himeko Design (high contrast, 3 kata maks).",
  },
  {
    id: "idea_demo_03",
    title: "3 Salah Paham Paling Umum tentang Doa Kumail",
    format: "video",
    status: "editing",
    hook: "Banyak yang mengira Doa Kumail cuma buat kalangan tertentu—padahal isinya dialog cinta paling universal.",
    scheduledFor: dateStrOffset(5),
    notes: "Raw cut sedang diedit Nadia Motion; siapkan 2 versi judul untuk A/B test.",
  },
  {
    id: "idea_demo_04",
    title: "【VUsTalk #3】Adab Diskusi Lintas Komunitas di Medsos",
    format: "collab",
    status: "prepping",
    hook: "Ngobrol bareng Hanif soal cara tetap tenang, berilmu, dan tidak reaktif menghadapi komentar pedas.",
    scheduledFor: dateStrOffset(3),
    notes: "Siapkan 4 segmen pertanyaan + overlay nama speaker.",
  },
  {
    id: "idea_demo_05",
    title: "3 Kalimat Imam Ali yang Bikin Tenang Saat Overthinking",
    format: "short",
    status: "idea",
    hook: "Stop scroll 30 detik kalau pikiranmu lagi penuh malam ini.",
    notes: "Cocok buat TikTok & YouTube Shorts jam 20:00 WIB; minta Raka Cuts bantu pacing subtitle.",
  },
  {
    id: "idea_demo_06",
    title: "【The Great Ace Attorney #4】Sidang Lanjutan London!",
    format: "stream",
    status: "idea",
    hook: "Lanjutin drama ruang sidang paling absurd bareng Herlock Sholmes.",
    notes: "Stream santai selingan setelah 2 sesi Ceramah.",
  },
  {
    id: "idea_demo_07",
    title: "Kenapa Memilih Jadi VTuber Ustadz?",
    format: "video",
    status: "published",
    hook: "Cerita di balik karakter VUstadz dan misi edukasi yang santai tapi tetap berdasar.",
    notes: "Performa bagus di retensi 30 detik pertama; jadikan referensi hook video berikutnya.",
  },
];

const DEMO_CONTACTS: Array<{
  id: string;
  name: string;
  role: ContactRole;
  handle: string;
  platform: string;
  status: ContactStatus;
  notes: string;
}> = [
  {
    id: "ctc_demo_01",
    name: "Himeko Design",
    role: "artist",
    handle: "@himekodesign",
    platform: "X / VGen",
    status: "active",
    notes: "Original character designer & key visual illustrator. Turnaround 3–5 hari untuk thumbnail custom.",
  },
  {
    id: "ctc_demo_02",
    name: "Raka Cuts",
    role: "clipper",
    handle: "@rakacuts_id",
    platform: "Discord / YouTube",
    status: "active",
    notes: "Clipper Shorts/TikTok spesialis potongan Ceramah & Zatsudan. Terima handoff raw clip via Box.",
  },
  {
    id: "ctc_demo_03",
    name: "Nadia Motion",
    role: "editor",
    handle: "@nadiamotion",
    platform: "Discord",
    status: "active",
    notes: "Editor video long-form (10–15 menit), motion typography bersih & subtitle rapi.",
  },
  {
    id: "ctc_demo_04",
    name: "KuroRig Studio",
    role: "rigger",
    handle: "@kurorig_live2d",
    platform: "VGen",
    status: "active",
    notes: "Live2D rigger untuk ekspresi tambahan & toggle aksesori.",
  },
  {
    id: "ctc_demo_05",
    name: "Hanif",
    role: "collab",
    handle: "@hanif_talks",
    platform: "YouTube",
    status: "active",
    notes: "Partner diskusi tetap di seri VUsTalk. Jadwal cocok malam hari WIB.",
  },
  {
    id: "ctc_demo_06",
    name: "Arif (Head Mod)",
    role: "mod",
    handle: "@arif_mod",
    platform: "Discord / YouTube",
    status: "active",
    notes: "Kepala moderator live chat & kurasi pertanyaan Q&A komunitas.",
  },
  {
    id: "ctc_demo_07",
    name: "Pustaka Nusantara",
    role: "sponsor",
    handle: "partnerships@pustakanusantara.example",
    platform: "Email",
    status: "pitched",
    notes: "Pitch sponsor buku sejarah & audiobook untuk segmen Ceramah bulanan.",
  },
];

const DEMO_MEMORIES: Array<{
  id: string;
  category: StudioMemoryCategory;
  content: string;
  tags: string[];
}> = [
  {
    id: "mem_demo_01",
    category: "preference",
    content: "Jadwal prime time live stream Roffi adalah jam 20:00 WIB (UTC+7), biasanya Jumat malam untuk Ceramah / Friday Night Study dan akhir pekan untuk Free Talk atau gaming santai.",
    tags: ["schedule", "wib", "prime-time"],
  },
  {
    id: "mem_demo_02",
    category: "workflow",
    content: "Semua promo media sosial (X, TikTok, Instagram) wajib masuk Buffer sebagai Draft dulu — jangan pernah auto-publish tanpa persetujuan Roffi.",
    tags: ["buffer", "draft-first", "social"],
  },
  {
    id: "mem_demo_03",
    category: "team",
    content: "Brief thumbnail untuk Himeko Design harus maksimal 3 kata besar yang kebaca jelas di layar HP, kontras tinggi, dan menyertakan ekspresi karakter Roffi yang spesifik — jangan pernah rekomendasikan AI art.",
    tags: ["thumbnail", "himeko", "human-artist"],
  },
  {
    id: "mem_demo_04",
    category: "team",
    content: "Potongan raw clip (.mp4 + .srt) untuk Shorts dan TikTok selalu di-upload ke Box folder 'Otto Handoffs/' agar Raka Cuts bisa langsung ambil dengan catatan hook score dan timestamp.",
    tags: ["clips", "box", "raka-cuts"],
  },
  {
    id: "mem_demo_05",
    category: "content",
    content: "Segmen Q&A live chat di 30–40 menit terakhir Ceramah Stream selalu menghasilkan retensi tertinggi dan paling banyak momen clip-worthy untuk Shorts.",
    tags: ["ceramah", "qa", "retention"],
  },
  {
    id: "mem_demo_06",
    category: "content",
    content: "Seri VUsTalk bersama Hanif paling cocok pakai format diskusi santai berbasis 4–5 pertanyaan komunitas dengan overlay Lower Third nama pembicara dan topik aktif.",
    tags: ["vustalk", "collab", "hanif", "obs"],
  },
  {
    id: "mem_demo_07",
    category: "preference",
    content: "Gaya bahasa Roffi di konten dan promo: santai, hangat, berilmu, kadang selipkan deadpan humor wibu/gaming, tapi selalu tenang dan tidak reaktif saat membahas topik sensitif.",
    tags: ["voice", "tone", "branding"],
  },
  {
    id: "mem_demo_08",
    category: "workflow",
    content: "Semua raw clip sebelum dikirim ke editor manusia harus dinormalisasi ke -14 LUFS dan 30fps CFR supaya audio ceramah terdengar rata di TikTok dan YouTube Shorts.",
    tags: ["audio", "lufs", "clips"],
  },
  {
    id: "mem_demo_09",
    category: "opsec",
    content: "Privasi & anonimitas persona Roffi Daijoubu bersifat mutlak: jangan pernah menanyakan, mencatat, atau menampilkan informasi identitas dunia nyata, lokasi spesifik, atau akun pribadi di konten maupun metadata.",
    tags: ["opsec", "anonymity", "safety"],
  },
  {
    id: "mem_demo_10",
    category: "decision",
    content: "Untuk desain OBS overlay (Starting Soon, Lower Third, BRB), Roffi menyukai estetika clean editorial dengan tipografi tajam, kontras tinggi, dan warna aksen emas/hitam yang selaras dengan emblem singa & pedang Zulfiqar.",
    tags: ["obs", "design", "branding"],
  },
];

if (isClear) {
  for (const i of DEMO_IDEAS) await deletePipelineItem(i.id);
  for (const c of DEMO_CONTACTS) await deleteContact(c.id);
  for (const m of DEMO_MEMORIES) await forgetCloudMemory(m.id);
  const evts = await listCalendarEvents();
  const kept = evts.filter((e) => !e.id.startsWith("evt_demo_"));
  if (kept.length !== evts.length) {
    // Mark demo calendar events cancelled via batch or remove cleanly
    for (const e of evts) {
      if (e.id.startsWith("evt_demo_")) {
        e.status = "cancelled";
      }
    }
    await saveCalendarEventsBatch(evts);
  }
  const metrics = await listChannelMetrics(200);
  for (const m of metrics) {
    if (m.notes.includes("[demo-history]")) {
      await deleteChannelMetric(m.id);
    }
  }
  console.log("[seed-demo] Cleared demo records.");
  process.exit(0);
}

const nowIso = new Date().toISOString();

for (const e of DEMO_CALENDAR) {
  await upsertCalendarEvent({
    ...e,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

for (const idea of DEMO_IDEAS) {
  await upsertPipelineItem(idea);
}

for (const ctc of DEMO_CONTACTS) {
  await upsertContact(ctc);
}

let memoriesVectorSynced = 0;
for (const mem of DEMO_MEMORIES) {
  const res = await rememberCloudMemory({
    id: mem.id,
    category: mem.category,
    content: mem.content,
    tags: mem.tags,
    source: "demo-seed",
  });
  if (res.vectorSynced) memoriesVectorSynced += 1;
}
console.log(`[seed-demo] Seeded ${DEMO_MEMORIES.length} cloud memories (${memoriesVectorSynced} synced to Pinecone otto-memory).`);

// Seed a gentle 9-day historical growth curve leading up to today's real metrics
const existingMetrics = await listChannelMetrics(100);
const latestByPlatform = new Map<string, { subs: number; views: number }>();
for (const m of existingMetrics) {
  const p = m.platform.toLowerCase();
  if (!latestByPlatform.has(p) && m.subscribers !== null) {
    latestByPlatform.set(p, {
      subs: m.subscribers,
      views: m.totalViews ?? 0,
    });
  }
}

const baselines: Record<string, { subs: number; views: number; stepSubs: number; stepViews: number }> = {
  youtube: {
    subs: latestByPlatform.get("youtube")?.subs ?? 14200,
    views: latestByPlatform.get("youtube")?.views ?? 420000,
    stepSubs: 18,
    stepViews: 1450,
  },
  tiktok: {
    subs: latestByPlatform.get("tiktok")?.subs ?? 19500,
    views: latestByPlatform.get("tiktok")?.views ?? 185000,
    stepSubs: 32,
    stepViews: 920,
  },
  instagram: {
    subs: latestByPlatform.get("instagram")?.subs ?? 6400,
    views: latestByPlatform.get("instagram")?.views ?? 210,
    stepSubs: 11,
    stepViews: 1,
  },
  x: {
    subs: latestByPlatform.get("x")?.subs ?? 10820,
    views: latestByPlatform.get("x")?.views ?? 9080,
    stepSubs: 14,
    stepViews: 6,
  },
};

for (const [platform, cfg] of Object.entries(baselines)) {
  for (let daysAgo = 9; daysAgo >= 1; daysAgo -= 1) {
    const recordedAt = dateStrOffset(-daysAgo);
    const jitter = ((daysAgo * 7) % 5) - 2;
    await upsertDailyChannelMetric({
      recordedAt,
      platform,
      subscribers: Math.max(0, cfg.subs - daysAgo * cfg.stepSubs + jitter),
      totalViews: Math.max(0, cfg.views - daysAgo * cfg.stepViews),
      notes: "Historical snapshot [demo-history]",
    });
  }
}

const after = await getStudioDbOverview();
console.log("[seed-demo] Seeded Neon Studio DB successfully:", JSON.stringify(after, null, 2));
