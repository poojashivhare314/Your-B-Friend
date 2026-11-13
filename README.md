# Your B Friend

### Find your next book. Explore the story beyond the page.

Your B Friend is a book discovery companion that brings recommendations, a reading shelf, and cross-media discovery into one responsive Expo app for web, Android, and iOS.

> **Status:** Early local-development MVP. Web and API flows have been exercised locally; native device builds and public deployment still need validation.

## The idea

A great book can lead to another book, a podcast conversation, a film, or a video essay. Finding those connections often means searching several services separately. Your B Friend starts with the book and brings those paths together, while making room for literature from Nepal and India alongside global titles.

No account is required. Readers can optionally share an age group, region, and interests, then discover curated collections and recommendations. Each book has a details view with shelf controls and links to possible related media.

## Features

- **Discover:** Browse suggestions and curated Nepal, India, and global collections.
- **Search:** Find books using Open Library and Google Books.
- **Keep a shelf:** Mark books as want to read, currently reading, or read, and add a one-to-five-star rating.
- **Explore beyond the book:** Find possible podcast episodes and search for movies, series, and YouTube videos. Optional API keys enable direct TMDb and YouTube results.
- **Personalize without signing in:** Choose interests and a region in a skippable setup. Preferences are associated with a locally stored anonymous device ID.
- **Use one codebase:** React Native and Expo support mobile and responsive web.

## How recommendations work

The recommendation service compares selected interests and metadata from books marked as read with book subjects and authors. It also uses anonymous read/reading counts from other users in the same age group or region. When there is little community activity, it falls back to a small curated collection. These collections are editorial starting points, not live bestseller charts. City is saved as a preference but is not currently used in rankings.

The cross-media explorer searches Apple Podcasts and, when configured, TMDb and YouTube. A **Possible match** is based on title overlap and may be unrelated. A **Likely adaptation** requires an exact normalized title, supporting metadata, and a release year no earlier than the book's publication year. This is an automated signal, not human verification. Podcast and video discussions are presented as possible matches, and search links are available when a provider is unavailable. Results and availability vary by region.

A no-login book discovery app for web, Android and iOS, built with Expo and a small Node/SQLite API. The API creates its database and seeds its curated books on first start. Recommendations combine interest and read-book metadata with anonymous community counts and curated regional fallbacks. Collections are editorial starting points, not verified live bestseller charts. Search queries Open Library and Google Books; availability depends on those providers.

## Run locally

Install Node.js **24 LTS or later** with npm. Clone the project and start the server:

```powershell
git clone https://github.com/poojashivhare314/Your-B-Friend.git
cd Your-B-Friend/apps/client
npm install
cd ..\..
node apps/server/server.js
```

Leave that terminal open. In a second terminal:

```powershell
cd Your-B-Friend/apps/client
npm run web
```

Open the URL printed by Expo (normally http://localhost:8081). The API runs on port 3001. Use the first-run screen to select interests or skip it, then select a book to add it to a shelf and rate it.

For Android emulator, run `npm run android` in `apps/client`; the default API address is `10.0.2.2:3001`. For a physical device, set the API URL to your computer's LAN address **before** starting Expo, for example:

```powershell
$env:EXPO_PUBLIC_API_URL='http://192.168.1.20:3001'
npm start
```

Replace the example address with your computer's actual LAN IP, keep both devices on the same network, and allow port 3001 through the firewall if needed. Scan the Expo QR code with Expo Go. On macOS with Xcode, `npm run ios` opens the iOS simulator; physical iOS devices also need the LAN URL. Native builds and simulators require their platform tooling. For a phone browser, set the same LAN URL before starting `npm run web` and open the Expo address from the phone.

## Structure

```text
apps/
  client/       Expo React Native and React Native Web interface
    App.js      Navigation, onboarding, search, shelf and preferences
    app.json
    package.json
  server/
    server.js   HTTP API, SQLite schema, search cache and recommendations
    seed.json   Curated Nepal, India and global books
    books.db    Generated on first run (not committed)
```

The API exposes `POST /api/session/init`, `POST /api/books/interact`, `GET /api/books/search?q=...`, `GET /api/books/shelf?device_uuid=...`, and `GET /api/recommendations?device_uuid=...`. It stores sessions, books, one current interaction per device/book, and regional seed rankings. Search results are cached in memory for one hour. The app uses Expo's entry point and responsive in-app navigation; it does not currently use Expo Router. Native deep linking is not configured, and native builds need device testing.

Each book opens a details view with podcast, movie, series and YouTube discovery. On the web, known books also have a shareable `/book/:bookId` path on the same server; search results are stored when searched. The endpoint `GET /api/books/:bookId/adaptations?title=...&author=...&year=...` uses Apple Podcasts without a key, and optionally TMDb and YouTube Data API. Before starting the server, set `TMDB_API_KEY` and/or `YOUTUBE_API_KEY` in its environment to enable those providers. For example, in PowerShell: `$env:TMDB_API_KEY='your-key'` and `$env:YOUTUBE_API_KEY='your-key'`. Never put keys in the client. Provider results are cached in SQLite for seven days when configured providers respond successfully; errors are retried. Search links remain available without keys. YouTube and podcast results are treated as possible discussions, not verified adaptations. Even a “Likely adaptation” is an automated metadata match, not a human verification; missing publication years prevent that label. Native app links open the details view in-app, but native deep linking is not configured.

The recommendation approach is informed by the common content-based book-recommendation pattern found in projects such as [AmoliR/nlp-for-book-recommendation](https://github.com/AmoliR/nlp-for-book-recommendation); this implementation is original and does not copy that project's code or dataset. It uses lightweight token overlap with normalization rather than TF-IDF. Community rankings use region and age group; the optional city is stored but is not currently used to calculate trends.

## Local MVP boundaries

This is a local development server, not a public production deployment. It has no authentication, transport security, abuse controls, account recovery, or cross-device identity. Anyone with a device ID and access to the server could read or alter that device's shelf; anonymous IDs are not secret credentials. Keep it on a trusted network. Preferences and shelf data are stored in SQLite on the server, while the device ID and preferences are also stored locally. Deleting the database resets server data. Google Books or Open Library may omit covers and metadata or be unavailable.
