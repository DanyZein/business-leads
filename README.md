# Business Leads Scraper

A Node.js scraper that finds local businesses with a weak or nonexistent web
presence and appends them to a Google Sheet as sales leads.

Point it at a state and a business type (`"Roofers"`, `"Restaurants"`,
`"Dentists"`), and it walks every city in that state, queries the Google Places
API (New), filters for businesses that have no website or only a DIY/social
page, and writes the results into a spreadsheet with clickable map links and a
local-time column so you know when to call.

---

## Table of contents

- [How it works](#how-it-works)
- [What counts as a lead](#what-counts-as-a-lead)
- [Requirements](#requirements)
- [Setup](#setup)
- [Configuration](#configuration)
- [Project files](#project-files)
- [Sheet column layout](#sheet-column-layout)
- [Running it](#running-it)
- [Resume and state](#resume-and-state)
- [Cost](#cost)
- [Known limitations](#known-limitations)
- [Safety and secrets](#safety-and-secrets)
- [Adding a new state or business type](#adding-a-new-state-or-business-type)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Disclaimer](#disclaimer)

---

## How it works

```
cities.js
    |
    v
getCityList()  -->  ["Baltimore, Maryland", "Rockville, Maryland", ...]   (sorted)
    |
    v
Places Text Search (New)   "Roofers in Baltimore, Maryland"
    |
    v
isTarget() filter  -->  no website  OR  DIY / social platform domain
    |
    v
seen_leads.json dedupe  -->  skip any Place ID already processed
    |
    v
appendToSheet()  -->  Google Sheets API
    |
    v
progress.json  -->  checkpoint: index of the next city to process
```

Step by step:

1. **Build the city list.** `getCityList()` flattens the `cities.js` object into
   a sorted array of `"City, State"` strings. Sorting matters: it guarantees the
   same order on every run, which is what makes the index-based checkpoint in
   `progress.json` valid.
2. **Search.** For each city, POST to
   `https://places.googleapis.com/v1/places:searchText` with
   `textQuery: "<business> in <City, State>"`.
3. **Paginate.** Follows `nextPageToken` until the city is exhausted, pausing
   2 seconds between pages.
4. **Filter.** Keeps only places that match the target profile (see below).
5. **Dedupe.** Any Place ID already present in `seen_leads.json` is skipped.
6. **Append.** Matching leads are written to the Google Sheet in one batch per
   city.
7. **Checkpoint.** `progress.json` is updated to the index of the next city, so
   the next run resumes instead of starting over.

The Requests use a field mask, so only the fields the script needs are billed
and returned: `places.id`, `places.displayName`, `places.websiteUri`,
`places.internationalPhoneNumber`, `places.formattedAddress`,
`places.utcOffsetMinutes`, `places.primaryTypeDisplayName`, and
`nextPageToken`.

---

## What counts as a lead

A place is kept if it has **no website at all**, or if its website URL contains
one of the platform domains below. These are businesses that either never got a
site or cobbled one together on a free/DIY builder, which makes them the right
target for a website sales pitch.

| Domain pattern            | What it catches                               |
| ------------------------- | --------------------------------------------- |
| _(empty)_                 | No website on the Google listing              |
| `sites.google.com`        | Google Sites                                  |
| `linktr.ee`               | Linktree                                      |
| `wixsite.com`             | Wix free subdomain                            |
| `square.site`             | Square Online                                 |
| `toasttab.com`            | Toast restaurant sites                        |
| `menupix.com`             | Third-party menu aggregator                   |
| `fb.me`, `m.facebook.com` | Facebook page / mobile Facebook               |
| `facebook.com`            | Facebook page as the primary web presence     |
| `instagram.com`           | Instagram profile as the primary web presence |

The list lives in the `isTarget` block inside `getLeadsForCity()`. Add to it as
you learn which platforms your market actually uses (see
[Roadmap](#roadmap)).

---

## Requirements

- **Node.js 18 or newer** (googleapis and axios both want a modern runtime)
- **A Google Cloud project** with billing enabled
- **Places API (New)** enabled. Not the legacy "Places API". This script calls
  the `v1` endpoint, which is the new one.
- **Google Sheets API** enabled
- **A service account** with a JSON key, so the script can write to your sheet
  without a browser login
- **A target spreadsheet**, shared with the service account's email address

---

## Setup

### 1. Install dependencies

```bash
git clone <your-repo-url>
cd business-leads
npm install axios googleapis dotenv
```

### 2. Create the Google Cloud project and enable APIs

1. Go to <https://console.cloud.google.com/> and create a project (or pick an
   existing one).
2. **APIs & Services > Library**, then enable:
   - **Places API (New)**
   - **Google Sheets API**
3. **Billing** must be enabled on the project. The Places API refuses to serve
   requests without it.

### 3. Create an API key (for Places)

1. **APIs & Services > Credentials > Create credentials > API key**.
2. Restrict it: under **API restrictions**, allow only **Places API (New)**.
   A key that can call every enabled API on your project is a liability if it
   ever leaks.

### 4. Create the service account (for Sheets)

1. **APIs & Services > Credentials > Create credentials > Service account**.
2. Give it a name, save it. No project roles are needed, sheet access is granted
   by sharing the file itself.
3. Open the service account, go to **Keys > Add key > Create new key > JSON**.
4. Save the downloaded file as `credentials.json` in the project root.
5. Copy the service account's email address (looks like
   `something@your-project.iam.gserviceaccount.com`).

### 5. Share your spreadsheet with the service account

Open the target Google Sheet, click **Share**, and add the service account email
as an **Editor**. Without this step the script authenticates fine and then fails
with a `403 PERMISSION_DENIED` on the first sheet write.

### 6. Create the `.env` file

In the project root:

```env
MAPS_API_KEY=AIzaSy...your-places-api-key...
```

Also create `.gitignore` before your first commit:

```gitignore
# Secrets
.env
credentials.json

# Dependencies
node_modules/

# Optional: scraper state (see "Safety and secrets")
# seen_leads.json
# progress.json
```

### 7. Create the sheet tab

The script writes to a tab named after the **first entry** in `TARGET_STATES`.
If `TARGET_STATES = ["Maryland"]`, there must be a tab named exactly
`Maryland`. Create it before the first run if it does not exist.

---

## Configuration

Everything you normally touch is at the top of the main script:

| Constant          | Purpose                                                          | Default             |
| ----------------- | ---------------------------------------------------------------- | ------------------- |
| `TARGET_STATES`   | States to process. Empty array means every state in `cities.js`. | `["Maryland"]`      |
| `business`        | The search term. Becomes `"<business> in <City, State>"`.        | `"Roofers"`         |
| `SEEN_LEADS_FILE` | JSON file holding every Place ID already processed.              | `"seen_leads.json"` |
| `PROGRESS_FILE`   | JSON file holding the checkpoint.                                | `"progress.json"`   |
| spreadsheet ID    | Hardcoded in `appendToSheet()` in two places.                    | your sheet          |

Rename `business` to whatever you are selling into. Good candidates:
`"Roofers"`, `"Restaurants"`, `"Dentists"`, `"Plumbers"`, `"Landscapers"`,
`"Barbershops"`.

Due to the search query format, targets you should be safe with: singular or
plural trade nouns plus a city. Text Search is not designed for ambiguous
queries, multi-concept queries, or queries naming several places at once, and it
gives worse results for those.

---

## Project files

| File                                 | Committed? | Purpose                       |
| ------------------------------------ | ---------- | ----------------------------- |
| `scraper.js`                         | Yes        | Main scraper                  |
| `cities.js`                          | Yes        | State to city-list lookup     |
| `package.json` / `package-lock.json` | Yes        | Dependencies                  |
| `.env`                               | **No**     | `MAPS_API_KEY`                |
| `credentials.json`                   | **No**     | Service account private key   |
| `node_modules/`                      | **No**     | Regenerable via `npm install` |
| `seen_leads.json`                    | Your call  | Dedupe memory (see below)     |
| `progress.json`                      | Your call  | Resume checkpoint (see below) |

### `cities.js` shape

An object keyed by state, each value an array of city names **without** the
state suffix, since the script appends `, <state>` itself:

```js
module.exports = {
  Maryland: ["Aberdeen", "Baltimore", "Rockville", "Towson"],
  Virginia: ["Alexandria", "Richmond"],
};
```

Keep the list sorted or unsorted, it does not matter, `getCityList()` sorts the
flattened output either way. What matters is that the order **does not change
between runs** while a run is in progress, or the index checkpoint will point at
the wrong city.

---

## Sheet column layout

Each lead is one row. Columns are written as a single append starting at `A2`,
which means row 1 is expected to be your header row.

| Col    | Content                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| A      | Business name (`displayName.text`)                                                                 |
| B      | Phone number, prefixed with `'` so Sheets keeps it as text. Falls back to `N/A`                    |
| C      | Address as a `=HYPERLINK()` formula pointing at Google Maps, using the Place ID for an exact match |
| D, E   | Reserved (empty)                                                                                   |
| F      | Website URL, or `NO WEBSITE`                                                                       |
| G      | Local time formula, see below                                                                      |
| H      | `Not Contacted` (your pipeline status column)                                                      |
| I to L | Reserved (empty)                                                                                   |
| M      | Business type (`primaryTypeDisplayName.text`), or `Unknown`                                        |
| N to Z | Reserved (empty)                                                                                   |
| AA     | `utcOffsetMinutes` from the API                                                                    |
| AB     | Google Place ID                                                                                    |
| AC     | Reserved (empty), but **`AC2` is read by every formula in column G**                               |

### The local time column

Column G is:

```
=NOW() + (AA<row>/1440) + ($AC$2/1440)
```

`AA` is the place's UTC offset in minutes, divided by 1440 to convert to a
fraction of a day. `$AC$2` is **not written by the script**. You fill it in
yourself with the current daylight saving adjustment in minutes (for example
`-60` or `60`). If your call times are off by exactly one hour, `AC2` is why.

Because it uses `NOW()`, the column recalculates constantly and shows the
current local time at each business, refreshed on every sheet edit. It is a live
clock, not a timestamp of when the lead was scraped.

---

## Running it

```bash
node scraper.js
```

Or via npm:

```json
{
  "scripts": {
    "start": "node scraper.js"
  }
}
```

```bash
npm start
```

Run it from the project root. The `keyFile: "credentials.json"` path in the
Google auth block is resolved relative to the **working directory**, not the
script file, so running it from elsewhere breaks authentication. Running
`node scraper/scraper.js` from a parent folder will fail for this reason.

Expected console output:

```
Loaded 312 cities for: Maryland
--- Starting City: Aberdeen, Maryland ---
Fetched batch...
✅ Success: Added 4 leads for Aberdeen, Maryland.
Progress saved. Completed 1/312 cities.
--- Starting City: Baltimore, Maryland ---
...
```

Interrupt with `Ctrl+C` at any time. Progress is checkpointed after each
completed city, so you lose at most the city in flight.

**Do not run two instances at the same time.** `appendToSheet()` finds the next
free row by reading column A, so two concurrent processes will both read the
same "last row" and overwrite each other's appends.

---

## Resume and state

Two JSON files carry state between runs.

**`progress.json`**

```json
{ "lastCityIndex": 47 }
```

The index of the next city to process. After a city finishes successfully, the
script writes `i + 1`.

**`seen_leads.json`**

```json
["ChIJifIePKtZwokRVZ-UdRGkZzs", "ChIJPxPd_P1YwokfzLhSiACEoU"]
```

Every Place ID the script has ever seen, target or not. Checked before
appending, and it is a plain array so it grows without bound.

### Failure behavior, which is the good part

If the Places API errors mid-city, `completedSuccessfully` goes false and the
loop **breaks without saving anything** for that city:

- `progress.json` is not advanced, so that city is retried on the next run
- `seen_leads.json` is not updated, so nothing is marked as processed
- `appendToSheet()` is never called, because it only runs after the whole city
  returns

The result is that a crash or rate limit mid-city leaves no partial writes and
no duplicate rows. Restart and it picks up cleanly at that same city.

### Empty page retries

Google's Text Search occasionally returns a `200` with an empty `places` array
while still handing back a `nextPageToken`. The script treats that as a
transient glitch, retries the same token up to 3 times with a 2 second delay,
then gives up and moves on to the next city. You will see:

```
Empty page, retrying token... (1/3)
```

This is normal and usually resolves on the first retry.

---

## Cost

This is the part worth reading twice, because a full-state run is real money.

### Your requests bill at the Enterprise tier

Places API (New) bills a Text Search request at the **highest** SKU of any field
you ask for. You are billed at the highest SKU applicable to your request, not
the sum of SKUs. Here is where your actual field mask lands:

| Field in your mask                | SKU            |
| --------------------------------- | -------------- |
| `places.id`, `nextPageToken`      | Essentials     |
| `places.displayName`              | Pro            |
| `places.formattedAddress`         | Pro            |
| `places.utcOffsetMinutes`         | Pro            |
| `places.primaryTypeDisplayName`   | Pro            |
| `places.websiteUri`               | **Enterprise** |
| `places.internationalPhoneNumber` | **Enterprise** |

Because `websiteUri` and `internationalPhoneNumber` are in the mask, every
request bills as **Text Search Enterprise**. Note that `displayName` is a Pro
field even though it feels essential, and `websiteUri` is Enterprise, not Pro.
Published rates put Text Search Pro at around `$32.00` per 1,000 requests at the
base volume tier and **Text Search Enterprise at `$35.00`**, dropping as monthly
volume rises. Google revises these, so check the current list before budgeting.

You cannot cheaply drop to Pro here. `websiteUri` **is** the product, it is the
filter criterion, and `internationalPhoneNumber` is what makes a lead callable.
Dropping either to save money removes the thing you are selling. Enterprise is
the honest cost of this use case.

At `$35` per 1,000, that is roughly **3.5 cents per request**. A city costs one
to three requests, because of the 60 result cap below.

| Scale         | Rough requests | Rough cost              |
| ------------- | -------------- | ----------------------- |
| 50 cities     | 50 to 150      | $1.75 to $5.25          |
| 300 cities    | 300 to 900     | $10.50 to $31.50        |
| All 50 states | thousands      | budget first, see below |

Each SKU also carries a monthly free call allowance, so light testing often
costs nothing. The old `$200` monthly Maps Platform credit is retired, so do not
budget around it.

### Reruns are not free

Nothing is cached between runs. Rerunning a state you already scraped re-issues
every request and re-bills you, even though `seen_leads.json` stops the leads
from being written twice. The dedupe saves you duplicate rows, **not** duplicate
API spend. This is the strongest argument for committing `seen_leads.json` and
`progress.json` to the repo: losing them means paying to redo the work.

### Before spending anything

```js
// Temporary: limit to the first 5 cities to validate setup and output
const TARGET_STATES = ["Maryland"];
// then in the main loop, for (let i = progress.lastCityIndex; i < 5; i++)
```

Check the Sheet output and the billing page in Cloud Console after a small run
before pointing it at a whole state. Set a **budget alert** in Cloud Console
under Billing. This script in a loop over thousands of cities is exactly the
shape of thing that produces a surprise invoice.

---

## Known limitations

- **60 results maximum per city, hard cap.** Text Search (New) returns at most
  60 results across all pages, regardless of how many matching businesses
  exist. A city with 400 roofers yields 60 candidates, of which only some pass
  the filter. **Dense cities are systematically under-scraped.** Mitigations are
  in the roadmap.
- **The filter list is incomplete.** `business.site` (Google's now-retired
  business pages), `webflow.io`, `godaddysites.com`, `weebly.com`,
  `squarespace.com` subdomains, `wordpress.com`, `yelp`, `doordash`,
  `grubhub`, `ubereats`, and `order.online` are all realistic weak-presence
  signals that are not in the list yet.
- **Substring matching.** `site.includes("fb.me")` matches anywhere in the URL,
  so an unrelated domain containing that string would false-positive. Rare in
  practice, but it is why the filter is a substring check and not a domain parse.
- **`seen_leads.json` is global.** It is shared across every state and every
  business type. A Place ID seen once is never reconsidered, even if you later
  change the filter logic. Expanding the platform list will not retroactively
  surface leads that a previous run skipped.
- **Only the first state gets a sheet tab.** `sheetName = TARGET_STATES[0]`
  means a run with `["Maryland", "Virginia"]` writes **everything** into the
  `Maryland` tab, mixing both states with no column recording which is which.
  Run one state at a time, or fix this before multi-state runs.
- **The spreadsheet ID is hardcoded in two places** in `appendToSheet()`.
- **`appendToSheet()` assumes contiguous data** starting at `A2`. Insert a blank
  row, or a row of subtotals, and the next append lands in the wrong place.
- **`utcOffsetMinutes` plus a manual `AC2`** is a two-part time solution. The API
  value plus your hand-maintained DST adjustment. It is the reason for the
  `AC2` cell, and the reason it can drift by an hour twice a year.
- **No retry on rate limit errors.** A `429` sets `completedSuccessfully` false
  and stops the whole run for that city. Safe, but blunt.
- **No `movedPlace` handling.** Google can retire a Place ID and return
  `places.movedPlaceId`. The script ignores it, so a moved business may be
  re-surfaced as new.

---

## Safety and secrets

Never commit `credentials.json` or `.env`. `credentials.json` contains a private
key that can write to any spreadsheet shared with that service account. If it
ever ends up in a pushed commit, the key is public forever, even after you
delete the file in a later commit. Rotate the key in Cloud Console immediately
and remove it from history with `git filter-repo`.

If you already committed either file:

```bash
git rm --cached credentials.json .env
```

Then add both to `.gitignore`, commit, and **rotate the exposed credentials**.
`git rm --cached` stops tracking the file but leaves the old commit intact.

`seen_leads.json` and `progress.json` are worth committing deliberately, since
losing them costs real API spend to regenerate. They are not secrets, but they
do grow, and they will produce noisy diffs on every run. Pick one and be
consistent.

Also: restrict the API key in Cloud Console to Places API (New) only, and set
spending budget alerts.

---

## Adding a new state or business type

### New state

1. Add the state key and its city array to `cities.js`, city names only, no
   state suffix.
2. Set `TARGET_STATES = ["Virginia"]`.
3. Create a sheet tab named exactly `Virginia`.
4. Reset the checkpoint: `progress.json` to `{ "lastCityIndex": 0 }`.
5. If you want a clean lead pool, start a fresh `seen_leads.json` too.
6. Run a small slice first, verify the sheet, then run the rest.

### New business type

1. Change `const business = "Dentists"`.
2. **Reset `progress.json` to index 0.** This is the step people miss. The
   checkpoint is per-position, not per-business-type, so leaving it at city 87
   means every city before 87 is silently skipped for the new business type.
3. Decide what to do with `seen_leads.json`. Place IDs are per business, so
   keeping it is usually fine and prevents a business you already logged as a
   lead from being logged again. If you want a completely fresh pass, archive it
   and start a new one.
4. Consider pointing the new vertical at its own spreadsheet or tab.

Because both state files are single fixed filenames, running two verticals in
parallel means renaming them between runs. See the roadmap.

---

## Troubleshooting

**`403 PERMISSION_DENIED` on the first sheet write**
The spreadsheet is not shared with the service account. Share it as Editor with
the `...@....iam.gserviceaccount.com` address from `credentials.json`.

**`PERMISSION_DENIED` / `API not enabled` on the Places call**
Places API (New) is not enabled, or billing is not enabled on the project. Both
are required. The legacy "Places API" is a different API and does not satisfy
this script's `v1` endpoint.

**`REQUEST_DENIED` with an API key present**
The key's API restrictions do not include Places API (New), or an application
restriction (HTTP referrer, IP) is blocking a non-browser client. Server-side
scripts should use IP restrictions or none, not HTTP referrer restrictions.

**`Unable to parse range: Maryland!A2`**
The tab named `Maryland` does not exist. `sheetName` comes from
`TARGET_STATES[0]`, so the tab must be named exactly that, including case.

**`ENOENT: no such file or directory, open 'credentials.json'`**
You are running from the wrong directory. `keyFile` resolves relative to the
working directory, so `cd` to the project root first.

**Every city logs `No new leads found`**
Either `seen_leads.json` already covers them (expected on a rerun), or the
`isTarget` filter is rejecting everything. Sanity check by temporarily logging
`p.websiteUri` for every place, unfiltered.

**`Empty page, retrying token...` repeatedly**
Expected occasionally, handled internally. If it happens on every page, the
`nextPageToken` you are sending is being rejected. All parameters other than
`pageSize`, `pageToken`, and `maxResultCount` must be identical between
paginated requests, so changing the query mid-pagination triggers
`INVALID_ARGUMENT`.

**Progress looks stuck at the same city**
That city failed and the run stopped by design. Check the error above it in the
log, fix the cause, rerun. No duplicate rows will have been written.

**Times in column G are an hour off**
Set `AC2` to the current DST offset in minutes.

**Sheet has duplicate businesses**
Two instances ran concurrently, or `seen_leads.json` was deleted/rolled back
between runs.

**`429` rate limit**
The 2 second pauses are the throttle. For heavier use, raise the delay or request
a quota increase in Cloud Console under Google Maps Platform > Quotas.

---

## Roadmap

Ideas that would make this materially better, roughly in value order:

- **Per-vertical config.** Move `TARGET_STATES`, `business`, the spreadsheet ID,
  and the state filenames into a config object or `.env`, and derive filenames
  like `seen_leads.roofers.md.json` and `progress.roofers.md.json`. This unlocks
  running multiple verticals without manual file juggling and without resetting
  your checkpoint by hand.
- **Beat the 60 result cap.** Narrow the query per city (`"roofing contractor"`
  vs `"roofers"`), or add `locationRestriction` with a viewport and split dense
  cities into sub-areas, or iterate zip codes. Dense cities are the biggest
  coverage hole.
- **Multi-state runs done right.** Write `TARGET_STATES[0]` as a per-state tab,
  or add a `State` column so mixed tabs are still filterable.
- **Expand the platform list** with the domains listed under Known limitations.
- **Retry with backoff on `429` and `5xx`** instead of halting the run.
- **Handle `movedPlaceId`** so moved businesses are not re-surfaced.
- **Verify the lead before writing.** HEAD request each website URL and drop
  404s, so `NO WEBSITE` and dead domains are trustworthy.
- **Outreach columns.** Pre-fill an email or message template column per row.
- **Scheduling.** Run nightly via Windows Task Scheduler or a cron job so new
  businesses get picked up continuously.
- **Report totals per run** (requests issued, estimated cost) so spend is
  visible without opening Cloud Console.

---

## Disclaimer

This tool queries the Google Places API and stores the results. Storing Places
content long term (as this script does, in a spreadsheet) is subject to the
Google Maps Platform Terms of Service and the Places API policies, which include
restrictions on caching and storing Places data. Review those terms before using
this for commercial outreach at scale, particularly the retention limits that
apply to data other than Place IDs.

You are also responsible for complying with the solicitation and anti-spam laws
that apply where you and your leads are located.

---

## License

MIT License

Copyright (c) 2026 Dany Zein

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
