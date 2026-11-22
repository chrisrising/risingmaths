# RisingMaths

Free GCSE and Functional Skills maths resources for teachers, at
**[risingmaths.web.app](https://risingmaths.web.app)**.

## What's here

```
public/index.html       the home page, with a Fermi question of the day
public/classtools.html  the ClassTools app page, with the download button
firebase.json           hosting settings
deploy.cmd              double-click to put changes live (Windows)
SETUP.txt               first-time setup, if you ever start from scratch
```

The site is plain HTML with no build step — open a file, edit it, deploy.

## Publishing a change

Edit the files in `public`, then either double-click `deploy.cmd` or run:

```bash
firebase deploy --only hosting
```

Commit and push as well, so the repo matches what's live.

## The ClassTools download button

The download button on the ClassTools page is not a fixed link. When the page
loads it asks GitHub for the newest release of
[chrisrising/classtools](https://github.com/chrisrising/classtools), then
points itself at that zip and prints the version, date and size beside the
button. Publishing a new release is all it takes — this site needs no edit.

The link written into the HTML is a direct download of the current zip, so the
button still works with scripts turned off.

## Update emails

The sign-up box on the ClassTools page posts into a Google Form, "ClassTools
updates", which collects the addresses.

`email/ClassTools-updates.gs` runs on that form (three dots > Apps Script). Once
a week it asks GitHub whether a new ClassTools version has been released. If one
has, everybody signed up gets a short email with three of the changes, taken
from the release notes. If not, nothing is sent, so nobody gets an email for the
sake of it.

Every email carries an unsubscribe link pointing at a second form, "Stop
ClassTools emails", with the reader's own address already filled in. The script
reads that form too and skips anyone on it, so coming off the list is one click
for them and nothing to do for you.

Setup, and the by-hand functions (`previewToMe`, `whoIsOnTheList`, `sendNow`),
are documented at the top of that file.

## Hosting notes

- `cleanUrls` is on, so the ClassTools page is `/classtools`. The older
  `/classtools.html` address redirects to it.
- Nothing is cached, so a deploy is visible straight away rather than teachers
  being served a stale page. If images get added later, they could be allowed
  to cache.
