/**
 * ClassTools update emails
 * ------------------------
 * Lives on the "ClassTools updates" Google Form, which collects the addresses.
 *
 * Once a week it asks GitHub whether a new version of ClassTools has been
 * released. If there is one, everyone who signed up gets a short email saying
 * so, with three of the changes taken from the release notes. If there isn't,
 * it does nothing, so nobody is emailed for the sake of it.
 *
 * Setting it up (once):
 *   1. Open the form, click the three dots top right, choose Apps Script.
 *   2. Replace everything in the editor with this file, and save.
 *   3. Run "setUp" from the dropdown at the top. Google will ask you to
 *      authorise it - that is Google asking whether you trust your own script.
 *   4. That's it. It runs every Monday morning by itself.
 *
 * Useful things you can run by hand from the same dropdown:
 *   previewToMe   - sends you, and only you, what the next email would look like
 *   whoIsOnTheList - logs the addresses currently signed up
 *   sendNow       - emails everyone about the current version, ignoring whether
 *                   they have already had it. For when you want to force one out.
 */

var REPO = 'chrisrising/classtools';
var DOWNLOAD_PAGE = 'https://risingmaths.web.app/classtools';
var FROM_NAME = 'RisingMaths';


/** Run this once to start the weekly check. */
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyCheck')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();

  // Remember the version that is out right now WITHOUT emailing anyone about
  // it, so the first email people get is for the next release rather than one
  // they already have.
  var rel = latestRelease();
  var props = PropertiesService.getScriptProperties();
  if (rel && !props.getProperty('lastVersion')) {
    props.setProperty('lastVersion', rel.tag);
    Logger.log('Set up. Currently out: ' + rel.tag + '. The next release will be emailed about.');
  } else {
    Logger.log('Set up. Weekly check runs each Monday morning.');
  }
}


/** The weekly job. Emails only when GitHub has a version nobody has been told about. */
function weeklyCheck() {
  var props = PropertiesService.getScriptProperties();
  var rel = latestRelease();
  if (!rel) { Logger.log('Could not reach GitHub. Trying again next week.'); return; }

  if (rel.tag === props.getProperty('lastVersion')) {
    Logger.log('No new version since ' + rel.tag + '. Nothing sent.');
    return;
  }

  var sent = emailEveryone(rel);
  props.setProperty('lastVersion', rel.tag);
  props.setProperty('lastSentAt', new Date().toISOString());
  Logger.log('Emailed ' + sent + ' people about ' + rel.tag + '.');
}


/** Emails everyone about whatever is out now, new or not. */
function sendNow() {
  var rel = latestRelease();
  if (!rel) { Logger.log('Could not reach GitHub.'); return; }
  var sent = emailEveryone(rel);
  PropertiesService.getScriptProperties().setProperty('lastVersion', rel.tag);
  Logger.log('Emailed ' + sent + ' people about ' + rel.tag + '.');
}


/** Sends the email to you alone, so you can see it before anyone else does. */
function previewToMe() {
  var rel = latestRelease();
  if (!rel) { Logger.log('Could not reach GitHub.'); return; }
  var me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: me,
    subject: '[Preview] ' + subjectFor(rel),
    htmlBody: bodyFor(rel),
    name: FROM_NAME
  });
  Logger.log('Preview sent to ' + me);
}


/** Logs who is currently signed up. */
function whoIsOnTheList() {
  var list = subscribers();
  Logger.log(list.length + ' on the list:\n' + list.join('\n'));
}


/* ------------------------------------------------------------------ */

/** The newest release on GitHub: its version, date and first three changes. */
function latestRelease() {
  try {
    var res = UrlFetchApp.fetch(
      'https://api.github.com/repos/' + REPO + '/releases/latest',
      { muteHttpExceptions: true, headers: { 'Accept': 'application/vnd.github+json' } });
    if (res.getResponseCode() !== 200) return null;
    var r = JSON.parse(res.getContentText());
    return {
      tag: r.tag_name,
      version: String(r.tag_name).replace(/^v/, ''),
      date: new Date(r.published_at),
      changes: threeChanges(r.body || '')
    };
  } catch (err) {
    return null;
  }
}


/**
 * Pulls three changes out of the release notes. The notes are bullet points, so
 * take the first three, drop the markdown, and keep them short enough to scan.
 */
function threeChanges(body) {
  var out = [];
  body.split('\n').forEach(function (line) {
    if (out.length >= 3) return;
    var t = line.trim();
    if (!/^[-*]\s+/.test(t)) return;
    t = t.replace(/^[-*]\s+/, '')
         .replace(/\*\*(.+?)\*\*/g, '$1')      // bold
         .replace(/\*(.+?)\*/g, '$1')          // italic
         .replace(/`(.+?)`/g, '$1')            // code
         .replace(/\[(.+?)\]\(.+?\)/g, '$1')   // links
         .trim();
    if (t.length > 160) t = t.slice(0, 157).replace(/\s+\S*$/, '') + '…';
    if (t) out.push(t);
  });
  return out;
}


/** Everyone who has filled the form in, tidied up and with duplicates removed. */
function subscribers() {
  var seen = {}, list = [];
  FormApp.getActiveForm().getResponses().forEach(function (resp) {
    resp.getItemResponses().forEach(function (item) {
      var v = String(item.getResponse() || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return;
      if (seen[v]) return;
      seen[v] = true;
      list.push(v);
    });
  });
  return list;
}


function subjectFor(rel) {
  return 'ClassTools ' + rel.version + ' is out';
}


function bodyFor(rel) {
  var items = rel.changes.length
    ? '<ul style="margin:0 0 18px;padding-left:20px">' +
        rel.changes.map(function (c) {
          return '<li style="margin-bottom:8px">' + escapeHtml(c) + '</li>';
        }).join('') +
      '</ul>'
    : '';

  return '' +
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;' +
    'line-height:1.5;color:#222;max-width:560px">' +
      '<p style="margin:0 0 18px">A new version of ClassTools is ready to download.</p>' +
      '<p style="margin:0 0 10px"><strong>Version ' + escapeHtml(rel.version) + '</strong></p>' +
      items +
      '<p style="margin:0 0 24px">' +
        '<a href="' + DOWNLOAD_PAGE + '" ' +
        'style="display:inline-block;background:#1f5fa8;color:#fff;text-decoration:none;' +
        'padding:12px 22px;border-radius:8px;font-weight:600">Download it</a>' +
      '</p>' +
      '<p style="margin:0 0 6px;color:#5b6573;font-size:14px">' +
        'Remember to right-click the zip and tick Unblock before extracting it.' +
      '</p>' +
      '<p style="margin:18px 0 0;color:#5b6573;font-size:13px">' +
        'You signed up for these on RisingMaths. Reply to this email and I\'ll take you off the list.' +
      '</p>' +
    '</div>';
}


/** Sends to everyone, one at a time so nobody sees anyone else's address. */
function emailEveryone(rel) {
  var list = subscribers();
  if (!list.length) { Logger.log('Nobody on the list yet.'); return 0; }

  var quota = MailApp.getRemainingDailyQuota();
  if (quota < list.length) {
    Logger.log('Careful: ' + list.length + ' to email but only ' + quota +
               ' left in today\'s Gmail allowance. Sending what it allows.');
  }

  var subject = subjectFor(rel), html = bodyFor(rel), sent = 0;
  list.forEach(function (to) {
    if (sent >= quota) return;
    try {
      MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: FROM_NAME });
      sent++;
    } catch (err) {
      Logger.log('Could not email ' + to + ': ' + err);
    }
  });
  return sent;
}


function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
