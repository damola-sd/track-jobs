// Injected into the job page with chrome.scripting.executeScript({ func: extractJobDetails }).
// It is serialized, so it must be fully self-contained: no imports or outside variables.

export function extractJobDetails() {
  const MAX_DESC = 30000;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const first = (sels, read) => {
    for (const sel of [].concat(sels)) {
      const el = document.querySelector(sel);
      const v = el ? read(el) : '';
      if (v) return v;
    }
    return '';
  };
  const text = (sels) => first(sels, (el) => clean(el.textContent));
  const block = (sels) => first(sels, (el) => (el.innerText || el.textContent || '').trim());
  const meta = (n) => clean(document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content);
  const titleCase = (s) => decodeURIComponent(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const host = location.hostname.replace(/^www\./, '').toLowerCase();
  const parts = location.pathname.split('/').filter(Boolean);

  // ---- 1. Structured data (schema.org JobPosting) ----
  const ld = {};
  const findPosting = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const n of node) { const r = findPosting(n); if (r) return r; }
      return null;
    }
    const t = node['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return node;
    return node['@graph'] ? findPosting(node['@graph']) : null;
  };
  let posting = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { posting = findPosting(JSON.parse(s.textContent)); } catch { /* ignore bad JSON */ }
    if (posting) break;
  }
  if (posting) {
    ld.title = clean(posting.title);
    const org = posting.hiringOrganization;
    ld.company = clean(typeof org === 'string' ? org : org?.name);
    const locs = [].concat(posting.jobLocation || []).map((l) => {
      const a = l?.address || {};
      if (typeof a === 'string') return a;
      const country = typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name;
      return [a.addressLocality, a.addressRegion, country].filter((x) => typeof x === 'string' && x).join(', ');
    }).filter(Boolean);
    ld.location = [...new Set(locs)].join(' / ');
    if (String(posting.jobLocationType || '').toUpperCase() === 'TELECOMMUTE') ld.workMode = 'Remote';
    const bs = posting.baseSalary;
    const v = bs?.value;
    if (v && typeof v === 'object') {
      const cur = !bs.currency || bs.currency === 'USD' ? '$' : bs.currency + ' ';
      const fmt = (n) => cur + Number(n).toLocaleString();
      if (v.minValue && v.maxValue) ld.salary = `${fmt(v.minValue)} – ${fmt(v.maxValue)}`;
      else if (v.value || v.minValue) ld.salary = fmt(v.value || v.minValue);
      if (ld.salary && v.unitText) ld.salary += ' / ' + String(v.unitText).toLowerCase();
    }
    if (posting.description) {
      // DOMParser never runs scripts or loads images, unlike innerHTML.
      const html = String(posting.description).replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '$&\n');
      ld.description = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
    }
  }

  // Value of a "Label" heading's next sibling, e.g. <h2>Location</h2><p>Remote</p>.
  const labelled = (name) => {
    const h = [...document.querySelectorAll('h2, h3, dt')].find((e) => clean(e.textContent).toLowerCase() === name);
    return clean(h?.nextElementSibling?.textContent);
  };

  // ---- 2. Site-specific selectors ----
  // site.company is read from the page; site.companyGuess comes from the URL slug and is
  // only used when neither the page nor the structured data names the company.
  const site = {};
  if (host.endsWith('linkedin.com')) {
    site.title = text(['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title']);
    site.company = text(['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link']);
    site.location = text([
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet',
    ]).split('·')[0].trim();
    site.workMode = text(['.job-details-preferences-and-skills__pill', '.jobs-unified-top-card__workplace-type']);
    site.description = block(['#job-details', '.jobs-description__content', '.show-more-less-html__markup']);
    site.salary = text(['.compensation__salary', '.job-details-jobs-unified-top-card__job-insight--highlight']);
  } else if (host.endsWith('greenhouse.io')) {
    site.title = text(['.app-title', '.job__title h1', 'h1.section-header', 'h1']);
    site.company = text(['.company-name']).replace(/^at\s+/i, '');
    site.companyGuess = titleCase(new URLSearchParams(location.search).get('for') || parts[0]);
    site.location = text(['.job__location', '.location']);
    site.description = block(['.job__description', '#content']);
  } else if (host === 'jobs.lever.co') {
    site.title = text(['.posting-headline h2']);
    site.companyGuess = titleCase(parts[0]);
    site.location = text(['.posting-categories .location', '.sort-by-location']);
    site.workMode = text(['.posting-categories .workplaceTypes']);
    site.description = block(['.section-wrapper.page-full-width', '.content']);
  } else if (host === 'jobs.ashbyhq.com') {
    site.title = text(['h1.ashby-job-posting-heading', 'h1']);
    site.companyGuess = titleCase(parts[0]);
    site.location = labelled('location');
    site.workMode = labelled('location type');
    site.description = block(['.ashby-job-posting-description']);
  } else if (host.endsWith('myworkdayjobs.com')) {
    site.title = text(['[data-automation-id="jobPostingHeader"]']);
    // Workday's structured data often has a legal entity ("2100 NVIDIA USA"); the subdomain reads better.
    site.company = titleCase(host.split('.')[0]);
    site.location = text(['[data-automation-id="locations"] dd']);
    site.workMode = text(['[data-automation-id="remoteType"] dd']);
    site.description = block(['[data-automation-id="jobPostingDescription"]']);
  } else if (host.endsWith('indeed.com')) {
    site.title = text(['[data-testid="jobsearch-JobInfoHeader-title"]', '[data-testid="vj-job-title"]', 'h1'])
      .replace(/\s*-\s*job post$/i, '');
    site.company = text(['[data-testid="inlineHeader-companyName"]', '[data-company-name]',
      '[data-testid="desktop-job-header"] a[href*="/cmp/"]']);
    // The page title is "Role - Location - Indeed.com" in every layout.
    const titleParts = document.title.split(' - ');
    site.location = text(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]']) ||
      (titleParts.length >= 3 ? titleParts[titleParts.length - 2] : '');
    site.salary = text(['#salaryInfoAndJobType span']);
    site.description = block(['#jobDescriptionText']);
  } else if (host === 'apply.workable.com') {
    site.title = text(['[data-ui="job-title"]', 'h1']);
    site.companyGuess = titleCase(parts[0]);
    site.location = text(['[data-ui="job-location"]']);
    site.workMode = text(['[data-ui="job-workplace"]']);
    site.description = block(['[data-ui="job-description"]']);
  } else if (host === 'jobs.smartrecruiters.com') {
    site.title = text(['h1.job-title', 'h1']);
    site.companyGuess = titleCase(parts[0]);
    site.location = text(['.job-detail-location', 'spl-job-location']);
  }

  // ---- 3. Generic fallbacks ----
  const generic = {};
  const docTitle = clean(document.title);
  const atMatch = docTitle.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+[|\-–—]\s+.*)?$/i);
  generic.title = (atMatch && atMatch[1]) || meta('og:title') || text(['h1']) || docTitle.split(/\s+[|\-–—]\s+/)[0];
  generic.company = (atMatch && atMatch[2]) || meta('og:site_name');
  generic.description = block(['[class*="job-description" i]', '[id*="job-description" i]', 'main', 'article']);

  const pick = (k) => site[k] || ld[k] || generic[k] || '';
  const out = {
    title: pick('title'),
    company: site.company || ld.company || site.companyGuess || generic.company || '',
    location: site.location || ld.location || '',
    salary: site.salary || ld.salary || '',
    workMode: '',
    description: (site.description || ld.description || generic.description || '').slice(0, MAX_DESC),
  };

  // Work mode: normalize into Remote / Hybrid / On-site. The page's own label wins over
  // structured data, which wins over words found in the location or title.
  const modeOf = (s) => {
    if (/\bhybrid\b/i.test(s)) return 'Hybrid';
    if (/\bremote\b/i.test(s)) return 'Remote';
    if (/\bon[- ]?site\b|\bin[- ]office\b/i.test(s)) return 'On-site';
    return '';
  };
  out.workMode = modeOf(site.workMode || '') || ld.workMode || modeOf(`${out.location} ${out.title}`);

  // Salary: look for a pay range in the posting text if structured data had none.
  // Search the description first; pay is sometimes only in the page header, so fall back to the whole page.
  const findSalary = (hay) => {
    const amount = String.raw`(?:\d{2,3}(?:,\d{3})+(?:\.\d+)?|\d{2,3}(?:\.\d+)?\s?[kK]|\d{2,3}(?:\.\d{2})?(?=\s?(?:\/|per|an?)\s?(?:hour|hr)))`;
    const unit = String.raw`(?:\s?(?:USD|GBP|EUR|CAD))?(?:\s?(?:\/|per|an?)\s?(?:year|yr|annum|hour|hr))?`;
    // A range ("$120k – $150k") is almost always pay, so take the first one.
    const range = new RegExp(String.raw`[$£€]\s?${amount}\s?(?:-|–|—|to)\s?(?:[$£€]\s?)?${amount}${unit}`);
    let m = hay.match(range);
    if (!m) {
      // A single amount counts only with a pay word just before it or a pay unit after it,
      // so things like "~$15k/month for compute" are skipped.
      const single = new RegExp(String.raw`[$£€]\s?${amount}${unit}`, 'g');
      for (const s of hay.matchAll(single)) {
        const before = hay.slice(Math.max(0, s.index - 60), s.index);
        if (/salary|compensation|\bpay\b|base|wage|stipend|\bOTE\b/i.test(before) ||
            /(?:year|yr|annum|hour|hr)$/i.test(s[0])) { m = s; break; }
      }
    }
    return m ? clean(m[0]) : '';
  };
  if (!out.salary) {
    out.salary = findSalary(out.description) || findSalary((document.body?.innerText || '').slice(0, 60000));
  }

  for (const k of Object.keys(out)) if (k !== 'description') out[k] = clean(out[k]).slice(0, 300);
  return out;
}
