// Shared data layer. Everything lives in chrome.storage.local under one key.

export const STATUSES = ['Applied', 'Interviewing', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn'];
export const OPEN_STATUSES = ['Applied', 'Interviewing'];
export const WORK_MODES = ['', 'Remote', 'Hybrid', 'On-site'];

const KEY = 'applications';

// Query params that identify a specific job on some sites. All others are dropped
// when comparing URLs, so tracking params don't hide duplicates.
const KEEP_PARAMS = ['gh_jid', 'jk', 'vjk', 'currentjobid', 'jobid', 'job_id', 'id', 'for', 'token'];

const SOURCES = [
  ['linkedin.com', 'LinkedIn'],
  ['greenhouse.io', 'Greenhouse'],
  ['lever.co', 'Lever'],
  ['ashbyhq.com', 'Ashby'],
  ['myworkdayjobs.com', 'Workday'],
  ['workday.com', 'Workday'],
  ['indeed.com', 'Indeed'],
  ['glassdoor.', 'Glassdoor'],
  ['workable.com', 'Workable'],
  ['smartrecruiters.com', 'SmartRecruiters'],
  ['icims.com', 'iCIMS'],
  ['jobvite.com', 'Jobvite'],
  ['bamboohr.com', 'BambooHR'],
  ['wellfound.com', 'Wellfound'],
  ['ycombinator.com', 'Y Combinator'],
  ['otta.com', 'Otta'],
  ['welcometothejungle.com', 'Welcome to the Jungle'],
  ['dice.com', 'Dice'],
  ['ziprecruiter.com', 'ZipRecruiter'],
  ['monster.', 'Monster'],
];

export function normalizeUrl(raw) {
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch { return String(raw).trim().toLowerCase(); }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  // LinkedIn shows the same job under many paths; collapse to /jobs/view/<id>.
  if (host.endsWith('linkedin.com')) {
    // Signed-in: /jobs/view/123  ·  Guest: /jobs/view/software-engineer-at-acme-123
    const id = u.searchParams.get('currentJobId') || (u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1];
    if (id) return `linkedin.com/jobs/view/${id}`;
  }

  const path = u.pathname
    .replace(/\/+$/, '')
    .replace(/\/(apply|application|applications)$/i, '')
    .toLowerCase();
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => KEEP_PARAMS.includes(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .sort();
  return host + path + (kept.length ? '?' + kept.join('&') : '');
}

export function detectSource(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [needle, name] of SOURCES) if (host.includes(needle)) return name;
    return 'Company site';
  } catch {
    return '';
  }
}

export async function getAll() {
  const r = await chrome.storage.local.get(KEY);
  return Array.isArray(r[KEY]) ? r[KEY] : [];
}

async function setAll(apps) {
  await chrome.storage.local.set({ [KEY]: apps });
}

const DEFAULTS = {
  url: '', company: '', title: '', location: '', workMode: '', salary: '', source: '',
  status: 'Applied', appliedAt: '', contact: '', resumeVersion: '', followUpAt: null,
  followUpNotified: false, notes: '', description: '', statusHistory: [],
};

// Insert a new application or merge changes into an existing one (matched by id).
export async function saveApplication(app) {
  const apps = await getAll();
  const now = new Date().toISOString();
  const i = app.id ? apps.findIndex((a) => a.id === app.id) : -1;
  let saved;

  if (i >= 0) {
    const prev = apps[i];
    saved = { ...prev, ...app, updatedAt: now };
    saved.urlKey = normalizeUrl(saved.url);
    if (prev.status !== saved.status) {
      saved.statusHistory = [...(prev.statusHistory || []), { status: saved.status, at: now }];
    }
    if ((prev.followUpAt || null) !== (saved.followUpAt || null)) saved.followUpNotified = false;
    apps[i] = saved;
  } else {
    const appliedAt = app.appliedAt || now;
    saved = {
      ...DEFAULTS,
      ...app,
      id: app.id || crypto.randomUUID(),
      appliedAt,
      urlKey: normalizeUrl(app.url),
      createdAt: now,
      updatedAt: now,
    };
    if (!saved.statusHistory?.length) saved.statusHistory = [{ status: saved.status, at: appliedAt }];
    apps.push(saved);
  }

  await setAll(apps);
  return saved;
}

export async function deleteApplication(id) {
  const apps = await getAll();
  await setAll(apps.filter((a) => a.id !== id));
}

// Apply a mutation to every application, then save once.
export async function patchApplications(fn) {
  const apps = await getAll();
  let changed = false;
  for (const a of apps) if (fn(a)) changed = true;
  if (changed) await setAll(apps);
  return apps;
}

// Matches on the same normalized URL, or the same company + role.
export function findMatches(apps, url, company, title) {
  const key = normalizeUrl(url);
  const c = (company || '').trim().toLowerCase();
  const t = (title || '').trim().toLowerCase();
  return apps.filter((a) =>
    (key && a.urlKey === key) ||
    (c && t && a.company?.trim().toLowerCase() === c && a.title?.trim().toLowerCase() === t));
}

export async function importApplications(list) {
  if (!Array.isArray(list)) throw new Error('Expected a JSON array of applications.');
  const apps = await getAll();
  const ids = new Set(apps.map((a) => a.id));
  const now = new Date().toISOString();
  let added = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object' || ids.has(item.id)) continue;
    const a = { ...DEFAULTS, ...item };
    a.id = a.id || crypto.randomUUID();
    a.urlKey = normalizeUrl(a.url);
    a.appliedAt = a.appliedAt || now;
    a.createdAt = a.createdAt || now;
    a.updatedAt = now;
    if (!a.statusHistory?.length) a.statusHistory = [{ status: a.status, at: a.appliedAt }];
    apps.push(a);
    ids.add(a.id);
    added++;
  }
  await setAll(apps);
  return added;
}

const CSV_COLUMNS = [
  'appliedAt', 'company', 'title', 'location', 'workMode', 'salary', 'source', 'status',
  'contact', 'resumeVersion', 'followUpAt', 'notes', 'url',
];

export function toCSV(apps) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = apps.map((a) => CSV_COLUMNS.map((c) => esc(a[c])).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

export function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isFollowUpDue(a) {
  return !!a.followUpAt && a.followUpAt <= todayLocal() && OPEN_STATUSES.includes(a.status);
}
