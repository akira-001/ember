const PROCESSED_LABEL = 'drive-saved';

const FOLDER_IDS = {
  receipt: '19w5drjOukTUx56qCHkmoRktDaSwaNw8T',
  invoice: '1fVkpSTcehrYmPL7iYd5dn8sqskukSDVd',
};

const QUERIES = {
  receipt: (days) => `in:anywhere newer_than:${days}d -label:${PROCESSED_LABEL} (subject:(領収書 OR receipt OR "your receipt") OR from:(stripe.com OR invoice))`,
  invoice: (days) => `in:anywhere newer_than:${days}d -label:${PROCESSED_LABEL} subject:(請求書 OR invoice OR INV)`,
};

const EXCLUDE_PATTERNS = [/datumix/i];

function main() {
  return runSync(3);
}

function runBackfill60d() {
  return runSync(60);
}

function runSync(days) {
  const summary = { saved: [], skipped: [], errors: [] };
  try {
    for (const kind of ['receipt', 'invoice']) {
      const query = QUERIES[kind](days);
      const threads = GmailApp.search(query);
      Logger.log(`[${kind}] query=${query} hits=${threads.length}`);
      for (const thread of threads) {
        for (const message of thread.getMessages()) {
          processMessage(message, kind, summary);
        }
      }
    }
    notifySuccess(summary, days);
  } catch (err) {
    notifyFailure(err, summary, days);
    throw err;
  }
}

function processMessage(message, kind, summary) {
  const subject = message.getSubject() || '';
  const from = message.getFrom() || '';
  const body = message.getPlainBody() || '';

  for (const pat of EXCLUDE_PATTERNS) {
    if (pat.test(subject) || pat.test(from) || pat.test(body)) {
      summary.skipped.push({ subject, reason: 'excluded' });
      return;
    }
  }

  const pdfAttachments = message.getAttachments().filter((a) =>
    (a.getContentType() || '').toLowerCase() === 'application/pdf'
  );
  if (pdfAttachments.length === 0) return;

  const year = String(message.getDate().getFullYear());
  const yearFolder = getOrCreateYearFolder(kind, year);

  let savedAny = false;
  for (const att of pdfAttachments) {
    try {
      const fileName = resolveUniqueName(yearFolder, att.getName() || 'attachment.pdf');
      yearFolder.createFile(att.copyBlob().setName(fileName));
      summary.saved.push({ kind, year, name: fileName, from, subject });
      savedAny = true;
    } catch (err) {
      summary.errors.push({ subject, file: att.getName(), error: String(err) });
    }
  }

  if (savedAny) {
    let label = GmailApp.getUserLabelByName(PROCESSED_LABEL);
    if (!label) label = GmailApp.createLabel(PROCESSED_LABEL);
    message.getThread().addLabel(label);
  }
}

const yearFolderCache = {};
function getOrCreateYearFolder(kind, year) {
  const key = `${kind}/${year}`;
  if (yearFolderCache[key]) return yearFolderCache[key];
  const parent = DriveApp.getFolderById(FOLDER_IDS[kind]);
  const existing = parent.getFoldersByName(year);
  const folder = existing.hasNext() ? existing.next() : parent.createFolder(year);
  yearFolderCache[key] = folder;
  return folder;
}

function resolveUniqueName(folder, originalName) {
  const dot = originalName.lastIndexOf('.');
  const base = dot > -1 ? originalName.slice(0, dot) : originalName;
  const ext = dot > -1 ? originalName.slice(dot) : '';
  let name = originalName;
  let i = 2;
  while (folder.getFilesByName(name).hasNext()) {
    name = `${base}_${i}${ext}`;
    i++;
  }
  return name;
}
