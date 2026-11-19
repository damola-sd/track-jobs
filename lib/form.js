// Helpers shared by the popup and the dashboard edit dialog. Both forms use the same
// field names as the stored application object.
import { STATUSES, WORK_MODES } from './storage.js';

export function toLocalInput(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fillSelect(select, values, labels = {}) {
  select.replaceChildren(...values.map((v) => new Option(labels[v] ?? v, v)));
}

export function setupForm(form) {
  fillSelect(form.elements.status, STATUSES);
  fillSelect(form.elements.workMode, WORK_MODES, { '': '—' });
}

export function fillForm(form, app) {
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = app[el.name] ?? '';
    el.value = el.name === 'appliedAt' ? toLocalInput(v) : v;
  }
}

export function readForm(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name || ['checkbox', 'submit', 'button'].includes(el.type)) continue;
    data[el.name] = el.name === 'description' ? el.value : el.value.trim();
  }
  const applied = data.appliedAt ? new Date(data.appliedAt) : new Date();
  data.appliedAt = (isNaN(applied) ? new Date() : applied).toISOString();
  data.followUpAt = data.followUpAt || null;
  return data;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(isoOrDay) {
  if (!isoOrDay) return '';
  // Plain YYYY-MM-DD strings are local dates; don't let them shift by timezone.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? new Date(isoOrDay + 'T00:00') : new Date(isoOrDay);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
