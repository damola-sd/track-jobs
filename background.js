import {
  getAll, saveApplication, findMatches, normalizeUrl, detectSource,
  patchApplications, isFollowUpDue,
} from './lib/storage.js';
import { extractJobDetails } from './lib/extract.js';

const MENU_ID = 'log-application';
const ALARM = 'follow-ups';
const ICON = 'icons/icon128.png';
const DASHBOARD = 'dashboard/dashboard.html';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Log this job application',
    contexts: ['page', 'link', 'selection'],
  });
  setupAlarm();
});

chrome.runtime.onStartup.addListener(setupAlarm);

function setupAlarm() {
  chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 60 });
}

// ---- Right-click quick save ----
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  let d = {};
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobDetails });
    d = res?.result || {};
  } catch { /* e.g. chrome:// pages; save what we have */ }

  const apps = await getAll();
  const dup = findMatches(apps, tab.url, d.company, d.title)[0];
  if (dup) {
    notify(`dup:${dup.id}`, 'Already logged', `${dup.company || 'Unknown company'} — ${dup.title || 'Untitled role'} (${dup.status})`);
    return;
  }
  const saved = await saveApplication({
    url: tab.url,
    company: d.company || '',
    title: d.title || tab.title || '',
    location: d.location || '',
    workMode: d.workMode || '',
    salary: d.salary || '',
    description: d.description || '',
    source: detectSource(tab.url),
    status: 'Applied',
    appliedAt: new Date().toISOString(),
  });
  notify(`saved:${saved.id}`, 'Application logged',
    `${saved.company || 'Unknown company'} — ${saved.title || 'Untitled role'}. Click to review it in the dashboard.`);
});

// ---- Badge: show a check on pages you've already logged ----
async function updateBadge(tabId, url) {
  const key = normalizeUrl(url);
  const apps = key ? await getAll() : [];
  const hit = apps.find((a) => a.urlKey === key);
  await chrome.action.setBadgeText({ tabId, text: hit ? '✓' : '' });
  if (hit) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
    await chrome.action.setTitle({ tabId, title: `Logged: ${hit.company} — ${hit.title} (${hit.status})` });
  } else {
    await chrome.action.setTitle({ tabId, title: 'Log this job application' });
  }
}

async function refreshActiveBadges() {
  const tabs = await chrome.tabs.query({ active: true });
  for (const t of tabs) if (t.id && t.url) updateBadge(t.id, t.url).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'complete') updateBadge(tabId, tab.url).catch(() => {});
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) updateBadge(tabId, tab.url).catch(() => {});
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.applications) refreshActiveBadges();
});

// ---- Follow-up reminders ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const due = [];
  await patchApplications((a) => {
    if (isFollowUpDue(a) && !a.followUpNotified) {
      a.followUpNotified = true;
      due.push(a);
      return true;
    }
    return false;
  });
  for (const a of due) {
    notify(`followup:${a.id}`, 'Time to follow up',
      `${a.company || 'Unknown company'} — ${a.title || 'role'} (applied ${new Date(a.appliedAt).toLocaleDateString()})`);
  }
});

function notify(id, title, message) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 1 });
}

chrome.notifications.onClicked.addListener((id) => {
  const appId = id.split(':')[1];
  chrome.tabs.create({ url: chrome.runtime.getURL(`${DASHBOARD}${appId ? `#${appId}` : ''}`) });
  chrome.notifications.clear(id);
});
