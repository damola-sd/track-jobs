# Job Application Tracker (Chrome extension)

Log every job you apply to in one click. Data stays in your browser (`chrome.storage.local`); nothing is sent anywhere.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension (puzzle icon → pin) so the icon is always visible.

After editing code, click the ↻ reload button on the extension's card.

## Use

- **Popup** – On a job page, click the icon (or press `Alt+Shift+J`). Company, title, location, work mode, salary and source are filled in from the page; URL and date/time are set automatically. Check the fields, then click **Save**.
- **Right-click → "Log this job application"** – saves immediately with the detected details and shows a notification.
- **Badge** – a green ✓ on the icon means you've already logged the current page. The popup also warns you about duplicates (same URL, or same company + role).
- **Dashboard** – click **Dashboard ↗** in the popup, or right-click the icon → Options. From there you can search, filter and sort, change status inline, click a row to edit everything, and export to CSV/JSON. Use **Import JSON** to restore a backup.
- **Follow-ups** – set a "Follow up on" date and you'll get a desktop notification on that day while the application is still Applied/Interviewing.

## What's stored per application

`url`, `appliedAt` (date + time), `company`, `title`, `location`, `workMode`, `salary`, `source`, `status`, `statusHistory` (each change, timestamped), `contact`, `resumeVersion`, `followUpAt`, `notes`, `description` (optional snapshot of the posting).

## Supported sites for auto-detection

LinkedIn, Greenhouse, Lever, Ashby, Workday, Indeed, Workable and SmartRecruiters each have dedicated rules. Any other site that publishes schema.org `JobPosting` data works too. If a site has neither, the extension falls back to the page title and headings. Fields can always be edited before saving.

## Files

```
manifest.json         Extension config (Manifest V3)
background.js         Context menu, badge, follow-up reminders
lib/storage.js        Data model, duplicate detection, import/export
lib/extract.js        Page parser injected into job pages
lib/form.js           Form helpers shared by popup + dashboard
lib/base.css          Shared styles (light/dark)
popup/                The save form
dashboard/            Full-page list of applications
icons/                Extension icons
```

## Permissions

- `tabs` – reads the current tab's URL to show the ✓ badge. Chrome describes this as "Read your browsing history".
- `activeTab` + `scripting` – read the job page only when you click the icon or the menu item.
- `storage`/`unlimitedStorage`, `contextMenus`, `alarms`, `notifications` – saving data, the right-click item, and follow-up reminders.

Chrome can clear `chrome.storage.local` if you remove the extension, so **Export JSON** now and then as a backup.
