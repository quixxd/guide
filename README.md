# Tour Guide (prototype)

A personal audio tour guide for walks and drives. Open it on your phone, pick what interests you, and it talks you through the place as you move. Product spec: `spec/rev1/spec.md`. Architecture and costs: `spec/rev1/architecture.md`.

This is the first prototype (architecture "A": everything generated live). It's a mobile web app: the phone's browser handles GPS, the voice (built-in speech synthesis) and push-to-talk (built-in speech recognition). A small Node server finds nearby places (Wikipedia, OpenStreetMap), decides what to talk about and when, and has Claude write the commentary.

## Run it

Needs Node 24+.

```sh
npm install
cp .env.example .env     # then put your ANTHROPIC_API_KEY in .env
npm start                # http://localhost:8787
```

Simulated tours work straight away on desktop: choose **Simulated route**, pick a preset (or tap start and end points on the map), and press **Start tour**.

## Test on your phone while walking

The phone needs an HTTPS address for GPS and the microphone. The simplest way is a free Cloudflare quick tunnel from this PC:

1. Install cloudflared once: `winget install --id Cloudflare.cloudflared`
2. With the server running, in a second terminal: `npm run tunnel`
3. It prints a `https://….trycloudflare.com` address. On the phone, open `https://….trycloudflare.com/?key=<ACCESS_TOKEN from .env>`. The phone remembers the key after the first visit.

The PC has to stay on and online while you walk, and the tunnel address changes every time you restart it.

Tips for the walk:
- Use headphones, and keep the screen on (the app asks the browser to keep it awake). Browsers stop GPS when the screen locks.
- The first segment takes a few seconds to start. Wait until you're moving before judging the timing.
- Turn on **Settings → Show debug panel** to see what the guide thinks: your speed, mode, the places it's considering, and why it picked one.
- In **Settings** you can choose the voice. Phones often have better "enhanced" voices you can download in the system settings.

## Develop

```sh
npm run dev        # server with auto-restart
npm test           # unit tests (planner, geometry, stream parsing)
npm run typecheck
node scripts/time-sources.ts 38.7075 -9.1364   # time each external data source at a position
```
